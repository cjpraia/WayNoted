// Tarefas agregadas — parte pura: extrai itens de checklist (com menção de data) dos documentos,
// reúne linhas de bancos com data e conclusão pendente e separa em Atrasadas / Hoje / Próximas / Sem data.
// Sem store e sem React: testável e rápido (10 mil páginas em poucos milissegundos).
import { doneProperty, isDoneValue, describeRecurrence, validISODate } from '../../electron/recurrence.mjs'
import type { DatabaseSchema, DateValue, Page, Property } from '../types.ts'

export interface ChecklistEntry {
  blockId: string
  text: string
  checked: boolean
  /** Instante ISO da primeira menção de data do item (ou vazio): o PRAZO. */
  date: string
  /** Dia de início (AAAA-MM-DD) quando a menção tem início separado do prazo. */
  startDate?: string
  /** 'HH:MM' quando a menção tem hora explícita. */
  time?: string
  repeat?: string
  mentionId?: string
  reminderId?: string
  /** Título do contêiner mais próximo (toggle/título), para contexto. */
  context?: string
}

export interface TaskItem {
  key: string
  kind: 'checklist' | 'row'
  /** Página que contém o item (checklist) ou a própria linha (banco). */
  pageId: string
  blockId?: string
  title: string
  /** Prazo (AAAA-MM-DD). Atrasada = prazo anterior a hoje. */
  due: string | null
  /** Início (AAAA-MM-DD), só quando é anterior ao prazo: a tarefa só aparece em "Hoje" a partir dele. */
  startDate?: string
  time?: string
  /** Resumo da repetição ("Todo mês no dia 5"). */
  repeat?: string
  /** Agrupamento por projeto: página de origem (checklist) ou banco (linha). */
  sourceId: string
  sourceTitle: string
  databaseId?: string
  propertyId?: string
  mentionId?: string
  /** Só com `includeDone`: o item já está concluído. */
  done?: boolean
  /** Checklist sem data própria numa nota diária: `due` é o dia da nota (herdado). */
  inherited?: boolean
}

/** Configuração da herança de data das notas diárias (padrão: ligada). */
export interface DailyInheritance {
  /** Banco gerenciado "Notas diárias" (ausente/inexistente = sem herança). */
  databaseId?: string | null
  /** Padrão: true. */
  inherit?: boolean
}

type AnyBlock = { id?: unknown; type?: unknown; props?: Record<string, unknown>; content?: unknown; children?: unknown }
type AnyInline = { type?: string; text?: string; content?: unknown; props?: Record<string, unknown> }

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const raw of content as AnyInline[]) {
    if (!raw || typeof raw !== 'object') continue
    if (typeof raw.text === 'string') out += raw.text
    else if (raw.type === 'link' && Array.isArray(raw.content)) out += inlineText(raw.content)
  }
  return out
}

/** Itens de checklist do documento (inclusive aninhados em toggles, colunas e listas). */
export function extractChecklist(blocks: unknown): ChecklistEntry[] {
  const out: ChecklistEntry[] = []
  const walk = (list: unknown, context: string | undefined, depth: number) => {
    if (!Array.isArray(list) || depth > 40) return
    for (const raw of list as AnyBlock[]) {
      if (!raw || typeof raw !== 'object') continue
      if (raw.type === 'checkListItem' && typeof raw.id === 'string') {
        const mention = Array.isArray(raw.content) ? (raw.content as AnyInline[]).find(item => item?.type === 'dateMention' && typeof item.props?.date === 'string' && Number.isFinite(Date.parse(String(item.props.date)))) : undefined
        const props = mention?.props ?? {}
        out.push({
          blockId: raw.id, text: inlineText(raw.content).replace(/\s+/g, ' ').trim(), checked: raw.props?.checked === true,
          date: mention ? String(props.date) : '',
          ...(typeof props.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(props.startDate) ? { startDate: props.startDate } : {}),
          ...(typeof props.time === 'string' && /^\d{2}:\d{2}$/.test(props.time) ? { time: props.time } : {}),
          ...(typeof props.repeat === 'string' && props.repeat ? { repeat: props.repeat } : {}),
          ...(typeof props.id === 'string' && props.id ? { mentionId: props.id } : {}),
          ...(typeof props.reminderId === 'string' && props.reminderId ? { reminderId: props.reminderId } : {}),
          ...(context ? { context } : {}),
        })
      }
      if (Array.isArray(raw.children) && raw.children.length) {
        const own = raw.type === 'toggleListItem' || raw.type === 'heading' ? inlineText(raw.content).trim().slice(0, 60) : ''
        walk(raw.children, own || context, depth + 1)
      }
    }
  }
  walk(blocks, undefined, 0)
  return out
}

