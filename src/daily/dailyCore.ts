import COMPAT from '../../shared/compatibility.ts'
// Notas diárias — parte pura (sem store, sem React): datas civis, semana, título, esquema do banco
// "Notas diárias", modelo padrão e substituição de variáveis {{data}}, {{dia_da_semana}}, {{semana}},
// {{ontem}}, {{amanha}}, {{agenda}} e {{tarefas_do_dia}}.
import type { DatabaseSchema, Page } from '../types.ts'

import { addDays, formatLongDate, formatMonthYear, formatShortDate, formatWeekday, isISODate, isoWeek, localDay, monthGrid, weekDays, weekStartFor, type DailyLocale } from '../templates/dates.ts'
import { expandTemplate, plainText, type TemplateBlock, type TemplateTaskLine } from '../templates/variables.ts'

// Datas civis: moram em src/templates/dates.ts (compartilhadas com os modelos); reexportadas aqui por compatibilidade.
export { addDays, formatLongDate, formatMonthYear, formatShortDate, formatWeekday, isISODate, isoWeek, localDay, monthGrid, weekDays, weekStartFor }
export type { DailyLocale }

/** Título da nota diária: "7 de outubro de 2026" / "October 7, 2026". */
export function dailyTitle(iso: string, locale: DailyLocale): string { return formatLongDate(iso, locale) }

// ---------- Banco "Notas diárias" ----------

export function dailyDatabaseSchema(locale: DailyLocale, uid: () => string = () => crypto.randomUUID()): { schema: DatabaseSchema; datePropertyId: string } {
  const en = locale === 'en-US'
  const title = { id: uid(), name: en ? 'Name' : 'Nome', type: 'title' as const }
  const date = { id: uid(), name: en ? 'Date' : 'Data', type: 'date' as const }
  const created = { id: uid(), name: en ? 'Created' : 'Criado em', type: 'createdTime' as const }
  const table = { id: uid(), name: en ? 'Table' : 'Tabela', type: 'table' as const, filters: [], sorts: [{ propertyId: date.id, direction: 'desc' as const }], hidden: [], widths: {}, dateProp: date.id }
  const calendar = { id: uid(), name: en ? 'Calendar' : 'Calendário', type: 'calendar' as const, filters: [], sorts: [], hidden: [], widths: {}, dateProp: date.id }
  return { schema: { properties: [title, date, created], views: [table, calendar], activeViewId: table.id }, datePropertyId: date.id }
}

/** Primeira propriedade de data do banco (a "Data" da nota diária). */
export function dailyDateProperty(schema: DatabaseSchema | undefined): string | null {
  return schema?.properties.find(property => property.type === 'date')?.id ?? null
}

/** Índice data → nota (página viva mais antiga vence em caso de duplicata). */
export function dailyIndex(pages: Record<string, Page>, databaseId: string, isLive: (id: string) => boolean): Map<string, Page> {
  const db = pages[databaseId]
  const propId = dailyDateProperty(db?.database)
  const map = new Map<string, Page>()
  if (!db?.database || !propId) return map
  for (const page of Object.values(pages)) {
    if (page.parentId !== databaseId || page.trashed) continue
    const value = page.props?.[propId] as { start?: unknown } | undefined
    const start = value && typeof value === 'object' ? value.start : undefined
    if (!isISODate(start)) continue
    const existing = map.get(start)
    if ((!existing || page.createdAt < existing.createdAt) && isLive(page.id)) map.set(start, page)
  }
  return map
}

// ---------- Modelo e variáveis ----------
// O motor de {{variáveis}} mora em src/templates/variables.ts (compartilhado com modelos de página, pessoais, de linha e de tipo).

type Block = TemplateBlock
export type DailyTaskLine = TemplateTaskLine
export interface DailyContext {
  date: string
  locale: DailyLocale
  /** Link para a nota de ontem/amanhã (página existente ou workspace://daily/AAAA-MM-DD). */
  yesterdayHref: string
  tomorrowHref: string
  tasks: DailyTaskLine[]
  /** Opcionais (modelos gerais): hora, título, nome do usuário e respostas de {{pergunta:…}}. */
  time?: string
  title?: string
  userName?: string
  answers?: Record<string, string>
}

export const DAILY_VARIABLES = ['data', 'dia_da_semana', 'semana', 'ontem', 'amanha', 'agenda', 'tarefas_do_dia'] as const

export const dailyLink = (iso: string) => `workspace://daily/${iso}`
export const DAILY_LINK = new RegExp(`^(?:workspace|${COMPAT.record007}):\\/\\/daily\\/(\\d{4}-\\d{2}-\\d{2})$`, "")

const text = (value: string, styles: Record<string, unknown> = {}) => ({ type: 'text', text: value, styles })

/** Modelo padrão da nota diária. */
export function defaultDailyTemplate(locale: DailyLocale): Block[] {
  const en = locale === 'en-US'
  const h = (value: string) => ({ type: 'heading', props: { level: 2 }, content: [text(value)] })
  const p = (value: string) => ({ type: 'paragraph', content: value ? [text(value)] : [] })
  return [
    { type: 'paragraph', props: { textColor: 'gray' }, content: [text('{{dia_da_semana}} · ' + (en ? 'Week' : 'Semana') + ' {{semana}} · {{ontem}} · {{amanha}}')] },
    h(en ? 'Agenda' : 'Agenda'), p('{{agenda}}'),
    h(en ? 'Tasks for the day' : 'Tarefas do dia'), p('{{tarefas_do_dia}}'),
    { type: 'checkListItem', content: [] },
    h(en ? 'Notes' : 'Notas'), p(''),
  ]
}

/** Aplica o modelo e devolve também variáveis desconhecidas e o cursor ({{cursor}}). */
export function applyDailyTemplateFull(blocks: readonly unknown[], ctx: DailyContext, uid: () => string = () => crypto.randomUUID()) {
  return expandTemplate(blocks, { ...ctx }, uid, { baseProps: true })
}

/**
 * Aplica o modelo: substitui variáveis no texto (preservando estilos), troca parágrafos que contêm
 * só {{agenda}} pelo bloco "Agenda de hoje" e só {{tarefas_do_dia}} pela lista de tarefas do dia.
 * Sempre devolve blocos novos com ids novos.
 */
export function applyDailyTemplate(blocks: readonly unknown[], ctx: DailyContext, uid: () => string = () => crypto.randomUUID()): Block[] {
  return applyDailyTemplateFull(blocks, ctx, uid).blocks
}

/** Texto puro (índice de busca) dos blocos gerados. */
export function dailyBlocksText(blocks: readonly Block[]): string {
  const lines: string[] = []
  const visit = (list: readonly Block[]) => { for (const block of list) { const value = plainText(block.content); if (value.trim()) lines.push(value); visit(block.children ?? []) } }
  visit(blocks)
  return lines.join('\n')
}
