// Resultado atual de uma consulta em forma tabular, para exportação Markdown/HTML (puro).
import type { Page } from '../types'
import { resolveValue } from '../components/database/derived.ts'
import { valueText } from '../components/database/filterEngine.ts'
import { translate } from '../localization.ts'
import { extractChecklist, type ChecklistEntry } from '../tasks/taskCore.ts'
import { runQuery, taskForRow } from './engine.ts'
import { parseQueryJson } from './model.ts'
import { parseQueryText, serializeQuery } from './text.ts'
import { buildVirtualDb } from './virtualDb.ts'

export interface QueryExport { text: string; display: string; columns: string[]; rows: { pageId: string | null; cells: string[] }[]; total: number }

const PAGE_FIELD_NAMES: Record<string, [string, string]> = { '@title': ['Título', 'Title'], '@created': ['Criada em', 'Created'], '@updated': ['Editada em', 'Edited'], '@parent': ['Página pai', 'Parent page'], '@icon': ['Ícone', 'Icon'], '@cover': ['Tem capa', 'Has cover'], '@words': ['Palavras', 'Words'], '@favorite': ['Favorita', 'Favorite'], '@content': ['Conteúdo', 'Content'], '@database': ['Banco', 'Database'], '@due': ['Vencimento', 'Due'], '@done': ['Concluída', 'Done'], '@source': ['Origem', 'Source'] }

/** Checklists dos documentos exportados (fonte "tarefas"), sem páginas protegidas (já removidas). */
export function checklistsFrom(documents: Record<string, unknown[]>, pages: Record<string, Page>): Map<string, ChecklistEntry[]> {
  const out = new Map<string, ChecklistEntry[]>()
  for (const [id, blocks] of Object.entries(documents)) if (pages[id] && !pages[id].passwordLock) { const items = extractChecklist(blocks); if (items.length) out.set(id, items) }
  return out
}

export function queryExport(props: Record<string, unknown>, pages: Record<string, Page>, options: { thisPageId?: string; locale?: 'pt-BR' | 'en-US'; checklists?: Map<string, ChecklistEntry[]>; now?: number; limit?: number }): QueryExport | null {
  const locale = options.locale ?? 'pt-BR'
  const databases = Object.values(pages).filter((page) => page.database).map((page) => ({ id: page.id, title: page.title }))
  const query = parseQueryJson(props.query) ?? (typeof props.text === 'string' && props.text.trim() ? parseQueryText(props.text, { locale, databases }).query : null)
  if (!query) return null
  const text = serializeQuery(query, { locale, databaseName: (id) => pages[id]?.title, pageTitle: (id) => pages[id]?.title })
  const result = runQuery(query, { pages, locale, now: options.now ?? Date.now(), thisPageId: options.thisPageId, checklists: options.checklists })
  const vdb = buildVirtualDb(query, result, pages, 'export', { title: '', locale, fieldName: (field) => translate(locale, ...(PAGE_FIELD_NAMES[field] ?? [field, field])) }, false)
  const limit = options.limit ?? 500
  const rows = vdb.rows.slice(0, limit).map((row, index) => {
    const original = result.rows[index]
    const task = original ? taskForRow(original) : undefined
    return {
      pageId: task ? task.pageId : original && pages[original.id] ? original.id : null,
      cells: vdb.visibleProps.map((prop) => prop.type === 'title' ? row.title : valueText(resolveValue(row, prop, pages), prop, pages, locale)),
    }
  })
  return { text, display: query.display, columns: vdb.visibleProps.map((prop) => prop.name), rows, total: result.total }
}
