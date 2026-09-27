<script>
  /**
   * 앱 정보 페이지: 소개 · 도움말 · 앱 정보(버전/업데이트) · 데이터 저장 · 크레딧
   * 헤더의 ⓘ 버튼으로 들어오고, 헤더 왼쪽 ‹ 버튼으로 메인으로 돌아간다.
   */
  import { onMount } from 'svelte'
  import { store } from '../lib/store.svelte.js'
  import { timer } from '../lib/engine.svelte.js'
  import { appUpdate, applyUpdate, checkForUpdate } from '../lib/app-update.svelte.js'
  import { BUNDLED_SOUNDS } from '../lib/bundled-sounds.js'
  import { formatBytes, formatDateTime, formatIsoDateTime } from '../lib/time.js'

  let { onback } = $props()

  let storage = $state(null)
  let persisted = $state(null)
  let requestingPersist = $state(false)
  let persistMessage = $state('')
  let isStandalone = $state(false)

  onMount(async () => {
    isStandalone =
      window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
    storage = await store.storageEstimate()
    try {
      persisted = (await navigator.storage?.persisted?.()) ?? null
    } catch {
      persisted = null
    }
  })

  async function requestPersist() {
    requestingPersist = true
    persistMessage = ''
    const granted = await store.requestPersistence()
    persisted = granted
    requestingPersist = false
    persistMessage = granted
      ? '영구 저장이 적용되었습니다. 이제 브라우저가 임의로 데이터를 지우지 않습니다.'
      : '이 브라우저(탭)에서는 허용되지 않았습니다. 홈 화면에 추가해 실행하면 iOS가 자동으로 영구 저장을 허용합니다.'
  }

  /** 새로고침 직전에 실행 중인 타이머를 일시 중지해 두면 새 버전에서 이어서 재생할 수 있다. */
  function refreshApp() {
    if (timer.status === 'running') timer.pause()
    applyUpdate()
  }
</script>

<article class="card stack">
  <strong>정해진 시간에 소리를 재생하는 타이머</strong>
  <div class="small muted">
    시작 후 원하는 시점(예: 5분, 10분, 15분)에 지정한 소리를 재생합니다. 명상·요가·공부·운동처럼
    “언제 무엇으로 알려 줄지”가 중요한 순간에 쓰도록 만들었습니다.
  </div>
  <div class="tiny muted">
    모든 데이터(타이머 설정·추가한 음원)는 서버로 전송되지 않고 <strong>이 기기 안에만</strong> 저장됩니다.
    한 번 열어 두면 네트워크 없이도 동작합니다.
  </div>
</article>

<div class="section-title">사용법</div>
<article class="card stack">
  <ol class="hint-list" style="margin:0; padding-left:20px">
    <li><strong>타이머</strong> 화면에서 ‘＋ 새 타이머’를 누릅니다.</li>
    <li>소리를 재생할 <strong>시간</strong>을 분·초로 추가합니다(빠른 추가 버튼 사용 가능).</li>
    <li>기본 소리를 고르고, 특정 시간대만 다른 소리를 쓰려면 그 시간대의 소리를 따로 지정합니다.</li>
    <li><strong>▶ 타이머 시작</strong>을 누르면 끝날 때까지 자동으로 진행됩니다. 화면을 꺼도 소리가 납니다.</li>
    <li>진행 중에는 <strong>⏸ 일시 중지 / ▶ 이어서 / ■ 종료</strong>로 조절하고, 잠금 화면의 재생 버튼으로도 조작할 수 있습니다.</li>
    <li>앱을 완전히 종료했다가 다시 열면 <strong>‘중단되었던 타이머 — 이어서 재생’</strong>으로 이어갈 수 있습니다.</li>
  </ol>
</article>

