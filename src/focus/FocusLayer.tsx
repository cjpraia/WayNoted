// Modo foco: esconde a interface, centraliza o texto, destaca o parágrafo atual e mantém a linha no centro.
import { useEffect, useState } from 'react'
import { AlignCenter, Pilcrow, X } from 'lucide-react'
import { t, useI18n } from '../i18n'
import { countWords, focusMode, useFocusMode } from './focusMode'
import './focus.css'
import { matchesCombo, shortcutHint } from '../shortcuts'

const OPEN_LAYERS = '.st-overlay, [role="dialog"]:not(.np-focus-bar), [role="menu"], [role="listbox"], .bn-suggestion-menu, .bn-formatting-toolbar, .pg-menu, .mantine-Popover-dropdown'

function editorRoot() { return document.querySelector<HTMLElement>('.app-content .pg-root') }
function caretRect(): DOMRect | null {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return null
  const range = selection.getRangeAt(0).cloneRange()
  range.collapse(false)
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
  if (rect && (rect.top || rect.bottom)) return rect
  const element = (selection.focusNode instanceof Element ? selection.focusNode : selection.focusNode?.parentElement) ?? null
  return element?.getBoundingClientRect() ?? null
}

export function FocusModeLayer() {
  const { active, highlight, typewriter } = useFocusMode()
  const [words, setWords] = useState(0)
  useI18n()

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('np-focus', active)
    root.classList.toggle('np-focus-dim', active && highlight)
    root.classList.toggle('np-focus-typewriter', active && typewriter)
    return () => { root.classList.remove('np-focus', 'np-focus-dim', 'np-focus-typewriter') }
  }, [active, highlight, typewriter])

  // Bloco atual (para destacar) e rolagem "máquina de escrever".
  useEffect(() => {
    if (!active) return
    // O bloco atual é marcado por uma regra CSS com o data-id do BlockNote — nunca alteramos o DOM do ProseMirror
    // (ele desfaz atributos estranhos e reescreve a seleção).
    const style = document.createElement('style')
    style.id = 'np-focus-current'
    document.head.appendChild(style)
    let currentId: string | null = null, frame = 0
    // setTimeout (não rAF): rAF fica suspenso quando a janela está encoberta.
    const update = () => {
      clearTimeout(frame)
      frame = window.setTimeout(() => {
        const selection = window.getSelection()
        const node = selection?.focusNode
        const element = node instanceof Element ? node : node?.parentElement
        const block = element?.closest<HTMLElement>('.pg-root .bn-block-outer[data-id]')
        const id = block?.dataset.id ?? null
        if (id !== currentId) {
          currentId = id
          style.textContent = id ? `html.np-focus-dim .pg-root .bn-block-outer[data-id="${CSS.escape(id)}"] > .bn-block > .bn-block-content { opacity: 1; }` : ''
        }
        if (focusMode.get().typewriter && block) {
          const scroller = document.querySelector<HTMLElement>('.app-content')
          const rect = caretRect()
          if (scroller && rect) {
            const box = scroller.getBoundingClientRect()
            const delta = rect.top + rect.height / 2 - (box.top + box.height / 2)
            if (Math.abs(delta) > 2) scroller.scrollTop += delta
          }
        }
      }, 16)
    }
    document.addEventListener('selectionchange', update)
    document.addEventListener('input', update, true)
    update()
    return () => { clearTimeout(frame); document.removeEventListener('selectionchange', update); document.removeEventListener('input', update, true); style.remove() }
  }, [active, typewriter])

  // Contagem de palavras discreta (título + corpo da página aberta).
  useEffect(() => {
    if (!active) return
    let timer = 0
    const recount = () => {
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        const root = editorRoot()
        const title = root?.querySelector<HTMLElement>('.pg-title')?.innerText ?? ''
        const body = root?.querySelector<HTMLElement>('.bn-editor')?.innerText ?? ''
        setWords(countWords(`${title}\n${body}`))
      }, 200)
    }
    recount()
    const observer = new MutationObserver(recount)
    const content = document.querySelector('.app-content')
    if (content) observer.observe(content, { childList: true, subtree: true, characterData: true })
    return () => { clearTimeout(timer); observer.disconnect() }
  }, [active])

  // Esc sai (quando nenhum menu/diálogo está aberto); ⌘⇧F alterna.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && focusMode.get().active && !event.defaultPrevented && !document.querySelector(OPEN_LAYERS)) {
        focusMode.toggle(false)
        return
      }
      // Captura antes do editor (⌘F/⌘⇧F abre a busca na página). No app, o menu pode disparar o mesmo atalho:
      // focusMode.fromCommand ignora o comando logo após a tecla.
      if (matchesCombo(event, shortcutHint('focus'))) {
        event.preventDefault()
        event.stopPropagation()
        focusMode.fromKey()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  if (!active) return null
  return (
    <div className="np-focus-bar" role="toolbar" aria-label={t('Modo foco', 'Focus mode')}>
      <span className="np-focus-words" aria-live="polite">{t('{n} palavras', '{n} words', { n: words })}</span>
      <span className="np-focus-sep" />
      <button className={highlight ? 'is-on' : ''} aria-pressed={highlight} onClick={() => focusMode.setHighlight(!highlight)} title={t('Destacar só o parágrafo atual', 'Highlight only the current paragraph')}>
        <Pilcrow size={14} /> {t('Parágrafo', 'Paragraph')}
      </button>
      <button className={typewriter ? 'is-on' : ''} aria-pressed={typewriter} onClick={() => focusMode.setTypewriter(!typewriter)} title={t('Manter a linha atual no centro', 'Keep the current line centered')}>
        <AlignCenter size={14} /> {t('Máquina de escrever', 'Typewriter')}
      </button>
      <span className="np-focus-sep" />
      <button onClick={() => focusMode.toggle(false)} title={t('Sair do modo foco (Esc)', 'Exit focus mode (Esc)')} aria-label={t('Sair do modo foco', 'Exit focus mode')}><X size={14} /></button>
    </div>
  )
}
