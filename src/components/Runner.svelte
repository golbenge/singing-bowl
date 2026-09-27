<script>
  /** 실행 화면: 시작 / 일시 중지 / 재개 / 종료 */
  import { store } from '../lib/store.svelte.js'
  import { timer } from '../lib/engine.svelte.js'
  import { primeAudio } from '../lib/audio-session.js'
  import { formatDuration, formatKoreanDuration, formatTimeOfDay } from '../lib/time.js'

  let { projectId, onback, onedit } = $props()

  const project = $derived(store.projectById(projectId))
  let busy = $state(false)

  const active = $derived(timer.projectId === projectId)
  const status = $derived(active ? timer.status : 'idle')
  const totalSeconds = $derived(
    project?.cues.length ? Math.max(...project.cues.map((cue) => cue.atSeconds)) : 0,
  )
  const nextCue = $derived(active && timer.status !== 'idle' ? timer.nextCue : null)
  const nextSoundName = $derived(nextCue ? store.soundName(nextCue.soundId) : '')

  const CUE_LABELS = {
    pending: '대기',
    scheduled: '예정',
    done: '재생됨',
    missed: '건너뜀',
    skipped: '건너뜀',
  }

  function cueBadgeClass(state) {
    if (state === 'done') return 'badge done'
    if (state === 'missed' || state === 'skipped') return 'badge danger'
    if (state === 'scheduled') return 'badge accent'
    return 'badge'
  }

  function markerLeft(atSeconds) {
    if (!timer.durationMs) return 0
    return Math.min(100, (atSeconds * 1000) / timer.durationMs * 100)
  }

  /** 시작 버튼: 제스처 직후 곧바로 오디오 세션을 깨워 잠금 화면 재생을 준비한다. */
  async function handleStart() {
    if (!project || busy) return
    busy = true
    timer.error = null
    try {
      await primeAudio()
      const ok = await timer.prepare(project)
      if (ok) await timer.start()
    } finally {
      busy = false
    }
  }

  async function handleResume() {
    if (busy) return
    busy = true
    try {
      await timer.resume()
    } finally {
      busy = false
    }
  }

  function handlePause() {
    timer.pause()
  }

  function handleStop() {
    timer.stop('manual')
  }
</script>

