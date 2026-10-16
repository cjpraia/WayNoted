// Visualização Calendário: grade mensal por uma propriedade de data, com intervalos em barras contínuas por semana.
import { useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { actions, getState } from '../../../store'
import type { DatabaseSchema, DateValue, Page, Property, View } from '../../../types'
import { getValue, isDateValue, parseISODate, toISODate, type ViewProps } from '../lib'
import { Popover } from './shared/Popover'
import { usePointerDrag } from './shared/useDrag'
import { InlineTitleInput, PropValueView, RowIcon, RowTitle, shownProps, useRowCreation, useRowMenu } from './shared/rows'
import { getLocale, t } from '../../../i18n'
import { dateOccurrences, type DateOccurrence } from '../recurrence'
import { occurrenceForViewer } from '../timeZones'
import './CalendarView.css'
import { useCalendarOverlay, SystemEventBars } from '../../calendar/SystemCalendarOverlay'
import { CalendarOverlayControl } from '../../calendar/CalendarOverlayControl'
import { RowCalendarMenuItems } from '../../calendar/RowCalendarMenuItems'

const WEEKDAYS_PT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_MS = 86_400_000

export function resolveDateProp(schema: DatabaseSchema, view: View): Property | undefined {
  const chosen = schema.properties.find((p) => p.id === view.dateProp)
  if (chosen?.type === 'date') return chosen
  return schema.properties.find((p) => p.type === 'date')
}

function addDays(iso: string, n: number): string {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

function diffDays(a: string, b: string): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / DAY_MS)
}

/** Número da semana ISO 8601 (segunda-feira como início) de uma data 'YYYY-MM-DD'. */
export function isoWeek(iso: string): number {
  const d = parseISODate(iso)
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const firstThursday = new Date(target.getFullYear(), 0, 4)
  return 1 + Math.round(((target.getTime() - firstThursday.getTime()) / DAY_MS - 3 + ((firstThursday.getDay() + 6) % 7)) / 7)
}

function monthTitle(d: Date) {
  return d.toLocaleDateString(getLocale(), { month: 'long', year: 'numeric' })
}

