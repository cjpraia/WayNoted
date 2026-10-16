// Automações de banco (A4) — parte pura: gatilhos, condições, prévia do "Testar", "data chegou" e registro de execuções.
// Sem store e sem React. A execução (escritas pelas guardas do store) fica em src/store.ts.
import { addDays, validISODate } from '../../../electron/recurrence.mjs'
import type { AutomationAction, AutomationCondition, AutomationRunLog, AutomationTrigger, ButtonAction, DatabaseAutomation } from '../../database-models.ts'
import type { DatabaseSchema, Page, Property, PropValue } from '../../types.ts'
import { validActions } from './engines.ts'

export const MAX_AUTOMATION_DEPTH = 3
export const AUTOMATION_LOG_LIMIT = 50
export const MAX_FIRED = 5000

export type TriggerEvent =
  | { kind: 'propertyChange'; propertyId: string }
  | { kind: 'rowCreated' }
  | { kind: 'typeAdded'; typeId: string }
  | { kind: 'taskCompleted' }

/** Regras ligadas que respondem a este evento (gatilhos "agendado" e "data chegou" rodam no relógio, não aqui). */
export function automationsFor(schema: DatabaseSchema | undefined, event: TriggerEvent): DatabaseAutomation[] {
  return (schema?.automations ?? []).filter(automation => {
    if (!automation.enabled || automation.trigger.kind !== event.kind) return false
    const trigger = automation.trigger
    if (trigger.kind === 'propertyChange') return event.kind === 'propertyChange' && trigger.propertyId === event.propertyId
    if (trigger.kind === 'typeAdded') return event.kind === 'typeAdded' && (!trigger.typeId || trigger.typeId === event.typeId)
    return true
  })
}

// ---------- Condições ----------

const isDateValue = (value: unknown): value is { start: string } => !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { start?: unknown }).start === 'string'
const norm = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase()

function valueOf(row: Page, propertyId: string): PropValue | undefined {
  return propertyId === '@title' ? row.title : row.props?.[propertyId]
}

const isEmpty = (value: unknown) => value === undefined || value === null || value === '' || value === false || (Array.isArray(value) && value.length === 0)

export function conditionPasses(condition: AutomationCondition, row: Page): boolean {
  const value = valueOf(row, condition.propertyId)
  switch (condition.op) {
    case 'empty': return isEmpty(value)
    case 'notEmpty': return !isEmpty(value)
    case 'equals': case 'notEquals': {
      const wanted = condition.value
      const same = Array.isArray(value) ? value.length === 1 && value[0] === wanted
        : typeof value === 'boolean' ? value === (wanted === true || norm(wanted) === 'true')
        : typeof value === 'number' ? value === Number(wanted)
        : isDateValue(value) ? value.start === wanted
        : norm(value) === norm(wanted)
      return condition.op === 'equals' ? same : !same
    }
    case 'contains': {
      if (Array.isArray(value)) return value.includes(condition.value as never)
      return norm(value).includes(norm(condition.value)) && norm(condition.value) !== ''
    }
    default: return false
  }
}

export function conditionsPass(conditions: readonly AutomationCondition[] | undefined, row: Page): { pass: boolean; failed: AutomationCondition[] } {
  const failed = (conditions ?? []).filter(condition => !conditionPasses(condition, row))
  return { pass: failed.length === 0, failed }
}

// ---------- "Data chegou" ----------

export interface DateArrival { seeded: boolean; fire: string[]; fired: Record<string, string> }

/**
 * Linhas cuja data (mais o deslocamento) chegou e ainda não dispararam para essa data. Na primeira avaliação (sem `fired`)
 * só registra as que já chegaram, sem rodar nada: criar a regra não pode disparar o passado inteiro de uma vez.
 */
