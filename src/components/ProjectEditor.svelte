<script>
  /** 프로젝트 편집: 이름 / 기본 소리 / 시간대별 소리 */
  import { untrack } from 'svelte'
  import SoundPicker from './SoundPicker.svelte'
  import { store } from '../lib/store.svelte.js'
  import { timer } from '../lib/engine.svelte.js'
  import { previewSound } from '../lib/audio-session.js'
  import { DEFAULT_SOUND_ID } from '../lib/synth.js'
  import { clamp, formatDuration, formatKoreanDuration, uid } from '../lib/time.js'

  let { projectId, onback, onrun } = $props()

  // 컴포넌트는 프로젝트마다 새로 만들어지므로 최초 1회만 읽는다.
  const project = untrack(() => store.projectById(projectId))

  function cloneProject(source) {
    return {
      name: source.name,
      defaultSoundId: source.defaultSoundId ?? DEFAULT_SOUND_ID,
      volume: typeof source.volume === 'number' ? source.volume : 0.9,
      cues: source.cues.map((cue) => ({
        id: cue.id,
        atSeconds: cue.atSeconds,
        soundId: cue.soundId ?? null,
        label: cue.label ?? '',
      })),
    }
  }

  let draft = $state(project ? cloneProject(project) : null)
  let saveState = $state('idle') // idle | pending | saved
  let saveTimer = null
  let lastSaved = project ? JSON.stringify(cloneProject(project)) : ''
  let pickerCueId = $state(null)
  let pickingDefault = $state(false)
  let confirmingDelete = $state(false)
  let previewing = $state(false)
  let previewError = $state(null)

  function timeFieldOf(cue) {
    return {
      minutes: String(Math.floor(cue.atSeconds / 60)),
      seconds: String(cue.atSeconds % 60),
    }
  }

  // 시간 입력 필드는 렌더 중에 만들지 않도록(렌더 중 상태 변경 금지) 미리 채워 둔다.
  const timeFields = $state({})
  for (const cue of draft?.cues ?? []) timeFields[cue.id] = timeFieldOf(cue)

  $effect(() => {
    if (!draft) return
    for (const cue of draft.cues) {
      if (!timeFields[cue.id]) timeFields[cue.id] = timeFieldOf(cue)
    }
    for (const id of Object.keys(timeFields)) {
      if (!draft.cues.some((cue) => cue.id === id)) delete timeFields[id]
    }
  })

  const defaultSoundName = $derived(
    store.soundName(draft?.defaultSoundId ?? DEFAULT_SOUND_ID),
  )
  const lastCueSeconds = $derived(draft?.cues.at(-1)?.atSeconds ?? 0)
  const duplicateTimes = $derived(
    (draft?.cues ?? []).some(
      (cue, index) => (draft?.cues ?? []).findIndex((item) => item.atSeconds === cue.atSeconds) !== index,
    ),
  )

  // 변경 사항 자동 저장(0.4초 디바운스)
  $effect(() => {
    if (!draft) return
    const snapshot = JSON.stringify(draft)
    if (snapshot === lastSaved) return
    saveState = 'pending'
    clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      await store.updateProject(projectId, {
        name: draft.name,
        defaultSoundId: draft.defaultSoundId,
        volume: draft.volume,
        cues: draft.cues,
      })
      lastSaved = snapshot
      saveState = 'saved'
    }, 400)
  })

  async function flush() {
    if (!draft) return
    clearTimeout(saveTimer)
    const snapshot = JSON.stringify(draft)
    if (snapshot === lastSaved) return
    await store.updateProject(projectId, {
      name: draft.name,
      defaultSoundId: draft.defaultSoundId,
      volume: draft.volume,
      cues: draft.cues,
    })
    lastSaved = snapshot
    saveState = 'saved'
  }

  /* ------------------------------- 시간 편집 ------------------------------- */

  function fieldOf(cue) {
    return timeFields[cue.id] ?? timeFieldOf(cue)
  }

  function toNumber(value, max) {
    const parsed = Number.parseInt(String(value ?? '').replace(/[^0-9]/g, ''), 10)
    if (Number.isNaN(parsed)) return 0
    return clamp(parsed, 0, max)
  }

  function applyTime(cue) {
    const field = fieldOf(cue)
    cue.atSeconds = toNumber(field.minutes, 999) * 60 + toNumber(field.seconds, 59)
  }

  function normalizeField(cue) {
    const field = fieldOf(cue)
    field.minutes = String(Math.floor(cue.atSeconds / 60))
    field.seconds = String(cue.atSeconds % 60)
  }

  function addCue(offsetSeconds) {
    const last = draft.cues.at(-1)
    const cue = {
      id: uid('cue'),
      atSeconds: Math.max(0, (last?.atSeconds ?? 0) + offsetSeconds),
      soundId: null,
      label: '',
    }
    draft.cues.push(cue)
    timeFields[cue.id] = timeFieldOf(cue)
  }

  function removeCue(cueId) {
    draft.cues = draft.cues.filter((cue) => cue.id !== cueId)
    delete timeFields[cueId]
  }

  function moveCue(index, direction) {
    const target = index + direction
    if (target < 0 || target >= draft.cues.length) return
    const cues = [...draft.cues]
    const [moved] = cues.splice(index, 1)
    cues.splice(target, 0, moved)
    draft.cues = cues
  }

  function cueSoundLabel(cue) {
    return cue.soundId ? store.soundName(cue.soundId) : `기본 소리 (${defaultSoundName})`
  }

  async function previewCue(cue) {
    previewError = null
    previewing = true
    try {
      await previewSound(cue.soundId ?? draft.defaultSoundId, 0.9)
    } catch (error) {
      previewError = error?.message ?? String(error)
    } finally {
      setTimeout(() => (previewing = false), 1200)
    }
  }

  async function runNow() {
    await flush()
    onrun?.(projectId)
  }

  async function deleteProject() {
    if (!confirmingDelete) {
      confirmingDelete = true
      setTimeout(() => (confirmingDelete = false), 3000)
      return
    }
    if (timer.projectId === projectId) timer.reset()
    await store.deleteProject(projectId)
    onback?.()
  }

  const pickerTarget = $derived(draft?.cues.find((cue) => cue.id === pickerCueId) ?? null)
