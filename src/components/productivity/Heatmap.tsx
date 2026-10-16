// Mapa de calor de 53 semanas × 7 dias (grade CSS própria) com dica por dia e navegação por teclado.
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ProductivityData } from '../../../electron/productivity-data.mjs'
import { heatmap, yearsWithData, type HeatCell, type Metric } from '../../activity/stats'
import { t } from '../../i18n'
import { Select } from '../ui/Select'

export const metricLabel = (metric: Metric) => ({
  words: t('Palavras', 'Words'), edits: t('Edições', 'Edits'), tasks: t('Tarefas', 'Tasks'), created: t('Páginas criadas', 'Pages created'),
})[metric]

function describe(cell: HeatCell, locale: string): string {
  const date = new Date(`${cell.key}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const day = cell.day
  if (!day || (!day.words && !day.edits && !day.tasks && !day.created)) return `${date} · ${t('sem atividade', 'no activity')}`
  const n = (value: number) => value.toLocaleString(locale)
  return `${date}${day.estimated ? ` (${t('estimado', 'estimated')})` : ''} · ${t('{n} palavras', '{n} words', { n: n(day.words) })} · ${t('{n} edições', '{n} edits', { n: n(day.edits) })} · ${t('{n} tarefas', '{n} tasks', { n: n(day.tasks) })} · ${t('{n} páginas criadas', '{n} pages created', { n: n(day.created) })}`
}

export function Heatmap({ data, today, weekStart, locale, metric, onMetric }: { data: ProductivityData; today: string; weekStart: 0 | 1; locale: string; metric: Metric; onMetric: (metric: Metric) => void }) {
  const years = useMemo(() => yearsWithData(data, today), [data, today])
  // null = últimos 12 meses; número = ano civil.
  const [year, setYear] = useState<number | null>(null)
  const map = useMemo(() => year === null ? heatmap(data, today, weekStart, metric) : heatmap(data, `${year}-12-31` > today ? today : `${year}-12-31`, weekStart, metric, `${year}-01-01`), [data, today, weekStart, metric, year])
  const [focus, setFocus] = useState<{ column: number; row: number } | null>(null)
  const [hover, setHover] = useState<{ column: number; row: number } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const active = hover ?? focus
  const activeCell = active ? map.weeks[active.column]?.[active.row] : null
  // Dica flutuante sobre o dia ativo (mouse ou teclado), posicionada fora da área com rolagem.
  const sectionRef = useRef<HTMLElement>(null)
  const [bubble, setBubble] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const section = sectionRef.current, cell = activeCell?.inRange ? section?.querySelector(`#pd-cell-${activeCell.key}`) : null
    if (!section || !cell) { setBubble(null); return }
    const box = section.getBoundingClientRect(), rect = cell.getBoundingClientRect()
    setBubble({ left: Math.max(130, Math.min(box.width - 130, rect.left - box.left + rect.width / 2)), top: rect.top - box.top - 6 })
  }, [activeCell?.key, activeCell?.inRange])
  const older = year === null ? years.find(y => y < Number(today.slice(0, 4))) ?? null : years.find(y => y < year) ?? null
  const label = year === null ? t('Últimos 12 meses', 'Last 12 months') : String(year)
  const currentYear = Number(today.slice(0, 4))
  const goNewer = () => { if (year === null) return; const newer = years.filter(y => y > year).at(-1); setYear(newer === undefined || newer >= currentYear ? null : newer) }
  const monthName = (month: number) => new Date(2024, month, 1).toLocaleDateString(locale, { month: 'short' }).replace('.', '')
  const weekdayName = (row: number) => new Date(Date.UTC(2024, 0, 7 + ((row + weekStart) % 7))).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' }).replace('.', '')
  const total = map.weeks.flat().reduce((sum, cell) => sum + (cell.inRange ? cell.value : 0), 0)
  const estimated = map.weeks.flat().some(cell => cell.inRange && cell.estimated && cell.value > 0)

  const onKey = (e: KeyboardEvent) => {
    const current = focus ?? { column: map.weeks.length - 1, row: map.weeks.at(-1)!.findIndex(cell => cell.key === today) }
    const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const move = moves[e.key]
    if (!move) return
    e.preventDefault()
    setHover(null)
    let column = Math.max(0, Math.min(map.weeks.length - 1, current.column + move[0])), row = current.row + move[1]
    if (row < 0) { row = 6; column = Math.max(0, column - 1) } else if (row > 6) { row = 0; column = Math.min(map.weeks.length - 1, column + 1) }
    setFocus({ column, row: Math.max(0, row) })
  }

  return <section ref={sectionRef} className="pd-heat" aria-labelledby="pd-heat-title">
    {bubble && activeCell && <div className="pd-bubble" aria-hidden style={{ left: bubble.left, top: bubble.top }}>{describe(activeCell, locale)}</div>}
    <div className="pd-heat-head">
      <h2 id="pd-heat-title" className="pd-h2">{t('Atividade', 'Activity')} · <span className="pd-muted">{t('{n} no período', '{n} in range', { n: total.toLocaleString(locale) })}</span></h2>
      <div className="pd-heat-tools">
        <Select aria-label={t('Métrica do mapa de calor', 'Heatmap metric')} value={metric} onChange={e => onMetric(e.target.value as Metric)}>
          {(['words', 'edits', 'tasks', 'created'] as Metric[]).map(m => <option key={m} value={m}>{metricLabel(m)}</option>)}
        </Select>
        <div className="pd-year" role="group" aria-label={t('Período do mapa', 'Heatmap range')}>
          <button type="button" className="pd-icon-btn" disabled={older === null} onClick={() => older !== null && setYear(older)} aria-label={t('Ano anterior', 'Previous year')}><ChevronLeft size={16} /></button>
          <span className="pd-year-label" aria-live="polite">{label}</span>
          <button type="button" className="pd-icon-btn" disabled={year === null} onClick={goNewer} aria-label={t('Próximo', 'Next')}><ChevronRight size={16} /></button>
        </div>
      </div>
    </div>
    <div className="pd-heat-scroll">
      <div className="pd-heat-body">
        <div className="pd-heat-months" aria-hidden>
          {map.months.map(month => <span key={`${month.year}-${month.month}`} style={{ gridColumn: month.column + 1, gridRow: 1 }}>{monthName(month.month)}</span>)}
        </div>
        <div className="pd-heat-days" aria-hidden>
          {[0, 1, 2, 3, 4, 5, 6].map(row => <span key={row}>{row % 2 === 1 ? weekdayName(row) : ''}</span>)}
        </div>
        <div ref={gridRef} className="pd-heat-grid" role="grid" tabIndex={0} aria-label={t('Mapa de calor de {metric}', '{metric} heatmap', { metric: metricLabel(metric).toLowerCase() })}
          aria-activedescendant={focus ? `pd-cell-${map.weeks[focus.column][focus.row].key}` : undefined}
          onKeyDown={onKey} onBlur={() => setFocus(null)} onMouseLeave={() => setHover(null)}>
          {map.weeks.map((week, column) => <div key={week[0].key} className="pd-heat-col" role="row">
            {week.map((cell, row) => <span key={cell.key} id={`pd-cell-${cell.key}`} role="gridcell" aria-label={cell.inRange ? describe(cell, locale) : undefined}
              className={`pd-cell pd-l${cell.level}${cell.inRange ? '' : ' is-out'}${cell.estimated && cell.value ? ' is-est' : ''}${cell.key === today ? ' is-today' : ''}${active?.column === column && active.row === row ? ' is-active' : ''}`}
              onMouseEnter={() => cell.inRange && setHover({ column, row })} />)}
          </div>)}
        </div>
      </div>
    </div>
    <div className="pd-heat-foot">
      <span className="pd-sr" role="status">{activeCell?.inRange ? describe(activeCell, locale) : ''}</span>
      <span className="pd-tip">{estimated ? t('Dias com contorno tracejado: histórico anterior estimado.', 'Dashed days: estimated earlier history.') : '\u00a0'}</span>
      <span className="pd-legend" aria-hidden>{t('Menos', 'Less')} {[0, 1, 2, 3, 4].map(level => <i key={level} className={`pd-cell pd-l${level}`} />)} {t('Mais', 'More')}</span>
    </div>
  </section>
}