function dayLabel(iso: string) {
  const d = parseISODate(iso)
  if (d.getDate() !== 1) return String(d.getDate())
  return getLocale() === 'pt-BR' ? `${d.getDate()} de ${d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}` : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface Segment {
  row: Page
  value: DateValue
  occurrence: DateOccurrence
  startCol: number
  endCol: number
  lane: number
  continuesLeft: boolean
  continuesRight: boolean
}

interface Week {
  start: string
  days: string[]
  segments: Segment[]
  lanes: number
}

function buildWeeks(month: Date, events: { row: Page; value: DateValue; occurrence: DateOccurrence; start: string; end: string }[]): Week[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const gridStart = new Date(first)
  gridStart.setDate(1 - first.getDay())
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const count = Math.ceil((first.getDay() + daysInMonth) / 7)
  const weeks: Week[] = []
  for (let w = 0; w < count; w++) {
    const start = addDays(toISODate(gridStart), w * 7)
    const end = addDays(start, 6)
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
    const inWeek = events
      .filter((e) => e.start <= end && e.end >= start)
      .map((e) => ({
        row: e.row,
        value: e.value,
        occurrence: e.occurrence,
        startCol: e.start < start ? 0 : diffDays(start, e.start),
        endCol: e.end > end ? 6 : diffDays(start, e.end),
        continuesLeft: e.start < start,
        continuesRight: e.end > end,
        lane: 0,
      }))
      .sort((a, b) => a.startCol - b.startCol || b.endCol - b.startCol - (a.endCol - a.startCol))
    // Distribui em faixas: cada barra ocupa a primeira faixa livre em todo o seu intervalo.
    const laneEnds: number[] = []
    for (const seg of inWeek) {
      let lane = laneEnds.findIndex((endCol) => endCol < seg.startCol)
      if (lane < 0) lane = laneEnds.length
      laneEnds[lane] = seg.endCol
      seg.lane = lane
    }
    weeks.push({ start, days, segments: inWeek, lanes: laneEnds.length })
  }
  return weeks
}

export function CalendarView({ db, schema, view, rows, visibleProps, readOnly, onOpenRow, creationDefaults }: ViewProps) {
  const dateProp = resolveDateProp(schema, view)
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [undatedAnchor, setUndatedAnchor] = useState<HTMLElement | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const grabbedRef = useRef<string | null>(null)
  const { openMenu, menuNode, menuRowId } = useRowMenu(readOnly, onOpenRow, (rowId, close) => <RowCalendarMenuItems rowId={rowId} propId={dateProp?.id} close={close} />)
  const systemWeek = useCalendarOverlay(view.id, month)
  const { editingId, create, stopEditing } = useRowCreation(db, schema, view, creationDefaults)

  const { events, undated } = useMemo(() => {
    const events: { row: Page; value: DateValue; occurrence: DateOccurrence; start: string; end: string }[] = []
    const undated: Page[] = []
    if (dateProp) {
      const windowStart = toISODate(new Date(month.getFullYear(), month.getMonth(), -6))
      const windowEnd = toISODate(new Date(month.getFullYear(), month.getMonth() + 1, 7))
      const sourceStart = addDays(windowStart, -2), sourceEnd = addDays(windowEnd, 2)
      const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone
      for (const row of rows) {
        const v = getValue(row, dateProp)
        if (isDateValue(v) && v.start) {
          for (const source of dateOccurrences(row.id, v, sourceStart, sourceEnd)) {
            const occurrence = occurrenceForViewer(source, v, viewerZone)
            if (occurrence && occurrence.start <= windowEnd && occurrence.end >= windowStart) events.push({ row, value: v, occurrence, start: occurrence.start, end: occurrence.end })
          }
        } else undated.push(row)
      }
    }
    return { events, undated }
  }, [rows, dateProp, month])

  const weeks = useMemo(() => buildWeeks(month, events), [month, events])
  const hideWeekends = view.showWeekends === false

  const dateAt = (x: number, y: number): string | null => {
    const grid = gridRef.current
    if (!grid) return null
    for (const el of grid.querySelectorAll<HTMLElement>('[data-cal-week]')) {
      const r = el.getBoundingClientRect()
      if (y < r.top || y >= r.bottom || x < r.left - 30 || x > r.right + 30) continue
      // Sem fins de semana as colunas de domingo e sábado têm largura zero.
      const col = hideWeekends ? 1 + Math.max(0, Math.min(4, Math.floor(((x - r.left) / r.width) * 5))) : Math.max(0, Math.min(6, Math.floor(((x - r.left) / r.width) * 7)))
      return addDays(el.dataset.calWeek!, col)
    }
    return null
  }

  const { drag, onPointerDown } = usePointerDrag<string>({
    disabled: readOnly || !dateProp,
    onStart: (_id, x, y) => {
      grabbedRef.current = dateAt(x, y)
    },
    resolve: (x, y) => dateAt(x, y),
    onDrop: (id, target) => {
      if (getState().pages[id]?.locked) return
      const ev = events.find((e) => e.row.id === id && !e.occurrence.recurring)
      const grabbed = grabbedRef.current
      if (!ev || !grabbed || !dateProp) return
      const delta = diffDays(grabbed, target)
      if (delta === 0) return
      const next: DateValue = { ...ev.value, start: addDays(ev.value.start, delta) }
      if (ev.value.end) next.end = addDays(ev.value.end, delta)
      actions.setProp(id, dateProp.id, next)
    },
  })

  if (!dateProp) {
    return (
      <div className="vw-empty">
        <CalendarDays size={28} strokeWidth={1.5} className="vw-empty-icon" />
        <div className="vw-empty-title">{t('Nenhuma propriedade de data', 'No date property')}</div>
        <div className="vw-empty-text">{t('O calendário posiciona as páginas pelos dias. Adicione uma propriedade do tipo Data para usá-lo.', 'The calendar places pages by date. Add a Date property to use it.')}</div>
      </div>
    )
  }

  // Faixa destacada durante o arraste (preserva a duração e o dia "agarrado").
  let dropStart: string | null = null
  let dropEnd: string | null = null
  if (drag?.target && grabbedRef.current) {
    const ev = events.find((e) => e.row.id === drag.id && !e.occurrence.recurring)
    if (ev) {
      const delta = diffDays(grabbedRef.current, drag.target)
      dropStart = addDays(ev.start, delta)
      dropEnd = addDays(ev.end, delta)
    }
  }

  const today = toISODate(new Date())
  const monthIdx = month.getMonth()
  const cardProps = visibleProps.filter((p) => p.id !== dateProp.id)
  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1))

  return (
    <div className={`cal${hideWeekends ? ' cal--no-weekends' : ''}${view.showWeekNumbers ? ' cal--weeknums' : ''}`}>
      <div className="cal-header">
        <div className="cal-title">{monthTitle(month)}</div>
        <div className="cal-nav">
          {undated.length > 0 && (
            <button
              type="button"
              className={`cal-undated-btn${undatedAnchor ? ' is-open' : ''}`}
              onClick={(e) => setUndatedAnchor(undatedAnchor ? null : e.currentTarget)}
            >
              {undated.length} {t('sem data', 'undated')}
            </button>
          )}
          <CalendarOverlayControl viewId={view.id} />
          <button type="button" className="cal-nav-btn cal-icon" title={t('Mês anterior', 'Previous month')} onClick={() => shift(-1)}>
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="cal-nav-btn"
            onClick={() => {
              const now = new Date()
              setMonth(new Date(now.getFullYear(), now.getMonth(), 1))
            }}
          >
            {t('Hoje', 'Today')}
          </button>
          <button type="button" className="cal-nav-btn cal-icon" title={t('Próximo mês', 'Next month')} onClick={() => shift(1)}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="cal-weekdays">
        {(getLocale() === 'pt-BR' ? WEEKDAYS_PT : WEEKDAYS_EN).map((w) => (
          <div key={w} className="cal-weekday">
            {w}
          </div>
        ))}
      </div>

      <div className="cal-grid" ref={gridRef}>
        {weeks.map((week) => (
          <div
            key={week.start}
            className="cal-week"
            data-cal-week={week.start}
            style={{ gridTemplateRows: `34px repeat(${week.lanes + systemWeek(week.start).lanes}, auto) minmax(14px, 1fr)` }}
          >
            {week.days.map((iso, i) => {
              const d = parseISODate(iso)
              const outside = d.getMonth() !== monthIdx
              const weekend = i === 0 || i === 6
              const isDrop = dropStart !== null && dropEnd !== null && iso >= dropStart && iso <= dropEnd
              return (
                <div
                  key={iso}
                  className={`cal-day${outside ? ' cal-outside' : ''}${weekend ? ' cal-weekend' : ''}${isDrop ? ' cal-drop' : ''}`}
                  style={{ gridColumn: i + 1 }}
                >
                  {!readOnly && (
                    <button
                      type="button"
                      className="cal-add"
                      title={t('Nova página neste dia', 'New page on this day')}
                      onClick={() => create({ [dateProp.id]: { start: iso } })}
                    >
                      <Plus size={14} />
                    </button>
                  )}
                  {view.showWeekNumbers && i === (hideWeekends ? 1 : 0) && <span className="cal-weeknum" title={t('Semana {n}', 'Week {n}', { n: isoWeek(addDays(week.start, 1)) })}>{t('S{n}', 'W{n}', { n: isoWeek(addDays(week.start, 1)) })}</span>}
                  <span className={`cal-num${iso === today ? ' cal-today' : ''}`}>{dayLabel(iso)}</span>
                </div>
              )
            })}
            {week.segments.map((seg) => {
              // Sem fins de semana, eventos só de sábado/domingo somem (as colunas têm largura zero).
              if (hideWeekends && seg.startCol === seg.endCol && (seg.startCol === 0 || seg.startCol === 6)) return null
              const editing = editingId === seg.row.id
              const values = shownProps(seg.row, cardProps)
              return (
                <div
                  key={seg.occurrence.id}
                  className={`cal-event${seg.continuesLeft ? ' cal-cont-left' : ''}${seg.continuesRight ? ' cal-cont-right' : ''}${
                    drag?.id === seg.row.id ? ' is-dragging' : ''
                  }${menuRowId === seg.row.id ? ' is-active' : ''}${seg.occurrence.projected ? ' cal-event--projected' : ''}`}
                  style={{ gridColumn: `${seg.startCol + 1} / ${seg.endCol + 2}`, gridRow: seg.lane + 2 }}
                  data-row-id={seg.occurrence.id}
                  title={seg.occurrence.recurring ? t('Ocorrência de {date}. Abra a página para editar a série.', 'Occurrence on {date}. Open the page to edit the series.', { date: seg.occurrence.start }) : `${seg.occurrence.start}${seg.occurrence.startTime ? ` ${seg.occurrence.startTime} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}` : ''}`}
                  onPointerDown={(e) => { if (!seg.row.locked && !seg.occurrence.recurring) onPointerDown(e, seg.row.id) }}
                  onClick={() => !editing && onOpenRow(seg.row.id)}
                  onContextMenu={(e) => openMenu(e, seg.row.id)}
                >
                  <div className="cal-event-title">
                    {seg.row.icon && <RowIcon page={seg.row} size={14} />}
                    {seg.occurrence.recurring && <span aria-label={t('Ocorrência recorrente', 'Recurring occurrence')}>↻</span>}
                    {editing ? <InlineTitleInput page={seg.row} onDone={stopEditing} /> : <RowTitle page={seg.row} />}
                  </div>
                  {values.length > 0 && (
                    <div className="cal-event-props">
                      {values.map(({ prop, value }) => (
                        <span key={prop.id} className="cal-event-prop" title={prop.name}>
                          <PropValueView prop={prop} value={value} rowId={seg.row.id} />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            <SystemEventBars segments={systemWeek(week.start).segments} laneOffset={week.lanes} />
          </div>
        ))}
      </div>

      {undatedAnchor && (
        <Popover anchor={undatedAnchor} align="end" width={280} onClose={() => setUndatedAnchor(null)}>
          <div className="vw-menu-section">{t('Sem data', 'Undated')} · {dateProp.name}</div>
          <div className="cal-undated-list">
            {undated.map((row) => (
              <button
                key={row.id}
                type="button"
                className="vw-menu-item"
                onClick={() => {
                  setUndatedAnchor(null)
                  onOpenRow(row.id)
                }}
                onContextMenu={(e) => openMenu(e, row.id)}
              >
                <RowIcon page={row} size={16} />
                <span className="vw-menu-label">
                  <RowTitle page={row} />
                </span>
              </button>
            ))}
          </div>
        </Popover>
      )}
      {menuNode}
    </div>
  )
}