export function dateArrivals(schema: DatabaseSchema, rows: readonly Page[], automation: DatabaseAutomation, today: string): DateArrival | null {
  const trigger = automation.trigger
  if (trigger.kind !== 'dateArrived') return null
  const property = schema.properties.find(candidate => candidate.id === trigger.propertyId && candidate.type === 'date')
  if (!property) return null
  const offset = Number.isFinite(trigger.offsetDays) ? Math.trunc(trigger.offsetDays!) : 0
  const alive = new Set(rows.map(row => row.id))
  const fired: Record<string, string> = {}
  for (const [id, date] of Object.entries(automation.fired ?? {})) if (alive.has(id)) fired[id] = date
  const fire: string[] = []
  const seeding = automation.fired === undefined
  for (const row of rows) {
    const value = row.props?.[property.id]
    if (!isDateValue(value) || !validISODate(value.start)) continue
    if (addDays(value.start, offset) > today) continue
    if (fired[row.id] === value.start) continue
    fired[row.id] = value.start
    if (!seeding) fire.push(row.id)
  }
  const entries = Object.entries(fired)
  const trimmed = entries.length > MAX_FIRED ? Object.fromEntries(entries.slice(entries.length - MAX_FIRED)) : fired
  return { seeded: seeding, fire, fired: trimmed }
}

// ---------- Texto e prévia ----------

export interface DescribeContext {
  t: (pt: string, en: string, vars?: Record<string, string | number>) => string
  typeName(id: string): string | undefined
  pageTitle(id: string): string | undefined
}

export const fillTemplate = (text: string, row: Pick<Page, 'title'>) => text.replace(/\{(?:titulo|título|title)\}/gi, row.title || '')

function optionName(property: Property | undefined, value: unknown): string {
  if (!property) return String(value ?? '')
  if (Array.isArray(value)) return value.map(item => optionName(property, item)).join(', ')
  return property.options?.find(option => option.id === value)?.name ?? String(value ?? '')
}

export function describeCondition(schema: DatabaseSchema, condition: AutomationCondition, ctx: DescribeContext): string {
  const property = condition.propertyId === '@title' ? undefined : schema.properties.find(candidate => candidate.id === condition.propertyId)
  const name = condition.propertyId === '@title' ? ctx.t('Título', 'Title') : property?.name ?? ctx.t('(propriedade removida)', '(removed property)')
  const shown = optionName(property, condition.value)
  switch (condition.op) {
    case 'equals': return ctx.t('{name} é “{value}”', '{name} is “{value}”', { name, value: shown })
    case 'notEquals': return ctx.t('{name} não é “{value}”', '{name} is not “{value}”', { name, value: shown })
    case 'contains': return ctx.t('{name} contém “{value}”', '{name} contains “{value}”', { name, value: shown })
    case 'notEmpty': return ctx.t('{name} está preenchido', '{name} is filled in', { name })
    default: return ctx.t('{name} está vazio', '{name} is empty', { name })
  }
}

export function describeTrigger(schema: DatabaseSchema, trigger: AutomationTrigger, ctx: DescribeContext): string {
  const name = (id: string) => schema.properties.find(property => property.id === id)?.name ?? ctx.t('(propriedade removida)', '(removed property)')
  switch (trigger.kind) {
    case 'propertyChange': return ctx.t('Quando “{name}” mudar', 'When “{name}” changes', { name: name(trigger.propertyId) })
    case 'scheduled': return ctx.t('Em horário agendado ({every})', 'On a schedule ({every})', { every: trigger.every === 'daily' ? ctx.t('diário', 'daily') : trigger.every === 'weekly' ? ctx.t('semanal', 'weekly') : ctx.t('mensal', 'monthly') })
    case 'rowCreated': return ctx.t('Quando uma linha for criada', 'When a row is created')
    case 'typeAdded': return trigger.typeId ? ctx.t('Quando a tag/tipo “{name}” for adicionado', 'When the tag/type “{name}” is added', { name: ctx.typeName(trigger.typeId) ?? trigger.typeId }) : ctx.t('Quando qualquer tag/tipo for adicionado', 'When any tag/type is added')
    case 'taskCompleted': return ctx.t('Quando a tarefa for concluída', 'When the task is completed')
    default: return trigger.offsetDays
      ? ctx.t('{n} dia(s) {when} a data de “{name}”', '{n} day(s) {when} the date of “{name}”', { n: Math.abs(trigger.offsetDays), when: trigger.offsetDays < 0 ? ctx.t('antes de', 'before') : ctx.t('depois de', 'after'), name: name(trigger.propertyId) })
      : ctx.t('Quando a data de “{name}” chegar', 'When the date of “{name}” arrives', { name: name(trigger.propertyId) })
  }
}

