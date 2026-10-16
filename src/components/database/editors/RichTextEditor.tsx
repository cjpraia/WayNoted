// Editor inline de texto: uma caixa ancorada à própria célula (mesma posição e tipografia),
// contenteditable leve que serializa para `RichTextValue` (runs) ou `string` quando não há formatação.
// Enter confirma, Shift+Enter quebra linha, Esc cancela, Tab/Shift+Tab confirmam e vão à vizinha.
// Formatação sob demanda: ⌘B ⌘I ⌘U ⌘⇧S ⌘E ⌘K e uma mini-barra que só aparece com texto selecionado.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Bold, Code, Italic, Link as LinkIcon, RemoveFormatting, Strikethrough, Underline } from 'lucide-react'
import type { RichTextRun } from '../../../database-models'
import { t } from '../../../i18n'
import {
  clearFormatInRange, domToRuns, hasInlineMarkdown, hrefInRange, htmlToRuns, insertHtmlAtSelection, insertLineBreak, linkRangeAt,
  markdownToRuns, marksInRange, normalizeLinkInput, runsSlice, runsToHtml, runsToStored, sameStored, selectionOffsets,
  setLinkInRange, setSelectionOffsets, toggleMarkInRange, valueToRuns, type RichMark,
} from '../richText'
import { DbPopover } from '../ui/Popover'
import type { PropertyEditorProps } from './PropertyEditor'
import { applyAnchorTypography } from './anchorStyle'

// Posição do último clique: o cursor da edição nasce onde o usuário clicou na célula.
let lastPointer: { x: number; y: number; at: number } | null = null
if (typeof document !== 'undefined') {
  document.addEventListener('mousedown', (e) => { lastPointer = { x: e.clientX, y: e.clientY, at: Date.now() } }, true)
}

function caretFromPoint(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
  const d = doc as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null }
  if (d.caretPositionFromPoint) { const p = d.caretPositionFromPoint(x, y); return p ? { node: p.offsetNode, offset: p.offset } : null }
  if (d.caretRangeFromPoint) { const r = d.caretRangeFromPoint(x, y); return r ? { node: r.startContainer, offset: r.startOffset } : null }
  return null
}

interface Bar { x: number; top: number; bottom: number; marks: Set<RichMark>; href?: string }

const BAR_BUTTONS: { mark: RichMark; icon: typeof Bold; label: [string, string]; keys: string }[] = [
  { mark: 'bold', icon: Bold, label: ['Negrito', 'Bold'], keys: '⌘B' },
  { mark: 'italic', icon: Italic, label: ['Itálico', 'Italic'], keys: '⌘I' },
  { mark: 'underline', icon: Underline, label: ['Sublinhado', 'Underline'], keys: '⌘U' },
  { mark: 'strike', icon: Strikethrough, label: ['Tachado', 'Strikethrough'], keys: '⌘⇧S' },
  { mark: 'code', icon: Code, label: ['Código', 'Code'], keys: '⌘E' },
]

