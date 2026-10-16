// Editor de data: campos de início/término, mini calendário mensal próprio, intervalo e "Limpar".
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import type { DateValue, Property, PropValue } from '../../../types'
import { isDateValue, parseISODate, toISODate } from '../lib'
import { DbPopover, MenuItem, MenuSep, type DbAnchor } from '../ui/Popover'
import type { EditorCloseReason } from './PropertyEditor'
import { getLocale, t } from '../../../i18n'
import { convertDateValueZone, validDateValueWallTimes, validTimeZone } from '../timeZones'
import { RepeatSection } from './RepeatSection'
import { describeNaturalDate, parseNaturalDate, toDateValue } from '../../../nlp/dates'

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

function fmtInput(iso: string | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return getLocale() === 'en-US' ? `${m}/${d}/${y}` : `${d}/${m}/${y}`
}

function parseInput(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (!m) return null
  let y = Number(m[3])
  if (y < 100) y += 2000
  const month = Number(getLocale() === 'en-US' ? m[1] : m[2])
  const day = Number(getLocale() === 'en-US' ? m[2] : m[1])
  const d = new Date(y, month - 1, day)
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null
  return toISODate(d)
}

export function MiniCalendar(props: {
  month: Date
  onMonth: (d: Date) => void
  start?: string
  end?: string
  onPick: (iso: string) => void
}) {
  const { month, start, end } = props
  const today = toISODate(new Date())
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const gridStart = new Date(first)
  gridStart.setDate(1 - first.getDay())
  const days: Date[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    days.push(d)
  }
  const title = month.toLocaleDateString(getLocale(), { month: 'long', year: 'numeric' })
  const shift = (n: number) => props.onMonth(new Date(month.getFullYear(), month.getMonth() + n, 1))

  return (
    <div className="ed-cal">
      <div className="ed-cal-head">
        <span className="ed-cal-title">{title.charAt(0).toUpperCase() + title.slice(1)}</span>
        <button type="button" className="ed-cal-today" onClick={() => props.onMonth(new Date())}>
          {t('Hoje', 'Today')}
        </button>
        <button type="button" className="dbv-icon-btn" aria-label={t('Mês anterior', 'Previous month')} onClick={() => shift(-1)}>
          <ChevronLeft size={16} />
        </button>
        <button type="button" className="dbv-icon-btn" aria-label={t('Próximo mês', 'Next month')} onClick={() => shift(1)}>
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="ed-cal-grid" role="grid">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="ed-cal-wd" title={new Date(2026, 5, 7 + i).toLocaleDateString(getLocale(), { weekday: 'long' })}>
            {getLocale() === 'en-US' ? ['S', 'M', 'T', 'W', 'T', 'F', 'S'][i] : w}
          </span>
        ))}
        {days.map((d) => {
          const iso = toISODate(d)
          const out = d.getMonth() !== month.getMonth()
          const isStart = iso === start
          const isEnd = !!end && iso === end
          const inRange = !!start && !!end && iso > start && iso < end
          const cls = [
            'ed-cal-day',
            out && 'ed-cal-day--out',
            iso === today && 'ed-cal-day--today',
            (isStart || isEnd) && 'ed-cal-day--sel',
            inRange && 'ed-cal-day--range',
            end && end !== start && isStart && 'ed-cal-day--rs',
            end && end !== start && isEnd && 'ed-cal-day--re',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <button key={iso} type="button" className={cls} onClick={() => props.onPick(iso)}>
              <span>{d.getDate()}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function DateEditor(props: {
  property: Property
  value: PropValue
  anchor: DbAnchor
  onChange: (value: PropValue) => void
  onClose: (reason: EditorCloseReason) => void
}) {
  const value: DateValue | null = isDateValue(props.value) ? props.value : null
  const [range, setRange] = useState(!!value?.end)
  const [field, setField] = useState<'start' | 'end'>('start')
  const [month, setMonth] = useState(() => (value ? parseISODate(value.start) : new Date()))
  const [startText, setStartText] = useState(fmtInput(value?.start))
  const [endText, setEndText] = useState(fmtInput(value?.end))
  const [timeZone, setTimeZone] = useState(value?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [zoneError, setZoneError] = useState('')
  // Como no Export Bundle: hora e opções avançadas (fuso, repetição) ficam recolhidas até serem pedidas.
  const [includeTime, setIncludeTime] = useState(!!(value?.startTime || value?.endTime))
  const [showMore, setShowMore] = useState(false)

  useEffect(() => {
    setStartText(fmtInput(value?.start))
    setEndText(fmtInput(value?.end))
  }, [value?.start, value?.end])

  const emit = (start: string | undefined, end: string | undefined, isRange = range) => {
    if (!start) return props.onChange(null)
    let next: DateValue
    // Mudar o início à mão reinicia a série nessa data (a âncora antiga deixaria de valer).
    const base: DateValue | null = value && value.recurrence?.anchor && start !== value.start ? { ...value, recurrence: { ...value.recurrence, anchor: undefined } } : value
    if (isRange && end) {
      if (end < start) [start, end] = [end, start]
      next = { ...base, start, end }
    } else next = { ...base, start, end: undefined, endTime: undefined }
    if (!validDateValueWallTimes(next, Intl.DateTimeFormat().resolvedOptions().timeZone)) {
      setZoneError(t('Horário inexistente neste fuso.', 'Time does not exist in this time zone.'))
      return
    }
    setZoneError('')
    props.onChange(next)
  }
  const changeTime = (which: 'startTime' | 'endTime', time: string) => {
    if (!value) return
    const next = { ...value, [which]: time || undefined }
    if (!validDateValueWallTimes(next, Intl.DateTimeFormat().resolvedOptions().timeZone)) {
      setZoneError(t('Horário inexistente neste fuso.', 'Time does not exist in this time zone.'))
      return
    }
    setZoneError('')
    props.onChange(next)
  }

  const pick = (iso: string) => {
    if (!range) {
      emit(iso, undefined)
      return
    }
    if (field === 'start' || !value) {
      emit(iso, value?.end ?? iso)
      setField('end')
    } else {
      emit(value.start, iso)
      setField('start')
    }
  }

  const toggleRange = () => {
    const next = !range
    setRange(next)
    if (value) emit(value.start, next ? value.end ?? value.start : undefined, next)
    setField(next && value ? 'end' : 'start')
  }

  // Texto livre ("amanhã às 9h", "todo dia 5", "fim do mês"): src/nlp/dates.ts.
  const naturalFor = (text: string) => text.trim() && !parseInput(text) ? parseNaturalDate(text, { locale: getLocale() }) : null
  const natural = naturalFor(field === 'end' ? endText : startText)
  const commitNatural = (which: 'start' | 'end', text: string): boolean => {
    const parsed = naturalFor(text)
    if (!parsed) return false
    if (which === 'end') { if (value) emit(value.start, parsed.start); return true }
    const next = toDateValue(parsed, value)
    if (!next.end && range && value?.end && value.end >= next.start) next.end = value.end
    if (next.end) setRange(true)
    if (!validDateValueWallTimes(next, Intl.DateTimeFormat().resolvedOptions().timeZone)) { setZoneError(t('Horário inexistente neste fuso.', 'Time does not exist in this time zone.')); return true }
    setZoneError('')
    if (next.startTime) setIncludeTime(true)
    setMonth(parseISODate(next.start))
    props.onChange(next)
    return true
  }
  const commitText = (which: 'start' | 'end', text: string) => {
    if (commitNatural(which, text)) return
    const iso = parseInput(text)
    if (!text.trim()) {
      if (which === 'start') emit(undefined, undefined)
      else emit(value?.start, undefined)
      return
    }
    if (!iso) {
      // Inválido: volta ao valor atual.
      setStartText(fmtInput(value?.start))
      setEndText(fmtInput(value?.end))
      return
    }
    setMonth(parseISODate(iso))
    if (which === 'start') emit(iso, value?.end)
    else emit(value?.start ?? iso, iso)
  }

  const inputProps = (which: 'start' | 'end') => ({
    className: `dbv-input ed-date-input${range && field === which ? ' ed-date-input--active' : ''}`,
    placeholder: t('dd/mm/aaaa ou “amanhã às 9h”', 'mm/dd/yyyy or “tomorrow 9am”'),
    value: which === 'start' ? startText : endText,
    onFocus: () => setField(which),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => (which === 'start' ? setStartText : setEndText)(e.target.value),
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => commitText(which, e.target.value),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commitText(which, e.currentTarget.value)
      } else if (e.key === 'Tab' && !range) {
        e.preventDefault()
        props.onClose(e.shiftKey ? 'shiftTab' : 'tab')
      }
    },
  })
  const commitTimeZone = () => {
    const nextZone = timeZone.trim()
    if (!validTimeZone(nextZone)) { setZoneError(t('Fuso horário inválido.', 'Invalid time zone.')); return }
    if (!value) { setZoneError(''); return }
    const converted = convertDateValueZone(value, value.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, nextZone)
    if (!converted) { setZoneError(t('Horário inexistente neste fuso.', 'Time does not exist in this time zone.')); return }
    setZoneError('')
    props.onChange(converted)
  }

  return (
    <DbPopover anchor={props.anchor} onClose={() => props.onClose('outside')} className="ed-date-pop" label={props.property.name}>
      <div className="ed-date">
        {/* Como no Export Bundle: data e hora lado a lado no mesmo campo. */}
        <div className="ed-date-fields">
          <div className="ed-date-row">
            <input {...inputProps('start')} aria-label={range ? t('Início', 'Start') : t('Data', 'Date')} placeholder={range ? t('Início', 'Start') : undefined} />
            {includeTime && <input type="time" className="dbv-input ed-date-time" aria-label={t('Hora inicial', 'Start time')} value={value?.startTime ?? ''} disabled={!value} onChange={(event) => changeTime('startTime', event.target.value)} />}
          </div>
          {natural && <div className="ed-date-natural" role="status">{t('Entendi:', 'Got it:')} <mark>{describeNaturalDate(natural, getLocale())}</mark> <kbd>↵</kbd></div>}
          {range && (
            <div className="ed-date-row">
              <input {...inputProps('end')} aria-label={t('Prazo', 'Due')} placeholder={t('Prazo', 'Due')} />
              {includeTime && <input type="time" className="dbv-input ed-date-time" aria-label={t('Hora final', 'End time')} value={value?.endTime ?? ''} disabled={!value} onChange={(event) => changeTime('endTime', event.target.value)} />}
            </div>
          )}
        </div>
        <MiniCalendar month={month} onMonth={setMonth} start={value?.start} end={range ? value?.end : undefined} onPick={pick} />
        <MenuSep />
        <div className="dbv-menu ed-date-menu">
          <button type="button" className="dbv-menu-item" role="switch" aria-checked={range} onClick={toggleRange}>
            <span className="dbv-menu-label">{t('Início e prazo (data de término)', 'Start and due (end date)')}</span>
            <span className={`np-switch-track${range ? ' is-on' : ''}`} />
          </button>
          <button type="button" className="dbv-menu-item" role="switch" aria-checked={includeTime} disabled={!value} onClick={() => {
            const next = !includeTime
            setIncludeTime(next)
            if (!next && value && (value.startTime || value.endTime)) props.onChange({ ...value, startTime: undefined, endTime: undefined })
          }}>
            <span className="dbv-menu-label">{t('Incluir hora', 'Include time')}</span>
            <span className={`np-switch-track${includeTime ? ' is-on' : ''}`} />
          </button>
          <button type="button" className="dbv-menu-item" aria-expanded={showMore || !!zoneError} onClick={() => setShowMore(!showMore)}>
            <span className="dbv-menu-label">{t('Fuso horário', 'Time zone')}</span>
            <ChevronRight size={14} className={`ed-date-more-caret${showMore || zoneError ? ' ed-date-more-caret--open' : ''}`} />
          </button>
          {(showMore || !!zoneError) && <>
            <label className="ed-date-zone">{t('Fuso horário', 'Time zone')}
              <input className="dbv-input" list="db-time-zones" value={timeZone} onChange={(event) => { setTimeZone(event.target.value); setZoneError('') }} onBlur={commitTimeZone} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitTimeZone() } }} />
            </label>
            <small className="ed-date-hint">{t('Ao mudar o fuso, a hora representa o mesmo instante.', 'Changing the time zone preserves the instant.')}</small>
            <datalist id="db-time-zones"><option value="UTC" /><option value="America/Sao_Paulo" /><option value="America/New_York" /><option value="Europe/London" /><option value="Asia/Tokyo" /></datalist>
          </>}
          {zoneError && <div className="db-formula-error" role="alert">{zoneError}</div>}
          {value && <><MenuSep /><RepeatSection property={props.property} value={value} onChange={props.onChange} /></>}
          <MenuSep />
          <MenuItem icon={<Trash2 size={16} />} label={t('Limpar', 'Clear')} onClick={() => emit(undefined, undefined)} />
        </div>
      </div>
    </DbPopover>
  )
}
