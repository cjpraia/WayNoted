// Ligação do registro de produtividade com a interface: hook de leitura e o backfill em segundo plano.
import { useEffect, useSyncExternalStore } from 'react'
import { api, getState, loadDocForIndex, productivity, selectors } from '../store'
import { protectedAncestor } from '../security/pageLock'
import { blocksToText } from '../components/page/util'
import { runBackfill } from './backfill'
import type { ProductivityData } from '../../electron/productivity-data.mjs'

export function productivityEnabled() { return getState().settings.productivity?.enabled !== false }

/** Dados para exibição (gravados + pendentes); carrega na primeira chamada. */
export function useProductivityData(): { data: ProductivityData; loaded: boolean } {
  useSyncExternalStore(productivity.subscribe, productivity.getVersion)
  useEffect(() => { void productivity.load().catch(() => {}) }, [])
  return { data: productivity.view(), loaded: productivity.loaded() }
}

// ---------- Backfill (uma vez por espaço, em fatias ociosas, cancelável) ----------

export interface BackfillStatus { running: boolean; done: number; total: number; error: string | null }
let status: BackfillStatus = { running: false, done: 0, total: 0, error: null }
let controller: AbortController | null = null
let version = 0
const listeners = new Set<() => void>()
const update = (patch: Partial<BackfillStatus>) => { status = { ...status, ...patch }; version++; listeners.forEach(l => l()) }

export function useBackfillStatus(): BackfillStatus {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => version)
  return status
}

export async function startBackfill(): Promise<void> {
  if (status.running || !productivityEnabled()) return
  const data = await productivity.load()
  if (!data || data.backfilledAt || !productivityEnabled()) return
  controller = new AbortController()
  update({ running: true, done: 0, total: 0, error: null })
  try {
    const { pages } = getState()
    const before = productivity.today(data.trackingSince ?? Date.now())
    const days = await runBackfill({
      pages,
      hidden: id => !!protectedAncestor(pages, id) || !selectors.isLive(id),
      isProtected: id => !!protectedAncestor(pages, id),
      listVersions: id => api.listDocVersions(id),
      loadDoc: id => loadDocForIndex(id),
      toText: blocksToText,
    }, before, { signal: controller.signal, onProgress: (done, total) => update({ done, total }) })
    if (productivityEnabled()) await productivity.backfill(days)
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) update({ error: error instanceof Error ? error.message : String(error) })
  } finally { controller = null; update({ running: false }) }
}

/** Interrompe a reconstrução; ela recomeça na próxima abertura do app. */
export function cancelBackfill() { controller?.abort() }

let scheduled = false
/** Agenda o backfill alguns segundos depois da abertura, para não disputar com o carregamento. */
export function scheduleBackfill(delay = 8000) {
  if (scheduled) return
  scheduled = true
  const timer = setTimeout(() => void startBackfill().catch(() => {}), delay)
  ;(timer as { unref?: () => void }).unref?.()
}
