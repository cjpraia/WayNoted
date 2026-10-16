// Atenção seletiva: depois de 3 s de digitação contínua no editor, o cromo (barra lateral, abas, ações da
// topbar) esmaece para 60 %; volta ao mover o mouse ou ao parar de digitar. Núcleo puro e testável.
export const DIM_AFTER_MS = 3000
/** Pausa máxima entre teclas para a digitação ainda ser "contínua". */
export const TYPING_GAP_MS = 1500

export class TypingTracker {
  private start = -1
  private last = -1
  private dimmed = false
  private readonly onChange: (dimmed: boolean) => void
  constructor(onChange: (dimmed: boolean) => void) { this.onChange = onChange }
  /** Tecla digitada no editor; `now` em ms. Devolve se o cromo deve estar esmaecido. */
  key(now: number): boolean {
    if (this.start < 0 || now - this.last > TYPING_GAP_MS) this.start = now
    this.last = now
    if (!this.dimmed && now - this.start >= DIM_AFTER_MS) this.set(true)
    return this.dimmed
  }
  /** Mouse mexeu, foco saiu do editor ou a digitação parou. */
  release() { this.start = -1; this.last = -1; this.set(false) }
  /** Chamado por um temporizador: se já passou da pausa, solta. */
  tick(now: number) { if (this.last >= 0 && now - this.last > TYPING_GAP_MS) this.release() }
  get isDimmed() { return this.dimmed }
  private set(value: boolean) { if (this.dimmed !== value) { this.dimmed = value; this.onChange(value) } }
}

const EDITABLE = '.ProseMirror, [contenteditable="true"]'

/** Liga os ouvintes no documento. Devolve a função de limpeza. `enabled()` é lida a cada tecla. */
export function installDimChrome(root: HTMLElement, enabled: () => boolean, focusActive: () => boolean): () => void {
  const tracker = new TypingTracker(dimmed => { if (dimmed) root.dataset.typing = '1'; else delete root.dataset.typing })
  const onKey = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.key.length > 1 && event.key !== 'Backspace' && event.key !== 'Enter') return
    if (!enabled() || focusActive() || !(event.target as Element | null)?.closest?.(EDITABLE)) return
    tracker.key(performance.now())
  }
  let lastX = -1, lastY = -1
  const onMove = (event: MouseEvent) => {
    // Ignora o "mouse parado" que alguns sistemas reemitem após a digitação.
    if (Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY) < 3) return
    lastX = event.clientX; lastY = event.clientY
    tracker.release()
  }
  const interval = setInterval(() => tracker.tick(performance.now()), 500)
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('mousemove', onMove, { passive: true })
  document.addEventListener('pointerdown', () => tracker.release(), true)
  return () => { clearInterval(interval); document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousemove', onMove); tracker.release() }
}
