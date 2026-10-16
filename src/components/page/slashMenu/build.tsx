import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions'
import { assertCanConvertToColumns, insertColumns } from '../columns/actions.ts'
import { getDefaultReactSlashMenuItems, type DefaultReactSuggestionItem } from '@blocknote/react'
import { actions, getState } from '../../../store'
import type { ViewType } from '../../../types'
import { BlockIcon } from '../../ui/BlockIcon'
import { blocksToText } from '../util'
import type { PageEditorType } from '../schema'
import { SLASH_CATALOG, slashSubtext, type SlashCommand } from './catalog'
import { emptySlashItem, moreSlashItem, recordSlashUse, slashPlan } from './plan'
import { columnsFromBlock, copyBlockForNewPage, persistOwnedBlockBeforeNavigation } from './lifecycle'
import { INTEGRATION_COMMANDS, integrationIcon, runIntegrationCommand } from '../../dictation/integrationCommands'
import { requestMentionAutoOpen } from '../../../nlp/mention'
import { requestLinkPickerAutoOpen } from '../../database/linkedSource'
import { QUERY_COMMANDS, queryIcon, runQueryCommand } from '../../query/insert'
import { TYPE_COMMANDS, runTypeCommand, typeIcon } from '../../objecttypes/slash'
import { TEMPLATE_VARIABLE_COMMANDS, runTemplateVariableCommand, templateVariableIcon } from '../../../templates/slash'
import { CANVAS_COMMANDS, canvasIcon, runCanvasCommand } from '../../canvas/slash'

/** Catálogo com os itens de integração local (Ditado, Agenda de hoje) inseridos ao fim da sua categoria. */
const FULL_CATALOG: readonly SlashCommand[] = [...INTEGRATION_COMMANDS, ...QUERY_COMMANDS, ...TYPE_COMMANDS, ...CANVAS_COMMANDS, ...TEMPLATE_VARIABLE_COMMANDS].reduce<SlashCommand[]>((list, command) => {
  const index = list.findLastIndex((item) => item.category === command.category)
  list.splice(index < 0 ? list.length : index + 1, 0, command)
  return list
}, [...SLASH_CATALOG])

export interface SlashMenuContext {
  editor: PageEditorType
  pageId: string
  locale: 'pt-BR' | 'en-US'
  query: string
  targetBlockId?: string
  onCreated: () => Promise<void>
  onPick: (kind: 'page' | 'database' | 'mention' | 'page-in', blockId?: string) => void
  onFile: (kind: 'file' | 'pdf') => void
  onImport: (kind: 'word' | 'zip' | 'pdf') => void
  onCopy: (blockId?: string) => void
  onMove: (blockId?: string) => void
  onAI: () => void
  onComment: (blockId?: string, suggestion?: boolean) => void
  onError: (message: string) => void
  /** Reabre o menu "/" depois de "Mais blocos" / "Ver mais". */
  onReopen?: () => void
}

const columnMessages = (locale: 'pt-BR' | 'en-US') => ({ nested: locale === 'en-US' ? 'Columns cannot be placed inside columns.' : 'Colunas não cabem dentro de colunas.' })

function activeText(editor: PageEditorType, blockId?: string): string { return blocksToText([blockId ? editor.getBlock(blockId) ?? editor.getTextCursorPosition().block : editor.getTextCursorPosition().block]).trim() }

