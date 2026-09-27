<script>
  import { onMount } from 'svelte'
  import { store } from './lib/store.svelte.js'
  import { discardPersistedRun, readPersistedRun, timer } from './lib/engine.svelte.js'
  import {
    appUpdate,
    applyUpdate,
    dismissUpdate,
    registerAppUpdater,
  } from './lib/app-update.svelte.js'
  import { formatDuration } from './lib/time.js'
  import ProjectList from './components/ProjectList.svelte'
  import ProjectEditor from './components/ProjectEditor.svelte'
  import Runner from './components/Runner.svelte'
  import SoundLibrary from './components/SoundLibrary.svelte'
  import AppInfo from './components/AppInfo.svelte'

  const HINT_KEY = 'singing-bowl:install-hint'

  let view = $state('timers') // timers | editor | runner | sounds | info
  let activeProjectId = $state(null)
  let pendingRun = $state(null)
  let installHintVisible = $state(false)
  let hintDismissed = $state(true)
  let booting = $state(true)

  onMount(async () => {
    registerAppUpdater()
    await store.init()

    const saved = readPersistedRun()
    if (saved && store.projectById(saved.projectId)) pendingRun = saved
    else if (saved) discardPersistedRun()

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
    installHintVisible = /iPhone|iPad|iPod/.test(navigator.userAgent) && !standalone
    try {
      hintDismissed = window.localStorage.getItem(HINT_KEY) === '1'
    } catch {
      hintDismissed = false
    }

    store.requestPersistence().catch(() => {})
    booting = false
  })

  const activeProject = $derived(activeProjectId ? store.projectById(activeProjectId) : null)
  const isSubPage = $derived(view === 'editor' || view === 'runner' || view === 'info')

  function openEditor(projectId) {
    activeProjectId = projectId
    view = 'editor'
  }

  function openRunner(projectId) {
    activeProjectId = projectId
    view = 'runner'
  }

  function goBack() {
    if (view === 'runner' && !timer.isActive) timer.reset()
    view = 'timers'
    activeProjectId = null
  }

  function openSounds() {
    view = 'sounds'
    activeProjectId = null
  }

  function openTimers() {
    view = 'timers'
    activeProjectId = null
  }

  function openInfo() {
    view = 'info'
    activeProjectId = null
  }

  function dismissInstallHint() {
    hintDismissed = true
    try {
      window.localStorage.setItem(HINT_KEY, '1')
    } catch {
      /* noop */
    }
  }

  async function resumeInterruptedRun() {
    const saved = pendingRun
    pendingRun = null
    if (!saved) return
    if (!timer.restore(saved)) {
      discardPersistedRun()
      return
    }
    activeProjectId = timer.projectId
    view = 'runner'
    await timer.resume()
  }

  function discardInterruptedRun() {
    discardPersistedRun()
    pendingRun = null
    timer.reset()
  }

  /** 새로고침 직전에 실행 중이던 타이머를 일시 중지해 두면, 새 버전에서 '이어서 재생'할 수 있다. */
  async function handleApplyUpdate() {
    if (timer.status === 'running') timer.pause()
    await applyUpdate()
  }

  /** 헤더에 표시할 현재 화면 이름 */
  function pageName() {
    if (view === 'editor') return '타이머 편집'
    if (view === 'runner') return activeProject?.name ?? '타이머'
    if (view === 'sounds') return '소리'
    if (view === 'info') return '앱 정보'
    return '타이머'
  }
</script>

