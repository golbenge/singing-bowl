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
  import { formatDuration, formatIsoDateTime } from './lib/time.js'
  import ProjectList from './components/ProjectList.svelte'
  import ProjectEditor from './components/ProjectEditor.svelte'
  import Runner from './components/Runner.svelte'
  import SoundLibrary from './components/SoundLibrary.svelte'

  const HINT_KEY = 'singing-bowl:install-hint'

  let view = $state('projects') // projects | editor | runner | sounds
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
    view = 'projects'
    activeProjectId = null
  }

  function openSounds() {
    view = 'sounds'
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

  function headerTitle() {
    if (view === 'editor') return '프로젝트 편집'
    if (view === 'runner') return activeProject?.name ?? '타이머'
    if (view === 'sounds') return '소리 보관함'
    return 'Singing Bowl'
  }
</script>

<div class="app-shell">
  <header class="app-header">
    {#if view === 'editor' || view === 'runner'}
      <button class="btn-icon plain" aria-label="뒤로" onclick={goBack}>‹</button>
    {/if}
    <div class="grow">
      <div class="title truncate">{headerTitle()}</div>
      {#if view === 'projects'}
        <div class="subtitle">정해진 시간에 소리를 재생하는 타이머</div>
      {:else if view === 'runner' && activeProject}
        <div class="subtitle truncate">
          {activeProject.cues.length}개 소리 · 기본 {store.soundName(activeProject.defaultSoundId)}
        </div>
      {:else if view === 'sounds'}
        <div class="subtitle truncate">
          오프라인 · 이 폰에만 저장 · 빌드 {formatIsoDateTime(appUpdate.buildTime)}
        </div>
      {/if}
    </div>

    {#if timer.isActive && view !== 'runner'}
      <button class="chip" onclick={() => openRunner(timer.projectId)}>
        {timer.status === 'paused' ? '⏸' : '●'} <span class="tabular">{formatDuration(timer.elapsedMs)}</span>
      </button>
    {/if}

    {#if view === 'runner' && activeProject}
      <button class="btn-icon plain" aria-label="편집" onclick={() => openEditor(activeProject.id)}>✎</button>
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
              {pendingRun.projectName || '프로젝트'} · {formatDuration(pendingRun.elapsedMs)} 지점
            </div>
            <div class="row" style="margin-top:8px">
              <button class="btn primary" onclick={resumeInterruptedRun}>이어서 재생</button>
              <button class="btn ghost" onclick={discardInterruptedRun}>버리기</button>
            </div>
          </div>
        </div>
      {/if}

      {#if installHintVisible && !hintDismissed && view === 'projects'}
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

      {#if view === 'projects'}
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
      {/if}
    {/if}
  </main>

  {#if view === 'projects' || view === 'sounds'}
    <nav class="bottom-nav">
      <button class={view === 'projects' ? 'active' : ''} onclick={goBack}>
        <span class="icon">🕉</span>프로젝트
      </button>
      <button class={view === 'sounds' ? 'active' : ''} onclick={openSounds}>
        <span class="icon">🔔</span>소리
      </button>
    </nav>
  {/if}
</div>

