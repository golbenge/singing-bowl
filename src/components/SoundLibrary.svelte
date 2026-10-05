<script>
  /** 소리: 앱 샘플 소리 + 사용자가 추가한 음향 파일 */
  import { store } from '../lib/store.svelte.js'
  import { BUNDLED_SOUNDS, SOUND_SOURCES } from '../lib/bundled-sounds.js'
  import { previewSound } from '../lib/audio-session.js'
  import { formatBytes, formatDuration } from '../lib/time.js'

  let fileInput = $state(null)
  let busy = $state(false)
  let previewingId = $state(null)
  let error = $state(null)
  let renamingId = $state(null)
  let renameValue = $state('')
  let confirmingId = $state(null)
  let bundledQuery = $state('')

  /** 출처별로 묶은 샘플 목록 (검색어 적용) */
  const bundledGroups = $derived.by(() => {
    const q = bundledQuery.trim().toLowerCase()
    const matched = q
      ? BUNDLED_SOUNDS.filter((sound) =>
          `${sound.name} ${sound.description} ${sound.author ?? ''}`
            .toLowerCase()
            .includes(q),
        )
      : BUNDLED_SOUNDS
    return SOUND_SOURCES.map((source) => ({
      ...source,
      items: matched.filter((sound) => sound.source === source.key),
    })).filter((group) => group.items.length)
  })

  async function addFiles(event) {
    const input = event.currentTarget
    const files = input?.files
    if (!files?.length) return
    busy = true
    error = null
    const added = await store.addSoundFiles(files)
    if (input) input.value = ''
    busy = false
    if (store.error) error = store.error
    if (!added.length && !error) error = '추가된 파일이 없습니다.'
  }

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

  function startRename(sound) {
    renamingId = sound.id
    renameValue = sound.name
  }

  async function commitRename(sound) {
    await store.renameSound(sound.id, renameValue)
    renamingId = null
  }

  async function remove(sound) {
    if (confirmingId !== sound.id) {
      confirmingId = sound.id
      setTimeout(() => {
        if (confirmingId === sound.id) confirmingId = null
      }, 3000)
      return
    }
    confirmingId = null
    await store.deleteSound(sound.id)
  }
</script>

<div class="notice">
  <span>📴</span>
  <span class="grow small">
    추가한 음향 파일은 <strong>이 기기(IndexedDB)</strong>에만 저장됩니다. 서버로 전송되지 않으며
    네트워크 연결이 없어도 재생됩니다.
  </span>
</div>

<div class="section-title">앱에 포함된 샘플 소리 {BUNDLED_SOUNDS.length}개 (오프라인에서도 재생)</div>
<input
  class="input"
  type="search"
  placeholder="샘플 검색 (예: 볼2 · 모노 · 싱잉볼 · Kasper)"
  bind:value={bundledQuery}
  enterkeyhint="search"
/>
{#each bundledGroups as group (group.key)}
  <div class="section-title">{group.label} · {group.items.length}개</div>
  <div class="list">
    {#each group.items as sound (sound.id)}
      <div class="list-item">
        <button class="btn-icon sm plain" aria-label="미리 듣기" onclick={() => preview(sound.id)}>
          {previewingId === sound.id ? '♪' : '▶'}
        </button>
        <div class="grow">
          <div class="card-title">{sound.name}</div>
          <div class="card-sub">{sound.description}</div>
          {#if sound.license}<div class="tiny muted">{sound.license}</div>{/if}
        </div>
        <span class="badge tabular">{formatDuration(sound.durationMs)}</span>
      </div>
    {/each}
  </div>
{/each}
{#if !bundledGroups.length}
  <div class="empty">검색과 일치하는 샘플이 없습니다.</div>
{/if}

<div class="row-between" style="margin-top:6px">
  <div class="section-title">내 소리 {store.sounds.length}개</div>
  {#if busy}<span class="row tiny muted"><span class="spinner"></span> 추가하는 중…</span>{/if}
</div>

<input
  bind:this={fileInput}
  type="file"
  multiple
  style="display:none"
  onchange={addFiles}
/>

{#if !store.sounds.length}
  <div class="empty">
    음향 파일(mp3, m4a, wav 등)을 추가하면<br />시간대마다 다른 소리를 쓸 수 있습니다.
  </div>
{/if}

<div class="list">
  {#each store.sounds as sound (sound.id)}
    <div class="list-item">
      <button class="btn-icon sm plain" aria-label="미리 듣기" onclick={() => preview(sound.id)}>
        {previewingId === sound.id ? '♪' : '▶'}
      </button>
      <div class="grow">
        {#if renamingId === sound.id}
          <input
            class="input"
            bind:value={renameValue}
            enterkeyhint="done"
            onkeydown={(event) => event.key === 'Enter' && commitRename(sound)}
          />
        {:else}
          <button
            style="background:transparent;border:0;padding:0;text-align:left"
            onclick={() => startRename(sound)}
          >
            <div class="card-title truncate">{sound.name}</div>
          </button>
          <div class="card-sub tabular">
            {sound.durationMs ? formatDuration(sound.durationMs) : '길이 미확인'} · {formatBytes(sound.size)}
            {#if sound.sampleRate}· {Math.round(sound.sampleRate / 1000)}kHz{/if}
          </div>
        {/if}
      </div>
      {#if renamingId === sound.id}
        <button class="btn-icon sm" aria-label="이름 저장" onclick={() => commitRename(sound)}>✓</button>
        <button class="btn-icon sm plain" aria-label="취소" onclick={() => (renamingId = null)}>✕</button>
      {:else}
        <button class="btn-icon sm plain" aria-label="이름 바꾸기" onclick={() => startRename(sound)}>✎</button>
        <button class="btn-icon sm plain danger-text" aria-label="삭제" onclick={() => remove(sound)}>
          {confirmingId === sound.id ? '!' : '🗑'}
        </button>
      {/if}
    </div>
    {#if confirmingId === sound.id}
      <div class="notice small">
        <span class="grow">
          이 소리를 쓰는 타이머 {store.usageCount(sound.id)}곳이 기본 소리로 바뀝니다. 삭제하려면 삭제 버튼을 한 번 더 누르세요.
        </span>
      </div>
    {/if}
  {/each}
</div>

<button class="btn primary block" onclick={() => fileInput?.click()} disabled={busy}>
  ＋ 음향 파일 추가
</button>
<div class="tiny muted">
  파일 앱(iCloud Drive · On My iPhone)에서 mp3 · m4a · wav 파일을 고르세요. 선택 목록이 비어 있으면
  파일 앱에서 그 파일을 한 번 열어 폰에 내려받은 뒤 다시 시도해 보세요. (ogg · flac 은 아이폰에서 재생되지 않습니다)
</div>

{#if error}
  <div class="toast">
    <span class="grow">{error}</span>
    <button class="btn-icon sm plain" aria-label="닫기" onclick={() => (error = null)}>✕</button>
  </div>
{/if}

