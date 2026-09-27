/**
 * 의존성 없는 간단한 E2E 테스트.
 *  - 로컬 Chrome을 headless 로 띄우고 CDP(WebSocket)로 조작/검증한다.
 *  - 실행: node scripts/e2e.mjs [url]
 */
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'

const URL_UNDER_TEST = process.argv[2] ?? 'http://127.0.0.1:4173/singing-bowl/'
const PORT = 9333
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PROFILE = '/tmp/sb-e2e-profile'

rmSync(PROFILE, { recursive: true, force: true })

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function findPageTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const targets = await response.json()
      const page = targets.find((target) => target.type === 'page')
      if (page) return page
    } catch {
      /* 아직 준비되지 않음 */
    }
    await sleep(250)
  }
  throw new Error('Chrome 디버깅 포트에 연결하지 못했습니다.')
}

const target = await findPageTarget()
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let messageId = 0
const pending = new Map()
const consoleErrors = []

// 가짜 새 버전 응답(업데이트 안내 테스트용)
let fakeBuildTime = null
const FAKE_BUILD_TIME = '2099-01-01T00:00:00.000Z'
const offlinePhase = { value: false }

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(JSON.stringify(message.error)))
    else resolve(message.result)
    return
  }
  if (message.method === 'Fetch.requestPaused') {
    const { requestId, request } = message.params
    if (fakeBuildTime && request.url.includes('version.json')) {
      send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'content-type', value: 'application/json' },
          { name: 'cache-control', value: 'no-store' },
        ],
        body: Buffer.from(JSON.stringify({ buildTime: fakeBuildTime })).toString('base64'),
      }).catch(() => {})
    } else {
      send('Fetch.continueRequest', { requestId }).catch(() => {})
    }
    return
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails
    const line = `exception: ${details.exception?.description ?? details.text}`
    consoleErrors.push(line)
    console.log(`[browser] ${line.split('\n')[0]}`)
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    const line = `console.error: ${message.params.args.map((arg) => arg.value ?? arg.description).join(' ')}`
    consoleErrors.push(line)
    console.log(`[browser] ${line.split('\n')[0]}`)
  }
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
    const text = message.params.entry.text
    // 오프라인 테스트 중 발생하는 네트워크 오류는 예상된 것이라 무시한다.
    if (offlinePhase.value && /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/.test(text)) return
    const line = `log: ${text}`
    consoleErrors.push(line)
    console.log(`[browser] ${line.split('\n')[0]}`)
  }
})

