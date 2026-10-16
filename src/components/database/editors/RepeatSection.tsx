// Seção "Repetir" e "Lembrete" do editor de data: presets, regra personalizada, fim, ação ao concluir.
import { useState } from 'react'
import type { DateValue, Property } from '../../../types'
import type { DateRecurrence } from '../../../database-models'
import { actions, getState } from '../../../store'
import { getLocale, t } from '../../../i18n'
import {
  applyPreset, completionSummary, describeRecurrence, doneProperty, isLastWeekdayOfMonth, patchRecurrence, presetOf,
  recurrenceRule, REMINDER_OFFSETS, weekdayOf, weekdayOrdinal, type RepeatPreset,
} from '../../../recurrence'
import { Select } from '../../ui/Select'

const WEEKDAY_SHORT_PT = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const WEEKDAY_SHORT_EN = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function weekdayName(day: number) { return new Date(2026, 5, 7 + day).toLocaleDateString(getLocale(), { weekday: 'long' }) }

function databaseOf(property: Property) {
  return Object.values(getState().pages).find((page) => page.database?.properties.some((candidate) => candidate.id === property.id))
}

function presetLabel(preset: RepeatPreset, value: DateValue): string {
  const day = Number(value.start.slice(8, 10))
  const weekday = weekdayName(weekdayOf(value.start))
  switch (preset) {
    case 'none': return t('Não repetir', 'Does not repeat')
    case 'daily': return t('Todo dia', 'Every day')
    case 'weekdays': return t('Dias úteis (seg–sex)', 'Weekdays (Mon–Fri)')
    case 'weekly': return t('Toda semana: {day}', 'Weekly on {day}', { day: weekday })
    case 'monthly': return t('Todo mês no dia {day}', 'Monthly on day {day}', { day })
    case 'monthlyWeekday': return describeRecurrence(applyPreset(value, 'monthlyWeekday'), getLocale())
    case 'yearly': return describeRecurrence(applyPreset(value, 'yearly'), getLocale())
    default: return t('Personalizado…', 'Custom…')
  }
}

export function reminderLabel(minutes: number): string {
  switch (minutes) {
    case 0: return t('No horário', 'At time of event')
    case 5: return t('5 minutos antes', '5 minutes before')
    case 15: return t('15 minutos antes', '15 minutes before')
    case 30: return t('30 minutos antes', '30 minutes before')
    case 60: return t('1 hora antes', '1 hour before')
    default: return t('1 dia antes', '1 day before')
  }
}

