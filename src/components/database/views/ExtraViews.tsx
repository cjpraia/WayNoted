// Visualizações Feed, Formulário, Mapa e Painel (prefixo db-extra-).
import { useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { CalendarDays, Check, ClipboardList, Hash, LayoutDashboard, List, MapPin, Newspaper, SquareKanban } from 'lucide-react'
import { actions } from '../../../store'
import { useI18n } from '../../../i18n'
import type { DateValue, Page, PlaceValue, PropValue } from '../../../types'
import { defaultsForNewRow, getValue, isDateValue, valueToText, type ViewProps } from '../lib'
import { isComputedProperty } from '../derived'
import { OptionChip } from '../PropDisplay'
import { PageIcon } from '../../page/PageIcon'
import { chartGroups } from './ChartView'
import { PropValueView, RowIcon, RowTitle, shownProps } from './shared/rows'
import './ExtraViews.css'
import { Select } from '../../ui/Select'

const activate = (fn: () => void) => (event: ReactKeyboardEvent) => {
  if (event.target !== event.currentTarget) return
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fn() }
}

// ---------- Feed ----------

export function FeedView({ schema, view, rows, visibleProps, onOpenRow }: ViewProps) {
  const { locale, t } = useI18n()
  const dateProp = schema.properties.find((property) => property.id === view.feedDateProp && property.type === 'date')
  const when = (row: Page): number => {
    const value = dateProp ? getValue(row, dateProp) : null
    return isDateValue(value) ? Date.parse(value.start) || row.updatedAt : row.updatedAt
  }
  if (!rows.length) return <div className="vw-empty">
    <Newspaper size={28} strokeWidth={1.5} className="vw-empty-icon" />
    <div className="vw-empty-title">{t('Nenhuma página no feed', 'No pages in the feed')}</div>
    <div className="vw-empty-text">{t('As páginas deste banco aparecem aqui, das mais recentes para as mais antigas.', 'Pages in this database show up here, newest first.')}</div>
  </div>
  return <div className="db-extra-feed">{[...rows].sort((a, b) => when(b) - when(a)).map((row) => {
    const values = shownProps(row, visibleProps)
    const text = row.text.trim()
    return <article key={row.id} className="db-extra-feed-item" role="button" tabIndex={0} onClick={() => onOpenRow(row.id)} onKeyDown={activate(() => onOpenRow(row.id))}>
      <header>
        {row.icon && <RowIcon page={row} size={18} />}
        <h3><RowTitle page={row} /></h3>
        <time dateTime={new Date(when(row)).toISOString()}>{new Date(when(row)).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}</time>
      </header>
      {values.length > 0 && <div className="db-extra-feed-props">{values.map(({ prop, value }) => <span key={prop.id} title={prop.name}><PropValueView prop={prop} value={value} rowId={row.id} /></span>)}</div>}
      {text && <p>{text.slice(0, 320)}</p>}
    </article>
  })}</div>
}

// ---------- Formulário ----------

type Draft = Record<string, string | boolean | string[]>
const FORM_TYPES = new Set(['title', 'text', 'number', 'select', 'status', 'multiSelect', 'date', 'checkbox', 'url', 'email', 'phone'])

