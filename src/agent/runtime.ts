// Núcleo puro para a API local, a CLI e o MCP (processo principal / Node, sem store nem React):
// tarefas, consulta viva em texto, notas diárias e tipos. É empacotado em electron/gen/agent-runtime.mjs
// por build/build-agent-runtime.mjs (npm run build:agent) e carregado por electron/agent-runtime.cjs.
// Nada aqui lê disco ou rede: recebe páginas/blocos já filtrados (sem páginas protegidas nem privadas para IA).
import { bucketTasks, collectTasks, extractChecklist, type ChecklistEntry, type TaskBuckets, type TaskItem } from '../tasks/taskCore.ts'
import { createQueryCache, fieldValue, isQueryable, runQuery, type QueryEnv } from '../query/engine.ts'
import { parseQueryText } from '../query/text.ts'
import { setRegisteredTypes } from '../objecttypes/registry.ts'
import { valueText } from '../components/database/filterEngine.ts'
import { addDays, applyDailyTemplateFull, dailyBlocksText, dailyDatabaseSchema, dailyDateProperty, dailyIndex, dailyTitle, defaultDailyTemplate, isISODate, localDay, type DailyLocale } from '../daily/dailyCore.ts'
import type { Page, Property } from '../types.ts'
import type { ObjectType } from '../objecttypes/model.ts'

export { addDays, bucketTasks, collectTasks, dailyBlocksText, dailyDatabaseSchema, dailyDateProperty, dailyIndex, dailyTitle, extractChecklist, isISODate, localDay }
export type { ChecklistEntry, TaskBuckets, TaskItem }

const localeOf = (value: unknown): DailyLocale => value === 'en-US' ? 'en-US' : 'pt-BR'

export interface AgentTask { id: string; kind: 'checklist' | 'row'; pageId: string; blockId?: string; title: string; due: string | null; time?: string; repeat?: string; page: string; done?: boolean; inherited?: boolean }
const taskView = (item: TaskItem): AgentTask => ({
  id: item.key, kind: item.kind, pageId: item.pageId, ...(item.blockId ? { blockId: item.blockId } : {}), title: item.title, due: item.due,
  ...(item.time ? { time: item.time } : {}), ...(item.repeat ? { repeat: item.repeat } : {}), page: item.sourceTitle,
  ...(item.done ? { done: true } : {}), ...(item.inherited ? { inherited: true } : {}),
})

/** Tarefas por faixa: `today`, `overdue`, `upcoming`, `undated` ou `all`. */
export function listTasks(input: { pages: Record<string, Page>; checklists: ReadonlyMap<string, readonly ChecklistEntry[]>; locale?: string; today?: string; bucket?: string; databaseId?: string | null; includeDone?: boolean; limit?: number }): { bucket: string; today: string; total: number; tasks: AgentTask[] } {
  const today = input.today && isISODate(input.today) ? input.today : localDay()
  const items = collectTasks({ pages: input.pages, checklists: input.checklists, locale: input.locale, includeDone: !!input.includeDone, daily: { databaseId: input.databaseId ?? null, inherit: true } })
  const buckets = bucketTasks(items, today)
  const bucket = ['today', 'overdue', 'upcoming', 'undated'].includes(String(input.bucket)) ? String(input.bucket) as keyof TaskBuckets : 'all'
  const chosen = bucket === 'all' ? [...buckets.overdue, ...buckets.today, ...buckets.upcoming, ...buckets.undated] : buckets[bucket]
  const limit = Math.max(1, Math.min(1000, Math.floor(Number(input.limit)) || 200))
  return { bucket, today, total: chosen.length, tasks: chosen.slice(0, limit).map(taskView) }
}