export function RichTextEditor({ property, value, anchor, onChange, onClose, seed }: PropertyEditorProps) {
  const ref = useRef<HTMLDivElement>(null)
  const done = useRef(false)
  const composing = useRef(false)
  const plainPaste = useRef(false)
  const initial = useRef(runsToStored(valueToRuns(value)))
  const [, tick] = useState(0)
  const [over, setOver] = useState(false)
  const [bar, setBar] = useState<Bar | null>(null)
  const [link, setLink] = useState<{ start: number; end: number; text: string; existing: boolean } | null>(null)
  const linkRef = useRef(link)
  linkRef.current = link
  const [host] = useState(() => typeof document !== 'undefined' ? document.createElement('div') : null)
  const anchorEl = anchor instanceof Element ? anchor : null

  useEffect(() => {
    if (!host) return
    host.className = 'ed-fmt-host'
    document.body.appendChild(host)
    return () => { host.remove() }
  }, [host])

  const finish = useCallback((reason: Parameters<PropertyEditorProps['onClose']>[0], save: boolean) => {
    if (done.current) return
    done.current = true
    const el = ref.current
    if (save && el) {
      const next = runsToStored(domToRuns(el))
      if (!sameStored(next, initial.current)) onChange(next)
    }
    onClose(reason)
  }, [onChange, onClose])
  const finishRef = useRef(finish)
  finishRef.current = finish

  // Conteúdo inicial, tipografia da célula, foco e cursor.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = runsToHtml(valueToRuns(seed ?? value))
    if (anchorEl) applyAnchorTypography(el, anchorEl)
    el.focus({ preventScroll: true })
    setSelectionOffsets(el, domToRuns(el, { trimTrailing: false }).reduce((n, r) => n + r.text.length, 0))
    const pointer = lastPointer && Date.now() - lastPointer.at < 1500 ? lastPointer : null
    const frame = requestAnimationFrame(() => {
      if (pointer && ref.current) {
        const box = ref.current.getBoundingClientRect()
        if (pointer.x >= box.left && pointer.x <= box.right && pointer.y >= box.top && pointer.y <= box.bottom) {
          const pos = caretFromPoint(document, pointer.x, pointer.y)
          if (pos && ref.current.contains(pos.node)) {
            const range = document.createRange()
            range.setStart(pos.node, pos.offset)
            range.collapse(true)
            const sel = document.getSelection()
            sel?.removeAllRanges()
            sel?.addRange(range)
          }
        }
      }
      measure()
    })
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const measure = () => {
    const el = ref.current
    if (!el || !anchorEl) return
    setOver(el.scrollHeight > anchorEl.getBoundingClientRect().height + 1)
  }

  const refreshBar = useCallback(() => {
    const el = ref.current
    if (!el || composing.current || linkRef.current) return
    const off = selectionOffsets(el)
    const sel = el.ownerDocument.getSelection()
    if (!off || off.start === off.end || !sel || !sel.rangeCount) { setBar(null); return }
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    if (!rect.width && !rect.height) { setBar(null); return }
    const runs = domToRuns(el, { trimTrailing: false })
    setBar({ x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom, marks: marksInRange(runs, off.start, off.end), href: hrefInRange(runs, off.start, off.end) })
  }, [])

  useEffect(() => {
    document.addEventListener('selectionchange', refreshBar)
    return () => document.removeEventListener('selectionchange', refreshBar)
  }, [refreshBar])

  /** Aplica `fn` ao trecho selecionado e regrava só esse trecho (desfazer nativo preservado). */
  const mutate = (fn: (runs: RichTextRun[], start: number, end: number) => RichTextRun[], range?: { start: number; end: number }) => {
    const el = ref.current
    if (!el) return
    const off = range ?? selectionOffsets(el)
    if (!off || off.start === off.end) return
    const runs = domToRuns(el, { trimTrailing: false })
    const next = fn(runs, off.start, off.end)
    el.focus({ preventScroll: true })
    setSelectionOffsets(el, off.start, off.end)
    insertHtmlAtSelection(el, runsToHtml(runsSlice(next, off.start, off.end)))
    setSelectionOffsets(el, off.start, off.end)
    tick((n) => n + 1)
    refreshBar()
  }

  const toggle = (mark: RichMark) => {
    const el = ref.current
    const off = el && selectionOffsets(el)
    if (el && off && off.start === off.end) {
      // Sem seleção: B/I/U/S alternam o estilo de digitação (nativo); código precisa de trecho.
      const command = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikeThrough', code: '' }[mark]
      if (command) try { el.ownerDocument.execCommand(command) } catch { /* sem suporte */ }
      return
    }
    mutate((runs, s, e) => toggleMarkInRange(runs, s, e, mark))
  }

  const openLink = () => {
    const el = ref.current
    const off = el && selectionOffsets(el)
    if (!el || !off) return
    const runs = domToRuns(el, { trimTrailing: false })
    let { start, end } = off
    let existing = hrefInRange(runs, start, end)
    if (start === end) {
      const found = linkRangeAt(runs, start)
      if (!found) return
      start = found.start; end = found.end; existing = found.href
      setSelectionOffsets(el, start, end)
    }
    setBar(null)
    setLink({ start, end, text: existing ?? '', existing: !!existing })
  }

  const closeLink = () => {
    const l = linkRef.current
    setLink(null)
    const el = ref.current
    if (el) { el.focus({ preventScroll: true }); if (l) setSelectionOffsets(el, l.start, l.end) }
  }

  const applyLink = (text: string) => {
    const l = linkRef.current
    if (!l) return
    const raw = text.trim()
    const href = normalizeLinkInput(raw)
    if (raw && !href) return // inválido: mantém o campo aberto
    setLink(null)
    linkRef.current = null
    mutate((runs, s, e) => setLinkInRange(runs, s, e, href), { start: l.start, end: l.end })
  }

  const openLinkRef = useRef(openLink)
  openLinkRef.current = openLink
  useEffect(() => {
    const onMenu = () => openLinkRef.current()
    window.addEventListener('np:cell-link', onMenu)
    return () => window.removeEventListener('np:cell-link', onMenu)
  }, [])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()
    const stop = () => { e.preventDefault(); e.nativeEvent.stopImmediatePropagation() }
    if (e.key === 'Enter') {
      stop()
      if (e.shiftKey && !mod && !e.altKey) { insertLineBreak(el); tick((n) => n + 1) } else finish('enter', true)
    } else if (e.key === 'Tab') {
      stop()
      finish(e.shiftKey ? 'shiftTab' : 'tab', true)
    } else if (mod && !e.altKey && key === 'b' && !e.shiftKey) { stop(); toggle('bold') }
    else if (mod && !e.altKey && key === 'i' && !e.shiftKey) { stop(); toggle('italic') }
    else if (mod && !e.altKey && key === 'u' && !e.shiftKey) { stop(); toggle('underline') }
    else if (mod && !e.altKey && key === 's' && e.shiftKey) { stop(); toggle('strike') }
    else if (mod && !e.altKey && key === 'e' && !e.shiftKey) { stop(); toggle('code') }
    else if (mod && !e.altKey && key === 'k' && !e.shiftKey) { stop(); openLink() }
    else if (mod && !e.altKey && key === 'v' && e.shiftKey) { plainPaste.current = true }
  }

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    const plainOnly = plainPaste.current
    plainPaste.current = false
    e.preventDefault()
    let runs: RichTextRun[]
    if (!plainOnly && html) runs = htmlToRuns(html)
    else if (!plainOnly && hasInlineMarkdown(text)) runs = markdownToRuns(text)
    else runs = [{ text }]
    const flat = runs.map((r) => ({ ...r, text: r.text.replace(/\r\n?/g, '\n') }))
    insertHtmlAtSelection(el, runsToHtml(flat))
    tick((n) => n + 1)
  }

  // Altura da caixa e sombra só quando excede a célula.
  useLayoutEffect(measure)

  const host_ = host
  const vw = typeof window === 'undefined' ? 1200 : window.innerWidth
  const barX = bar ? Math.max(130, Math.min(bar.x, vw - 130)) : 0
  const barAbove = bar ? bar.top > 52 : true

  return <>
    <DbPopover
      anchor={anchor}
      placement="cover"
      ignore={host_}
      onClose={() => finish('outside', true)}
      onEscape={() => { if (composing.current) return; if (linkRef.current) closeLink(); else finish('escape', false) }}
      className={`ed-text-pop ed-inline-pop${over ? ' ed-inline-pop--over' : ''}`}
      label={property.name}
      style={anchorEl ? { width: Math.max(anchorEl.getBoundingClientRect().width, 160) } : undefined}
    >
      <div
        ref={ref}
        className="ed-inline"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={property.name}
        spellCheck
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onInput={() => { tick((n) => n + 1); measure() }}
        onCompositionStart={() => { composing.current = true; setBar(null) }}
        onCompositionEnd={() => { composing.current = false; tick((n) => n + 1) }}
        onDrop={(e) => e.preventDefault()}
      />
    </DbPopover>
    {host_ && bar && !link && createPortal(
      <div
        className="ed-fmt-bar dbv-popover"
        role="toolbar"
        aria-label={t('Formatação', 'Formatting')}
        style={{ left: barX, top: barAbove ? bar.top - 8 : bar.bottom + 8, transform: barAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)' }}
        onMouseDown={(e) => e.preventDefault()}
      >
        {BAR_BUTTONS.map(({ mark, icon: Icon, label, keys }) => (
          <button key={mark} type="button" className={`ed-fmt-btn${bar.marks.has(mark) ? ' is-on' : ''}`} aria-pressed={bar.marks.has(mark)} title={`${t(label[0], label[1])} (${keys})`} aria-label={t(label[0], label[1])} onClick={() => toggle(mark)}>
            <Icon size={14} />
          </button>
        ))}
        <span className="ed-fmt-sep" />
        <button type="button" className={`ed-fmt-btn${bar.href ? ' is-on' : ''}`} aria-pressed={!!bar.href} title={`${t('Link', 'Link')} (⌘K)`} aria-label={t('Link', 'Link')} onClick={openLink}><LinkIcon size={14} /></button>
        <button type="button" className="ed-fmt-btn" title={t('Limpar formato', 'Clear formatting')} aria-label={t('Limpar formato', 'Clear formatting')} onClick={() => mutate((runs, s, e) => clearFormatInRange(runs, s, e))}><RemoveFormatting size={14} /></button>
      </div>,
      host_,
    )}
    {host_ && link && createPortal(<LinkField key={link.start} state={link} onApply={applyLink} onCancel={closeLink} anchorEl={ref.current} />, host_)}
  </>
}