export function RepeatSection({ property, value, onChange }: { property: Property; value: DateValue | null; onChange: (value: DateValue) => void }) {
  const [forceCustom, setForceCustom] = useState(false)
  if (!value) return null
  const preset = presetOf(value)
  const rule = recurrenceRule(value)
  const raw: DateRecurrence = value.recurrence ?? {}
  const patch = (next: Partial<DateRecurrence>) => onChange(patchRecurrence(value, next))
  const database = databaseOf(property)
  const schemaProperty = database?.database?.properties.find((candidate) => candidate.id === property.id) ?? property
  const doneCandidates = database?.database?.properties.filter((candidate) => candidate.type === 'status' || candidate.type === 'checkbox') ?? []
  const done = database?.database ? doneProperty(database.database, schemaProperty) : null
  const setPropertyConfig = (config: Partial<Property>) => {
    if (!database) return
    actions.updateSchema(database.id, (schema) => ({ ...schema, properties: schema.properties.map((candidate) => candidate.id === property.id ? { ...candidate, ...config } : candidate) }))
  }
  const endMode = raw.until ? 'until' : raw.count ? 'count' : 'never'
  const unitOptions: [NonNullable<DateValue['repeat']>, string][] = [['daily', t('dia(s)', 'day(s)')], ['weekly', t('semana(s)', 'week(s)')], ['monthly', t('mês(es)', 'month(s)')], ['yearly', t('ano(s)', 'year(s)')]]
  const history = completionSummary(value, getLocale())
  const showCustom = preset === 'custom' || (forceCustom && preset !== 'none')
  return (
    <div className="ed-repeat" aria-label={t('Repetição', 'Repeat')}>
      <label className="ed-date-zone">{t('Repetir', 'Repeat')}
        <Select className="dbv-input" value={showCustom ? 'custom' : preset} onChange={(event) => { const next = event.target.value as RepeatPreset; setForceCustom(next === 'custom'); onChange(applyPreset(value, next)) }}>
          {(['none', 'daily', 'weekdays', 'weekly', 'monthly', 'monthlyWeekday', 'yearly', 'custom'] as RepeatPreset[]).map((option) => <option key={option} value={option}>{presetLabel(option, value)}</option>)}
        </Select>
      </label>
      {showCustom && rule && (
        <div className="ed-repeat-custom">
          <div className="ed-repeat-line">
            <span>{t('A cada', 'Every')}</span>
            <input className="dbv-input ed-repeat-num" type="number" min={1} max={999} aria-label={t('Intervalo', 'Interval')} value={rule.interval}
              onChange={(event) => { const n = Math.max(1, Math.min(999, Math.floor(Number(event.target.value) || 1))); patch({ interval: n }) }} />
            <Select className="dbv-input" aria-label={t('Unidade', 'Unit')} value={rule.freq} onChange={(event) => onChange(patchRecurrence({ ...value, repeat: event.target.value as DateValue['repeat'] }, { weekdays: undefined, monthly: undefined }))}>
              {unitOptions.map(([freq, label]) => <option key={freq} value={freq}>{label}</option>)}
            </Select>
          </div>
          {rule.freq === 'weekly' && (
            <div className="ed-repeat-days" role="group" aria-label={t('Dias da semana', 'Days of the week')}>
              {(getLocale() === 'en-US' ? WEEKDAY_SHORT_EN : WEEKDAY_SHORT_PT).map((letter, day) => {
                const on = rule.weekdays!.includes(day)
                return <button key={day} type="button" className={`ed-repeat-day${on ? ' is-on' : ''}`} aria-pressed={on} title={weekdayName(day)}
                  onClick={() => { const next = on ? rule.weekdays!.filter((d) => d !== day) : [...rule.weekdays!, day]; if (next.length) patch({ weekdays: next.sort((a, b) => a - b) }) }}>{letter}</button>
              })}
            </div>
          )}
          {rule.freq === 'monthly' && (
            <Select className="dbv-input" aria-label={t('Dia do mês', 'Day of month')} value={rule.monthly} onChange={(event) => patch({ monthly: event.target.value as DateRecurrence['monthly'] })}>
              <option value="day">{describeRecurrence({ ...value, repeat: 'monthly', recurrence: { anchor: rule.anchor } }, getLocale())}</option>
              {weekdayOrdinal(rule.anchor) !== -1 && <option value="weekday">{describeRecurrence({ ...value, repeat: 'monthly', recurrence: { anchor: rule.anchor, monthly: 'weekday' } }, getLocale())}</option>}
              {isLastWeekdayOfMonth(rule.anchor) && <option value="lastWeekday">{describeRecurrence({ ...value, repeat: 'monthly', recurrence: { anchor: rule.anchor, monthly: 'lastWeekday' } }, getLocale())}</option>}
            </Select>
          )}
          <div className="ed-repeat-line">
            <span>{t('Termina', 'Ends')}</span>
            <Select className="dbv-input" aria-label={t('Término da repetição', 'Repeat ends')} value={endMode} onChange={(event) => {
              const mode = event.target.value
              if (mode === 'never') patch({ until: undefined, count: undefined })
              else if (mode === 'until') { const date = new Date(value.start + 'T00:00:00'); date.setMonth(date.getMonth() + 3); patch({ count: undefined, until: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }) }
              else patch({ until: undefined, count: 10 })
            }}>
              <option value="never">{t('Nunca', 'Never')}</option>
              <option value="until">{t('Em uma data', 'On a date')}</option>
              <option value="count">{t('Após N vezes', 'After N times')}</option>
            </Select>
          </div>
          {endMode === 'until' && <input className="dbv-input" type="date" aria-label={t('Repetir até', 'Repeat until')} min={value.start} value={raw.until} onChange={(event) => { if (event.target.value && event.target.value >= value.start) patch({ until: event.target.value }) }} />}
          {endMode === 'count' && <div className="ed-repeat-line"><input className="dbv-input ed-repeat-num" type="number" min={1} max={9999} aria-label={t('Número de ocorrências', 'Number of occurrences')} value={raw.count} onChange={(event) => patch({ count: Math.max(1, Math.floor(Number(event.target.value) || 1)) })} /><span>{t('ocorrências', 'occurrences')}</span></div>}
        </div>
      )}
      {rule && <div className="ed-repeat-summary" role="status"><span aria-hidden="true">↻</span>{describeRecurrence(value, getLocale())}</div>}
      {rule && database && (
        <>
          <label className="ed-date-zone">{t('Ao concluir', 'When completed')}
            <Select className="dbv-input" value={schemaProperty.recurrenceOnComplete ?? 'advance'} onChange={(event) => setPropertyConfig({ recurrenceOnComplete: event.target.value as Property['recurrenceOnComplete'] })}>
              <option value="advance">{t('Mover data para a próxima', 'Move date to next occurrence')}</option>
              <option value="copy">{t('Criar nova cópia', 'Create a new copy')}</option>
            </Select>
          </label>
          <label className="ed-date-zone">{t('Concluída quando', 'Completed when')}
            <Select className="dbv-input" value={done?.id ?? 'none'} onChange={(event) => setPropertyConfig({ recurrenceDoneProperty: event.target.value })}>
              {doneCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.type === 'checkbox' ? t('{name} marcado', '{name} checked', { name: candidate.name }) : t('{name} em “Concluído”', '{name} is “Complete”', { name: candidate.name })}</option>)}
              <option value="none">{t('Nunca (só repetir no calendário)', 'Never (calendar repeat only)')}</option>
            </Select>
          </label>
          {!done && <small className="ed-date-hint">{t('Adicione uma propriedade Status ou Caixa de seleção para concluir e avançar a tarefa.', 'Add a Status or Checkbox property to complete and advance the task.')}</small>}
        </>
      )}
      {history && <small className="ed-date-hint">{history}</small>}
      <label className="ed-date-zone">{t('Lembrete', 'Remind')}
        <Select className="dbv-input" value={value.reminder ?? ''} onChange={(event) => { const next = { ...value }; if (event.target.value === '') delete next.reminder; else next.reminder = Number(event.target.value); onChange(next) }}>
          <option value="">{t('Nenhum', 'None')}</option>
          {REMINDER_OFFSETS.map((minutes) => <option key={minutes} value={minutes}>{reminderLabel(minutes)}</option>)}
        </Select>
      </label>
      {value.reminder !== undefined && !value.startTime && <small className="ed-date-hint">{t('Sem hora definida, o lembrete usa 09:00.', 'Without a time, the reminder uses 9:00 AM.')}</small>}
      {value.reminder !== undefined && rule && <small className="ed-date-hint">{t('O lembrete se repete a cada ocorrência.', 'The reminder repeats for each occurrence.')}</small>}
    </div>
  )
}
