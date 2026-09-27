<script>
  /** 프로젝트 목록 */
  import Modal from './Modal.svelte'
  import { store } from '../lib/store.svelte.js'
  import { timer } from '../lib/engine.svelte.js'
  import { formatKoreanDuration } from '../lib/time.js'

  let { onedit, onrun } = $props()

  let creating = $state(false)
  let newName = $state('')
  let newNameInput = $state(null)
  let confirmingId = $state(null)

  $effect(() => {
    if (creating) newNameInput?.focus()
  })

  const projects = $derived([...store.projects].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)))

  function projectSummary(project) {
    const last = project.cues.at(-1)
    const total = last ? last.atSeconds : 0
    return `소리 ${project.cues.length}개 · ${total ? formatKoreanDuration(total) : '시간 없음'} · 기본 ${store.soundName(project.defaultSoundId)}`
  }

  async function createProject() {
    const project = await store.createProject(newName || '새 타이머')
    creating = false
    newName = ''
    onedit?.(project.id)
  }

  async function duplicate(projectId) {
    const copy = await store.duplicateProject(projectId)
    if (copy) onedit?.(copy.id)
  }

  async function remove(projectId) {
    if (confirmingId !== projectId) {
      confirmingId = projectId
      setTimeout(() => {
        if (confirmingId === projectId) confirmingId = null
      }, 3000)
      return
    }
    confirmingId = null
    if (timer.projectId === projectId) timer.reset()
    await store.deleteProject(projectId)
  }
</script>

<div class="row-between">
  <div class="section-title">내 타이머 {projects.length}개</div>
  <button class="btn primary pill" onclick={() => { creating = true; newName = '' }}>
    ＋ 새 타이머
  </button>
</div>

{#if !projects.length}
  <div class="empty">
    아직 타이머가 없습니다.<br />‘새 타이머’를 눌러 시작하세요.
  </div>
{/if}

{#each projects as project (project.id)}
  <article class="card">
    <div class="card-head">
      <button
        class="grow"
        style="background:transparent;border:0;text-align:left;padding:0"
        onclick={() => onedit?.(project.id)}
      >
        <div class="card-title truncate">{project.name}</div>
        <div class="card-sub">{projectSummary(project)}</div>
      </button>
      <button
        class="btn play"
        disabled={!project.cues.length}
        aria-label="{project.name} 실행"
        onclick={() => onrun?.(project.id)}
      >
        ▶ 재생
      </button>
    </div>

    <div class="row" style="margin-top:10px">
      <button class="chip plain" onclick={() => onedit?.(project.id)}>편집</button>
      <button class="chip plain" onclick={() => duplicate(project.id)}>복제</button>
      <span class="grow"></span>
      <button class="chip plain danger-text" onclick={() => remove(project.id)}>
        {confirmingId === project.id ? '정말 삭제할까요?' : '삭제'}
      </button>
    </div>
  </article>
{/each}

{#if creating}
  <Modal title="새 타이머" onclose={() => (creating = false)}>
    <div class="field">
      <span class="label">타이머 이름</span>
      <input
        bind:this={newNameInput}
        bind:value={newName}
        class="input"
        placeholder="예) 아침 명상"
        enterkeyhint="done"
        onkeydown={(event) => event.key === 'Enter' && createProject()}
      />
    </div>
    <div class="tiny muted">기본값: 소리 5분 뒤에 한 번 재생되는 타이머가 만들어집니다.</div>
    <div class="row">
      <button class="btn ghost grow" onclick={() => (creating = false)}>취소</button>
      <button class="btn primary grow" onclick={createProject}>만들기</button>
    </div>
  </Modal>
{/if}
