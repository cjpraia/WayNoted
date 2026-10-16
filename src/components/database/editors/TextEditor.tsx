// Editor inline (sobreposto à célula) para título, texto, número e URL.
import { useLayoutEffect, useRef, useState } from 'react'
import { applyAnchorTypography } from './anchorStyle'
import { ArrowUpRight } from 'lucide-react'
import type { Property, PropValue } from '../../../types'
import { DbPopover, type DbAnchor } from '../ui/Popover'
import { looseNumberValue, parseLooseUrl } from '../../../input/liberal'
import type { EditorCloseReason } from './PropertyEditor'
import { t } from '../../../i18n'

function toDraft(property: Property, value: PropValue): string {
  if (value === null || value === undefined) return ''
  if (property.type === 'number' && typeof value === 'number') return String(value).replace('.', ',')
  return String(value)
}

export function openUrl(url: string) {
  const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
  window.open(href, '_blank')
}

export function TextEditor(props: {
  property: Property
  value: PropValue
  anchor: DbAnchor
  seed?: string
  onChange: (value: PropValue) => void
  onClose: (reason: EditorCloseReason) => void
}) {
  const { property, value } = props
  const [draft, setDraft] = useState(() => props.seed ?? toDraft(property, value))
  const draftRef = useRef(draft)
  draftRef.current = draft
  const done = useRef(false)
  const [over, setOver] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const multiline = property.type === 'text' || property.type === 'title'

  const commit = (reason: EditorCloseReason) => {
    if (done.current) return
    done.current = true
    const text = draftRef.current
    let next: PropValue
    if (property.type === 'number') {
      next = text.trim() === '' ? null : looseNumberValue(text, property.numberFormat === 'percent')
      if (next === null && text.trim() !== '') next = value // número inválido: mantém o anterior
    } else if (property.type === 'title') {
      next = text.replace(/\n/g, ' ')
    } else {
      next = text.trim() === '' ? null : property.type === 'url' ? (parseLooseUrl(text)?.url ?? text.trim()) : text
    }
    if (next !== value) props.onChange(next)
    props.onClose(reason)
  }

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (props.anchor instanceof Element) applyAnchorTypography(el, props.anchor)
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
    setOver(props.anchor instanceof Element && el.scrollHeight > props.anchor.getBoundingClientRect().height + 1)
  }, [draft])

  return (
    <DbPopover anchor={props.anchor} placement="cover" onClose={() => commit('outside')} onEscape={() => { if (done.current) return; done.current = true; props.onClose('escape') }} className={`ed-text-pop ed-inline-pop${over ? ' ed-inline-pop--over' : ''}`} label={property.name} style={props.anchor instanceof Element ? { width: Math.max(props.anchor.getBoundingClientRect().width, 120) } : undefined}>
      <div className="ed-text">
        <textarea
          ref={ref}
          className={`ed-text-input${property.type === 'title' ? ' ed-text-input--title' : ''}`}
          value={draft}
          rows={1}
          spellCheck={multiline}
          inputMode={property.type === 'number' ? 'decimal' : undefined}
          placeholder={property.type === 'title' ? t('Sem título', 'Untitled') : property.type === 'url' ? 'https://' : ''}
          onChange={(e) => setDraft(multiline ? e.target.value : e.target.value.replace(/\n/g, ''))}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter' && !(e.shiftKey && property.type === 'text')) {
              e.preventDefault()
              commit('enter')
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              commit('escape')
            } else if (e.key === 'Tab') {
              e.preventDefault()
              commit(e.shiftKey ? 'shiftTab' : 'tab')
            }
          }}
        />
        {property.type === 'url' && draft.trim() && (
          <button type="button" className="dbv-icon-btn ed-text-open" title={t('Abrir link', 'Open link')} onClick={() => openUrl(draft.trim())}>
            <ArrowUpRight size={14} />
          </button>
        )}
      </div>
    </DbPopover>
  )
}