export function describeAction(schema: DatabaseSchema, action: AutomationAction, row: Pick<Page, 'title'>, ctx: DescribeContext): string {
  switch (action.kind) {
    case 'setProperty': {
      const property = schema.properties.find(candidate => candidate.id === action.propertyId)
      return ctx.t('Definir “{name}” como “{value}”', 'Set “{name}” to “{value}”', { name: property?.name ?? '?', value: action.value === null ? ctx.t('vazio', 'empty') : typeof action.value === 'boolean' ? (action.value ? ctx.t('marcado', 'checked') : ctx.t('desmarcado', 'unchecked')) : optionName(property, action.value) })
    }
    case 'setTitle': return ctx.t('Mudar o título para “{value}”', 'Change the title to “{value}”', { value: fillTemplate(action.value, row) })
    case 'createRow': return ctx.t('Criar uma linha neste banco', 'Create a row in this database')
    case 'duplicateRow': return ctx.t('Duplicar a linha', 'Duplicate the row')
    case 'archiveRow': return ctx.t('Mover a linha para a lixeira', 'Move the row to the trash')
    case 'moveRow': return ctx.t('Mover a linha para o banco “{name}”', 'Move the row to the database “{name}”', { name: ctx.pageTitle(action.databaseId) ?? '?' })
    case 'createTask': return ctx.t('Criar a tarefa “{title}”{due} na linha', 'Create the task “{title}”{due} on the row', { title: fillTemplate(action.title, row), due: action.inDays === undefined ? '' : action.inDays === 0 ? ctx.t(' para hoje', ' for today') : ctx.t(' para daqui a {n} dia(s)', ' due in {n} day(s)', { n: action.inDays }) })
    case 'addType': return ctx.t('Adicionar a tag/tipo “{name}”', 'Add the tag/type “{name}”', { name: ctx.typeName(action.typeId) ?? '?' })
    default: return ctx.t('Notificar: “{message}”', 'Notify: “{message}”', { message: fillTemplate(action.message, row) })
  }
}

export interface AutomationPreview {
  trigger: string
  conditions: { text: string; pass: boolean }[]
  /** As condições valem para esta linha: a regra rodaria. */
  wouldRun: boolean
  steps: string[]
  /** Ações que seriam ignoradas por referirem algo que não existe mais. */
  ignored: number
}

/** O que a regra faria com esta linha agora. Não escreve nada. */
export function previewAutomation(schema: DatabaseSchema, automation: DatabaseAutomation, row: Page, ctx: DescribeContext): AutomationPreview {
  const conditions = (automation.conditions ?? []).map(condition => ({ text: describeCondition(schema, condition, ctx), pass: conditionPasses(condition, row) }))
  const buttonKinds = new Set(['setProperty', 'setTitle', 'createRow', 'duplicateRow', 'archiveRow'])
  const valid = new Set(validActions(schema, automation.actions.filter((action): action is ButtonAction => buttonKinds.has(action.kind))))
  const usable = automation.actions.filter(action => !buttonKinds.has(action.kind) || valid.has(action as ButtonAction))
  return { trigger: describeTrigger(schema, automation.trigger, ctx), conditions, wouldRun: conditions.every(entry => entry.pass), steps: usable.map(action => describeAction(schema, action, row, ctx)), ignored: automation.actions.length - usable.length }
}

// ---------- Registro ----------

export function appendLog(log: readonly AutomationRunLog[] | undefined, entry: AutomationRunLog): AutomationRunLog[] {
  return [entry, ...(log ?? [])].slice(0, AUTOMATION_LOG_LIMIT)
}