async function turnInto(editor: PageEditorType, type: string, context: SlashMenuContext) {
  const current = context.targetBlockId ? editor.getBlock(context.targetBlockId) ?? editor.getTextCursorPosition().block : editor.getTextCursorPosition().block
  const content = current.content && Array.isArray(current.content) ? current.content : []
  if (type === 'page' || type === 'page-in') {
    if (type === 'page-in') { context.onPick('page-in', current.id); return }
    // Keep the destination independent while copying; a debounced save of the
    // original parent must not garbage-collect it before the wrapper exists.
    const id = actions.createPage(context.pageId, { title: activeText(editor, context.targetBlockId), blockOwnerId: null })
    try {
      await actions.flushMeta()
      await actions.appendPageBlocks(id, [copyBlockForNewPage(current)])
      const childIds = await actions.reparentOwnedPageBlocks(context.pageId, id, [current])
      actions.updatePage(id, { blockConversion: { sourceId: context.pageId, childIds } }, false)
      await actions.flushMeta()
    } catch (cause) {
      // A copied document may already own moved descendants. Keep it live and
      // detach it from this block until the user can retry metadata persistence.
      actions.updatePage(id, { blockOwnerId: null }, false)
      try { await actions.flushMeta() } catch (recoveryError) { actions.reportSaveError(recoveryError) }
      const reason = cause instanceof Error ? cause.message : String(cause)
      throw new Error(context.locale === 'en-US' ? `Conversion failed: ${reason}. Page ${id} was kept for recovery.` : `A conversão falhou: ${reason}. A página ${id} foi preservada para recuperação.`, { cause })
    }
    editor.updateBlock(current.id, { type: 'page', props: { pageId: id, ownership: 'owned', display: 'page' }, children: [] })
    actions.updatePage(id, { blockOwnerId: context.pageId }, false)
    try { await persistOwnedBlockBeforeNavigation(id, context.onCreated, actions.flushMeta, actions.openPage) }
    catch (cause) {
      actions.updatePage(id, { blockOwnerId: null }, false)
      try { await actions.flushMeta() } catch (recoveryError) { actions.reportSaveError(recoveryError) }
      const reason = cause instanceof Error ? cause.message : String(cause)
      throw new Error(context.locale === 'en-US' ? `Conversion save failed: ${reason}. Page ${id} was kept for recovery.` : `A gravação da conversão falhou: ${reason}. A página ${id} foi preservada para recuperação.`, { cause })
    }
    return
  }
  if (type === 'syncedBlock') {
    const id = actions.createSyncedBlock(context.pageId, [structuredClone(current)])
    editor.updateBlock(current.id, { type: 'syncedBlock', props: { syncedId: id } })
    return
  }
  if (type === 'equation') { editor.updateBlock(current.id, { type: 'equation', props: { latex: activeText(editor, context.targetBlockId) || 'x^2' } }); return }
  if (type === 'callout') { editor.updateBlock(current.id, { type: 'callout', content: content as never }); return }
  if (type.startsWith('heading:') || type.startsWith('toggle-heading:')) {
    const level = Number(type.split(':').at(-1))
    editor.updateBlock(current.id, { type: 'heading', props: { level, isToggleable: type.startsWith('toggle-') }, content: content as never })
    return
  }
  if (type.startsWith('columns:')) {
    const count = Number(type.split(':')[1])
    assertCanConvertToColumns(editor as never, current.id, columnMessages(context.locale))
    editor.updateBlock(current.id, { type: 'columnList', children: columnsFromBlock(current, count) as never })
    return
  }
  editor.updateBlock(current.id, { type: type as never, content: content as never })
}

