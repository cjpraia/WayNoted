import PRODUCT from '../../shared/product.json' with { type: 'json' }
// Aplica no aplicativo o que mudou no app Lembretes (C3b): título e prazo da tarefa. A conclusão usa completeTask.
// Só edita o que é seguro: página bloqueada, protegida ou na lixeira não é tocada, e itens de checklist com formatação
// além de texto e menção de data ficam como estão (o motivo vai para o registro).
import { actions, api, getState } from '../store.ts'
import { translate } from '../localization.ts'
import { parsedInstant } from '../nlp/dates.ts'
import { protectedAncestor } from '../security/pageLock.ts'
import type { DateValue } from '../types.ts'
import type { TaskItem } from '../tasks/taskCore.ts'

const message = (pt: string, en: string) => translate(getState().settings.locale, pt, en)

type Block = { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: Block[] }
type Inline = { type?: string; text?: string; styles?: Record<string, unknown>; props?: Record<string, unknown> }

function findBlock(list: Block[] | undefined, id: string): Block | null {
  for (const block of list ?? []) {
    if (block?.id === id) return block
    const nested = findBlock(block?.children, id)
    if (nested) return nested
  }
  return null
}

function assertWritable(pageId: string) {
  const { pages } = getState()
  const page = pages[pageId]
  if (!page || page.trashed) throw new Error(message('A página da tarefa não está disponível.', 'The task’s page is unavailable.'))
  if (page.locked) throw new Error(message('A página da tarefa está bloqueada.', 'The task’s page is locked.'))
  if (protectedAncestor(pages, pageId)) throw new Error(message('A página da tarefa está protegida por senha.', 'The task’s page is password protected.'))
}

/** Itens só com texto sem estilo e menções de data podem ser reescritos sem perder formatação. */
export const plainChecklistContent = (content: unknown): boolean => Array.isArray(content) && (content as Inline[]).every(item => item?.type === 'dateMention' || (item?.type === 'text' && Object.keys(item.styles ?? {}).length === 0))

async function editChecklist(item: TaskItem, edit: (block: Block) => void) {
  assertWritable(item.pageId)
  await actions.flushAll()
  const blocks = structuredClone(await api.loadDoc(item.pageId) ?? []) as Block[]
  const block = findBlock(blocks, item.blockId!)
  if (!block || block.type !== 'checkListItem') throw new Error(message('A tarefa não foi encontrada na página.', 'The task was not found on the page.'))
  if (!plainChecklistContent(block.content)) throw new Error(message(`O item tem formatação; edite o título no ${PRODUCT.name}.`, `The item has formatting; edit the title in ${PRODUCT.name}.`))
  edit(block)
  await api.saveDoc(item.pageId, blocks, { checkpoint: true })
  await actions.reloadDocument(item.pageId)
}

export async function applyTitle(item: TaskItem, title: string): Promise<void> {
  const clean = title.trim()
  if (!clean) throw new Error(message(`Título vazio no Lembrete; mantive o do ${PRODUCT.name}.`, `Empty title in Reminders; kept the ${PRODUCT.name} one.`))
  if (item.kind === 'row') {
    const row = getState().pages[item.pageId]
    if (!row || row.locked || row.trashed) throw new Error(message('A linha está bloqueada ou indisponível.', 'The row is locked or unavailable.'))
    actions.updatePage(item.pageId, { title: clean })
    await actions.flushMeta()
    return
  }
  await editChecklist(item, block => {
    const content = (block.content as Inline[])
    const mentions = content.filter(part => part.type === 'dateMention')
    block.content = [{ type: 'text', text: clean + (mentions.length ? ' ' : ''), styles: {} }, ...mentions]
  })
}

export async function applyDue(item: TaskItem, due: string | null, time: string | null): Promise<void> {
  // Sem prazo no Lembrete: o aplicativo mantém o dele (tirar a data tiraria a tarefa das listas).
  if (!due) throw new Error(message(`O Lembrete ficou sem prazo; mantive o do ${PRODUCT.name}.`, `The reminder has no due date; kept the ${PRODUCT.name} one.`))
  if (item.kind === 'row') {
    const row = getState().pages[item.pageId]
    const property = row?.parentId ? getState().pages[row.parentId]?.database?.properties.find(p => p.id === item.propertyId) : undefined
    if (!row || !property || row.locked) throw new Error(message('A linha está bloqueada ou indisponível.', 'The row is locked or unavailable.'))
    const current = (row.props?.[property.id] ?? {}) as Partial<DateValue>
    const next: DateValue = { ...current, start: due }
    if (time) next.startTime = time; else delete next.startTime
    if (next.end && next.end < due) delete next.end
    actions.setProp(item.pageId, property.id, next)
    await actions.flushMeta()
    return
  }
  await editChecklist(item, block => {
    const content = block.content as Inline[]
    const instant = parsedInstant({ start: due, time: time ?? undefined })
    if (instant === null) throw new Error(message('Prazo inválido no Lembrete.', 'Invalid due date in Reminders.'))
    const iso = new Date(instant).toISOString()
    const mention = content.find(part => part.type === 'dateMention')
    if (mention?.props) mention.props = { ...mention.props, date: iso, time: time ?? '', startDate: '' }
    else block.content = [...content.map((part, i) => i === content.length - 1 && part.type === 'text' && part.text && !part.text.endsWith(' ') ? { ...part, text: `${part.text} ` } : part),
      { type: 'dateMention', props: { id: crypto.randomUUID(), date: iso, startDate: '', pageId: item.pageId, repeat: '', reminderId: '', time: time ?? '' } }]
  })
}