function send(method, params = {}) {
  const id = (messageId += 1)
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression, { userGesture = false } = {}) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture,
  })
  if (result.exceptionDetails) {
    throw new Error(
      `평가 실패: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
    )
  }
  return result.result.value
}

const clickButton = (text) => `(() => {
  const normalize = (value) => value.replace(/\\s+/g, ' ').trim()
  const buttons = [...document.querySelectorAll('button')]
  const el = buttons.find((button) => normalize(button.textContent).includes(${JSON.stringify(text)}))
  if (!el) return 'NOT_FOUND'
  if (el.disabled) return 'DISABLED'
  el.click()
  return 'OK'
})()`

async function click(label, { userGesture = false } = {}) {
  const result = await evaluate(clickButton(label), { userGesture })
  if (result !== 'OK') throw new Error(`버튼 클릭 실패(${label}): ${result}`)
  await sleep(150)
}

const text = () => evaluate('document.body.innerText')

async function waitFor(predicate, description, timeoutMs = 6000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true
    await sleep(150)
  }
  throw new Error(`시간 초과: ${description}`)
}

const checks = []
function check(name, condition, detail = '') {
  checks.push({ name, ok: !!condition, detail })
  console.log(`${condition ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

process.on('uncaughtException', async (error) => {
  console.log(`\n중단(예외): ${error?.message}`)
  await report()
})
process.on('unhandledRejection', async (error) => {
  console.log(`\n중단(거부): ${error?.message}`)
  await report()
})

async function report() {
  const failed = checks.filter((entry) => !entry.ok)
  console.log(`\n결과: ${checks.length - failed.length}/${checks.length} 통과`)
  if (consoleErrors.length) {
    console.log('\n콘솔 오류:')
    for (const error of consoleErrors) console.log(` - ${error}`)
  }
  try {
    socket.close()
  } catch {
    /* noop */
  }
  chrome.kill()
  process.exit(1)
}

/* ------------------------------ 도우미 함수 ------------------------------ */

/** 브라우저 안에서 WAV 파일 객체를 만드는 도우미를 설치한다. */
const installFileFactory = () =>
  evaluate(`(() => {
  window.__makeWavFile = (name, mime, seconds = 0.5, frequency = 440) => {
    const sampleRate = 8000
    const frames = Math.round(sampleRate * seconds)
    const buffer = new ArrayBuffer(44 + frames * 2)
    const view = new DataView(buffer)
    const text = (offset, value) => {
      for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i))
    }
    text(0, 'RIFF')
    view.setUint32(4, 36 + frames * 2, true)
    text(8, 'WAVE')
    text(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    text(36, 'data')
    view.setUint32(40, frames * 2, true)
    for (let i = 0; i < frames; i += 1) {
      view.setInt16(44 + i * 2, Math.round(Math.sin((i / sampleRate) * 2 * Math.PI * frequency) * 12000), true)
    }
    return new File([buffer], name, mime ? { type: mime } : undefined)
  }
  return true
})()`)

/** 파일 입력에 파일을 넣고 change 이벤트를 발생시킨다. */
const uploadFile = (fileExpression) =>
  evaluate(`(() => {
  const input = document.querySelector('input[type=file]')
  if (!input) return 'NO_INPUT'
  const transfer = new DataTransfer()
  transfer.items.add(${fileExpression})
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return 'OK'
})()`)

/** 업데이트 안내 배너가 화면에 있는지(배너 전용 버튼으로 판별) */
const updateBannerVisible = () =>
  evaluate(
    `[...document.querySelectorAll('button')].some((el) => el.textContent.includes('지금 새로고침'))`,
  )

/* --------------------------------- 테스트 --------------------------------- */

await send('Runtime.enable')
await send('Log.enable')
await send('Page.enable')
await send('Page.navigate', { url: URL_UNDER_TEST })
await sleep(1800)

await waitFor(async () => (await text()).includes('아침 명상'), '첫 화면 렌더링')
check('앱이 처음 실행되면 예시 프로젝트가 보인다', (await text()).includes('아침 명상'))

// 서비스 워커 등록(오프라인 동작의 전제)
const swRegistered = await evaluate(
  `navigator.serviceWorker.getRegistrations().then((list) => list.length)`,
)
check('서비스 워커가 등록된다', swRegistered >= 1, `등록 수 ${swRegistered}`)
await waitFor(
  async () => await evaluate(`!!navigator.serviceWorker.controller`),
  '서비스 워커가 페이지를 제어',
  20000,
)
check('서비스 워커가 페이지를 제어한다', await evaluate(`!!navigator.serviceWorker.controller`))
check('업데이트 안내는 최신 버전에서는 보이지 않는다', !(await updateBannerVisible()))

// 소리 스케줄링 검증용 계측 (새로고침 후에도 다시 설치한다)
const installSchedulerProbe = () =>
  evaluate(`(() => {
  window.__scheduled = []
  if (!window.__probeInstalled) {
    const nativeStart = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
      try {
        window.__scheduled.push({
          when,
          now: this.context.currentTime,
          duration: this.buffer ? this.buffer.duration : 0,
        })
      } catch {}
      return nativeStart.call(this, when, offset, duration)
    }
    window.__probeInstalled = true
  }
  return true
})()`)

await installSchedulerProbe()
await installFileFactory()
await sleep(300)

// 새 타이머 생성 → 0:02 / 5:02 두 개의 시간
await click('＋ 새 타이머')
await waitFor(async () => (await text()).includes('타이머 이름'), '새 타이머 모달')
await evaluate(`(() => {
  const input = document.querySelector('.sheet input.input')
  input.value = 'E2E 테스트'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return input.value
})()`)
await click('만들기')
await waitFor(
  async () => (await evaluate(`document.querySelectorAll('input[type="number"].time').length`)) >= 2,
  '편집 화면 진입',
)
const createdName = await evaluate(`document.querySelector('input.input')?.value ?? ''`)
check('만든 타이머 이름이 편집 화면에 보인다', createdName === 'E2E 테스트', createdName)

const edited = await evaluate(`(() => {
  const inputs = [...document.querySelectorAll('input[type="number"].time')]
  if (inputs.length < 2) return 'NO_INPUTS'
  const [minutes, seconds] = inputs
  minutes.value = '0'
  minutes.dispatchEvent(new Event('input', { bubbles: true }))
  seconds.value = '2'
  seconds.dispatchEvent(new Event('input', { bubbles: true }))
  return 'OK'
})()`)
check('시간 입력 필드를 수정할 수 있다', edited === 'OK', edited)
await sleep(400)
check('첫 번째 시간이 0:02 로 바뀐다', (await text()).includes('0:02'))

await click('＋5분')
await sleep(400)
check('두 번째 시간이 5:02 로 추가된다', (await text()).includes('5:02'))

// 기본 소리 시트에서 앱에 포함된 샘플 소리를 확인한다
const openedDefaultPicker = await evaluate(`(() => {
  const chip = document.querySelector('article.card button.chip')
  if (!chip) return 'NO_CHIP'
  chip.click()
  return 'OK'
})()`)
check('기본 소리 버튼을 누를 수 있다', openedDefaultPicker === 'OK', openedDefaultPicker)
await waitFor(async () => (await text()).includes('기본 소리 선택'), '기본 소리 시트')
const defaultSheetText = await text()
check('기본 소리 시트에 샘플 소리(싱잉볼)가 있다', defaultSheetText.includes('싱잉볼'), '')
await click('싱잉볼')
await sleep(400)
const defaultChipText = await evaluate(
  `document.querySelector('article.card button.chip')?.textContent.trim() ?? ''`,
)
check('기본 소리로 샘플 소리를 지정할 수 있다', defaultChipText.includes('싱잉볼'), defaultChipText)

await sleep(800) // 자동 저장 대기

// 실행
await click('이 타이머 실행')
await waitFor(async () => (await text()).includes('타이머 시작'), '실행 전 화면')
await click('▶ 타이머 시작', { userGesture: true })
await waitFor(async () => (await text()).includes('일시 중지'), '실행 중 화면', 12000)
check('시작하면 실행 화면으로 바뀐다', (await text()).includes('일시 중지'))

await sleep(2000)
const scheduled = await evaluate('window.__scheduled')
check(
  '샘플 소리(약 30초)가 모든 시간대에 적용된다',
  scheduled.length >= 2 && scheduled.every((entry) => entry.duration > 25),
  JSON.stringify(scheduled.map((entry) => Number(entry.duration.toFixed(1)))),
)
const near2 = scheduled.find((entry) => Math.abs(entry.when - entry.now - 2) < 0.5)
const near302 = scheduled.find((entry) => Math.abs(entry.when - entry.now - 302) < 1.5)
check(
  '0:02 소리가 정확한 시각으로 예약된다',
  !!near2,
  near2 ? `when-now=${(near2.when - near2.now).toFixed(3)}s` : JSON.stringify(scheduled),
)
check(
  '5:02 소리도 함께 예약된다',
  !!near302,
  near302 ? `when-now=${(near302.when - near302.now).toFixed(3)}s` : '',
)

const audioState = await evaluate(`(() => {
  const keepAlive = document.querySelector('audio')
  return {
    keepAlivePaused: keepAlive ? keepAlive.paused : null,
    metadata: navigator.mediaSession?.metadata?.title ?? null,
  }
})()`)
check(
  '잠금 화면용 무음 루프가 재생 중이다',
  audioState.keepAlivePaused === false,
  JSON.stringify(audioState),
)
check('Media Session 제목이 타이머 이름이다', audioState.metadata === 'E2E 테스트', String(audioState.metadata))

await waitFor(async () => (await text()).includes('재생됨'), '첫 소리 재생 완료 표시', 8000)
check('소리가 재생되면 재생됨으로 표시된다', (await text()).includes('재생됨'))

const elapsedText = await evaluate(`document.querySelector('.big-time').textContent.trim()`)
check('경과 시간이 표시된다', /^0:0[2-9]$/.test(elapsedText), elapsedText)

// 일시 중지 / 재개
await click('일시 중지')
await sleep(400)
check('일시 중지 상태가 표시된다', (await text()).includes('일시 중지됨'))
const pausedAt = await evaluate(`document.querySelector('.big-time').textContent.trim()`)
await sleep(1300)
const stillPaused = await evaluate(`document.querySelector('.big-time').textContent.trim()`)
check('일시 중지 중에는 시간이 멈춘다', pausedAt === stillPaused, `${pausedAt} / ${stillPaused}`)

const beforeResume = (await evaluate('window.__scheduled')).length
await click('▶ 이어서', { userGesture: true })
await waitFor(async () => (await text()).includes('일시 중지'), '재개 후 실행 화면', 8000)
await sleep(800)
const afterResume = (await evaluate('window.__scheduled')).length
check('재개하면 남은 소리가 다시 예약된다', afterResume > beforeResume, `${beforeResume} → ${afterResume}`)

// 종료
await click('■ 종료')
await sleep(500)
check('종료하면 시작 화면으로 돌아온다', (await text()).includes('타이머 시작'))

const clickNav = async (which) => {
  const result = await evaluate(
    `(() => {
      const nav = document.querySelector('.bottom-nav')
      if (!nav) return 'NO_NAV'
      const button = nav.querySelectorAll('button')[${which}]
      if (!button) return 'NO_BUTTON'
      button.click()
      return 'OK'
    })()`,
  )
  if (result !== 'OK') throw new Error(`하단 탭 클릭 실패(${which}): ${result}`)
  await sleep(150)
}

// 소리 화면 (목록으로 이동 후 하단 탭)
await click('‹')
await waitFor(async () => (await text()).includes('＋ 새 타이머'), '타이머 목록으로 복귀')

// 탭 아이콘 및 바닥 붙음 검증 (목록 화면에서 탭이 보임)
const navMetrics = await evaluate(`(() => {
  const nav = document.querySelector('.bottom-nav')
  if (!nav) return null
  const rect = nav.getBoundingClientRect()
  const icons = nav.querySelectorAll('svg.tab-icon')
  return {
    fixed: getComputedStyle(nav).position === 'fixed',
    bottom: Math.round(rect.bottom),
    windowH: window.innerHeight,
    iconCount: icons.length,
  }
})()`)
check('하단 탭이 fixed 로 화면 바닥에 고정된다', navMetrics?.fixed)
check('하단 탭에 SVG 아이콘 2개가 렌더링된다', navMetrics?.iconCount === 2, `개수 ${navMetrics?.iconCount}`)

await clickNav(1)
await waitFor(async () => (await text()).includes('앱에 포함된 샘플 소리'), '소리 화면')
const libraryText = await text()
check('앱에 포함된 샘플 소리(싱잉볼)가 표시된다', libraryText.includes('싱잉볼'))
check('샘플 소리 길이(0:30)가 표시된다', libraryText.includes('0:30'))
check('샘플 소리 라이선스(CC0)가 표시된다', libraryText.includes('CC0'))

// 사용자 음향 파일 추가(IndexedDB 저장 + 디코딩 검증)
const fileResult = await uploadFile(`window.__makeWavFile('tone-test.wav', 'audio/wav')`)
check('음향 파일 입력이 존재한다', fileResult === 'OK', fileResult)

await waitFor(async () => (await text()).includes('tone-test'), '내 소리에 파일 추가', 8000)
const afterUpload = await text()
check('추가한 파일이 내 소리에 표시된다', afterUpload.includes('tone-test'))
check('추가한 파일 길이가 표시된다(0.5초 → 0:01)', afterUpload.includes('0:01'))
check('내 소리 개수가 늘어난다', afterUpload.includes('내 소리 1개'))

// 확장자·MIME 이 오디오로 인식되지 않아도 실제로 디코딩되면 추가되어야 한다
// (아이폰 파일 선택기에서 흐리게 보여 선택할 수 없던 파일을 고를 수 있게 하기 위한 처리)
const weirdUpload = await uploadFile(`window.__makeWavFile('tone-unknown.dat', '')`)
check('확장자가 달라도 파일을 선택할 수 있다', weirdUpload === 'OK', weirdUpload)
await waitFor(async () => (await text()).includes('tone-unknown'), '확장자가 다른 파일 추가', 8000)
check(
  '오디오로 인식되지 않는 확장자도 내용이 소리면 추가된다',
  (await text()).includes('tone-unknown'),
)
check('내 소리 개수가 2개가 된다', (await text()).includes('내 소리 2개'))

// 소리가 아닌 파일은 명확한 안내와 함께 거부된다
const textFileResult = await evaluate(`(() => {
  const input = document.querySelector('input[type=file]')
  if (!input) return 'NO_INPUT'
  const transfer = new DataTransfer()
  transfer.items.add(new File(['이 파일은 소리가 아닙니다'], 'not-audio.txt', { type: 'text/plain' }))
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return 'OK'
})()`)
check('소리가 아닌 파일도 선택 자체는 가능하다', textFileResult === 'OK', textFileResult)
await waitFor(async () => (await text()).includes('소리 파일로 읽을 수 없습니다'), '거부 안내', 8000)
check('소리가 아닌 파일은 안내와 함께 추가되지 않는다', (await text()).includes('내 소리 2개'))

// 저장(IndexedDB) 확인
await send('Page.reload')
await sleep(2000)
await waitFor(async () => (await text()).includes('＋ 새 타이머'), '새로고침 후 목록')
await clickNav(1)
await waitFor(async () => (await text()).includes('앱에 포함된 샘플 소리'), '새로고침 후 소리 화면')
await waitFor(async () => (await text()).includes('tone-test'), '새로고침 후 파일 유지')
check('새로고침해도 추가한 파일이 남아 있다', (await text()).includes('tone-test'))

// 프로젝트에서 사용자 소리를 지정한 뒤 삭제하면 기본 소리로 되돌아간다
const clickAria = async (label) => {
  const result = await evaluate(`(() => {
    const el = document.querySelector('button[aria-label=${JSON.stringify(label)}]')
    if (!el) return 'NOT_FOUND'
    el.click()
    return 'OK'
  })()`)
  if (result !== 'OK') throw new Error(`버튼 클릭 실패(${label}): ${result}`)
  await sleep(150)
}

await clickNav(0)
await waitFor(async () => (await text()).includes('＋ 새 타이머'), '타이머 목록')
await click('E2E 테스트')
await waitFor(
  async () => (await evaluate(`document.querySelectorAll('input[type="number"].time').length`)) >= 2,
  '편집 화면',
)
const pickedCueSound = await evaluate(`(() => {
  const chip = [...document.querySelectorAll('button.chip')].find((button) =>
    button.textContent.includes('기본 소리 ('),
  )
  if (!chip) return 'NO_CHIP'
  chip.click()
  return 'OK'
})()`)
check('큐의 소리 선택 버튼이 있다', pickedCueSound === 'OK', pickedCueSound)
await waitFor(async () => (await text()).includes('이 시간대에 쓸 소리'), '소리 선택 시트')
await click('tone-test')
await sleep(400)
check('큐에 사용자 소리를 지정할 수 있다', (await text()).includes('tone-test'))

// 시간대별로 다른 소리를 쓰는지 실제 예약 결과로 확인한다(샘플 약 30초 + 사용자 0.5초)
await installSchedulerProbe()
await click('‹')
await waitFor(async () => (await text()).includes('＋ 새 타이머'), '목록으로 복귀')
const startedOverrideRun = await evaluate(
  `(() => {
    const card = [...document.querySelectorAll('article.card')].find((el) => el.textContent.includes('E2E 테스트'))
    const button = card?.querySelector('button.btn.play')
    if (!button) return 'NO_BUTTON'
    button.click()
    return 'OK'
  })()`,
  { userGesture: true },
)
check('시간대별 소리를 확인할 실행을 시작할 수 있다', startedOverrideRun === 'OK', startedOverrideRun)
await waitFor(async () => (await text()).includes('타이머 시작'), '실행 전 화면')
await click('▶ 타이머 시작', { userGesture: true })
await waitFor(async () => (await text()).includes('일시 중지'), '실행 중 화면', 12000)
await sleep(1200)
const overrideScheduled = (await evaluate('window.__scheduled')) ?? []
const overrideDurations = overrideScheduled.map((entry) => Number(entry.duration.toFixed(2)))
check(
  '시간대마다 다른 소리가 예약된다(약 30초 + 0.5초)',
  overrideDurations.includes(0.5) && overrideDurations.some((duration) => duration > 25),
  JSON.stringify(overrideDurations),
)
await click('■ 종료')
await sleep(400)
await click('‹')
await waitFor(async () => (await text()).includes('＋ 새 타이머'), '목록으로 복귀')
await clickNav(1)
await waitFor(async () => (await text()).includes('앱에 포함된 샘플 소리'), '소리 화면')
await clickAria('삭제')
await sleep(200)
await clickAria('삭제')
await sleep(300)
// 남은 사용자 소리도 모두 삭제한다(테스트에서 2개를 추가했다)
for (let attempt = 0; attempt < 3; attempt += 1) {
  const remaining = await evaluate(`document.querySelectorAll('button[aria-label="삭제"]').length`)
  if (!remaining) break
  await clickAria('삭제')
  await sleep(250)
  await clickAria('삭제')
  await sleep(400)
}
await waitFor(async () => (await text()).includes('내 소리 0개'), '소리 삭제', 10000)
check('추가한 소리를 삭제할 수 있다', (await text()).includes('내 소리 0개'))

await clickNav(0)
await waitFor(async () => (await text()).includes('＋ 새 타이머'), '타이머 목록')
await click('E2E 테스트')
await waitFor(
  async () => (await evaluate(`document.querySelectorAll('input[type="number"].time').length`)) >= 2,
  '편집 화면',
)
check(
  '삭제된 소리를 쓰던 큐는 기본 소리로 돌아온다',
  (await text()).includes('기본 소리 ('),
)
await click('‹')
await waitFor(async () => (await text()).includes('＋ 새 타이머'), '목록으로 복귀')

// 예전 버전에서 저장된 프로젝트(builtin:*)도 샘플 소리로 자동 이전되는지 확인한다
const legacySeeded = await evaluate(`(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('singing-bowl', 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const legacy = {
    id: 'project_legacy',
    name: '레거시 프로젝트',
    defaultSoundId: 'builtin:bowl',
    volume: 0.9,
    cues: [
      { id: 'cue_legacy_1', atSeconds: 3, soundId: null, label: '' },
      { id: 'cue_legacy_2', atSeconds: 60, soundId: 'builtin:wood', label: '' },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', 'readwrite')
    transaction.objectStore('projects').put(legacy)
    transaction.oncomplete = () => resolve('OK')
    transaction.onerror = () => reject(transaction.error)
  })
  db.close()
  return 'OK'
})()`)
check('레거시 프로젝트를 저장할 수 있다', legacySeeded === 'OK', legacySeeded)

await send('Page.reload')
await sleep(2200)
await waitFor(async () => (await text()).includes('＋ 새 타이머'), '새로고침 후 목록')
check('레거시 프로젝트가 목록에 나타난다', (await text()).includes('레거시 프로젝트'))

await installSchedulerProbe()
const startedLegacyRun = await evaluate(
  `(() => {
    const card = [...document.querySelectorAll('article.card')].find((el) => el.textContent.includes('레거시 프로젝트'))
    const button = card?.querySelector('button.btn.play')
    if (!button) return 'NO_BUTTON'
    button.click()
    return 'OK'
  })()`,
  { userGesture: true },
)
check('레거시 프로젝트를 실행할 수 있다', startedLegacyRun === 'OK', startedLegacyRun)
await waitFor(async () => (await text()).includes('타이머 시작'), '레거시 실행 전 화면')
check('레거시 소리 지정이 샘플 소리로 표시된다', (await text()).includes('싱잉볼'))
await click('▶ 타이머 시작', { userGesture: true })
await waitFor(async () => (await text()).includes('일시 중지'), '레거시 실행 중 화면', 12000)
await sleep(1200)
const legacyScheduled = (await evaluate('window.__scheduled')) ?? []
check(
  '레거시 시간대도 샘플 소리로 예약된다',
  legacyScheduled.length > 0 && legacyScheduled.every((entry) => entry.duration > 25),
  JSON.stringify(legacyScheduled.map((entry) => Number(entry.duration.toFixed(1)))),
)
await click('■ 종료')
await sleep(300)
await click('‹')
await waitFor(async () => (await text()).includes('＋ 새 타이머'), '목록으로 복귀')

// 중단된 실행 복구: 실행 중 새로고침하면 이어서 재생할 수 있어야 한다
await clickNav(0)
await waitFor(async () => (await text()).includes('＋ 새 타이머'), '타이머 목록')
const startedSecondRun = await evaluate(
  `(() => {
    const card = [...document.querySelectorAll('article.card')].find((el) => el.textContent.includes('E2E 테스트'))
    if (!card) return 'NO_CARD'
    const button = card.querySelector('button.btn.play')
    if (!button) return 'NO_BUTTON'
    button.click()
    return 'OK'
  })()`,
  { userGesture: true },
)
check('목록에서 다시 실행할 수 있다', startedSecondRun === 'OK', startedSecondRun)
await waitFor(async () => (await text()).includes('타이머 시작'), '실행 전 화면')
await click('▶ 타이머 시작', { userGesture: true })
await waitFor(async () => (await text()).includes('일시 중지'), '실행 중 화면', 12000)
await sleep(1500)

await send('Page.reload')
await sleep(2000)
await waitFor(async () => (await text()).includes('중단되었던 타이머'), '중단된 실행 안내')
check('새로고침하면 중단된 실행을 안내한다', (await text()).includes('중단되었던 타이머가 있습니다'))

await click('이어서 재생', { userGesture: true })
await waitFor(async () => (await text()).includes('일시 중지'), '복구 후 실행 화면', 12000)
const resumedElapsed = await evaluate(`document.querySelector('.big-time').textContent.trim()`)
check('복구 후 실행 화면으로 이어진다', /^0:0[1-9]$/.test(resumedElapsed), resumedElapsed)
await click('■ 종료')
await sleep(400)

// 새로고침 후 데이터 유지 확인
await click('‹')
await waitFor(async () => (await text()).includes('E2E 테스트'), '목록 복귀')
const afterReload = await text()
check('새로고침해도 프로젝트가 남아 있다', afterReload.includes('E2E 테스트'))
await click('E2E 테스트')
await waitFor(
  async () => (await evaluate(`document.querySelectorAll('input[type="number"].time').length`)) >= 2,
  '편집 화면',
)
const persistedTimes = await evaluate(
  `[...document.querySelectorAll('input[type="number"].time')].map((input) => input.value).join(':')`,
)
check('시간 설정도 유지된다', persistedTimes.startsWith('0:2'), persistedTimes)

// 소리 화면(하단 탭) + 헤더 ⓘ 로 여는 앱 정보 화면
await click('‹')
await waitFor(async () => (await text()).includes('＋ 새 타이머'), '목록으로 복귀')
await clickNav(1)
await waitFor(async () => (await text()).includes('앱에 포함된 샘플 소리'), '소리 화면')
await sleep(300)
check(
  '소리 화면의 페이지 제목이 [소리]로 표시된다',
  (await evaluate(`document.querySelector('.page-name')?.textContent.trim() ?? ''`)) === '소리',
)
check(
  '헤더에 앱 이름(Singing Bowl)이 항상 보인다',
  (await evaluate(`document.querySelector('.app-name')?.textContent.trim() ?? ''`)) === 'Singing Bowl',
)

await clickAria('앱 정보')
await waitFor(async () => (await text()).includes('빌드 시각'), '앱 정보 화면', 10000)
const appInfoText = await text()
check(
  '앱 정보 화면의 페이지 제목이 [앱 정보]로 표시된다',
  (await evaluate(`document.querySelector('.page-name')?.textContent.trim() ?? ''`)) === '앱 정보',
)
check('앱 정보 화면에 소개가 있다', appInfoText.includes('정해진 시간에 소리를 재생하는 타이머'))
check('앱 정보 화면에 사용법이 있다', appInfoText.includes('사용법'))
check('앱 정보 화면에 빌드 시각이 표시된다', appInfoText.includes('빌드 시각'))
check('업데이트 확인 버튼이 있다', appInfoText.includes('업데이트 확인'))
check('앱 새로고침 버튼이 있다', appInfoText.includes('앱 새로고침'))
check(
  '앱 정보 화면에 크레딧(샘플 음원 출처)이 있다',
  appInfoText.includes('크레딧') && appInfoText.includes('BigSoundBank'),
)
check(
  '데이터 저장 카드에 상태 배지가 있다(영구/일반)',
  appInfoText.includes('영구 저장 사용 중') || appInfoText.includes('일반 저장'),
)
check('데이터 저장 안내에 홈 화면 앱 설명이 있다', appInfoText.includes('홈 화면에 추가한 앱'))

const hasPersistButton = await evaluate(
  `[...document.querySelectorAll('button')].some((el) => el.textContent.includes('영구 저장 요청'))`,
)
if (hasPersistButton) {
  await click('영구 저장 요청')
  await sleep(800)
  const persistResult = await text()
  check(
    '영구 저장 요청 결과를 안내한다(적용 또는 거부)',
    persistResult.includes('영구 저장이 적용되었습니다') || persistResult.includes('허용되지 않았습니다'),
  )
}

await click('‹ 타이머로 돌아가기')
await waitFor(async () => (await text()).includes('＋ 새 타이머'), '타이머 화면 복귀')
check('앱 정보에서 뒤로 가기로 타이머 화면에 돌아온다', (await text()).includes('＋ 새 타이머'))

// --------------------------- 오프라인 동작 검증 ---------------------------
await send('Network.enable')
offlinePhase.value = true
await send('Network.emulateNetworkConditions', {
  offline: true,
  latency: 0,
  downloadThroughput: 0,
  uploadThroughput: 0,
})
await send('Page.reload')
await sleep(2500)
await waitFor(async () => (await text()).includes('＋ 새 타이머'), '오프라인에서 앱 실행', 15000)
check('오프라인이어도 앱이 실행된다(프리캐시)', (await text()).includes('＋ 새 타이머'))

await clickNav(1)
await waitFor(async () => (await text()).includes('싱잉볼'), '오프라인에서 샘플 소리 목록', 10000)
check('오프라인에서도 샘플 소리 목록이 보인다', (await text()).includes('싱잉볼'))

const offlinePreview = await evaluate(`(() => {
  const button = document.querySelector('button[aria-label="미리 듣기"]')
  if (!button) return 'NO_BUTTON'
  button.click()
  return 'OK'
})()`)
check('오프라인에서 샘플 소리 미리 듣기를 누를 수 있다', offlinePreview === 'OK', offlinePreview)
await sleep(2000)
check(
  '오프라인에서도 샘플 음원이 로딩된다(캐시)',
  !(await text()).includes('불러오지 못했습니다'),
)

await send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
})
offlinePhase.value = false

// ---------------------- 업데이트 안내 / 새로고침 검증 ----------------------
// 실제로는 새 버전을 배포해야 재현되므로, version.json 응답을 가로채 '새 버전' 을 흉내 낸다.
await send('Fetch.enable', { patterns: [{ urlPattern: '*version.json*' }] })
fakeBuildTime = FAKE_BUILD_TIME
await clickAria('앱 정보')
await waitFor(async () => (await text()).includes('빌드 시각'), '앱 정보 화면', 10000)
await waitFor(
  async () =>
    await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((el) =>
        el.textContent.includes('업데이트 확인'),
      )
      return !!button && !button.disabled
    })()`),
  '업데이트 확인 버튼 활성화',
  15000,
)
await click('업데이트 확인')
await waitFor(updateBannerVisible, '업데이트 안내 표시', 12000)
check('새 버전 감지 시 안내가 표시된다', await updateBannerVisible())
check('안내에 지금 새로고침 버튼이 있다', (await text()).includes('지금 새로고침'))

await click('나중에')
await sleep(400)
check('나중에를 누르면 안내가 사라진다', !(await updateBannerVisible()))

await click('업데이트 확인')
await waitFor(updateBannerVisible, '다시 안내', 12000)
check('업데이트 확인을 다시 누르면 안내가 돌아온다', await updateBannerVisible())

// 새로고침 동작 확인: 리로드되면 주입해 둔 계측(window.__probeInstalled)이 사라진다.
await click('지금 새로고침', { userGesture: true })
await sleep(2500)
const reloaded = await evaluate(`typeof window.__probeInstalled === 'undefined'`)
check('지금 새로고침을 누르면 앱이 다시 로드된다', reloaded === true, `reloaded=${reloaded}`)
await waitFor(async () => (await text()).includes('＋ 새 타이머') || (await text()).includes('앱에 포함된 샘플 소리'), '새로고침 후 화면', 15000)
check('새로고침 후에도 앱이 정상 실행된다', (await text()).includes('새 타이머') || (await text()).includes('소리'))

// 가로채기를 끄고 정상 상태로 돌린다.
fakeBuildTime = null
await send('Fetch.disable')

/* --------------------------------- 결과 ---------------------------------- */

await reportWithStatus(0)

async function reportWithStatus(exitCode) {
  const failed = checks.filter((entry) => !entry.ok)
  console.log(`\n결과: ${checks.length - failed.length}/${checks.length} 통과`)
  if (consoleErrors.length) {
    console.log('\n콘솔 오류:')
    for (const error of consoleErrors) console.log(` - ${error}`)
  }
  socket.close()
  chrome.kill()
  process.exit(failed.length ? 1 : exitCode)
}