/** Início só vale quando é válido e anterior ao prazo (dado inconsistente cai no modelo de um só prazo). */
function startOf(due: string | null, start: string | undefined): { startDate?: string } {
  return due && start && validISODate(start) && start < due ? { startDate: start } : {}
}

/** Propriedade de data de banco: `start` = início e `end` = prazo quando há intervalo; sem `end`, só prazo. */
export function dateRange(value: DateValue): { due: string; startDate?: string } {
  const end = value.end && validISODate(value.end) && value.end > value.start ? value.end : null
  return end ? { due: end, startDate: value.start } : { due: value.start }
}

/** Dia civil local de um instante (fuso do sistema). */
export function localDayOf(instant: string | number): string | null {
  const epoch = typeof instant === 'number' ? instant : Date.parse(instant)
  if (!Number.isFinite(epoch)) return null
  const d = new Date(epoch)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const MENTION_REPEAT_LABEL: Record<string, [string, string]> = { daily: ['Todo dia', 'Every day'], weekdays: ['Todo dia útil', 'Every weekday'], weekly: ['Toda semana', 'Every week'], monthly: ['Todo mês', 'Every month'], yearly: ['Todo ano', 'Every year'] }

export interface CollectInput {
  pages: Record<string, Page>
  checklists: ReadonlyMap<string, readonly ChecklistEntry[]>
  locale?: string
  /** Inclui itens concluídos (painel do calendário mostra o dia inteiro). */
  includeDone?: boolean
  daily?: DailyInheritance
}

/**
 * Tarefas de todas as páginas vivas, fora da lixeira e fora de páginas com senha.
 * Checklists: itens não marcados (com ou sem data). Bancos: linhas com data e conclusão pendente.
 */
export function collectTasks({ pages, checklists, locale = 'pt-BR', includeDone = false, daily }: CollectInput): TaskItem[] {
  const en = locale.startsWith('en')
  // Vivo e sem senha, memoizado por id (a cadeia de ancestrais é percorrida uma vez).
  const usable = new Map<string, boolean>()
  const ok = (id: string | null | undefined): boolean => {
    if (!id) return true
    const cached = usable.get(id)
    if (cached !== undefined) return cached
    const page = pages[id]
    usable.set(id, false) // ciclo: falso
    const result = !!page && !page.trashed && !page.passwordLock && ok(page.parentId)
    usable.set(id, result)
    return result
  }
  // Notas diárias: linhas do banco gerenciado cuja propriedade Data é um dia válido (só a página-nota, não subpáginas).
  const dailyDb = daily?.inherit !== false && daily?.databaseId ? pages[daily.databaseId] : undefined
  const dailyProp = dailyDb?.database && !dailyDb.trashed && ok(dailyDb.id) ? dailyDb.database.properties.find(property => property.type === 'date')?.id : undefined
  const items: TaskItem[] = []
  for (const [pageId, entries] of checklists) {
    const page = pages[pageId]
    if (!page || !entries.length || !ok(pageId)) continue
    let noteDay: string | null = null
    if (dailyProp && page.parentId === dailyDb!.id) {
      const value = page.props?.[dailyProp] as DateValue | undefined
      if (value && typeof value === 'object' && validISODate(value.start)) noteDay = value.start
    }
    const sourceTitle = page.title || (en ? 'Untitled' : 'Sem título')
    for (const entry of entries) {
      if (entry.checked && !includeDone) continue
      if (!entry.text && !entry.date) continue
      items.push({
        key: `c:${pageId}:${entry.blockId}`, kind: 'checklist', pageId, blockId: entry.blockId, title: entry.text,
        due: entry.date ? localDayOf(entry.date) : noteDay, ...startOf(entry.date ? localDayOf(entry.date) : null, entry.startDate), ...(!entry.date && noteDay ? { inherited: true } : {}), ...(entry.time ? { time: entry.time } : {}),
        ...(entry.repeat && MENTION_REPEAT_LABEL[entry.repeat] ? { repeat: MENTION_REPEAT_LABEL[entry.repeat][en ? 1 : 0] } : {}),
        sourceId: pageId, sourceTitle, ...(entry.mentionId ? { mentionId: entry.mentionId } : {}), ...(entry.checked ? { done: true } : {}),
      })
    }
  }
  // Bancos: propriedades de data com propriedade de conclusão (status/caixa) correspondente.
  const plans = new Map<string, { dates: { date: Property; done: Property }[]; title: string }>()
  for (const page of Object.values(pages)) {
    const schema = page.database
    if (!schema || schema.linkedSourceId || !schema.properties?.length) continue
    const dates: { date: Property; done: Property }[] = []
    for (const property of schema.properties) {
      if (property.type !== 'date') continue
      const done = doneProperty(schema as DatabaseSchema, property)
      if (done) dates.push({ date: property, done })
    }
    if (dates.length) plans.set(page.id, { dates, title: page.title || (en ? 'Untitled' : 'Sem título') })
  }
  if (plans.size) for (const row of Object.values(pages)) {
    const plan = row.parentId ? plans.get(row.parentId) : undefined
    if (!plan || !row.props || row.trashed || row.passwordLock) continue
    for (const { date, done } of plan.dates) {
      const value = row.props[date.id] as DateValue | undefined
      if (!value || typeof value !== 'object' || !validISODate(value.start)) continue
      const isDone = isDoneValue(done, row.props[done.id])
      if (!includeDone && isDone) break
      if (!ok(row.id)) break
      const repeat = value.repeat && value.repeat !== 'none' ? describeRecurrence(value, en ? 'en-US' : 'pt-BR') : ''
      items.push({
        key: `r:${row.id}:${date.id}`, kind: 'row', pageId: row.id, title: row.title || (en ? 'Untitled' : 'Sem título'),
        ...dateRange(value), ...(value.startTime ? { time: value.startTime } : {}), ...(repeat ? { repeat } : {}),
        sourceId: row.parentId!, sourceTitle: plan.title, databaseId: row.parentId!, propertyId: date.id, ...(isDone ? { done: true } : {}),
      })
      break
    }
  }
  return items
}

export interface TaskBuckets { overdue: TaskItem[]; today: TaskItem[]; upcoming: TaskItem[]; undated: TaskItem[] }

const byDue = (a: TaskItem, b: TaskItem) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || (a.time ?? '99:99').localeCompare(b.time ?? '99:99') || a.title.localeCompare(b.title) || a.key.localeCompare(b.key)

/** Separa por prazo em relação a `today` (AAAA-MM-DD local). */
export function bucketTasks(items: readonly TaskItem[], today: string, filter?: (item: TaskItem) => boolean, options: { hideInheritedOverdue?: boolean } = {}): TaskBuckets {
  const buckets: TaskBuckets = { overdue: [], today: [], upcoming: [], undated: [] }
  for (const item of items) {
    if (filter && !filter(item)) continue
    if (options.hideInheritedOverdue && item.inherited && item.due && item.due < today) continue
    if (!item.due) buckets.undated.push(item)
    else if (item.due < today) buckets.overdue.push(item)
    // Ainda não começou: fica em "Próximas" até o dia de início, mesmo que o prazo seja hoje.
    else if (item.startDate && item.startDate > today) buckets.upcoming.push(item)
    else if (item.due === today || item.startDate) buckets.today.push(item)
    else buckets.upcoming.push(item)
  }
  buckets.overdue.sort(byDue); buckets.today.sort(byDue); buckets.upcoming.sort(byDue)
  buckets.undated.sort((a, b) => a.sourceTitle.localeCompare(b.sourceTitle) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key))
  return buckets
}

