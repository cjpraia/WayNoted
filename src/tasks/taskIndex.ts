// Índice incremental de tarefas: itens de checklist por página, invalidados por página.
// - Ao salvar/abrir um documento (store → searchHooks.documentListeners) só aquela página é reprocessada.
// - Páginas alteradas por outra janela entram numa fila ociosa (fatias de ~10 ms) e são relidas.
// - Cache em IndexedDB ('tasks'); com senha no espaço o cache fica só na memória (src/search/cache.ts).
// - Páginas com senha nunca entram no índice nem no cache.
// A lista final (collectTasks + bucketTasks) é recalculada só quando o índice ou as páginas mudam.
import { useSyncExternalStore } from 'react'
import { getState, loadDocForIndex, subscribe } from '../store.ts'
import { searchHooks } from '../search/hooks.ts'
import { cacheDelete, cacheEntries, cachePut } from '../search/cache.ts'
import { bucketTasks, collectTasks, extractChecklist, type ChecklistEntry, type TaskBuckets, type TaskItem } from './taskCore.ts'
import type { Page } from '../types.ts'

interface Entry { key: string; items: ChecklistEntry[] }
const entries = new Map<string, Entry>()
const checklists = new Map<string, readonly ChecklistEntry[]>()
const listeners = new Set<() => void>()
const queue: string[] = []
const queued = new Set<string>()
let version = 0
let started = false
let working = false
let hydrated = false

const keyOf = (page: Page) => `${page.updatedAt}:${(page.text ?? '').length}`
function bump() { version++; listeners.forEach(listener => listener()) }

function setEntry(id: string, entry: Entry | null, persist = true) {
  const previous = entries.get(id)
  if (!entry) {
    if (!previous) return
    entries.delete(id); checklists.delete(id)
    void cacheDelete('tasks', id)
    bump(); return
  }
  entries.set(id, entry)
  if (entry.items.length) checklists.set(id, entry.items); else checklists.delete(id)
  if (persist && !getState().pages[id]?.passwordLock) void cachePut('tasks', id, entry)
  if (JSON.stringify(previous?.items ?? []) !== JSON.stringify(entry.items)) bump()
}

function indexBlocks(id: string, blocks: unknown[]) {
  const page = getState().pages[id]
  if (!page || page.passwordLock) { setEntry(id, null); return }
  setEntry(id, { key: keyOf(page), items: extractChecklist(blocks) })
}

const idle = (callback: () => void) => {
  const w = globalThis as typeof globalThis & { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }
  if (w.requestIdleCallback) w.requestIdleCallback(callback, { timeout: 800 }); else setTimeout(callback, 16)
}

function pump() {
  if (working || !queue.length) return
  working = true
  idle(async () => {
    const started = performance.now()
    try {
      while (queue.length && performance.now() - started < 10) {
        const id = queue.shift()!
        queued.delete(id)
        const page = getState().pages[id]
        if (!page || page.passwordLock) { setEntry(id, null); continue }
        if (entries.get(id)?.key === keyOf(page)) continue
        const blocks = await loadDocForIndex(id).catch(() => null)
        if (blocks) indexBlocks(id, blocks)
        else setEntry(id, { key: keyOf(page), items: [] })
      }
    } catch { /* Documento ilegível: segue com os demais. */ }
    working = false
    if (queue.length) pump()
  })
}

function enqueue(id: string) { if (!queued.has(id)) { queued.add(id); queue.push(id); pump() } }

let lastPages: Record<string, Page> | null = null
let scanTimer: ReturnType<typeof setTimeout> | null = null
function scan() {
  const { pages } = getState()
  for (const id of [...entries.keys()]) if (!pages[id] || pages[id].passwordLock) setEntry(id, null)
  for (const page of Object.values(pages)) {
    if (page.passwordLock || page.trashed || page.database || page.pendingTemplateBlocks) continue
    const entry = entries.get(page.id)
    if (entry ? entry.key !== keyOf(page) : !!page.text?.trim()) enqueue(page.id)
  }
}

/** Liga o índice (idempotente). */
export function startTaskIndex() {
  if (started || typeof window === 'undefined') return
  started = true
  searchHooks.documentListeners.add((id, blocks) => indexBlocks(id, blocks))
  const onChange = () => {
    const state = getState()
    if (!state.ready || state.pages === lastPages) return
    lastPages = state.pages
    if (!hydrated) {
      hydrated = true
      void cacheEntries<Entry>('tasks').then(list => {
        const pages = getState().pages
        for (const [id, entry] of list) {
          if (!pages[id] || pages[id].passwordLock || !entry || !Array.isArray(entry.items)) { void cacheDelete('tasks', id); continue }
          if (!entries.has(id)) { entries.set(id, entry); if (entry.items.length) checklists.set(id, entry.items) }
        }
        bump(); scan()
      })
      return
    }
    if (scanTimer) clearTimeout(scanTimer)
    scanTimer = setTimeout(() => { scanTimer = null; scan() }, 400)
  }
  subscribe(onChange)
  onChange()
}

export function taskIndexStatus() { return { pending: queue.length + (working ? 1 : 0), indexed: entries.size } }
export function subscribeTasks(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export const taskIndexVersion = () => version

// ---------- Lista memoizada ----------

interface Memo { version: number; pages: Record<string, Page>; locale: string; includeDone: boolean; databaseId: string | null; inherit: boolean; items: TaskItem[] }
let memo: Memo | null = null
let memoDone: Memo | null = null
/** Todas as tarefas abertas (ou também as concluídas, para o painel do calendário). */
export function currentTasks(includeDone = false): TaskItem[] {
  const { pages, settings } = getState()
  const databaseId = settings.dailyFlow?.databaseId ?? null
  const inherit = settings.dailyFlow?.inheritTaskDate !== false
  const cached = includeDone ? memoDone : memo
  if (cached && cached.version === version && cached.pages === pages && cached.locale === settings.locale && cached.databaseId === databaseId && cached.inherit === inherit) return cached.items
  const items = collectTasks({ pages, checklists, locale: settings.locale, includeDone, daily: { databaseId, inherit } })
  const next = { version, pages, locale: settings.locale, includeDone, databaseId, inherit, items }
  if (includeDone) memoDone = next; else memo = next
  return items
}

let bucketMemo: { items: TaskItem[]; today: string; hide: boolean; buckets: TaskBuckets } | null = null
export function currentBuckets(today: string): TaskBuckets {
  const items = currentTasks()
  const hide = getState().settings.dailyFlow?.showInheritedOverdue === false
  if (bucketMemo && bucketMemo.items === items && bucketMemo.today === today && bucketMemo.hide === hide) return bucketMemo.buckets
  bucketMemo = { items, today, hide, buckets: bucketTasks(items, today, undefined, { hideInheritedOverdue: hide }) }
  return bucketMemo.buckets
}

/** Hook: re-renderiza quando o índice muda (a store já re-renderiza por `useStore`). */
export function useTaskIndexVersion(): number {
  return useSyncExternalStore(subscribeTasks, taskIndexVersion, taskIndexVersion)
}

/** Para testes: injeta entradas sem documentos. */
export function __setChecklistForTest(id: string, items: ChecklistEntry[]) { entries.set(id, { key: 'test', items }); if (items.length) checklists.set(id, items); else checklists.delete(id); bump() }
