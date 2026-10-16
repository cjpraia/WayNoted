import COMPAT from '../../shared/compatibility.ts'
// Indexador em segundo plano da janela: mantém o índice de busca sincronizado com a store,
// extrai trechos por bloco (com blockId e contexto), texto de PDFs e, se habilitado, OCR de imagens.
// Incremental: ao salvar uma página só ela é reprocessada; o resto vem do cache em IndexedDB.
import type { Page } from '../types.ts'
import { getState, loadDocForIndex, subscribe } from '../store.ts'
import { searchEngine, searchablePages } from '../components/modals/search.mts'
import { extractSegments, propertyAttachments, type DocumentAttachment, type SearchSegment } from './extract.ts'
import { pageTextKey, type RichEntry } from './engine.ts'
import { searchHooks } from './hooks.ts'
import { cacheDelete, cacheEntries, cachePut } from './cache.ts'
import { imageText, ocrAvailable, pdfPages } from './attachments.ts'

interface StoredRich extends RichEntry { images: number; ocr: boolean }

const OCR_KEY = COMPAT.record055
const VISITS_KEY = COMPAT.record056
const listeners = new Set<() => void>()
let version = 0
let started = false
const queue: string[] = []
const queued = new Set<string>()
const stored = new Map<string, StoredRich>()
let working = false
let pendingAttachments = 0
let visits: Record<string, number> = readVisits()

function bump() { version++; listeners.forEach(listener => listener()) }
export function subscribeIndex(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function indexVersion() { return version }
export function indexStatus() { return { queued: queue.length + (working ? 1 : 0) + searchEngine.pendingCount, attachments: pendingAttachments } }

function readVisits(): Record<string, number> {
  try { const value = JSON.parse(localStorage.getItem(VISITS_KEY) ?? '{}'); return value && typeof value === 'object' ? value : {} } catch { return {} }
}
export function visitCounts() { return visits }
function recordVisit(id: string) {
  visits = { ...visits, [id]: (visits[id] ?? 0) + 1 }
  const entries = Object.entries(visits)
  if (entries.length > 1000) visits = Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, 800))
  try { localStorage.setItem(VISITS_KEY, JSON.stringify(visits)) } catch { /* Per-viewer convenience only. */ }
}

export function ocrEnabled(): boolean {
  try { return ocrAvailable() && localStorage.getItem(OCR_KEY) === '1' } catch { return false }
}
export function setOcrEnabled(enabled: boolean) {
  try { localStorage.setItem(OCR_KEY, enabled ? '1' : '0') } catch { /* ignore */ }
  if (enabled) scheduleStaleScan(0)
  bump()
}

const syncedLabel = (record: { sourcePageId: string }) => getState().pages[record.sourcePageId]?.title || ''

/** Trechos ricos de um documento; anexos com texto ainda não extraído voltam em `pending`. */
async function buildEntry(page: Page, blocks: unknown[], key: string, withAttachments: boolean): Promise<{ entry: StoredRich; pending: DocumentAttachment[] }> {
  const { segments, attachments } = extractSegments(blocks, getState().syncedBlocks, syncedLabel)
  const all = [...attachments, ...propertyAttachments(page.props)]
  const ocr = ocrEnabled()
  const pending: DocumentAttachment[] = []
  const extra: SearchSegment[] = []
  for (const attachment of all) {
    if (attachment.kind === 'pdf') {
      if (!withAttachments) { pending.push(attachment); continue }
      const pages = await pdfPages(attachment.data)
      pages?.forEach((text, i) => { if (text.trim()) extra.push({ text, kind: 'pdf', blockId: attachment.blockId, path: attachment.path, file: attachment.name, pdfPage: i + 1 }) })
    } else if (attachment.kind === 'image' && ocr) {
      if (!withAttachments) { pending.push(attachment); continue }
      const text = await imageText(attachment.data)
      if (text?.trim()) extra.push({ text, kind: 'image', blockId: attachment.blockId, path: attachment.path, file: attachment.name })
    }
    if (attachment.kind !== 'pdf' && !attachment.blockId) extra.push({ text: attachment.name, kind: 'file', file: attachment.name })
  }
  return { entry: { key, segments: [...segments, ...extra], images: all.filter(item => item.kind === 'image').length, ocr }, pending }
}

/** Password-protected pages never enter the index or its on-disk cache (see src/security). */
function forgetProtected(id: string) {
  if (!stored.has(id)) return
  stored.delete(id); searchEngine.setRich(id, null); void cacheDelete('rich', id); bump()
}
function purgeProtected(pages: Record<string, Page>) { for (const id of [...stored.keys()]) if (pages[id]?.passwordLock) forgetProtected(id) }