export function FormView({ db, schema, view, readOnly, creationDefaults }: ViewProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<Draft>({})
  const [sent, setSent] = useState(false)
  const visible = schema.properties.filter((property) => property.type === 'title' || FORM_TYPES.has(property.type) && !isComputedProperty(property) && (!view.formFields || view.formFields.includes(property.id)))
  const titleId = schema.properties.find((property) => property.type === 'title')?.id ?? ''
  const edit = (id: string, value: string | boolean | string[]) => { setDraft((current) => ({ ...current, [id]: value })); setSent(false) }
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (readOnly) return
    const title = String(draft[titleId] ?? '').trim()
    if (!title) return
    const props: Record<string, PropValue> = {}
    for (const property of visible) {
      if (property.type === 'title') continue
      const value = draft[property.id]
      if (property.type === 'checkbox') props[property.id] = value === true
      else if (property.type === 'number') { const number = Number(value); props[property.id] = typeof value === 'string' && value !== '' && Number.isFinite(number) ? number : null }
      else if (property.type === 'date') props[property.id] = typeof value === 'string' && value ? { start: value } : null
      else if (property.type === 'multiSelect') props[property.id] = Array.isArray(value) && value.length ? value : null
      else props[property.id] = typeof value === 'string' && value.trim() ? value.trim() : null
    }
    actions.createRow(db.id, defaultsForNewRow(schema, view, props, creationDefaults), { title })
    setDraft({})
    setSent(true)
  }
  const field = (property: (typeof visible)[number]): ReactNode => {
    const value = draft[property.id]
    if (property.type === 'checkbox') return <input type="checkbox" checked={value === true} disabled={readOnly} onChange={(e) => edit(property.id, e.target.checked)} />
    if ((property.type === 'select' || property.type === 'status') && property.options?.length) return <span className="db-extra-select">
      <Select value={String(value ?? '')} disabled={readOnly} onChange={(e) => edit(property.id, e.target.value)}>
        <option value="">{t('Selecione uma opção', 'Select an option')}</option>
        {property.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </Select>
    </span>
    if (property.type === 'multiSelect') {
      const chosen = Array.isArray(value) ? value : []
      if (!property.options?.length) return <span className="db-extra-form-hint">{t('Sem opções definidas', 'No options defined')}</span>
      return <span className="db-extra-form-chips" role="group" aria-label={property.name}>{property.options.map((option) => {
        const on = chosen.includes(option.id)
        return <button type="button" key={option.id} aria-pressed={on} disabled={readOnly} className={on ? 'is-on' : ''} onClick={() => edit(property.id, on ? chosen.filter((id) => id !== option.id) : [...chosen, option.id])}><OptionChip name={option.name} color={option.color} custom={option.customColor} /></button>
      })}</span>
    }
    const type = property.type === 'number' ? 'number' : property.type === 'date' ? 'date' : property.type === 'email' ? 'email' : property.type === 'url' ? 'url' : property.type === 'phone' ? 'tel' : 'text'
    return <input type={type} value={String(value ?? '')} disabled={readOnly} required={property.type === 'title'} placeholder={property.type === 'title' ? t('Escreva o título', 'Enter a title') : type === 'date' ? undefined : t('Sua resposta', 'Your answer')} onChange={(e) => edit(property.id, e.target.value)} />
  }
  return <form className="db-extra-form" onSubmit={submit}>
    <header>
      <ClipboardList size={20} strokeWidth={1.5} className="db-extra-form-icon" />
      <h2>{view.formTitle || t('Novo registro', 'New entry')}</h2>
      {view.formDescription && <p>{view.formDescription}</p>}
    </header>
    {visible.map((property) => property.type === 'checkbox'
      ? <label key={property.id} className="db-extra-form-check">{field(property)}<span>{property.name}</span></label>
      : property.type === 'multiSelect'
        ? <div key={property.id} className="db-extra-form-field"><span className="db-extra-form-label">{property.name}</span>{field(property)}</div>
        : <label key={property.id} className="db-extra-form-field"><span className="db-extra-form-label">{property.name}{property.type === 'title' && <em aria-hidden="true">*</em>}</span>{field(property)}</label>)}
    <footer>
      <button type="submit" className="db-extra-primary" disabled={readOnly || !String(draft[titleId] ?? '').trim()}>{t('Enviar', 'Submit')}</button>
      {sent ? <span role="status" className="db-extra-form-sent"><Check size={14} strokeWidth={2} />{t('Registro salvo neste dispositivo.', 'Entry saved on this device.')}</span>
        : <span className="db-extra-form-hint">{readOnly ? t('Este banco está bloqueado para edição.', 'This database is locked.') : t('As respostas viram páginas deste banco local.', 'Responses become pages in this local database.')}</span>}
    </footer>
  </form>
}

// ---------- Mapa ----------

interface MapPoint { row: Page; value: PlaceValue }

function isPlace(value: PropValue): value is PlaceValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'lat' in value && 'lng' in value && Number.isFinite(value.lat) && Number.isFinite(value.lng)
}