export interface AgentQueryRow { id: string; title: string; database?: string; fields: Record<string, string> }
/** Executa uma consulta no modo texto (PT-BR/EN) sobre páginas já filtradas. */
export function runTextQuery(input: { text: string; pages: Record<string, Page>; checklists: ReadonlyMap<string, readonly ChecklistEntry[]>; locale?: string; types?: readonly ObjectType[]; databaseId?: string | null; thisPageId?: string; limit?: number }): { ok: true; display: string; total: number; rows: AgentQueryRow[]; issues: string[]; elapsedMs: number } | { ok: false; error: string } {
  const locale = localeOf(input.locale)
  setRegisteredTypes(input.types)
  const databases = Object.values(input.pages).filter(page => page.database && isQueryable(input.pages, page.id)).map(page => ({ id: page.id, title: page.title }))
  const parsed = parseQueryText(String(input.text ?? '').slice(0, 4000), { locale, databases, types: (input.types ?? []).map(type => ({ id: type.id, name: type.name })), pages: Object.values(input.pages).filter(page => !page.trashed && !page.passwordLock && page.title).slice(0, 5000).map(page => ({ id: page.id, title: page.title })) })
  if (!parsed.query) return { ok: false, error: parsed.error?.message ?? 'Consulta inválida' }
  const query = parsed.query
  const tasks = query.source.kind === 'tasks' ? collectTasks({ pages: input.pages, checklists: input.checklists, locale, includeDone: !!query.source.includeDone, daily: { databaseId: input.databaseId ?? null, inherit: true } }) : undefined
  const env: QueryEnv = { pages: input.pages, locale, now: Date.now(), thisPageId: input.thisPageId, types: input.types ?? [], ...(tasks ? { tasks } : {}) }
  const result = runQuery(query, env, createQueryCache())
  const limit = Math.max(1, Math.min(1000, Math.floor(Number(input.limit)) || 100))
  const columns = (query.columns ?? []).slice(0, 12)
  const rows = result.rows.slice(0, limit).map((row): AgentQueryRow => {
    const fields: Record<string, string> = {}
    for (const column of columns) {
      try { const { value, prop } = fieldValue(row, column, input.pages, input.types ?? []); fields[column] = valueText(value, prop as Property, input.pages, locale) } catch { fields[column] = '' }
    }
    const parent = row.parentId ? input.pages[row.parentId] : undefined
    return { id: row.id, title: row.title, ...(parent?.database ? { database: parent.title } : {}), fields }
  })
  return { ok: true, display: query.display, total: result.total, rows, issues: result.issues.map(issue => `${issue.kind}: ${issue.detail}`), elapsedMs: result.elapsedMs }
}

/** Blocos iniciais de uma nota diária (modelo pessoal ou padrão), com variáveis resolvidas. */
export function buildDailyNote(input: { date: string; locale?: string; template?: readonly unknown[] | null; tasks?: { title: string; pageTitle: string; time?: string; href: string }[]; userName?: string; uid?: () => string }): { title: string; blocks: unknown[]; text: string } {
  const locale = localeOf(input.locale)
  const link = (iso: string) => `workspace://daily/${iso}`
  const ctx = { date: input.date, locale, yesterdayHref: link(addDays(input.date, -1)), tomorrowHref: link(addDays(input.date, 1)), tasks: input.tasks ?? [], title: dailyTitle(input.date, locale), userName: input.userName || undefined }
  const { blocks } = applyDailyTemplateFull(input.template && input.template.length ? input.template : defaultDailyTemplate(locale), ctx, input.uid)
  return { title: ctx.title, blocks, text: dailyBlocksText(blocks as never) }
}

/** Bloco de tarefa (caixa de seleção) com menção de data opcional. */
export function taskBlock(text: string, date?: string, uid: () => string = () => crypto.randomUUID()): unknown {
  const content: unknown[] = [{ type: 'text', text, styles: {} }]
  if (date && isISODate(date)) {
    const [year, month, day] = date.split('-').map(Number)
    // Meio-dia local: o dia civil da menção não muda com o fuso.
    content.push({ type: 'text', text: ' ', styles: {} }, { type: 'dateMention', props: { id: uid(), date: new Date(year, month - 1, day, 12).toISOString(), pageId: '', repeat: '', reminderId: '', time: '' } })
  }
  return { id: uid(), type: 'checkListItem', props: { checked: false, textColor: 'default', backgroundColor: 'default', textAlignment: 'left' }, content, children: [] }
}

/** Parágrafo simples (anexar texto a uma página). */
export function paragraphBlock(text: string, uid: () => string = () => crypto.randomUUID()): unknown {
  return { id: uid(), type: 'paragraph', props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' }, content: text ? [{ type: 'text', text, styles: {} }] : [], children: [] }
}

/** Tipos de objeto em forma resumida. */
export function listTypes(types: readonly ObjectType[] | undefined): { id: string; name: string; description: string; icon: string | null; properties: { id: string; name: string; type: string }[] }[] {
  return (types ?? []).map(type => ({ id: type.id, name: type.name, description: type.description ?? '', icon: type.icon ?? null, properties: (type.properties ?? []).map(property => ({ id: property.id, name: property.name, type: property.type })) }))
}