async function processPage(id: string, blocks?: unknown[]) {
  const page = getState().pages[id]
  if (page?.passwordLock) { forgetProtected(id); return }
  if (!page || page.pendingTemplateBlocks) return
  const key = pageTextKey(page)
  const doc = blocks ?? await loadDocForIndex(id).catch(() => null)
  if (!doc) return
  // Primeiro os blocos (rápido, mantém blockId atualizado ao salvar); depois os anexos.
  const quick = await buildEntry(page, doc, key, false)
  const previous = stored.get(id)
  if (quick.pending.length && previous?.key === key) {
    // Anexos inalterados: reaproveita o texto já extraído.
    const reused = previous.segments.filter(segment => segment.kind === 'pdf' || segment.kind === 'image')
    if (!ocrEnabled() || previous.ocr || !previous.images) quick.pending.length = 0
    quick.entry.segments.push(...reused); quick.entry.ocr = previous.ocr
  }
  apply(id, quick.entry, !quick.pending.length)
  if (!quick.pending.length) return
  // Anexos numa fila própria e sequencial: PDFs grandes não travam a indexação dos blocos.
  pendingAttachments++
  bump()
  attachmentChain = attachmentChain.then(async () => {
    try {
      if (getState().pages[id] && pageTextKey(getState().pages[id]) !== key) return
      const full = await buildEntry(page, doc, key, true)
      if (stored.get(id)?.key === key) apply(id, full.entry, true)
    } catch { /* Anexo ilegível: os blocos continuam indexados. */ } finally { pendingAttachments--; bump() }
  })
}
let attachmentChain: Promise<void> = Promise.resolve()

function apply(id: string, entry: StoredRich, persist: boolean) {
  stored.set(id, entry)
  searchEngine.setRich(id, entry)
  // Nunca grava no IndexedDB (texto claro) o que pertence a uma página protegida.
  if (persist && !getState().pages[id]?.passwordLock) void cachePut('rich', id, entry)
  bump()
}

function isStale(page: Page): boolean {
  if (page.pendingTemplateBlocks || page.passwordLock) return false
  const entry = stored.get(page.id)
  if (!entry || entry.key !== pageTextKey(page)) return !!(page.text?.trim() || entry || hasFileProps(page))
  return ocrEnabled() && entry.images > 0 && !entry.ocr
}
const hasFileProps = (page: Page) => propertyAttachments(page.props).length > 0

function enqueue(id: string, front = false) {
  if (queued.has(id)) return
  queued.add(id)
  if (front) queue.unshift(id); else queue.push(id)
  pump()
}

const idle = (callback: () => void) => {
  const w = globalThis as typeof globalThis & { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }
  if (w.requestIdleCallback) w.requestIdleCallback(callback, { timeout: 500 }); else setTimeout(callback, 16)
}

function pump() {
  if (working || !queue.length) return
  working = true
  idle(async () => {
    const started = performance.now()
    try {
      // Lotes curtos para não disputar a thread com a digitação.
      while (queue.length && performance.now() - started < 12) {
        const id = queue.shift()!
        queued.delete(id)
        const page = getState().pages[id]
        if (page && isStale(page)) await processPage(id)
      }
    } catch { /* Um documento ilegível não interrompe a indexação. */ }
    working = false
    bump()
    if (queue.length) pump()
  })
}

let scanTimer: ReturnType<typeof setTimeout> | null = null
function scheduleStaleScan(delay = 1200) {
  if (scanTimer) clearTimeout(scanTimer)
  scanTimer = setTimeout(() => {
    scanTimer = null
    const pages = getState().pages
    purgeProtected(pages)
    searchEngine.sync(searchablePages(pages))
    for (const page of Object.values(pages)) if (isStale(page)) enqueue(page.id)
  }, delay)
}

/** Inicia o indexador da janela (idempotente). */
export function startSearchIndexer() {
  if (started || typeof window === 'undefined') return
  started = true
  // Reindexações grandes (esquema de um banco com dezenas de milhares de linhas, relação
  // renomeada) vão em fatias de ~8 ms; avisa a interface no fim e no máximo a cada 300 ms.
  let lastProgress = 0
  searchEngine.configure({
    sliceMs: 8,
    onProgress: () => {
      const now = performance.now()
      if (!searchEngine.pendingCount || now - lastProgress > 300) { lastProgress = now; bump() }
    },
  })
  searchHooks.documentIndexed = (id, blocks) => {
    queued.delete(id)
    const index = queue.indexOf(id); if (index >= 0) queue.splice(index, 1)
    void processPage(id, blocks).catch(() => {})
  }
  let lastPages: Record<string, Page> | null = null
  let lastRoute = ''
  let hydrated = false
  const onChange = () => {
    const state = getState()
    if (!state.ready) return
    const route = state.route.type === 'page' ? state.route.id : ''
    if (route && route !== lastRoute) recordVisit(route)
    lastRoute = route
    if (!hydrated) {
      hydrated = true
      void cacheEntries<StoredRich>('rich').then(entries => {
        const pages = getState().pages
        for (const [id, entry] of entries) {
          if (pages[id]?.passwordLock) { void cacheDelete('rich', id); continue }
          if (pages[id] && entry?.key) { stored.set(id, entry); searchEngine.setRich(id, entry) }
        }
        idle(() => { searchEngine.sync(searchablePages(getState().pages)); bump() })
        scheduleStaleScan(800)
      })
    } else if (state.pages !== lastPages) scheduleStaleScan()
    lastPages = state.pages
  }
  subscribe(onChange)
  onChange()
}