export async function executeSlashCommand(item: SlashCommand, context: SlashMenuContext, natives: Record<string, DefaultReactSuggestionItem | undefined> = {}) {
  const { editor, pageId, locale } = context
  const operation = item.operation
  try {
    if (editor.isEditable === false && operation !== 'action:copy-link') throw new Error(locale === 'en-US' ? 'This page is locked.' : 'Esta página está bloqueada.')
    if (operation.startsWith('native:')) { const native = natives[operation.slice(7)]; if (!native) throw new Error(locale === 'en-US' ? 'This editor command is unavailable.' : 'Este comando do editor está indisponível.'); native.onItemClick(); return }
    if (operation === 'file') { context.onFile('file'); return }
    if (operation === 'file:pdf') { context.onFile('pdf'); return }
    if (operation.startsWith('import:')) { context.onImport(operation.slice(7) as 'word' | 'zip' | 'pdf'); return }
    if (operation.startsWith('integration:') && runIntegrationCommand(operation, editor, context.targetBlockId)) return
    if (runQueryCommand(operation, editor)) return
    if (runTypeCommand(operation, pageId)) return
    if (runTemplateVariableCommand(operation, editor as never, locale)) return
    if (runCanvasCommand(operation, editor, pageId, context.onCreated, actions.flushMeta, actions.openPage)) return
    if (operation === 'table') { insertOrUpdateBlockForSlashMenu(editor, { type: 'table', content: { type: 'tableContent', rows: [{ cells: ['', '', ''] }, { cells: ['', '', ''] }] } as never }); return }
    if (operation === 'synced') {
      const id = actions.createSyncedBlock(pageId, [{ type: 'paragraph', content: [] }])
      insertOrUpdateBlockForSlashMenu(editor, { type: 'syncedBlock', props: { syncedId: id } }); return
    }
    if (operation.startsWith('columns:')) { insertColumns(editor as never, Number(operation.split(':')[1]), columnMessages(locale), context.targetBlockId); return }
    if (operation.startsWith('heading:') || operation.startsWith('toggle-heading:')) {
      insertOrUpdateBlockForSlashMenu(editor, { type: 'heading', props: { level: Number(operation.split(':').at(-1)), isToggleable: operation.startsWith('toggle-') } }); return
    }
    if (operation === 'page:owned') {
      const id = actions.createPage(pageId, { blockOwnerId: pageId })
      insertOrUpdateBlockForSlashMenu(editor, { type: 'page', props: { pageId: id, ownership: 'owned', display: 'page' } })
      await persistOwnedBlockBeforeNavigation(id, context.onCreated, actions.flushMeta, actions.openPage)
      return
    }
    if (operation === 'page:linked') { context.onPick('page', editor.getTextCursorPosition().block.id); return }
    if (operation === 'database:linked') {
      // Como no Export Bundle: o bloco aparece já no lugar, com o estado vazio, e o seletor de fonte abre ancorado nele.
      const block = insertOrUpdateBlockForSlashMenu(editor, { type: 'page', props: { pageId: '', ownership: 'owned', display: 'link-source' } }) as { id?: string } | undefined
      if (block?.id) requestLinkPickerAutoOpen(block.id)
      return
    }
    if (operation.startsWith('database:') || operation.startsWith('chart:')) {
      const parts = operation.split(':')
      const chart = parts[0] === 'chart'
      const type = chart ? 'chart' : parts[1] as ViewType
      const display = chart ? 'inline' : parts[2] || 'inline'
      const id = actions.createDatabase(pageId, type, { blockOwnerId: pageId })
      if (chart) actions.updateSchema(id, (schema) => ({ ...schema, views: schema.views.map((view) => view.id === schema.activeViewId ? { ...view, chartType: parts[1] as 'verticalBar' | 'horizontalBar' | 'line' | 'donut' | 'number' } : view) }))
      insertOrUpdateBlockForSlashMenu(editor, { type: 'page', props: { pageId: id, ownership: 'owned', display } })
      if (display === 'page') await persistOwnedBlockBeforeNavigation(id, context.onCreated, actions.flushMeta, actions.openPage)
      else { await context.onCreated(); await actions.flushMeta() }
      return
    }
    if (operation === 'inline:person') { editor.insertInlineContent([{ type: 'text', text: `@${getState().settings.userName || (locale === 'en-US' ? 'You' : 'Você')} `, styles: {} }]); return }
    if (operation === 'inline:page') { context.onPick('mention', editor.getTextCursorPosition().block.id); return }
    if (operation === 'inline:date') { const id = crypto.randomUUID(); requestMentionAutoOpen(id); editor.insertInlineContent([{ type: 'dateMention', props: { id, date: new Date().toISOString(), startDate: '', pageId, repeat: '', reminderId: '', time: '' } }]); return }
    if (operation === 'inline:equation') { editor.insertInlineContent([{ type: 'inlineEquation', props: { id: crypto.randomUUID(), latex: 'x^2' } }]); return }
    if (operation.startsWith('external:')) { insertOrUpdateBlockForSlashMenu(editor, { type: 'externalReference', props: { provider: operation.slice(9) } }); return }
    if (operation.startsWith('block:')) {
      const type = operation.slice(6)
      insertOrUpdateBlockForSlashMenu(editor, type === 'breadcrumb' ? { type: 'breadcrumb', props: { pageId } } : { type: type as never })
      return
    }
    if (operation.startsWith('turn:')) { await turnInto(editor, operation.slice(5), context); return }
    if (operation.startsWith('color:')) {
      const [, kind, color] = operation.split(':')
      editor.updateBlock(context.targetBlockId ?? editor.getTextCursorPosition().block.id, { props: { [kind === 'text' ? 'textColor' : 'backgroundColor']: color } })
      return
    }
    const current = context.targetBlockId ? editor.getBlock(context.targetBlockId) ?? editor.getTextCursorPosition().block : editor.getTextCursorPosition().block
    if (operation === 'action:copy-link') { context.onCopy(current.id); return }
    if (operation === 'action:move') { context.onMove(current.id); return }
    if (operation === 'action:ai') { context.onAI(); return }
    if (operation === 'action:comment') { context.onComment(current.id); return }
    if (operation === 'action:duplicate') {
      const copies = await actions.duplicateOwnedPageBlocks(pageId, [current])
      editor.insertBlocks(copies as never, current, 'after')
      await context.onCreated()
      return
    }
    if (operation === 'action:delete') { editor.removeBlocks([current]); return }
    throw new Error(locale === 'en-US' ? `Unsupported command: ${item.en}` : `Comando não suportado: ${item.pt}`)
  } catch (cause) { context.onError(cause instanceof Error ? cause.message : String(cause)) }
}

