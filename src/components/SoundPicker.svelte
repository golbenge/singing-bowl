<script>
  /** 소리 선택 시트: 기본 소리 사용 / 앱 샘플 소리 / 내가 추가한 소리 */
  import Modal from './Modal.svelte'
  import { store } from '../lib/store.svelte.js'
  import { previewSound } from '../lib/audio-session.js'
  import { BUNDLED_SOUNDS, SOUND_SOURCES } from '../lib/bundled-sounds.js'
  import { formatDuration } from '../lib/time.js'

  let {
    value = null,
    defaultSoundId = null,
    allowDefault = true,
    title = '소리 선택',
    onselect,
    onclose,
  } = $props()

  let previewingId = $state(null)
  let error = $state(null)
  let fileInput = $state(null)
  let bundledQuery = $state('')

  /** 출처별로 묶은 샘플 목록 (검색어 적용) */
  const bundledGroups = $derived.by(() => {
    const q = bundledQuery.trim().toLowerCase()
    const matched = q
      ? BUNDLED_SOUNDS.filter((sound) =>
          `${sound.name} ${sound.description} ${sound.author ?? ''}`.toLowerCase().includes(q),
        )
      : BUNDLED_SOUNDS
    return SOUND_SOURCES.map((source) => ({
      ...source,
      items: matched.filter((sound) => sound.source === source.key),
    })).filter((group) => group.items.length)
  })

  const defaultSoundName = $derived(
    defaultSoundId ? store.soundName(defaultSoundId) : '기본 소리 없음',
  )

  async function preview(soundId) {
    error = null
    previewingId = soundId
    try {
      await previewSound(soundId, 0.9)
    } catch (err) {
      error = err?.message ?? String(err)
    } finally {
      setTimeout(() => {
        if (previewingId === soundId) previewingId = null
      }, 1200)
    }
  }

  function choose(soundId) {
    onselect?.(soundId)
    onclose?.()
  }

  async function addFiles(event) {
    const input = event.currentTarget
    const files = input?.files
    if (!files?.length) return
    error = null
    const added = await store.addSoundFiles(files)
    if (input) input.value = ''
    if (added.length) choose(added[0].id)
  }
</script>

<Modal {title} {onclose}>
  <div class="sheet-body">
    {#if allowDefault}
      <button class="list-item" onclick={() => choose(null)}>
        <span class="grow" style="text-align:left">
          <span class="card-title">기본 소리 사용</span>
          <span class="card-sub">{defaultSoundName}</span>
        </span>
        {#if value === null}
          <span class="badge accent">선택됨</span>
        {/if}
      </button>
      <div class="divider"></div>
    {/if}

    <div class="section-title">앱에 포함된 샘플 소리 {BUNDLED_SOUNDS.length}개</div>
    <input
      class="input"
      type="search"
      placeholder="샘플 검색 (예: 볼2 · 모노 · Kasper)"
      bind:value={bundledQuery}
      enterkeyhint="search"
    />
    {#each bundledGroups as group (group.key)}
      <div class="tiny muted" style="margin-top:4px">{group.label} · {group.items.length}개</div>
      {#each group.items as sound (sound.id)}
        <div class="list-item {value === sound.id ? 'active' : ''}">
          <button class="btn-icon sm plain" aria-label="미리 듣기" onclick={() => preview(sound.id)}>
            {previewingId === sound.id ? '♪' : '▶'}
          </button>
          <button class="grow" style="background:transparent;border:0;text-align:left" onclick={() => choose(sound.id)}>
            <div class="card-title">{sound.name}</div>
            <div class="card-sub">{sound.description}</div>
          </button>
          {#if value === sound.id}<span class="badge accent">선택됨</span>{/if}
        </div>
      {/each}
    {/each}
    {#if !bundledGroups.length}
      <div class="empty">검색과 일치하는 샘플이 없습니다.</div>
    {/if}

    <div class="divider"></div>
    <div class="section-title">내 소리 ({store.sounds.length})</div>
    {#if !store.sounds.length}
      <div class="empty">아직 추가한 음향 파일이 없습니다.</div>
    {/if}
    {#each store.sounds as sound (sound.id)}
      <div class="list-item {value === sound.id ? 'active' : ''}">
        <button class="btn-icon sm plain" aria-label="미리 듣기" onclick={() => preview(sound.id)}>
          {previewingId === sound.id ? '♪' : '▶'}
        </button>
        <button class="grow" style="background:transparent;border:0;text-align:left" onclick={() => choose(sound.id)}>
          <div class="card-title truncate">{sound.name}</div>
          <div class="card-sub">{sound.durationMs ? formatDuration(sound.durationMs) : '길이 미확인'}</div>
        </button>
        {#if value === sound.id}<span class="badge accent">선택됨</span>{/if}
      </div>
    {/each}

    <input
      bind:this={fileInput}
      type="file"
      multiple
      onchange={addFiles}
      style="display:none"
    />
    <button class="btn block" onclick={() => fileInput?.click()}>＋ 음향 파일 추가</button>
    <div class="tiny muted">mp3 · m4a · wav 파일을 지원합니다. (파일 앱의 iCloud Drive · On My iPhone)</div>

    {#if error}
      <div class="toast"><span class="grow">{error}</span></div>
    {/if}
  </div>
  <button class="btn ghost block" onclick={onclose}>닫기</button>
</Modal>
