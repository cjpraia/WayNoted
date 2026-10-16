import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { actions } from '../../../store'
import type { DateValue } from '../../../types'
import { defaultsForNewRow, getValue, isDateValue, parseISODate, toISODate, type ViewProps } from '../lib'
import './TimelineView.css'
import { PageIcon } from '../../page/PageIcon'
import { getLocale, t } from '../../../i18n'
import { dateOccurrences } from '../recurrence'
import { occurrenceForViewer } from '../timeZones'

const DAY = 86_400_000
/** Coluna de títulos recolhida: continua na grade (largura 0) para não deslocar os dias. */
const HIDDEN_SIDE = { visibility: 'hidden', overflow: 'hidden', padding: 0, border: 0, minWidth: 0 } as const
const addDays = (iso: string, days: number) => { const date = parseISODate(iso); date.setDate(date.getDate() + days); return toISODate(date) }

export function TimelineView({ db, schema, view, rows, readOnly, onOpenRow, creationDefaults }: ViewProps) {
  const dragging = useRef<{ rowId: string; x: number; value: DateValue; mode: 'move' | 'start' | 'end' } | null>(null)
  const suppressOpen = useRef(false)
  const dateProp = schema.properties.find((p) => p.id === view.dateProp && p.type === 'date') ?? schema.properties.find((p) => p.type === 'date')
  const [anchor, setAnchor] = useState(() => new Date())
  // Coluna de títulos à esquerda (Configurações › Layout › Mostrar tabela).
  const side = view.timelineTable === false ? 0 : 180
  const scale = view.timelineScale ?? 'month'
  const days = scale === 'week' ? 14 : scale === 'quarter' ? 91 : 35
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
  if (scale === 'week') start.setDate(start.getDate() - start.getDay())
  else start.setDate(1)
  const labels = Array.from({ length: days }, (_, i) => {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    return date
  })
  const shift = (direction: number) => {
    const next = new Date(anchor)
    if (scale === 'week') next.setDate(next.getDate() + direction * 7)
    else next.setMonth(next.getMonth() + direction * (scale === 'quarter' ? 3 : 1))
    setAnchor(next)
  }
  if (!dateProp) return <div className="vw-empty">{t('Crie uma propriedade de data para usar a linha do tempo.', 'Create a date property to use the timeline.')}</div>
  const windowStart = toISODate(start), windowEnd = toISODate(labels[days - 1])
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const dated = rows.flatMap((row) => {
    const value = getValue(row, dateProp)
    return isDateValue(value) ? dateOccurrences(row.id, value, addDays(windowStart, -2), addDays(windowEnd, 2)).flatMap((source) => { const occurrence = occurrenceForViewer(source, value, viewerZone); return occurrence && occurrence.start <= windowEnd && occurrence.end >= windowStart ? [{ row, value, occurrence }] : [] }) : []
  })
  const undated = rows.filter((row) => !isDateValue(getValue(row, dateProp)))
  return <div className="tl-root">
    <div className="tl-toolbar">
      <button type="button" aria-label={t('Período anterior', 'Previous period')} onClick={() => shift(-1)}><ChevronLeft size={16} /></button>
      <button type="button" onClick={() => setAnchor(new Date())}>{t('Hoje', 'Today')}</button>
      <button type="button" aria-label={t('Próximo período', 'Next period')} onClick={() => shift(1)}><ChevronRight size={16} /></button>
      <strong>{start.toLocaleDateString(getLocale(), { month: 'long', year: 'numeric' })}</strong>
      <span>{dated.length} {t('com data', 'dated')} · {undated.length} {t('sem data', 'undated')}</span>
    </div>
    <div className="tl-scroll"><div className="tl-grid" style={{ gridTemplateColumns: `${side}px repeat(${days}, 36px)` }}>
      <div className="tl-corner" style={side ? undefined : HIDDEN_SIDE}>{t('Página', 'Page')}</div>
      {labels.map((date) => <div className={`tl-day${toISODate(date) === toISODate(new Date()) ? ' tl-day--today' : ''}`} key={toISODate(date)} title={date.toLocaleDateString(getLocale())}>{date.getDate()}</div>)}
      {dated.map(({ row, value, occurrence }) => {
        const first = Math.max(0, Math.round((parseISODate(occurrence.start).getTime() - start.getTime()) / DAY))
        const last = Math.min(days - 1, Math.round((parseISODate(occurrence.end).getTime() - start.getTime()) / DAY))
        return <div className="tl-row" key={occurrence.id} style={{ gridColumn: `1 / span ${days + 1}`, gridTemplateColumns: `${side}px repeat(${days}, 36px)` }}>
          <button type="button" className="tl-title" style={side ? undefined : HIDDEN_SIDE} onClick={() => onOpenRow(row.id)} title={occurrence.recurring ? t('Abrir origem para editar a série', 'Open source to edit the series') : undefined}>{row.icon && <PageIcon value={row.icon} />} {occurrence.recurring && '↻ '}{row.title || t('Sem título', 'Untitled')}</button>
          <div className="tl-track" style={{ gridColumn: `2 / span ${days}`, gridTemplateColumns: `repeat(${days}, 36px)` }}>
            {first <= last && last >= 0 && first < days && <button type="button" className="tl-bar" style={{ gridColumn: `${first + 1} / span ${last - first + 1}` }} onClick={() => { if (suppressOpen.current) { suppressOpen.current = false; return } onOpenRow(row.id) }} title={occurrence.recurring ? t('Ocorrência {date}. Abra a origem para editar a série.', 'Occurrence {date}. Open the source to edit the series.', { date: occurrence.start }) : `${occurrence.start}${occurrence.startTime ? ` ${occurrence.startTime} · ${viewerZone}` : ''} → ${occurrence.end}`}
              onPointerDown={(event) => { if (readOnly || row.locked || occurrence.recurring) return; event.currentTarget.setPointerCapture(event.pointerId); const edge = (event.target as HTMLElement).dataset.edge; dragging.current = { rowId: row.id, x: event.clientX, value, mode: edge === 'start' || edge === 'end' ? edge : 'move' } }}
              onPointerMove={(event) => { if (!dragging.current || dragging.current.rowId !== row.id) return; const dx = event.clientX - dragging.current.x; event.currentTarget.style.transform = `translateX(${Math.round(dx / 36) * 36}px)` }}
              onPointerUp={(event) => { const drag = dragging.current; dragging.current = null; event.currentTarget.style.transform = ''; if (!drag || drag.rowId !== row.id) return; const delta = Math.round((event.clientX - drag.x) / 36); if (!delta) return; suppressOpen.current = true; setTimeout(() => { suppressOpen.current = false }, 0); const oldEnd = drag.value.end ?? drag.value.start; const nextStart = drag.mode === 'end' ? drag.value.start : addDays(drag.value.start, delta); const nextEnd = drag.mode === 'start' ? oldEnd : addDays(oldEnd, delta); if (nextStart > nextEnd) return; actions.setProp(row.id, dateProp.id, { ...drag.value, start: nextStart, end: drag.value.end || drag.mode !== 'move' ? nextEnd : undefined }) }}
              onPointerCancel={(event) => { dragging.current = null; event.currentTarget.style.transform = '' }}><span className="tl-drag-edge" data-edge="start" aria-hidden="true" />{row.title || t('Sem título', 'Untitled')}<span className="tl-drag-edge" data-edge="end" aria-hidden="true" /></button>}
          </div>
          {!readOnly && !row.locked && (occurrence.recurring ? <button type="button" className="tl-date" onClick={() => onOpenRow(row.id)} title={t('Editar data inicial e recorrência na página de origem', 'Edit start date and recurrence on the source page')}>{t('Editar série', 'Edit series')}</button> : <input type="date" className="tl-date" value={occurrence.start} title={t('Alterar data inicial', 'Change start date')} onChange={(e) => { if (e.target.value) { const delta = Math.round((parseISODate(e.target.value).getTime() - parseISODate(occurrence.start).getTime()) / DAY); const nextStart = addDays(value.start, delta); actions.setProp(row.id, dateProp.id, { ...value, start: nextStart, ...(value.end ? { end: addDays(value.end, delta) } : {}) }) } }} />)}
        </div>
      })}
    </div></div>
    {undated.length > 0 && <div className="tl-undated"><strong>{t('Sem data', 'Undated')}</strong>{undated.map((row) => <div key={row.id}><button type="button" onClick={() => onOpenRow(row.id)}>{row.icon && <PageIcon value={row.icon} />} {row.title || t('Sem título', 'Untitled')}</button>{!readOnly && !row.locked && <button type="button" onClick={() => actions.setProp(row.id, dateProp.id, { start: toISODate(new Date()) })}>{t('Definir hoje', 'Set today')}</button>}</div>)}</div>}
    {!readOnly && <button type="button" className="tl-add" onClick={() => { const id = actions.createRow(db.id, defaultsForNewRow(schema, view, { [dateProp.id]: { start: toISODate(new Date()) } }, creationDefaults)); onOpenRow(id) }}><Plus size={16} /> {t('Nova página com data de hoje', 'New page dated today')}</button>}
  </div>
}
