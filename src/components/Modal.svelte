<script>
  /** 하단에서 올라오는 시트형 모달 */
  let { title = '', onclose, children } = $props()
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onclose?.()} />

<div
  class="sheet-backdrop"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) onclose?.()
  }}
  onkeydown={(event) => event.key === 'Escape' && onclose?.()}
>
  <div class="sheet" role="dialog" aria-modal="true" aria-label={title} tabindex="-1">
    <div class="row-between">
      <strong>{title}</strong>
      <button class="btn-icon plain" aria-label="닫기" onclick={onclose}>✕</button>
    </div>
    {@render children?.()}
  </div>
</div>
