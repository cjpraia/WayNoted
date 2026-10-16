// Cria as tarefas confirmadas na prévia (B3): itens de checklist numa nota/página ou linhas de um banco de tarefas.
// Escreve só por caminhos já protegidos (saveDoc do processo principal, actions.createRow) e recusa destinos bloqueados.
import { actions, api, getState } from '../store.ts'
import { translate } from '../localization.ts'
import { doneProperty } from '../../electron/recurrence.mjs'
import { parsedInstant } from '../nlp/dates.ts'
import { ensureDailyNote } from '../daily/dailyNotes.ts'
import { protectedAncestor } from '../security/pageLock.ts'
import { localDay } from '../daily/dailyCore.ts'
import type { DatabaseSchema, DateValue, Page, PropValue } from '../types.ts'
import type { VoicePriority, VoiceTask } from './taskExtract.ts'

const message = (pt: string, en: string) => translate(getState().settings.locale, pt, en)

export type VoiceDestination = { kind: 'daily' } | { kind: 'page'; pageId: string } | { kind: 'database'; databaseId: string }

export const PRIORITY_PREFIX: Record<VoicePriority, string> = { high: '!! ', normal: '', low: '↓ ' }

type Block = { id: string; type: string; props: Record<string, unknown>; content: unknown[]; children: unknown[] }

/** Bloco de checklist com a menção de data (quando há) — mesmo formato do editor. */
export function checklistBlock(task: Pick<VoiceTask, 'title' | 'date' | 'time' | 'priority'>, pageId: string, makeId: () => string = () => crypto.randomUUID()): Block {
  const content: unknown[] = [{ type: 'text', text: PRIORITY_PREFIX[task.priority] + task.title + (task.date ? ' ' : ''), styles: {} }]
  if (task.date) {
    const instant = parsedInstant({ start: task.date, time: task.time ?? undefined })
    if (instant !== null) content.push({ type: 'dateMention', props: { id: makeId(), date: new Date(instant).toISOString(), startDate: '', pageId, repeat: '', reminderId: '', time: task.time ?? '' } })
  }
  return { id: makeId(), type: 'checkListItem', props: { checked: false }, content, children: [] }
}

/** Destino válido para escrita: viva, sem lixeira, bloqueio ou senha. Devolve o motivo em texto quando não é. */
export function destinationProblem(pageId: string): string | null {
  const { pages } = getState()
  const page = pages[pageId]
  if (!page || page.trashed) return message('A página de destino não está disponível.', 'The destination page is unavailable.')
  if (page.locked) return message('A página de destino está bloqueada.', 'The destination page is locked.')
  if (protectedAncestor(pages, pageId)) return message('A página de destino está protegida por senha.', 'The destination page is password protected.')
  if (page.canvas || page.database) return message('Escolha uma página de texto como destino.', 'Choose a text page as the destination.')
  return null
}

/** Bancos que servem como lista de tarefas (têm data e propriedade de conclusão). */
export function taskDatabases(pages: Record<string, Page> = getState().pages): Page[] {
  return Object.values(pages).filter(page => page.database && !page.trashed && !page.locked && !page.database.linkedSourceId && !protectedAncestor(pages, page.id)
    && page.database.properties.some(property => property.type === 'date' && doneProperty(page.database as DatabaseSchema, property))).sort((a, b) => a.title.localeCompare(b.title))
}

const HIGH_NAMES = /alta|high|urgent|urgente|importante/i, LOW_NAMES = /baixa|low/i, NORMAL_NAMES = /m[eé]dia|normal|medium/i

/** Valores de propriedade de uma linha de banco para a tarefa (data e, se existir, prioridade). */
export function rowProps(schema: DatabaseSchema, task: VoiceTask): Record<string, PropValue> {
  const props: Record<string, PropValue> = {}
  const dateProperty = schema.properties.find(property => property.type === 'date' && doneProperty(schema, property))
  if (dateProperty && task.date) {
    const value: DateValue = { start: task.date, ...(task.time ? { startTime: task.time } : {}) }
    props[dateProperty.id] = value
  }
  const priority = schema.properties.find(property => (property.type === 'select' || property.type === 'status') && /prior/i.test(property.name))
  if (priority?.options) {
    const pattern = task.priority === 'high' ? HIGH_NAMES : task.priority === 'low' ? LOW_NAMES : NORMAL_NAMES
    const option = priority.options.find(item => pattern.test(item.name))
    if (option) props[priority.id] = option.id
  }
  return props
}

export interface CreateResult { created: number; pageId: string; kind: VoiceDestination['kind'] }

export async function createVoiceTasks(tasks: readonly VoiceTask[], destination: VoiceDestination, now = Date.now()): Promise<CreateResult> {
  const chosen = tasks.filter(task => task.include && task.title.trim())
  if (!chosen.length) throw new Error(message('Marque ao menos uma tarefa.', 'Select at least one task.'))
  if (destination.kind === 'database') {
    const database = getState().pages[destination.databaseId]
    if (!database?.database || database.trashed || database.locked || protectedAncestor(getState().pages, database.id)) throw new Error(message('O banco de destino não está disponível.', 'The destination database is unavailable.'))
    for (const task of chosen) actions.createRow(database.id, rowProps(database.database, task), { title: task.title })
    await actions.flushMeta()
    return { created: chosen.length, pageId: database.id, kind: 'database' }
  }
  const pageId = destination.kind === 'daily' ? await ensureDailyNote(localDay(now)) : destination.pageId
  const problem = destinationProblem(pageId)
  if (problem) throw new Error(problem)
  await actions.flushAll()
  const current = structuredClone(await api.loadDoc(pageId) ?? []) as unknown[]
  const next = [...current, ...chosen.map(task => checklistBlock(task, pageId))]
  await api.saveDoc(pageId, next, { checkpoint: true })
  await actions.reloadDocument(pageId)
  return { created: chosen.length, pageId, kind: destination.kind }
}
