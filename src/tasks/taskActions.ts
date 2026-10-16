// Ações sobre tarefas agregadas: concluir no lugar e abrir a origem.
// Linhas de banco usam `actions.setProp` (dispara recorrência via completeRecurring e automações);
// itens de checklist são marcados no documento de origem (menção recorrente avança para a próxima data).
import { actions, api, getState } from '../store.ts'
import { advanceMentionDate, doneProperty, shiftMentionStart } from '../recurrence.ts'
import { clearDraft, windowDraftId } from '../components/page/util.ts'
import { translate } from '../localization.ts'
import { doneValueFor, type TaskItem } from './taskCore.ts'

const message = (pt: string, en: string) => translate(getState().settings.locale, pt, en)

type MutableBlock = { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: MutableBlock[] }
function findBlock(list: MutableBlock[] | undefined, id: string): MutableBlock | null {
  for (const block of list ?? []) {
    if (block?.id === id) return block
    const nested = findBlock(block?.children, id)
    if (nested) return nested
  }
  return null
}

/**
 * Marca/desmarca um item de checklist no documento. Item com menção recorrente: em vez de marcar,
 * a menção avança para a próxima ocorrência e o lembrete acompanha (igual ao editor).
 * Devolve 'advanced' quando a tarefa recorrente foi reagendada.
 */
export async function setChecklistChecked(pageId: string, blockId: string, checked: boolean, now = Date.now()): Promise<'checked' | 'unchecked' | 'advanced'> {
  const page = getState().pages[pageId]
  if (!page || page.trashed) throw new Error(message('A página da tarefa não está disponível.', 'The task’s page is unavailable.'))
  if (page.locked) throw new Error(message('A página está bloqueada. Desbloqueie-a para concluir a tarefa.', 'The page is locked. Unlock it to complete the task.'))
  if (page.passwordLock) throw new Error(message('Abra a página protegida para alterar esta tarefa.', 'Open the protected page to change this task.'))
  await actions.flushAll()
  const blocks = structuredClone(await api.loadDoc(pageId) ?? []) as MutableBlock[]
  const block = findBlock(blocks, blockId)
  if (!block || block.type !== 'checkListItem') throw new Error(message('A tarefa não foi encontrada na página (talvez tenha sido removida).', 'The task was not found on the page (it may have been removed).'))
  let result: 'checked' | 'unchecked' | 'advanced' = checked ? 'checked' : 'unchecked'
  const content = Array.isArray(block.content) ? block.content as { type?: string; props?: Record<string, unknown> }[] : []
  const mention = content.find(item => item?.type === 'dateMention' && typeof item.props?.repeat === 'string' && item.props.repeat)
  if (checked && mention?.props) {
    const next = advanceMentionDate(String(mention.props.date), String(mention.props.repeat), now)
    if (next) {
      // Início separado: avança junto com o prazo, mantendo a duração.
      const startDate = typeof mention.props.startDate === 'string' && mention.props.startDate ? shiftMentionStart(mention.props.startDate, String(mention.props.date), next) : ''
      mention.props = { ...mention.props, date: next, ...(startDate ? { startDate } : {}) }
      block.props = { ...block.props, checked: false }
      const reminderId = typeof mention.props.reminderId === 'string' ? mention.props.reminderId : ''
      if (reminderId && getState().notifications[reminderId]) actions.updateNotification(reminderId, { dueAt: Date.parse(next), firedAt: null, readAt: null })
      result = 'advanced'
    } else block.props = { ...block.props, checked: true }
  } else block.props = { ...block.props, checked }
  await api.saveDoc(pageId, blocks, { checkpoint: true })
  clearDraft(pageId)
  await api.draftDelete?.(pageId, windowDraftId())
  await actions.reloadDocument(pageId)
  return result
}

/** Valor "a fazer" para desfazer a conclusão de uma linha. */
function todoValue(type: string, options?: { id: string; group?: string }[]): boolean | string | null {
  if (type === 'checkbox') return false
  return options?.find(option => option.group === 'todo')?.id ?? null
}

/** Conclui (ou reabre) a tarefa no lugar. */
export async function completeTask(item: TaskItem, done = true): Promise<string> {
  if (item.kind === 'checklist') return setChecklistChecked(item.pageId, item.blockId!, done)
  const state = getState()
  const row = state.pages[item.pageId]
  const schema = row?.parentId ? state.pages[row.parentId]?.database : undefined
  const property = schema?.properties.find(p => p.id === item.propertyId)
  const done_ = schema && property ? doneProperty(schema, property) : null
  if (!row || !schema || !done_) throw new Error(message('Esta linha não tem propriedade de conclusão.', 'This row has no completion property.'))
  if (row.locked) throw new Error(message('A página está bloqueada. Desbloqueie-a para concluir a tarefa.', 'The page is locked. Unlock it to complete the task.'))
  const value = done ? doneValueFor(done_) : todoValue(done_.type, done_.options)
  if (value === null) throw new Error(message('A propriedade de status não tem uma opção “Concluído”.', 'The status property has no “Complete” option.'))
  actions.setProp(item.pageId, done_.id, value)
  await actions.flushMeta()
  return done ? 'checked' : 'unchecked'
}

/** Abre a página de origem e rola até o bloco (checklist). */
export function openTaskSource(item: TaskItem, newTab = false) {
  const route = { type: 'page' as const, id: item.pageId, ...(item.blockId ? { blockId: item.blockId } : {}) }
  if (newTab) actions.openInNewTab(route)
  else actions.openPage(item.pageId, item.blockId ? { blockId: item.blockId } : {})
}