</script>

{#if !draft}
  <div class="empty">프로젝트를 찾을 수 없습니다.</div>
  <button class="btn block" onclick={onback}>목록으로 돌아가기</button>
{:else}
  <article class="card stack">
    <div class="field">
      <span class="label">프로젝트 이름</span>
      <input class="input" bind:value={draft.name} maxlength="40" enterkeyhint="done" />
    </div>

    <div class="row-between">
      <span class="label">기본 소리</span>
      <button class="chip" onclick={() => (pickingDefault = true)}>🔔 {defaultSoundName}</button>
    </div>
    <div class="tiny muted">
      시간대에서 따로 소리를 고르지 않으면 기본 소리가 재생됩니다.
    </div>

    <div class="field">
      <span class="label">재생 볼륨</span>
      <div class="row">
        <input type="range" min="0" max="1" step="0.05" bind:value={draft.volume} />
        <span class="badge tabular">{Math.round(draft.volume * 100)}%</span>
      </div>
    </div>

    <div class="row-between tiny muted">
      <span>{saveState === 'pending' ? '저장 중…' : saveState === 'saved' ? '저장됨 ✓' : '변경하면 자동 저장됩니다'}</span>
      <span>전체 {lastCueSeconds ? formatKoreanDuration(lastCueSeconds) : '-'}</span>
    </div>
  </article>

  <div class="row-between">
    <div class="section-title">소리를 재생할 시간 {draft.cues.length}개</div>
    <span class="tiny muted">시간 순서로 재생</span>
  </div>

  {#if duplicateTimes}
    <div class="notice accent small">같은 시간이 겹쳐 있습니다. 시간을 조정해 주세요.</div>
  {/if}

  {#if !draft.cues.length}
    <div class="empty">아래 ‘빠른 추가’로 소리를 재생할 시간을 추가해 보세요.</div>
  {/if}

  {#each draft.cues as cue, index (cue.id)}
    <article class="card tight">
      <div class="row-between">
        <div class="row">
          <span class="badge accent tabular">{formatDuration(cue.atSeconds * 1000)}</span>
          <span class="tiny muted">시작 후</span>
        </div>
        <div class="row">
          <button
            class="btn-icon sm"
            aria-label="위로 이동"
            disabled={index === 0}
            onclick={() => moveCue(index, -1)}>↑</button
          >
          <button
            class="btn-icon sm"
            aria-label="아래로 이동"
            disabled={index === draft.cues.length - 1}
            onclick={() => moveCue(index, 1)}>↓</button
          >
          <button class="btn-icon sm danger-text" aria-label="삭제" onclick={() => removeCue(cue.id)}>✕</button>
        </div>
      </div>

      <div class="row" style="margin-top:8px">
        <input
          class="input time"
          type="number"
          inputmode="numeric"
          min="0"
          max="999"
          value={fieldOf(cue).minutes}
          oninput={(event) => {
            fieldOf(cue).minutes = event.currentTarget.value
            applyTime(cue)
          }}
          onblur={() => normalizeField(cue)}
        />
        <span class="muted small">분</span>
        <input
          class="input time"
          type="number"
          inputmode="numeric"
          min="0"
          max="59"
          value={fieldOf(cue).seconds}
          oninput={(event) => {
            fieldOf(cue).seconds = event.currentTarget.value
            applyTime(cue)
          }}
          onblur={() => normalizeField(cue)}
        />
        <span class="muted small">초</span>
        <span class="grow"></span>
        <button class="btn-icon sm plain" aria-label="미리 듣기" onclick={() => previewCue(cue)}>
          {previewing ? '♪' : '▶'}
        </button>
      </div>

      <button class="chip block" style="margin-top:8px;width:100%;justify-content:center" onclick={() => (pickerCueId = cue.id)}>
        🔔 {cueSoundLabel(cue)}
      </button>

      <input
        class="input"
        style="margin-top:8px"
        placeholder="메모 (선택) 예) 마무리"
        maxlength="40"
        bind:value={cue.label}
      />
    </article>
  {/each}

  <div class="row" style="flex-wrap:wrap">
    <span class="tiny muted">빠른 추가</span>
    <button class="chip" onclick={() => addCue(60)}>＋1분</button>
    <button class="chip" onclick={() => addCue(300)}>＋5분</button>
    <button class="chip" onclick={() => addCue(600)}>＋10분</button>
    <button class="chip" onclick={() => addCue(1800)}>＋30분</button>
  </div>

  {#if previewError}
    <div class="toast"><span class="grow">{previewError}</span></div>
  {/if}

  <button class="btn primary lg block" disabled={!draft.cues.length} onclick={runNow}>
    ▶ 이 프로젝트 실행
  </button>

  <button class="btn block danger-text" onclick={deleteProject}>
    {confirmingDelete ? '정말 삭제할까요? 한 번 더 누르세요' : '프로젝트 삭제'}
  </button>
{/if}

{#if pickerCueId && draft}
  <SoundPicker
    title="이 시간대에 쓸 소리"
    value={pickerTarget?.soundId ?? null}
    defaultSoundId={draft.defaultSoundId}
    allowDefault={true}
    onselect={(soundId) => {
      if (pickerTarget) pickerTarget.soundId = soundId
    }}
    onclose={() => (pickerCueId = null)}
  />
{/if}

{#if pickingDefault && draft}
  <SoundPicker
    title="기본 소리 선택"
    value={draft.defaultSoundId}
    allowDefault={false}
    onselect={(soundId) => {
      if (soundId) draft.defaultSoundId = soundId
    }}
    onclose={() => (pickingDefault = false)}
  />
{/if}

