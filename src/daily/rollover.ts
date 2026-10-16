// "Trazer tarefas atrasadas para hoje": move ou copia itens de checklist em aberto de notas diárias
// anteriores (data herdada) para a nota de hoje. Sempre manual; nunca automático.
import { actions, api, getState } from '../store.ts'
import { translate } from '../localization.ts'
import { ensureDailyNote, today } from './dailyNotes.ts'
import type { TaskItem } from '../tasks/taskCore.ts'

type MutableBlock = { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: MutableBlock[] }
const message = (pt: string, en: string) => translate(getState().settings.locale, pt, en)

/** Tarefas abertas de notas diárias passadas cuja data é herdada da nota (as com data própria ficam onde estão). */
export function rolloverCandidates(items: readonly TaskItem[], day: string): TaskItem[] {
  return items.filter(item => item.kind === 'checklist' && item.inherited && !item.done && !!item.due && item.due < day)
    .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? '') || a.key.localeCompare(b.key))
}

/** Remove o bloco (e devolve-o) de dentro da árvore; com `remove` falso só devolve uma cópia. */
export function takeBlock(list: MutableBlock[], id: string, remove: boolean): MutableBlock | null {
  for (let i = 0; i < list.length; i++) {
    const block = list[i]
    if (block?.id === id) { if (remove) list.splice(i, 1); return block }
    if (Array.isArray(block?.children)) { const nested = takeBlock(block.children, id, remove); if (nested) return nested }
  }
  return null
}

function fresh(block: MutableBlock): MutableBlock {
  const copy = structuredClone(block)
  const rename = (item: MutableBlock) => { item.id = crypto.randomUUID(); for (const child of item.children ?? []) rename(child) }
  rename(copy)
  copy.props = { ...copy.props, checked: false }
  return copy
}

export interface RolloverResult { done: number; skipped: number; todayId: string }

export async function rolloverTasks(items: readonly TaskItem[], mode: 'move' | 'copy'): Promise<RolloverResult> {
  const day = today()
  const candidates = rolloverCandidates(items, day)
  const todayId = await ensureDailyNote(day)
  await actions.flushAll()
  const pages = getState().pages
  const byPage = new Map<string, TaskItem[]>()
  for (const item of candidates) {
    const page = pages[item.pageId]
    if (!page || page.trashed || page.passwordLock || page.locked || item.pageId === todayId) continue
    byPage.set(item.pageId, [...(byPage.get(item.pageId) ?? []), item])
  }
  const moving: MutableBlock[] = []
  const sources: { pageId: string; blocks: MutableBlock[] }[] = []
  for (const [pageId, list] of byPage) {
    const blocks = structuredClone(await api.loadDoc(pageId) ?? []) as MutableBlock[]
    let touched = false
    for (const item of list) {
      const block = takeBlock(blocks, item.blockId!, mode === 'move')
      if (block && block.type === 'checkListItem') { moving.push(fresh(block)); touched = true }
    }
    if (touched && mode === 'move') sources.push({ pageId, blocks })
  }
  if (moving.length) {
    // Primeiro grava o destino; só depois tira dos originais (nada se perde se a gravação falhar).
    const target = structuredClone(await api.loadDoc(todayId) ?? []) as MutableBlock[]
    await api.saveDoc(todayId, [...target, ...moving], { checkpoint: true })
    for (const source of sources) await api.saveDoc(source.pageId, source.blocks, { checkpoint: true })
    for (const id of [todayId, ...sources.map(source => source.pageId)]) await actions.reloadDocument(id)
  }
  return { done: moving.length, skipped: candidates.length - moving.length, todayId }
}

export const rolloverLabel = (mode: 'move' | 'copy') => mode === 'move' ? message('Mover', 'Move') : message('Copiar', 'Copy')
