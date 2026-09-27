/**
 * 앱 업데이트 감지와 새로고침.
 *
 * iOS 홈 화면 앱(standalone)에는 브라우저 새로고침 버튼이 없고, 게다가
 * Safari/WebKit 에서는 prompt 모드의 workbox-window 'controlling'(controllerchange)
 * 이벤트가 발생하지 않는 알려진 문제가 있다(그래서 새로고침 버튼이 먹통이 되기도 한다).
 *
 * 그래서 여기서는
 *  1) 서비스 워커의 waiting 상태를 직접 확인하고
 *  2) 배포된 version.json 의 빌드 시각과 앱에 심어 둔 빌드 시각을 비교해
 * 새 버전을 판단한 뒤,
 *  3) 새로고침 시 SKIP_WAITING 메시지를 보내고 controllerchange 를 기다리되
 *     오지 않으면(약 2초) 강제로 리로드한다.
 */

export const appUpdate = $state({
  registered: false, // 서비스 워커 등록 완료
  needRefresh: false, // 새 버전 있음
  checking: false,
  lastCheckedAt: null,
  lastError: null,
  buildTime: __BUILD_TIME__,
})

const base = import.meta.env.BASE_URL ?? '/'

let registration = null
let started = false
let dismissedUntil = 0
let intervalId = null

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchServerBuildTime() {
  try {
    const response = await fetch(`${base}version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) return null
    const data = await response.json()
    return typeof data?.buildTime === 'string' ? data.buildTime : null
  } catch {
    return null // 오프라인이면 판단하지 않는다
  }
}

/** 새 버전이 있는지 확인한다. force=true 이면 '나중에'로 미뤄 둔 것도 다시 안내한다. */
export async function checkForUpdate(force = false) {
  if (!registration) return appUpdate.needRefresh
  if (force) dismissedUntil = 0
  appUpdate.checking = true
  try {
    // 오프라인 등에서는 update() 가 끝나지 않을 수 있으므로 시간 제한을 둔다.
    await Promise.race([registration.update(), sleep(8000)])
    const waiting = Boolean(registration.waiting)
    const serverBuildTime = await fetchServerBuildTime()
    const newerBuild = Boolean(serverBuildTime && serverBuildTime !== appUpdate.buildTime)
    if (Date.now() > dismissedUntil) appUpdate.needRefresh = waiting || newerBuild
    appUpdate.lastError = null
  } catch (error) {
    appUpdate.lastError = error?.message ?? String(error)
  } finally {
    appUpdate.checking = false
    appUpdate.lastCheckedAt = Date.now()
  }
  return appUpdate.needRefresh
}

/** 새로고침(새 서비스 워커 활성화 후 리로드). iOS 대비 타임아웃 폴백 포함. */
export async function applyUpdate() {
  const waiting = registration?.waiting
  if (waiting) {
    await new Promise((resolve) => {
      let finished = false
      const finish = () => {
        if (!finished) {
          finished = true
          resolve()
        }
      }
      try {
        navigator.serviceWorker.addEventListener('controllerchange', finish, { once: true })
        waiting.postMessage({ type: 'SKIP_WAITING' })
      } catch {
        /* noop */
      }
      setTimeout(finish, 2000) // iOS: controllerchange 가 오지 않아도 진행
    })
    await sleep(100) // 새 워커가 제어권을 잡을 짧은 여유
  }
  window.location.reload()
}

/** 이번 세션에서는 배너를 잠시 숨긴다(30분 뒤 다시 안내). */
export function dismissUpdate() {
  appUpdate.needRefresh = false
  dismissedUntil = Date.now() + 30 * 60 * 1000
}

/** 서비스 워커를 등록하고 업데이트 감시를 시작한다(앱 시작 시 1회). */
export function registerAppUpdater() {
  if (started) return
  started = true
  if (!('serviceWorker' in navigator)) return

  navigator.serviceWorker
    .register(`${base}sw.js`, { scope: base, updateViaCache: 'none' })
    .then((registered) => {
      registration = registered
      appUpdate.registered = true

      // 이전에 받아 두고 아직 활성화되지 않은 워커가 있으면 알린다.
      if (registered.waiting && navigator.serviceWorker.controller) {
        appUpdate.needRefresh = true
      }

      registered.addEventListener('updatefound', () => {
        const installing = registered.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          // 첫 설치 때는 controller 가 없으므로 '업데이트'로 취급하지 않는다.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            appUpdate.needRefresh = true
          }
        })
      })

      // 시작 직후와 화면이 다시 보일 때, 그리고 주기적으로 확인한다.
      setTimeout(() => checkForUpdate(), 2500)
      intervalId = setInterval(() => checkForUpdate(), 30 * 60 * 1000)
    })
    .catch((error) => {
      appUpdate.lastError = error?.message ?? String(error)
    })

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkForUpdate()
  })
  window.addEventListener('online', () => checkForUpdate())
}

/** 주기 확인 타이머 정리(앱을 닫을 때 등) */
export function clearUpdateInterval() {
  if (intervalId) clearInterval(intervalId)
  intervalId = null
}