/** Enquadra os pontos (projeção equirretangular 2:1) com folga e passo de grade "redondo". */
function mapFrame(points: MapPoint[]) {
  if (!points.length) return { lng0: -180, lat1: 90, lngSpan: 360, latSpan: 180, step: 30 }
  let minLng = Math.min(...points.map((p) => p.value.lng)), maxLng = Math.max(...points.map((p) => p.value.lng))
  let minLat = Math.min(...points.map((p) => p.value.lat)), maxLat = Math.max(...points.map((p) => p.value.lat))
  let lngSpan = Math.max(24, (maxLng - minLng) * 1.25), latSpan = Math.max(12, (maxLat - minLat) * 1.25)
  if (lngSpan > latSpan * 2) latSpan = lngSpan / 2
  else lngSpan = latSpan * 2
  lngSpan = Math.min(360, lngSpan); latSpan = Math.min(180, latSpan)
  const cLng = (minLng + maxLng) / 2, cLat = (minLat + maxLat) / 2
  minLng = Math.max(-180, Math.min(180 - lngSpan, cLng - lngSpan / 2))
  maxLat = Math.min(90, Math.max(-90 + latSpan, cLat + latSpan / 2))
  const step = [1, 2, 5, 10, 15, 20, 30, 45].find((s) => latSpan / s <= 6) ?? 45
  return { lng0: minLng, lat1: maxLat, lngSpan, latSpan, step }
}

const MAP_W = 720, MAP_H = 360