<div class="app-shell">
  <header class="app-header">
    {#if isSubPage}
      <button class="btn-icon plain" aria-label="뒤로" onclick={goBack}>‹</button>
    {/if}

    <div class="grow">
      <div class="app-name">Singing Bowl</div>
      <div class="page-name truncate">{pageName()}</div>
    </div>

    {#if timer.isActive && view !== 'runner'}
      <button
        class="chip"
        aria-label="실행 중인 타이머 열기"
        onclick={() => openRunner(timer.projectId)}
      >
        {timer.status === 'paused' ? '⏸' : '●'} <span class="tabular">{formatDuration(timer.elapsedMs)}</span>
      </button>
    {/if}

    {#if view === 'runner' && activeProject}
      <button class="btn-icon plain" aria-label="편집" onclick={() => openEditor(activeProject.id)}>✎</button>
    {/if}

    {#if view !== 'info'}
      <button class="btn-icon plain" aria-label="앱 정보" onclick={openInfo}>ⓘ</button>
    {/if}
  </header>

  <main class="app-main">
    {#if booting}
      <div class="row" style="justify-content:center;padding:40px 0">
        <span class="spinner"></span>
        <span class="muted small">데이터를 불러오는 중…</span>
      </div>
    {:else}
      {#if appUpdate.needRefresh}
        <div class="notice accent">
          <span>✨</span>
          <div class="grow">
            <strong>새 버전이 있습니다</strong>
            <div class="tiny muted">
              새로고침하면 최신 기능이 적용됩니다.
              {#if timer.isActive}실행 중인 타이머는 일시 중지되고, 새로고침 후 ‘이어서 재생’할 수 있습니다.{/if}
            </div>
            <div class="row" style="margin-top:8px">
              <button class="btn primary" onclick={handleApplyUpdate}>지금 새로고침</button>
              <button class="btn ghost" onclick={dismissUpdate}>나중에</button>
            </div>
          </div>
        </div>
      {/if}

      {#if pendingRun && view !== 'runner'}
        <div class="notice accent">
          <span>⏱</span>
          <div class="grow">
            <strong>중단되었던 타이머가 있습니다</strong>
            <div class="small muted">
              {pendingRun.projectName || '타이머'} · {formatDuration(pendingRun.elapsedMs)} 지점
            </div>
            <div class="row" style="margin-top:8px">
              <button class="btn primary" onclick={resumeInterruptedRun}>이어서 재생</button>
              <button class="btn ghost" onclick={discardInterruptedRun}>버리기</button>
            </div>
          </div>
        </div>
      {/if}

      {#if installHintVisible && !hintDismissed && view === 'timers'}
        <div class="notice">
          <span>📲</span>
          <div class="grow">
            <strong>홈 화면에 추가하면 앱처럼 쓸 수 있습니다</strong>
            <ul class="hint-list">
              <li>Safari 하단의 공유 버튼을 누릅니다</li>
              <li>‘홈 화면에 추가’를 선택합니다</li>
              <li>홈 화면의 Singing Bowl 아이콘으로 실행합니다</li>
            </ul>
            <div class="tiny muted">한 번 열어 두면 네트워크 없이도 동작합니다.</div>
          </div>
          <button class="btn-icon sm plain" aria-label="닫기" onclick={dismissInstallHint}>✕</button>
        </div>
      {/if}

      {#if store.error}
        <div class="toast">
          <span class="grow">{store.error}</span>
          <button class="btn-icon sm plain" aria-label="닫기" onclick={() => store.clearError()}>✕</button>
        </div>
      {/if}

      {#if view === 'timers'}
        <ProjectList onedit={openEditor} onrun={openRunner} />
      {:else if view === 'editor' && activeProjectId}
        {#key activeProjectId}
          <ProjectEditor projectId={activeProjectId} onback={goBack} onrun={openRunner} />
        {/key}
      {:else if view === 'runner' && activeProjectId}
        {#key activeProjectId}
          <Runner projectId={activeProjectId} onback={goBack} onedit={openEditor} />
        {/key}
      {:else if view === 'sounds'}
        <SoundLibrary />
      {:else if view === 'info'}
        <AppInfo onback={goBack} />
      {/if}
    {/if}
  </main>

  {#if view === 'timers' || view === 'sounds'}
    <nav class="bottom-nav">
      <button class={view === 'timers' ? 'active' : ''} onclick={openTimers}>
        <span class="icon">🕉</span>타이머
      </button>
      <button class={view === 'sounds' ? 'active' : ''} onclick={openSounds}>
        <span class="icon">🔔</span>소리
      </button>
    </nav>
  {/if}
</div>

