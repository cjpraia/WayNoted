/** Reveal a linked block even when it has no text cursor or is inside closed toggles. */
export function revealLinkedBlock(root: HTMLElement, blockId: string): HTMLElement | undefined {
  const matches = Array.from(root.querySelectorAll<HTMLElement>('[data-id]')).filter(element => element.dataset.id === blockId)
  const target = matches.find(element => element.classList.contains('bn-block')) ?? matches[0]
  if (!target) return
  const ancestors: HTMLElement[] = []
  for (let parent = target.parentElement?.closest<HTMLElement>('.bn-block'); parent; parent = parent.parentElement?.closest<HTMLElement>('.bn-block')) ancestors.unshift(parent)
  for (const ancestor of ancestors) {
    const toggle = Array.from(ancestor.querySelectorAll<HTMLElement>('.bn-toggle-wrapper')).find(wrapper => wrapper.closest('.bn-block') === ancestor)
    if (toggle?.dataset.showChildren === 'false') toggle.querySelector<HTMLButtonElement>('.bn-toggle-button')?.click()
  }
  target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  return target
}