export function MapView({ schema, view, rows, onOpenRow }: ViewProps) {
  const { t } = useI18n()
  const [hot, setHot] = useState<string | null>(null)
  const placeProp = schema.properties.find((property) => property.id === view.mapPlacePropertyId && property.type === 'place') ?? schema.properties.find((property) => property.type === 'place')
  if (!placeProp) return <div className="vw-empty">
    <MapPin size={28} strokeWidth={1.5} className="vw-empty-icon" />
    <div className="vw-empty-title">{t('Nada para mostrar no mapa', 'Nothing to show on the map')}</div>
    <div className="vw-empty-text">{t('Adicione uma propriedade Lugar para usar o mapa local.', 'Add a Place property to use the local map.')}</div>
  </div>
  const points: MapPoint[] = rows.flatMap((row) => { const value = getValue(row, placeProp); return isPlace(value) ? [{ row, value }] : [] })
  const missing = rows.length - points.length
  const frame = mapFrame(points)
  const px = (lng: number) => (lng - frame.lng0) / frame.lngSpan * MAP_W
  const py = (lat: number) => (frame.lat1 - lat) / frame.latSpan * MAP_H
  // Pontos no mesmo lugar viram um alfinete com contagem.
  const clusters = new Map<string, MapPoint[]>()
  for (const point of points) {
    const key = `${point.value.lat.toFixed(2)},${point.value.lng.toFixed(2)}`
    clusters.set(key, [...(clusters.get(key) ?? []), point])
  }
  const gridLng: number[] = [], gridLat: number[] = []
  for (let v = Math.ceil(frame.lng0 / frame.step) * frame.step; v <= frame.lng0 + frame.lngSpan; v += frame.step) gridLng.push(v)
  for (let v = Math.ceil((frame.lat1 - frame.latSpan) / frame.step) * frame.step; v <= frame.lat1; v += frame.step) gridLat.push(v)
  const deg = (v: number, pos: string, neg: string) => v === 0 ? '0°' : `${Math.abs(v)}°${v > 0 ? pos : neg}`

  return <div className="db-extra-map">
    <aside className="db-extra-map-list" aria-label={t('Locais', 'Places')}>
      <div className="db-extra-map-list-head">{points.length} {points.length === 1 ? t('local', 'place') : t('locais', 'places')}</div>
      {points.map(({ row, value }) => <button type="button" key={row.id} className={hot === row.id ? 'is-hot' : ''} onClick={() => onOpenRow(row.id)} onMouseEnter={() => setHot(row.id)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(row.id)} onBlur={() => setHot(null)}>
        <span className="db-extra-map-list-title">{row.icon && <PageIcon value={row.icon} />}{row.title || t('Sem título', 'Untitled')}</span>
        <span className="db-extra-map-list-place"><MapPin size={12} strokeWidth={1.75} />{value.label || `${value.lat.toFixed(2)}, ${value.lng.toFixed(2)}`}</span>
      </button>)}
      {!points.length && <div className="db-extra-map-list-empty">{t('Nenhuma página tem um lugar definido.', 'No page has a place set.')}</div>}
    </aside>
    <div className="db-extra-map-canvas">
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label={t('Mapa com pontos de localização', 'Map with location points')}>
        <rect className="db-extra-map-bg" width={MAP_W} height={MAP_H} />
        {gridLng.map((lng) => <g key={`x${lng}`}><line className={lng === 0 ? 'db-extra-map-axis' : 'db-extra-map-grid'} x1={px(lng)} x2={px(lng)} y1={0} y2={MAP_H} /><text className="db-extra-map-tick" x={px(lng) + 4} y={MAP_H - 6}>{deg(lng, 'L', 'O')}</text></g>)}
        {gridLat.map((lat) => <g key={`y${lat}`}><line className={lat === 0 ? 'db-extra-map-axis' : 'db-extra-map-grid'} x1={0} x2={MAP_W} y1={py(lat)} y2={py(lat)} /><text className="db-extra-map-tick" x={6} y={py(lat) - 4}>{deg(lat, 'N', 'S')}</text></g>)}
        {[...clusters.values()].map((group) => {
          const { value } = group[0]
          const x = px(value.lng), y = py(value.lat)
          const isHot = group.some((p) => p.row.id === hot)
          const open = () => onOpenRow(group[0].row.id)
          const names = group.map((p) => p.row.title || t('Sem título', 'Untitled')).join(', ')
          return <g key={group[0].row.id} className={`db-extra-map-pin${isHot ? ' is-hot' : ''}`} tabIndex={0} role="button" aria-label={`${names}: ${value.label}`} onClick={open} onKeyDown={activate(open)} onMouseEnter={() => setHot(group[0].row.id)} onMouseLeave={() => setHot(null)}>
            <title>{`${value.label} — ${names}`}</title>
            <ellipse className="db-extra-map-pin-shadow" cx={x} cy={y} rx={5} ry={2} />
            <path d={`M${x} ${y}C${x - 2.5} ${y - 6} ${x - 9} ${y - 9.5} ${x - 9} ${y - 16}A9 9 0 1 1 ${x + 9} ${y - 16}C${x + 9} ${y - 9.5} ${x + 2.5} ${y - 6} ${x} ${y}Z`} />
            {group.length > 1 ? <text x={x} y={y - 12} textAnchor="middle">{group.length}</text> : <circle cx={x} cy={y - 16} r={3.2} />}
          </g>
        })}
      </svg>
      {!points.length && <div className="db-extra-map-overlay">{t('Defina a propriedade “{name}” nas páginas para vê-las aqui.', 'Set the “{name}” property on pages to see them here.', { name: placeProp.name })}</div>}
      <div className="db-extra-map-caption">{t('Mapa esquemático local, sem mapas externos', 'Local schematic map without external tiles')}{missing > 0 && <> · {missing} {missing === 1 ? t('página sem lugar', 'page without a place') : t('páginas sem lugar', 'pages without a place')}</>}</div>
    </div>
  </div>
}

// ---------- Painel ----------