function LinkField({ state, onApply, onCancel, anchorEl }: { state: { text: string; existing: boolean; start: number; end: number }; onApply: (text: string) => void; onCancel: () => void; anchorEl: HTMLElement | null }) {
  const [text, setText] = useState(state.text)
  const [invalid, setInvalid] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const pos = useRef<{ left: number; top: number }>({ left: 0, top: 0 })
  if (anchorEl) {
    const sel = anchorEl.ownerDocument.getSelection()
    const rect = sel && sel.rangeCount && anchorEl.contains(sel.anchorNode) ? sel.getRangeAt(0).getBoundingClientRect() : anchorEl.getBoundingClientRect()
    if (rect.width || rect.height) pos.current = { left: Math.max(8, Math.min(rect.left, window.innerWidth - 320)), top: rect.bottom + 6 }
  }
  useLayoutEffect(() => { input.current?.focus(); input.current?.select() }, [])
  return (
    <div className="ed-fmt-link dbv-popover" style={{ left: pos.current.left, top: pos.current.top }}>
      <input
        ref={input}
        className={`ed-fmt-link-input${invalid ? ' is-invalid' : ''}`}
        value={text}
        placeholder={t('Colar ou digitar um link', 'Paste or type a link')}
        aria-label={t('Endereço do link', 'Link address')}
        onChange={(e) => { setText(e.target.value); setInvalid(false) }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
          else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            const raw = text.trim()
            if (raw && !normalizeLinkInput(raw)) setInvalid(true)
            else onApply(text)
          }
        }}
      />
      {state.existing && <button type="button" className="ed-fmt-link-remove" onClick={() => onApply('')}>{t('Remover', 'Remove')}</button>}
    </div>
  )
}