/** Itens que ocupam um dia (painel do calendário): o prazo ou, com início separado, qualquer dia do intervalo. */
export const tasksOnDay = (items: readonly TaskItem[], day: string) => items.filter(item => item.due === day || (!!item.startDate && !!item.due && item.startDate <= day && day <= item.due)).sort(byDue)

/** Agrupa em seções consecutivas por chave (dia ou projeto), preservando a ordem. */
export function groupTasks(items: readonly TaskItem[], by: 'day' | 'project'): { key: string; items: TaskItem[] }[] {
  const groups = new Map<string, TaskItem[]>()
  const ordered = by === 'project' ? [...items].sort((a, b) => a.sourceTitle.localeCompare(b.sourceTitle) || a.sourceId.localeCompare(b.sourceId) || byDue(a, b)) : items
  for (const item of ordered) {
    const key = by === 'day' ? item.due ?? '' : item.sourceId
    const list = groups.get(key)
    if (list) list.push(item); else groups.set(key, [item])
  }
  return [...groups].map(([key, list]) => ({ key, items: list }))
}

/** Próximas N tarefas (atrasadas primeiro, depois hoje e próximas). */
export function nextTasks(buckets: TaskBuckets, limit = 5): TaskItem[] {
  return [...buckets.overdue, ...buckets.today, ...buckets.upcoming].slice(0, limit)
}

/** Tarefas que pedem atenção agora: atrasadas primeiro, depois as de hoje (nunca as futuras). */
export function dueNowTasks(buckets: TaskBuckets, limit = 5): TaskItem[] {
  return [...buckets.overdue, ...buckets.today].slice(0, limit)
}

/** Valor "concluído" da propriedade de conclusão (caixa → true; status → primeira opção "complete"). */
export function doneValueFor(property: Property): boolean | string | null {
  if (property.type === 'checkbox') return true
  return property.options?.find(option => option.group === 'complete')?.id ?? null
}