export function DashboardView({ schema, view, rows, onOpenRow }: ViewProps) {
  const { locale, t } = useI18n()
  const firstNumber = schema.properties.find((property) => property.type === 'number')
  const firstGroup = schema.properties.find((property) => property.type === 'status' || property.type === 'select')
  const widgets = view.dashboardWidgets?.length ? view.dashboardWidgets : [
    { id: 'count', kind: 'number' as const, title: t('Páginas', 'Pages') },
    ...(firstNumber ? [{ id: 'sum', kind: 'number' as const, title: firstNumber.name, propertyId: firstNumber.id }] : []),
    ...(firstGroup ? [{ id: 'groups', kind: 'chart' as const, title: firstGroup.name, propertyId: firstGroup.id }] : []),
    { id: 'recent', kind: 'list' as const, title: t('Editadas recentemente', 'Recently edited') },
  ]
  const format = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 2 })
  const rowButton = (row: Page, meta?: ReactNode) => <button type="button" key={row.id} onClick={() => onOpenRow(row.id)}>
    <span className="db-extra-dashboard-row-title">{row.icon && <RowIcon page={row} />}<RowTitle page={row} /></span>{meta && <small>{meta}</small>}
  </button>
  const empty = <div className="db-extra-dashboard-empty">{t('Nenhuma página', 'No pages')}</div>
  return <div className="db-extra-dashboard">{widgets.map((widget) => {
    const property = schema.properties.find((candidate) => candidate.id === widget.propertyId)
    const numbers = property ? rows.map((row) => getValue(row, property)).filter((value): value is number => typeof value === 'number' && Number.isFinite(value)) : []
    let icon: ReactNode, content: ReactNode
    if (widget.kind === 'number') {
      icon = <Hash size={14} strokeWidth={1.75} />
      const isSum = property && ['number', 'formula', 'rollup'].includes(property.type)
      content = <><strong className="db-extra-dashboard-number">{format(isSum ? numbers.reduce((sum, value) => sum + value, 0) : rows.length)}</strong><span className="db-extra-dashboard-caption">{isSum ? t('Soma', 'Sum') : t('Contagem', 'Count')}</span></>
    } else if (widget.kind === 'chart') {
      icon = <SquareKanban size={14} strokeWidth={1.75} />
      const numeric = property && ['number', 'formula', 'rollup'].includes(property.type)
      const bars = numeric
        ? rows.map((row) => ({ key: row.id, label: row.title || t('Sem título', 'Untitled'), value: Number(getValue(row, property!)) || 0, color: 'blue' as const, empty: false, open: () => onOpenRow(row.id) })).sort((a, b) => b.value - a.value).slice(0, 8)
        : chartGroups(rows, schema, { ...view, chartGroupBy: property?.id, chartAggregation: 'count' }).map((group) => ({ ...group, open: group.rows.length === 1 ? () => onOpenRow(group.rows[0].id) : undefined }))
      const max = Math.max(1, ...bars.map((bar) => Math.abs(bar.value)))
      content = bars.length ? <div className="db-extra-dashboard-bars">{bars.map((bar) => <button type="button" key={bar.key} disabled={!bar.open} onClick={bar.open}>
        <span className="db-extra-dashboard-bar-label">{bar.label}</span>
        <span className="db-extra-dashboard-bar-track"><span style={{ width: `${Math.max(2, Math.abs(bar.value) / max * 100)}%`, background: bar.empty ? 'color-mix(in srgb, var(--opt-gray-dot) 50%, transparent)' : `var(--opt-${!bar.color || bar.color === 'default' ? 'gray' : bar.color}-dot)` }} /></span>
        <span className="db-extra-dashboard-bar-value">{format(bar.value)}</span>
      </button>)}</div> : empty
    } else if (widget.kind === 'calendar') {
      icon = <CalendarDays size={14} strokeWidth={1.75} />
      const dated = property ? rows.flatMap((row) => { const value = getValue(row, property); return isDateValue(value) ? [{ row, value }] : [] }).sort((a, b) => a.value.start.localeCompare(b.value.start)).slice(0, 8) : []
      content = dated.length ? <div className="db-extra-dashboard-list">{dated.map(({ row, value }) => rowButton(row, valueToText(value as DateValue, property!)))}</div> : empty
    } else {
      icon = <List size={14} strokeWidth={1.75} />
      const recent = [...rows].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6)
      content = recent.length ? <div className="db-extra-dashboard-list">{recent.map((row) => rowButton(row, new Date(row.updatedAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' })))}</div> : empty
    }
    return <section key={widget.id} className={`db-extra-dashboard-widget is-${widget.kind}`}><h3>{icon}{widget.title}</h3>{content}</section>
  })}{!widgets.length && <div className="vw-empty"><LayoutDashboard size={28} strokeWidth={1.5} className="vw-empty-icon" /><div className="vw-empty-title">{t('Painel vazio', 'Empty dashboard')}</div></div>}</div>
}