/** Atalhos Markdown exibidos à direita do item, em cinza (como no Export Bundle). */
const SLASH_SHORTCUTS: Record<string, string> = {
  'heading-1': '#', 'heading-2': '##', 'heading-3': '###', 'heading-4': '####',
  'bulleted-list': '-', 'numbered-list': '1.', 'to-do-list': '[]', 'toggle-list': '>',
  quote: '"', divider: '---', code: '```',
}

export function buildSlashItems(context: SlashMenuContext): DefaultReactSuggestionItem[] {
  const nativeItems = getDefaultReactSlashMenuItems(context.editor)
  const dictionary = context.editor.dictionary.slash_menu
  const natives = Object.fromEntries(['image', 'video', 'audio', 'file', 'emoji'].map((key) => [key, nativeItems.find((item) => item.title === dictionary[key as keyof typeof dictionary]?.title)]))
  const plan = slashPlan(FULL_CATALOG, context.query, context.locale)
  const searching = !!context.query.trim()
  if (searching && !plan.length) return [emptySlashItem(context.query, context.locale)]
  return plan.map((entry): DefaultReactSuggestionItem => {
    if (entry.kind === 'more') return moreSlashItem(entry, context.onReopen)
    const item = entry.command
    return {
      title: context.locale === 'en-US' ? item.en : item.pt,
      subtext: slashSubtext(item, searching, context.locale),
      aliases: item.aliases,
      group: entry.group,
      icon: integrationIcon(item.id) ?? queryIcon(item.id) ?? typeIcon(item.id) ?? templateVariableIcon(item.id) ?? canvasIcon(item.id) ?? <BlockIcon name={item.id} size={18} />,
      badge: SLASH_SHORTCUTS[item.id],
      onItemClick: () => { recordSlashUse(item.id); void executeSlashCommand(item, context, natives).catch((cause) => context.onError(cause instanceof Error ? cause.message : String(cause))) },
    }
  })
}

export { SLASH_CATALOG }