<div class="section-title">앱 정보</div>
<article class="card stack">
  <div class="row-between">
    <span class="small">Singing Bowl — 명상 타이머</span>
    {#if appUpdate.needRefresh}
      <span class="badge accent">새 버전 있음</span>
    {:else}
      <span class="badge done">최신 버전</span>
    {/if}
  </div>
  <div class="small muted">빌드 시각: {formatIsoDateTime(appUpdate.buildTime)}</div>
  <div class="small muted">
    마지막 확인: {appUpdate.lastCheckedAt ? formatDateTime(appUpdate.lastCheckedAt) : '확인 중…'}
  </div>
  <div class="tiny muted">
    홈 화면 앱에는 브라우저 새로고침 버튼이 없습니다. 새 버전이 나오면 화면 위쪽에 안내가 뜨고, 그때
    <strong>지금 새로고침</strong>을 누르면 됩니다. 안내가 보이지 않으면 아래 ‘업데이트 확인’을 눌러 보세요.
    그래도 그대로면 앱을 완전히 종료(앱 전환기에서 위로 밀기)한 뒤 다시 열면 최신 버전으로 실행됩니다.
  </div>
  <div class="row">
    <button class="btn grow" onclick={() => checkForUpdate(true)} disabled={appUpdate.checking}>
      {appUpdate.checking ? '확인하는 중…' : '업데이트 확인'}
    </button>
    <button class="btn grow" onclick={refreshApp}>앱 새로고침</button>
  </div>
  {#if appUpdate.lastError}
    <div class="tiny muted">확인 실패: {appUpdate.lastError} (오프라인이면 정상입니다)</div>
  {/if}
</article>

<div class="section-title">데이터 저장</div>
<article class="card stack">
  <div class="row-between">
    <span class="small">저장 상태</span>
    {#if persisted === true}
      <span class="badge done">영구 저장 사용 중</span>
    {:else if persisted === false}
      <span class="badge">일반 저장</span>
    {:else}
      <span class="badge">확인 중</span>
    {/if}
  </div>
  {#if storage}
    <div class="small muted">사용 {formatBytes(storage.usage)} / 최대 {formatBytes(storage.quota)}</div>
  {/if}
  <div class="tiny muted">
    {#if persisted === true}
      브라우저가 저장 공간을 정리할 때도 타이머와 추가한 음원이 자동으로 지워지지 않습니다.
      {#if isStandalone}홈 화면 앱으로 실행 중이라 iOS가 영구 저장을 자동으로 허용했습니다.{/if}
    {:else}
      지금은 <strong>일반 저장(임시)</strong> 상태입니다. 저장 공간이 부족해지거나
      <strong>7일 넘게 방문하지 않으면</strong> 사파리가 타이머·음원 데이터를 지울 수 있습니다.
      iOS는 <strong>홈 화면에 추가한 앱</strong>에만 영구 저장을 자동 허용하며, 사파리 탭에서는 아래 요청이
      거부될 수 있습니다(정상 동작입니다).
    {/if}
  </div>
  {#if persisted !== true}
    <button class="btn block" onclick={requestPersist} disabled={requestingPersist}>
      {requestingPersist ? '요청하는 중…' : '영구 저장 요청'}
    </button>
  {/if}
  {#if persistMessage}
    <div class="tiny">{persistMessage}</div>
  {/if}
</article>

<div class="section-title">크레딧</div>
<article class="card stack">
  {#each BUNDLED_SOUNDS as sound (sound.id)}
    <div class="small">
      함께 들어 있는 샘플 소리 “{sound.name}” — {sound.license}
    </div>
  {/each}
  <div class="tiny muted">
    샘플 음원 출처: <a
      href="https://bigsoundbank.com/tibetan-bowl-struck-1-s1110.html"
      target="_blank"
      rel="noreferrer">BigSoundBank · Tibetan Bowl Struck #1 (Joseph SARDIN, CC0)</a>.
    CC0(퍼블릭 도메인)라 출처 표기 없이도 사용할 수 있지만, 감사한 마음으로 표기합니다.
  </div>
  <div class="divider"></div>
  <div class="tiny muted">
    제작: Svelte 5 · Vite · vite-plugin-pwa 로 만든 오프라인 PWA.
    소스 코드: <a href="https://github.com/golbenge/singing-bowl" target="_blank" rel="noreferrer"
      >github.com/golbenge/singing-bowl</a
    >
  </div>
</article>

<button class="btn block" onclick={onback}>‹ 타이머로 돌아가기</button>
