// Quando o ditado falha por uma permissão/ajuste do macOS, o app abre o painel certo sozinho (sem o usuário procurar)
// e tenta de novo quando a janela do aplicativo volta a ter foco. Sem laço: um painel por tentativa, no máximo 3 vezes.
import type { DictationPane } from './dictationText.ts'

type Opener = (pane: Exclude<DictationPane, null>) => unknown

let armed: (() => void) | null = null

/** Abre o painel de Ajustes do Sistema e arma uma nova tentativa para quando o usuário voltar ao app. */
export function autoFixPane(pane: DictationPane, retry: () => void, options: { open?: Opener; attempts?: { count: number } } = {}) {
  if (!pane || typeof window === 'undefined') return
  const attempts = options.attempts ?? { count: 0 }
  if (attempts.count >= 3) return
  attempts.count++
  const open: Opener | undefined = options.open ?? ((p) => (window as unknown as { api?: { openPrivacySettings?: Opener } }).api?.openPrivacySettings?.(p))
  void open?.(pane)
  armed?.()
  const onFocus = () => { disarm(); setTimeout(retry, 400) }
  const disarm = () => { window.removeEventListener('focus', onFocus); armed = null }
  armed = disarm
  // Só rearma o retry depois que a janela perder o foco para os Ajustes (evita disparar com o foco atual).
  const onBlur = () => { window.removeEventListener('blur', onBlur); window.addEventListener('focus', onFocus, { once: true }) }
  window.addEventListener('blur', onBlur, { once: true })
  const timer = setTimeout(() => { window.removeEventListener('blur', onBlur); if (armed === disarm) disarm() }, 5 * 60_000) as unknown as { unref?: () => void }
  timer.unref?.()
}

export function cancelAutoFix() { armed?.() }
