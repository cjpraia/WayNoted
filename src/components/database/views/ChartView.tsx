// Visualização Gráfico: barras horizontais/verticais, linha, rosca e número, desenhados em SVG próprio.
// As cores vêm da paleta de opções (db-tokens.css); eixos, grade e textos seguem os tokens do tema.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { ChartColumnBig, Download } from 'lucide-react'
import { actions, api, getState } from '../../../store'
import { getLocale, t } from '../../../i18n'
import type { DatabaseSchema, OptionColor, Page, Property, View } from '../../../types'
import { findOption, getValue, isDateValue, valueToText, type ViewProps } from '../lib'
import './ChartView.css'
import { PageIcon } from '../../page/PageIcon'
import { cellKey, crossTab, cumulative, sankeyLayout, squarify, type Bucket } from './chartData'
import { Select } from '../../ui/Select'

/** Tipos que usam uma segunda propriedade (pilhas, destino do fluxo ou subnível). */
export const SECONDARY_CHARTS = new Set(['stackedBar', 'sankey', 'treemap'])

/** Baldes de uma linha para uma propriedade: multisseleção e relação geram um balde por item. */
export function bucketsOf(row: Page, prop: Property | undefined): Bucket[] {
  if (!prop) return [{ key: '__all__', label: t('Todas as páginas', 'All pages') }]
  const value = getValue(row, prop)
  const none: Bucket = { key: '__none__', label: t('Sem valor', 'No value'), color: 'gray', empty: true }
  if (isDateValue(value)) return [{ key: value.start.slice(0, 7), label: value.start.slice(0, 7) }]
  if ((prop.type === 'select' || prop.type === 'status') && typeof value === 'string') {
    const option = findOption(prop, value)
    return option ? [{ key: option.id, label: option.name, color: option.color, custom: option.customColor }] : [none]
  }
  if (prop.type === 'multiSelect' && Array.isArray(value)) {
    const buckets = value.flatMap((id) => { const option = findOption(prop, id); return option ? [{ key: option.id, label: option.name, color: option.color, custom: option.customColor }] : [] })
    return buckets.length ? buckets : [none]
  }
  if (prop.type === 'relation' && Array.isArray(value)) {
    const buckets = value.flatMap((id) => typeof id === 'string' && getState().pages[id] ? [{ key: id, label: getState().pages[id].title || t('Sem título', 'Untitled') }] : [])
    return buckets.length ? buckets : [none]
  }
  if (typeof value === 'boolean') return [{ key: String(value), label: value ? t('Marcado', 'Checked') : t('Desmarcado', 'Unchecked'), color: value ? 'green' : 'gray' }]
  const text = valueToText(value, prop)
  return text ? [{ key: text, label: text }] : [none]
}

export interface ChartGroup { key: string; label: string; rows: Page[]; value: number; color?: OptionColor; empty?: boolean }

/** Ordem das cores quando o agrupamento não tem opções coloridas (datas, textos, números). */
const PALETTE: OptionColor[] = ['blue', 'green', 'orange', 'purple', 'pink', 'yellow', 'brown', 'red', 'gray']

export function chartGroups(rows: Page[], schema: DatabaseSchema, view: View): ChartGroup[] {
  const groupBy = schema.properties.find((p) => p.id === view.chartGroupBy) ?? schema.properties.find((p) => p.type === 'status' || p.type === 'select' || p.type === 'date')
  const valueProp = schema.properties.find((p) => p.id === view.chartValueId) ?? schema.properties.find((p) => ['number', 'formula', 'rollup'].includes(p.type))
  const groups = new Map<string, ChartGroup>()
  const noValue = t('Sem valor', 'No value')
  const groupFor = (row: Page, prop: Property | undefined): Pick<ChartGroup, 'label' | 'color' | 'empty'> => {
    if (!prop) return { label: t('Todas as páginas', 'All pages') }
    const value = getValue(row, prop)
    if (isDateValue(value)) return { label: value.start.slice(0, 7) }
    if ((prop.type === 'select' || prop.type === 'status') && typeof value === 'string') {
      const option = findOption(prop, value)
      if (option) return { label: option.name, color: option.color }
    }
    const text = valueToText(value, prop)
    return text ? { label: text } : { label: noValue, color: 'gray', empty: true }
  }
  for (const row of rows) {
    const info = groupFor(row, groupBy)
    const group = groups.get(info.label) ?? { key: info.label, rows: [], value: 0, ...info }
    group.rows.push(row)
    groups.set(info.label, group)
  }
  for (const group of groups.values()) {
    const numbers = valueProp ? group.rows.map((row) => getValue(row, valueProp)).filter((v): v is number => typeof v === 'number' && Number.isFinite(v)) : []
    const aggregate = view.chartAggregation ?? 'count'
    group.value = aggregate === 'count' ? group.rows.length : aggregate === 'sum' ? numbers.reduce((sum, n) => sum + n, 0) : numbers.length ? numbers.reduce((sum, n) => sum + n, 0) / numbers.length : 0
  }
  // Opções seguem a ordem do esquema (como as colunas do quadro); o resto em ordem alfabética; "Sem valor" por último.
  const order = new Map((groupBy?.options ?? []).map((option, index) => [option.name, index]))
  return [...groups.values()].sort((a, b) => Number(!!a.empty) - Number(!!b.empty) || (order.get(a.label) ?? Infinity) - (order.get(b.label) ?? Infinity) || a.label.localeCompare(b.label, getLocale()))
}

