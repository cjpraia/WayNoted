// Inserção do bloco de consulta: itens do menu "/", atalho ⌘⌥K no editor (⌘⌥Q é a citação do BlockNote) e comandos do ⌘K.
import { CalendarClock, Clock, Link2, ListChecks, SlidersHorizontal } from 'lucide-react'
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions'
import type { SlashCommand } from '../page/slashMenu/catalog'
import { actions, getState } from '../../store'
import { queryBlockProps, queryTemplate, QUERY_TEMPLATES, type QueryTemplateId } from '../../query/templates'

type AnyEditor = {
  isEditable: boolean
  getTextCursorPosition: () => { block: { id: string } }
  insertBlocks: (blocks: unknown[], reference: string, placement: 'before' | 'after') => unknown
  setTextCursorPosition?: (id: string, placement?: 'start' | 'end') => void
}

const command = (id: string, en: string, pt: string, operation: string, aliases: string[]): SlashCommand =>
  ({ id, en, pt, category: 'Database', operation, aliases: [...new Set([id, en.toLowerCase(), pt.toLowerCase(), ...aliases])], status: 'local' })

/** Itens do grupo "Banco de dados" do menu "/". */
export const QUERY_COMMANDS: readonly SlashCommand[] = [
  command('query', 'Query', 'Consulta', 'query:blank', ['consulta', 'query', 'dataview', 'filtro', 'filter', 'lista viva', 'live list', 'consultar']),
  ...QUERY_TEMPLATES.filter((template) => template.id !== 'tasks-of-day').map((template) => command(`query-${template.id}`, `Query: ${template.en}`, `Consulta: ${template.pt}`, `query:${template.id}`, ['consulta', 'query', 'dataview', ...template.aliases])),
]

export function queryIcon(id: string) {
  if (id === 'query') return <SlidersHorizontal size={18} strokeWidth={1.6} />
  if (id === 'query-open-tasks') return <ListChecks size={18} strokeWidth={1.6} />
  if (id === 'query-edited-this-week') return <Clock size={18} strokeWidth={1.6} />
  if (id === 'query-backlinks') return <Link2 size={18} strokeWidth={1.6} />
  if (id === 'query-overdue-rows') return <CalendarClock size={18} strokeWidth={1.6} />
  return null
}

export function queryBlockFor(templateId: QueryTemplateId | string, options: { date?: string } = {}) {
  const pages = getState().pages
  const locale = getState().settings.locale ?? 'pt-BR'
  return { type: 'query', props: queryBlockProps(queryTemplate(templateId, options), { locale, databaseName: (id) => pages[id]?.title, pageTitle: (id) => pages[id]?.title }) }
}

/** Executa um item "query:*" do menu "/"; devolve false se a operação não for deste módulo. */
export function runQueryCommand(operation: string, editor: unknown): boolean {
  if (!operation.startsWith('query:')) return false
  insertOrUpdateBlockForSlashMenu(editor as never, queryBlockFor(operation.slice(6)) as never)
  return true
}

// ---------- editor ativo (⌘K) ----------

const editors = new Map<string, AnyEditor>()
/** Registra o editor montado de uma página; devolve a função de remoção. */
export function registerQueryEditor(pageId: string, editor: unknown): () => void {
  editors.set(pageId, editor as AnyEditor)
  return () => { if (editors.get(pageId) === editor) editors.delete(pageId) }
}

/** Insere uma consulta na página: após o bloco do cursor se o editor estiver aberto, senão ao fim. */
export async function insertQueryIntoPage(pageId: string, templateId: QueryTemplateId | string = 'blank'): Promise<void> {
  const block = queryBlockFor(templateId)
  const editor = editors.get(pageId)
  if (editor?.isEditable) {
    let reference: string | undefined
    try { reference = editor.getTextCursorPosition().block.id } catch { reference = undefined }
    if (reference) { editor.insertBlocks([block], reference, 'after'); return }
  }
  await actions.appendPageBlocks(pageId, [{ id: crypto.randomUUID(), ...block, children: [] }])
}

/** ⌘⌥K no editor: insere uma consulta abaixo do bloco atual. */
export function handleQueryShortcut(event: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; code: string; preventDefault(): void; stopPropagation(): void }, editor: unknown): boolean {
  if (!(event.metaKey || event.ctrlKey) || !event.altKey || event.shiftKey || event.code !== 'KeyK') return false
  const target = editor as AnyEditor
  if (!target.isEditable) return false
  event.preventDefault(); event.stopPropagation()
  try { target.insertBlocks([queryBlockFor('blank')], target.getTextCursorPosition().block.id, 'after') } catch { /* Sem cursor: ignora. */ }
  return true
}