{#if !project}
  <div class="empty">프로젝트를 찾을 수 없습니다.</div>
  <button class="btn block" onclick={onback}>목록으로 돌아가기</button>
{:else if active && timer.status !== 'idle' && timer.status !== 'finished'}
  <!-- ------------------------------ 실행 중 ------------------------------ -->
  <article class="card stack" style="text-align:center">
    <div class="small muted truncate">{timer.projectName || project.name}</div>

    {#if timer.status === 'preparing'}
      <div class="big-time tabular">--:--</div>
      <div class="row" style="justify-content:center">
        <span class="spinner"></span>
        <span class="small muted">{timer.progressMessage || '소리를 준비하는 중…'}</span>
      </div>
    {:else}
      <div class="big-time tabular">{formatDuration(timer.elapsedMs)}</div>
      <div class="small muted">
        {#if timer.status === 'paused'}
          일시 중지됨 · 전체 {formatDuration(timer.durationMs)}
        {:else}
          전체 {formatDuration(timer.durationMs)} · 남은 {formatDuration(Math.max(0, timer.durationMs - timer.elapsedMs))}
        {/if}
      </div>
    {/if}

    <div class="progress">
      <div class="bar" style="width:{Math.round(timer.progress * 100)}%"></div>
      {#each timer.cues as cue (cue.id)}
        <div
          class="marker {cue.state === 'done' ? 'done' : ''}"
          style="left:{markerLeft(cue.atSeconds)}%"
          title="{formatDuration(cue.atSeconds * 1000)}"
        ></div>
      {/each}
    </div>

    {#if timer.status === 'running'}
      <div class="small">
        {#if nextCue}
          <span class="muted">다음 소리</span>
          <strong class="tabular">{formatDuration(timer.remainingToNextMs)}</strong>
          <span class="muted">후 · {nextSoundName}</span>
          <div class="tiny muted">{formatTimeOfDay(Date.now() + timer.remainingToNextMs)}에 재생</div>
        {:else}
          <span class="muted">남은 소리가 없습니다. 잠시 후 자동 종료됩니다.</span>
        {/if}
      </div>
    {:else}
      <div class="small muted">‘이어서’를 누르면 남은 소리부터 다시 예약됩니다.</div>
    {/if}
  </article>

  <div class="row">
    {#if timer.status === 'preparing'}
      <button class="btn lg grow" disabled><span class="spinner"></span> 준비 중…</button>
    {:else if timer.status === 'running'}
      <button class="btn lg grow" onclick={handlePause}>⏸ 일시 중지</button>
    {:else}
      <button class="btn primary lg grow" onclick={handleResume} disabled={busy}>▶ 이어서</button>
    {/if}
    <button class="btn danger lg" onclick={handleStop}>■ 종료</button>
  </div>

  <div class="row">
    <span class="tiny muted">볼륨</span>
    <input
      type="range"
      min="0"
      max="1"
      step="0.05"
      value={timer.volume}
      oninput={(event) => timer.setVolume(Number(event.currentTarget.value))}
    />
    <span class="badge tabular">{Math.round(timer.volume * 100)}%</span>
  </div>

  <div class="section-title">
    재생 일정 · {timer.completedCount}/{timer.cues.length} 재생{#if timer.skippedCount} · {timer.skippedCount}개 건너뜀{/if}
  </div>
  <div class="list">
    {#each timer.cues as cue, index (cue.id)}
      <div class="list-item {cue.state === 'done' ? 'active' : ''}">
        <span class="badge tabular">{formatDuration(cue.atSeconds * 1000)}</span>
        <div class="grow">
          <div class="truncate">
            {index + 1}. {store.soundName(cue.soundId)}
            {#if cue.usesDefault}<span class="tag">기본</span>{/if}
          </div>
          {#if cue.label}<div class="tiny muted truncate">{cue.label}</div>{/if}
        </div>
        <span class={cueBadgeClass(cue.state)}>{CUE_LABELS[cue.state] ?? ''}</span>
      </div>
    {/each}
  </div>

  {#if timer.wakeLockActive}
    <div class="notice small"><span>💡</span><span class="grow">화면이 꺼지지 않도록 유지하고 있습니다.</span></div>
  {/if}
  <div class="notice small">
    <span>🔒</span>
    <span class="grow">
      화면을 꺼도 예약된 시각에 소리가 재생됩니다. 잠금 화면의 재생/일시정지 버튼으로도 조작할 수 있습니다.
    </span>
  </div>
{:else}
  <!-- ------------------------------ 실행 전 ------------------------------ -->
  {#if timer.status === 'finished' && active}
    <div class="notice accent">
      <span>✅</span>
      <span class="grow">
        타이머가 끝났습니다. 전체 {formatDuration(timer.durationMs)} 동안 {timer.completedCount}개의 소리를 재생했습니다.
      </span>
    </div>
  {/if}

  <article class="card stack">
    <div class="row-between">
      <strong>{project.name}</strong>
      <span class="badge accent">{project.cues.length}개 소리</span>
    </div>
    <div class="small muted">
      {totalSeconds ? `마지막 소리 ${formatKoreanDuration(totalSeconds)} 후` : '재생할 시간 없음'} · 기본 소리
      {store.soundName(project.defaultSoundId)} · 볼륨 {Math.round(project.volume * 100)}%
    </div>
    <div class="divider"></div>
    <div class="list">
      {#each [...project.cues].sort((a, b) => a.atSeconds - b.atSeconds) as cue (cue.id)}
        <div class="list-item">
          <span class="badge tabular">{formatDuration(cue.atSeconds * 1000)}</span>
          <div class="grow">
            <div class="truncate">
              {store.soundName(cue.soundId ?? project.defaultSoundId)}
              {#if !cue.soundId}<span class="tag">기본</span>{/if}
            </div>
            {#if cue.label}<div class="tiny muted truncate">{cue.label}</div>{/if}
          </div>
        </div>
      {/each}
    </div>
  </article>

  {#if !project.cues.length}
    <div class="notice"><span>ℹ️</span><span class="grow">소리를 재생할 시간을 먼저 추가해 주세요.</span></div>
    <button class="btn primary block" onclick={() => onedit?.(projectId)}>시간 추가하러 가기</button>
  {:else}
    <button class="btn primary lg block" onclick={handleStart} disabled={busy}>
      {#if busy}<span class="spinner"></span> 준비하는 중…{:else}▶ 타이머 시작{/if}
    </button>
    <div class="notice small">
      <span>💡</span>
      <span class="grow">
        알림이 아니라 소리로 알려 줍니다. 시작 후에는 화면을 꺼도 되고, 앱을 홈 화면에 추가해 두면 더 안정적으로 동작합니다.
      </span>
    </div>
  {/if}

  {#if timer.error}
    <div class="toast">
      <span class="grow">{timer.error}</span>
      <button class="btn-icon sm plain" aria-label="닫기" onclick={() => (timer.error = null)}>✕</button>
    </div>
  {/if}
{/if}