/** Marcas "redondas" para o eixo de valores (1, 2, 2,5 ou 5 × 10ⁿ). */
function niceTicks(min: number, max: number, integer: boolean, count = 5): number[] {
  if (max === min) max = min + 1
  const raw = (max - min) / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / magnitude
  let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * magnitude
  if (integer && step < 1) step = 1
  const ticks: number[] = []
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return ticks
}

function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const end = Math.min(a1, a0 + Math.PI * 2 - 1e-4)
  const large = end - a0 > Math.PI ? 1 : 0
  const p = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`
  return `M${p(r1, a0)}A${r1} ${r1} 0 ${large} 1 ${p(r1, end)}L${p(r0, end)}A${r0} ${r0} 0 ${large} 0 ${p(r0, a0)}Z`
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text
}

/** Copia para o clone os estilos calculados (variáveis CSS não existem num SVG avulso). */
function standaloneSvg(source: SVGSVGElement): SVGSVGElement {
  const clone = source.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const box = source.viewBox.baseVal
  clone.setAttribute('width', String(box.width))
  clone.setAttribute('height', String(box.height))
  const from = [source, ...source.querySelectorAll('*')]
  const to = [clone, ...clone.querySelectorAll('*')]
  from.forEach((element, index) => {
    const style = getComputedStyle(element)
    for (const prop of ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'font-size', 'font-weight', 'font-family']) {
      const value = style.getPropertyValue(prop)
      if (value) to[index].setAttribute(prop, value)
    }
    to[index].removeAttribute('class')
    to[index].removeAttribute('tabindex')
  })
  return clone
}

interface Hover { key: string; x: number; y: number }

export function ChartView({ db, schema, view, rows, onOpenRow, readOnly }: ViewProps) {
  const [drill, setDrill] = useState<{ label: string; rows: Page[]; color: string } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [exportError, setExportError] = useState('')
  const [width, setWidth] = useState(720)
  const svgRef = useRef<SVGSVGElement>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const groups = chartGroups(rows, schema, view)
  const active = groups.find((g) => g.key === selected)
  const type = view.chartType ?? 'horizontalBar'
  const aggregation = view.chartAggregation ?? 'count'
  const groupProp = schema.properties.find((p) => p.id === view.chartGroupBy) ?? schema.properties.find((p) => p.type === 'status' || p.type === 'select' || p.type === 'date')
  const total = groups.reduce((sum, group) => sum + group.value, 0)
  const integer = groups.every((group) => Number.isInteger(group.value))
  const format = (value: number) => value.toLocaleString(getLocale(), { maximumFractionDigits: 2 })

  useLayoutEffect(() => {
    const el = plotRef.current
    if (!el) return
    const measure = () => setWidth(Math.max(320, Math.round(el.clientWidth)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [groups.length > 0])
  useEffect(() => setHover(null), [type, aggregation, view.chartGroupBy, view.chartValueId])
  useEffect(() => setDrill(null), [type, aggregation, view.chartGroupBy, view.chartSecondaryGroupBy, view.chartValueId])
  useEffect(() => { if (selected && !groups.some((g) => g.key === selected)) setSelected(null) }, [groups, selected])

  const colorOf = (group: ChartGroup, index: number): string => {
    if (group.empty) return 'color-mix(in srgb, var(--opt-gray-dot) 50%, transparent)'
    const color = group.color ?? (type === 'donut' ? PALETTE[index % PALETTE.length] : 'blue')
    return `var(--opt-${color === 'default' ? 'gray' : color}-dot)`
  }
  const choose = (key: string) => setSelected((current) => (current === key ? null : key))
  // Gráficos ricos: segunda propriedade, medida e cores por balde.
  const secondaryProp = schema.properties.find((p) => p.id === view.chartSecondaryGroupBy && p.id !== groupProp?.id)
  const valueProp = schema.properties.find((p) => p.id === view.chartValueId) ?? schema.properties.find((p) => ['number', 'formula', 'rollup'].includes(p.type))
  const measure = (list: Page[]) => {
    if (aggregation === 'count' || !valueProp) return list.length
    const numbers = list.map((row) => getValue(row, valueProp)).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    return aggregation === 'sum' ? numbers.reduce((sum, n) => sum + n, 0) : numbers.length ? numbers.reduce((sum, n) => sum + n, 0) / numbers.length : 0
  }
  const bucketOrder = (prop: Property | undefined) => {
    const order = new Map((prop?.options ?? []).map((option, index) => [option.id, index]))
    return (a: Bucket, b: Bucket) => (order.get(a.key) ?? Infinity) - (order.get(b.key) ?? Infinity) || a.label.localeCompare(b.label, getLocale(), { numeric: true })
  }
  const bucketColor = (bucket: Bucket, index: number) => bucket.empty ? 'color-mix(in srgb, var(--opt-gray-dot) 50%, transparent)' : bucket.custom ?? `var(--opt-${!bucket.color || bucket.color === 'default' ? PALETTE[index % PALETTE.length] : bucket.color}-dot)`
  const openDrill = (label: string, list: Page[], color: string) => { setSelected(null); setDrill((current) => current?.label === label ? null : { label, rows: list, color }) }
  const drillProps = (label: string, list: Page[], color: string) => ({
    role: 'button', tabIndex: 0, className: 'ch-mark', 'aria-label': `${label}: ${list.length}`,
    onClick: () => openDrill(label, list, color),
    onKeyDown: (event: ReactKeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDrill(label, list, color) } },
  })
  const interactive = (group: ChartGroup, extra = '') => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': `${group.label}: ${format(group.value)}`,
    className: `ch-mark${extra}${selected === group.key ? ' is-selected' : ''}${selected && selected !== group.key ? ' is-dimmed' : ''}`,
    onClick: () => choose(group.key),
    onKeyDown: (event: ReactKeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(group.key) } },
    onMouseMove: (event: ReactMouseEvent) => {
      const box = plotRef.current?.getBoundingClientRect()
      if (box) setHover({ key: group.key, x: event.clientX - box.left, y: event.clientY - box.top })
    },
    onMouseLeave: () => setHover(null),
  })

  const W = width
  let height = 300
  let body: ReactNode = null

  if (type === 'horizontalBar') {
    const pitch = 34
    const labelW = Math.min(180, Math.round(W * 0.3), 16 + Math.max(...groups.map((g) => g.label.length)) * 7)
    const top = 8
    height = top + groups.length * pitch + 32
    const ticks = niceTicks(Math.min(0, ...groups.map((g) => g.value)), Math.max(0, ...groups.map((g) => g.value)), integer)
    const lo = ticks[0], hi = ticks[ticks.length - 1]
    const x0 = labelW + 12, x1 = W - 16
    const sx = (v: number) => x0 + (v - lo) / (hi - lo || 1) * (x1 - x0)
    const axisY = top + groups.length * pitch
    body = <>
      {ticks.map((tick) => <g key={tick}><line className="ch-grid" x1={sx(tick)} x2={sx(tick)} y1={top} y2={axisY} /><text className="ch-tick" x={sx(tick)} y={axisY + 20} textAnchor="middle">{format(tick)}</text></g>)}
      <line className="ch-axis" x1={sx(0)} x2={sx(0)} y1={top} y2={axisY} />
      {groups.map((group, index) => {
        const y = top + index * pitch + 6
        const a = sx(Math.min(0, group.value)), b = sx(Math.max(0, group.value))
        return <g key={group.key}>
          <text className="ch-label" x={labelW} y={y + 15} textAnchor="end">{truncate(group.label, Math.floor(labelW / 7))}</text>
          <rect {...interactive(group)} x={a} y={y} width={Math.max(2, b - a)} height={22} rx={4} fill={colorOf(group, index)} />
        </g>
      })}
    </>
  } else if (type === 'verticalBar' || type === 'line') {
    const ticks = niceTicks(Math.min(0, ...groups.map((g) => g.value)), Math.max(0, ...groups.map((g) => g.value)), integer)
    const lo = ticks[0], hi = ticks[ticks.length - 1]
    const left = 16 + Math.max(...ticks.map((tick) => format(tick).length)) * 7.5, right = W - 16, top = 12, bottom = height - 36
    const sy = (v: number) => bottom - (v - lo) / (hi - lo || 1) * (bottom - top)
    const band = (right - left) / Math.max(1, groups.length)
    const cx = (index: number) => left + band * (index + 0.5)
    const maxChars = Math.max(3, Math.floor(band / 7))
    const axis = <>
      {ticks.map((tick) => <g key={tick}><line className="ch-grid" x1={left} x2={right} y1={sy(tick)} y2={sy(tick)} /><text className="ch-tick" x={left - 8} y={sy(tick) + 4} textAnchor="end">{format(tick)}</text></g>)}
      <line className="ch-axis" x1={left} x2={right} y1={sy(0)} y2={sy(0)} />
      {groups.map((group, index) => <text key={group.key} className="ch-tick" x={cx(index)} y={bottom + 22} textAnchor="middle">{truncate(group.label, maxChars)}</text>)}
    </>
    if (type === 'verticalBar') {
      const barW = Math.max(6, Math.min(56, band * 0.6))
      body = <>{axis}{groups.map((group, index) => {
        const a = sy(Math.max(0, group.value)), b = sy(Math.min(0, group.value))
        return <rect key={group.key} {...interactive(group)} x={cx(index) - barW / 2} y={a} width={barW} height={Math.max(2, b - a)} rx={4} fill={colorOf(group, index)} />
      })}</>
    } else {
      const points = groups.map((group, index) => [cx(index), sy(group.value)] as const)
      const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
      body = <>{axis}
        {points.length > 1 && <polygon className="ch-area" points={`${points[0][0]},${sy(Math.max(lo, 0))} ${line} ${points[points.length - 1][0]},${sy(Math.max(lo, 0))}`} />}
        <polyline className="ch-line" points={line} />
        {groups.map((group, index) => <g key={group.key}>
          <circle cx={points[index][0]} cy={points[index][1]} r={14} {...interactive(group, ' ch-hit')} />
          <circle className={`ch-point${hover?.key === group.key || selected === group.key ? ' is-hover' : ''}`} cx={points[index][0]} cy={points[index][1]} r={hover?.key === group.key || selected === group.key ? 5 : 3.5} />
        </g>)}
      </>
    }
  } else if (type === 'donut') {
    height = Math.max(240, 40 + groups.length * 28)
    const r1 = 96, r0 = 66, cx = 24 + r1, cy = height / 2
    const positive = groups.filter((g) => g.value > 0)
    const sum = positive.reduce((n, g) => n + g.value, 0)
    let angle = 0
    const legendX = cx + r1 + 48
    const legendRight = Math.min(W - 16, legendX + 300)
    const legendTop = cy - (groups.length * 28) / 2 + 14
    body = <>
      {sum === 0 && <circle className="ch-track" cx={cx} cy={cy} r={(r0 + r1) / 2} strokeWidth={r1 - r0} />}
      {positive.map((group) => {
        const index = groups.indexOf(group)
        const span = group.value / sum * Math.PI * 2
        const start = angle
        angle += span
        const gap = positive.length > 1 ? 0.012 : 0
        return <path key={group.key} {...interactive(group)} d={arcPath(cx, cy, r0, hover?.key === group.key ? r1 + 4 : r1, start + gap, start + span - gap)} fill={colorOf(group, index)} />
      })}
      <text className="ch-donut-total" x={cx} y={cy + 4} textAnchor="middle">{format(total)}</text>
      <text className="ch-tick" x={cx} y={cy + 24} textAnchor="middle">{aggregation === 'count' ? t('páginas', 'pages') : aggregation === 'sum' ? t('soma', 'sum') : t('média', 'average')}</text>
      {groups.map((group, index) => {
        const y = legendTop + index * 28
        const pct = sum > 0 && group.value > 0 ? ` · ${Math.round(group.value / sum * 100)}%` : ''
        return <g key={group.key} className="ch-legend-item">
          <circle cx={legendX + 4} cy={y - 4} r={4} fill={colorOf(group, index)} />
          <text className={group.value < 0 ? 'ch-label ch-negative' : 'ch-label'} x={legendX + 16} y={y}>{truncate(group.label, Math.max(8, Math.floor((legendRight - legendX - 90) / 7)))}</text>
          <text className="ch-tick" x={legendRight} y={y} textAnchor="end">{format(group.value)}{pct}</text>
        </g>
      })}
    </>
  } else if (type === 'stackedBar' || type === 'sankey' || (type === 'treemap' && secondaryProp)) {
    const cross = crossTab(rows, (row) => bucketsOf(row, groupProp), (row) => secondaryProp ? bucketsOf(row, secondaryProp) : [{ key: '__all__', label: t('Total', 'Total') }], measure, bucketOrder(groupProp))
    const secondaryOrder = bucketOrder(secondaryProp)
    cross.secondary.sort((a, b) => Number(!!a.empty) - Number(!!b.empty) || secondaryOrder(a, b))
    const colorIndex = new Map(cross.secondary.map((bucket, index) => [bucket.key, bucketColor(bucket, index)]))
    const legendH = secondaryProp ? Math.ceil(cross.secondary.length / 4) * 18 + 12 : 0
    const legend = () => <g>{cross.secondary.map((bucket, index) => <g key={bucket.key} transform={`translate(${16 + (index % 4) * Math.floor((W - 32) / 4)}, ${height - legendH + 18 + Math.floor(index / 4) * 18})`}><circle cx={4} cy={-4} r={4} fill={colorIndex.get(bucket.key)} /><text className="ch-label" x={14} y={0}>{truncate(bucket.label, Math.floor((W - 32) / 4 / 7) - 3)}</text></g>)}</g>
    if (type === 'stackedBar') {
      height = 300 + legendH
      const stacks = cross.primary.map((bucket) => cross.secondary.map((child) => ({ child, cell: cross.cells.get(cellKey(bucket.key, child.key)) })))
      const totals = stacks.map((stack) => stack.reduce((sum, item) => sum + Math.max(0, item.cell?.value ?? 0), 0))
      const ticks = niceTicks(0, Math.max(0, ...totals), integer && aggregation !== 'average')
      const hi = ticks[ticks.length - 1] || 1
      const left = 16 + Math.max(...ticks.map((tick) => format(tick).length)) * 7.5, right = W - 16, top = 12, bottom = height - 36 - legendH
      const sy = (v: number) => bottom - v / hi * (bottom - top)
      const band = (right - left) / Math.max(1, cross.primary.length)
      const barW = Math.max(6, Math.min(56, band * 0.6))
      body = <>
        {ticks.map((tick) => <g key={tick}><line className="ch-grid" x1={left} x2={right} y1={sy(tick)} y2={sy(tick)} /><text className="ch-tick" x={left - 8} y={sy(tick) + 4} textAnchor="end">{format(tick)}</text></g>)}
        <line className="ch-axis" x1={left} x2={right} y1={sy(0)} y2={sy(0)} />
        {cross.primary.map((bucket, index) => {
          let base = 0
          const cx = left + band * (index + 0.5)
          return <g key={bucket.key}>
            <text className="ch-tick" x={cx} y={bottom + 22} textAnchor="middle">{truncate(bucket.label, Math.max(3, Math.floor(band / 7)))}</text>
            {stacks[index].map(({ child, cell }) => {
              if (!cell || cell.value <= 0) return null
              const y0 = sy(base), y1 = sy(base + cell.value)
              base += cell.value
              const label = `${bucket.label} · ${child.label}`
              return <rect key={child.key} {...drillProps(label, cell.rows, colorIndex.get(child.key)!)} x={cx - barW / 2} y={y1} width={barW} height={Math.max(1, y0 - y1)} fill={colorIndex.get(child.key)}><title>{`${label}: ${format(cell.value)}`}</title></rect>
            })}
          </g>
        })}
        {secondaryProp && legend()}
      </>
    } else if (type === 'sankey') {
      const sources = cross.primary.map((bucket) => ({ key: bucket.key, value: cross.totals.get(bucket.key)?.value ?? 0 }))
      const targets = cross.secondary.map((bucket) => ({ key: bucket.key, value: 0 }))
      const flows = [...cross.cells].map(([key, cell]) => { const [source, target] = key.split('\u0000'); return { source, target, value: cell.value } })
      height = Math.max(240, 24 * Math.max(cross.primary.length, cross.secondary.length) + 40)
      const nodeW = 12, labelW = Math.min(170, Math.round(W * 0.22)), x0 = labelW, x1 = W - labelW - nodeW, top = 12
      const layout = sankeyLayout(sources, targets, flows, height - 24, 8)
      const byKey = (side: 'left' | 'right') => new Map(layout.nodes.filter((node) => node.side === side).map((node) => [node.key, node]))
      const leftNodes = byKey('left'), rightNodes = byKey('right')
      const sourceColor = new Map(cross.primary.map((bucket, index) => [bucket.key, bucketColor(bucket, index)]))
      body = <>
        {layout.links.map((link) => {
          const a = cross.primary.find((bucket) => bucket.key === link.source)!, b = cross.secondary.find((bucket) => bucket.key === link.target)!
          const sx = x0 + nodeW, tx = x1, mid = (sx + tx) / 2
          const y0 = top + link.sy, y1 = top + link.ty
          const d = `M${sx},${y0}C${mid},${y0} ${mid},${y1} ${tx},${y1}L${tx},${y1 + link.h}C${mid},${y1 + link.h} ${mid},${y0 + link.h} ${sx},${y0 + link.h}Z`
          const label = `${a.label} → ${b.label}`
          const cell = cross.cells.get(cellKey(link.source, link.target))!
          return <path key={`${link.source}>${link.target}`} {...drillProps(label, cell.rows, sourceColor.get(link.source)!)} className="ch-mark ch-flow" d={d} fill={sourceColor.get(link.source)}><title>{`${label}: ${format(link.value)}`}</title></path>
        })}
        {cross.primary.map((bucket) => { const node = leftNodes.get(bucket.key); if (!node || node.h <= 0) return null; const cell = cross.totals.get(bucket.key)!; return <g key={`l${bucket.key}`}>
          <rect {...drillProps(bucket.label, cell.rows, sourceColor.get(bucket.key)!)} x={x0} y={top + node.y} width={nodeW} height={Math.max(1, node.h)} rx={2} fill={sourceColor.get(bucket.key)}><title>{`${bucket.label}: ${format(node.value)}`}</title></rect>
          <text className="ch-label" x={x0 - 8} y={top + node.y + node.h / 2 + 4} textAnchor="end">{truncate(bucket.label, Math.floor(labelW / 7) - 4)} · {format(node.value)}</text>
        </g> })}
        {cross.secondary.map((bucket, index) => { const node = rightNodes.get(bucket.key); if (!node || node.h <= 0) return null; const list = [...new Set(cross.primary.flatMap((source) => cross.cells.get(cellKey(source.key, bucket.key))?.rows ?? []))]; return <g key={`r${bucket.key}`}>
          <rect {...drillProps(bucket.label, list, bucketColor(bucket, index))} x={x1} y={top + node.y} width={nodeW} height={Math.max(1, node.h)} rx={2} fill={bucketColor(bucket, index)}><title>{`${bucket.label}: ${format(node.value)}`}</title></rect>
          <text className="ch-label" x={x1 + nodeW + 8} y={top + node.y + node.h / 2 + 4}>{truncate(bucket.label, Math.floor(labelW / 7) - 4)} · {format(node.value)}</text>
        </g> })}
        {!secondaryProp && <text className="ch-tick" x={W / 2} y={height - 4} textAnchor="middle">{t('Escolha a propriedade de destino do fluxo.', 'Choose the flow’s target property.')}</text>}
      </>
    } else {
      height = 360
      const outer = squarify(cross.primary.map((bucket) => ({ key: bucket.key, value: cross.totals.get(bucket.key)?.value ?? 0 })), 0, 0, W, height)
      body = <>{outer.map((rect) => {
        const parent = cross.primary.find((bucket) => bucket.key === rect.key)!
        const inner = squarify(cross.secondary.map((child) => ({ key: child.key, value: cross.cells.get(cellKey(rect.key, child.key))?.value ?? 0 })), rect.x + 2, rect.y + 20, rect.w - 4, rect.h - 22)
        return <g key={rect.key}>
          <rect className="ch-tree-frame" x={rect.x + 1} y={rect.y + 1} width={Math.max(0, rect.w - 2)} height={Math.max(0, rect.h - 2)} rx={6} />
          {rect.w > 40 && <text className="ch-label ch-tree-title" x={rect.x + 8} y={rect.y + 15}>{truncate(`${parent.label} · ${format(rect.value)}`, Math.floor(rect.w / 7))}</text>}
          {inner.map((cell) => {
            const child = cross.secondary.find((bucket) => bucket.key === cell.key)!
            const list = cross.cells.get(cellKey(rect.key, cell.key))?.rows ?? []
            const label = `${parent.label} · ${child.label}`
            return <g key={cell.key}>
              <rect {...drillProps(label, list, colorIndex.get(child.key)!)} x={cell.x + 1} y={cell.y + 1} width={Math.max(0, cell.w - 2)} height={Math.max(0, cell.h - 2)} rx={4} fill={colorIndex.get(child.key)}><title>{`${label}: ${format(cell.value)}`}</title></rect>
              {cell.w > 48 && cell.h > 18 && <text className="ch-tree-label" x={cell.x + 6} y={cell.y + 15} pointerEvents="none">{truncate(child.label, Math.floor(cell.w / 7))}</text>}
            </g>
          })}
        </g>
      })}</>
    }
  } else if (type === 'treemap') {
    height = 340
    const rects = squarify(groups.map((group) => ({ key: group.key, value: group.value })), 0, 0, W, height)
    body = <>{rects.map((rect) => {
      const group = groups.find((item) => item.key === rect.key)!
      const index = groups.indexOf(group)
      return <g key={rect.key}>
        <rect {...interactive(group)} x={rect.x + 1} y={rect.y + 1} width={Math.max(0, rect.w - 2)} height={Math.max(0, rect.h - 2)} rx={6} fill={group.empty ? colorOf(group, index) : `var(--opt-${group.color && group.color !== 'default' ? group.color : PALETTE[index % PALETTE.length]}-dot)`} />
        {rect.w > 48 && rect.h > 22 && <text className="ch-tree-label" x={rect.x + 8} y={rect.y + 18} pointerEvents="none">{truncate(group.label, Math.floor(rect.w / 7))}</text>}
        {rect.w > 48 && rect.h > 40 && <text className="ch-tree-label ch-tree-value" x={rect.x + 8} y={rect.y + 36} pointerEvents="none">{format(group.value)}</text>}
      </g>
    })}</>
  } else if (type === 'cumulativeLine') {
    const running = cumulative(groups.map((group) => group.value))
    const ticks = niceTicks(Math.min(0, ...running), Math.max(0, ...running), integer)
    const lo = ticks[0], hi = ticks[ticks.length - 1]
    const left = 16 + Math.max(...ticks.map((tick) => format(tick).length)) * 7.5, right = W - 16, top = 12, bottom = height - 36
    const sy = (v: number) => bottom - (v - lo) / (hi - lo || 1) * (bottom - top)
    const band = (right - left) / Math.max(1, groups.length)
    const cx = (index: number) => left + band * (index + 0.5)
    const points = running.map((value, index) => [cx(index), sy(value)] as const)
    const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
    body = <>
      {ticks.map((tick) => <g key={tick}><line className="ch-grid" x1={left} x2={right} y1={sy(tick)} y2={sy(tick)} /><text className="ch-tick" x={left - 8} y={sy(tick) + 4} textAnchor="end">{format(tick)}</text></g>)}
      <line className="ch-axis" x1={left} x2={right} y1={sy(0)} y2={sy(0)} />
      {groups.map((group, index) => <text key={group.key} className="ch-tick" x={cx(index)} y={bottom + 22} textAnchor="middle">{truncate(group.label, Math.max(3, Math.floor(band / 7)))}</text>)}
      {points.length > 1 && <polygon className="ch-area" points={`${points[0][0]},${sy(Math.max(lo, 0))} ${line} ${points[points.length - 1][0]},${sy(Math.max(lo, 0))}`} />}
      <polyline className="ch-line" points={line} />
      {groups.map((group, index) => <g key={group.key}>
        <circle cx={points[index][0]} cy={points[index][1]} r={14} {...interactive(group, ' ch-hit')}><title>{`${group.label}: ${format(running[index])} (+${format(group.value)})`}</title></circle>
        <circle className={`ch-point${selected === group.key ? ' is-hover' : ''}`} cx={points[index][0]} cy={points[index][1]} r={selected === group.key ? 5 : 3.5} />
      </g>)}
    </>
  } else {
    height = 220
    body = <>
      <text className="ch-number" x={W / 2} y={118} textAnchor="middle">{format(total)}</text>
      <text className="ch-number-caption" x={W / 2} y={150} textAnchor="middle">{aggregation === 'count' ? t('páginas', 'pages') : aggregation === 'sum' ? t('Soma', 'Sum') : t('Média', 'Average')}</text>
    </>
  }

  const exportSvg = () => {
    if (!svgRef.current) return
    void api.exportFile(`${view.name || 'chart'}.svg`, `<?xml version="1.0" encoding="UTF-8"?>\n${standaloneSvg(svgRef.current).outerHTML}`)
  }
  const exportPng = async () => {
    if (!svgRef.current || !api.exportBinaryFile) return
    setExportError('')
    const svg = standaloneSvg(svgRef.current)
    const background = getComputedStyle(svgRef.current).getPropertyValue('--bg').trim() || '#ffffff'
    const url = URL.createObjectURL(new Blob([svg.outerHTML], { type: 'image/svg+xml;charset=utf-8' }))
    try {
      const image = new Image()
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error(t('Falha ao gerar PNG', 'Could not create PNG'))); image.src = url })
      const bounds = svgRef.current.viewBox.baseVal
      const canvas = document.createElement('canvas')
      canvas.width = bounds.width * 2; canvas.height = bounds.height * 2
      const context = canvas.getContext('2d')
      if (!context) throw new Error(t('Canvas indisponível', 'Canvas unavailable'))
      context.fillStyle = background; context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!png || !await api.exportBinaryFile(`${view.name || 'chart'}.png`, new Uint8Array(await png.arrayBuffer()))) throw new Error(t('Falha ao exportar PNG', 'Could not export PNG'))
    } catch (error) { setExportError(error instanceof Error ? error.message : t('Falha ao exportar PNG', 'Could not export PNG')) }
    finally { URL.revokeObjectURL(url) }
  }

  const hovered = hover ? groups.find((g) => g.key === hover.key) : undefined
  const aggregationLabel = aggregation === 'sum' ? t('Soma', 'Sum') : aggregation === 'average' ? t('Média', 'Average') : t('Contagem', 'Count')
  const pages = (n: number) => `${n} ${n === 1 ? t('página', 'page') : t('páginas', 'pages')}`

  return <div className="ch-root">
    <div className="ch-heading">
      <div className="ch-title">{aggregationLabel} {t('por', 'by')} {groupProp?.name ?? t('grupo', 'group')}<span className="ch-subtitle">{pages(rows.length)}</span></div>
      <div className="ch-actions">
        {SECONDARY_CHARTS.has(type) && <label className="ch-secondary">{type === 'sankey' ? t('Fluxo para', 'Flow to') : type === 'stackedBar' ? t('Empilhar por', 'Stack by') : t('Subdividir por', 'Subdivide by')}
          <Select value={secondaryProp?.id ?? ''} disabled={readOnly} onChange={(event) => actions.updateView(db.id, view.id, { chartSecondaryGroupBy: event.target.value || undefined })}>
            <option value="">{t('Nenhuma', 'None')}</option>
            {schema.properties.filter((p) => p.id !== groupProp?.id && ['select', 'status', 'multiSelect', 'relation', 'checkbox', 'date', 'person', 'text'].includes(p.type)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </label>}
        <button type="button" className="ch-export" onClick={exportSvg} disabled={!groups.length} aria-label={t('Exportar SVG', 'Export SVG')}><Download size={14} strokeWidth={1.75} /> SVG</button>
        <button type="button" className="ch-export" onClick={() => void exportPng()} disabled={!groups.length || !api.exportBinaryFile} aria-label={t('Exportar PNG', 'Export PNG')}><Download size={14} strokeWidth={1.75} /> PNG</button>
      </div>
    </div>
    {!groups.length ? <div className="vw-empty">
      <ChartColumnBig size={28} strokeWidth={1.5} className="vw-empty-icon" />
      <div className="vw-empty-title">{t('Nada para mostrar', 'Nothing to show')}</div>
      <div className="vw-empty-text">{t('Nenhuma linha corresponde aos filtros desta visualização.', 'No rows match this view’s filters.')}</div>
    </div> : <div className="ch-card">
      <div className="ch-plot" ref={plotRef} onMouseMove={(event) => { if (!(event.target as Element).closest('.ch-mark')) setHover(null) }} onMouseLeave={() => setHover(null)}>
        <svg ref={svgRef} className="ch-svg" viewBox={`0 0 ${W} ${height}`} width={W} height={height} role="img" aria-label={view.name}>
          <title>{view.name}</title>
          <rect className="ch-bg" width={W} height={height} />
          {body}
        </svg>
        {hovered && hover && <div className="ch-tooltip" style={{ left: Math.min(hover.x + 12, W - 180), top: Math.max(0, hover.y - 52) }}>
          <span className="ch-tooltip-label"><i style={{ background: colorOf(hovered, groups.indexOf(hovered)) }} />{hovered.label}</span>
          <strong>{format(hovered.value)}</strong>
          {aggregation !== 'count' && <span className="ch-tooltip-meta">{pages(hovered.rows.length)}</span>}
        </div>}
      </div>
    </div>}
    {exportError && <div role="alert" className="dbv-csv-status">{exportError}</div>}
    {drill && !active && <div className="ch-detail">
      <div className="ch-detail-head"><i style={{ background: drill.color }} />{drill.label}<span>{pages(drill.rows.length)}</span></div>
      {drill.rows.map((row) => <button type="button" key={row.id} onClick={() => onOpenRow(row.id)}>{row.icon && <PageIcon value={row.icon} />}<span>{row.title || t('Sem título', 'Untitled')}</span></button>)}
    </div>}
    {active && <div className="ch-detail">
      <div className="ch-detail-head"><i style={{ background: colorOf(active, groups.indexOf(active)) }} />{active.label}<span>{pages(active.rows.length)}</span></div>
      {active.rows.map((row) => <button type="button" key={row.id} onClick={() => onOpenRow(row.id)}>{row.icon && <PageIcon value={row.icon} />}<span>{row.title || t('Sem título', 'Untitled')}</span></button>)}
    </div>}
  </div>
}
