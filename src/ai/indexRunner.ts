// Indexador de "Perguntar às suas notas": mantém o ChunkIndex sincronizado com a store em fatias
// idle, pede embeddings ao Ollama local (se houver) e persiste via processo principal (cifrado).
// Fora do índice: páginas protegidas (mesmo desbloqueadas), lixeira e o espaço bloqueado.
import { getState, loadDocForIndex, subscribe } from '../store.ts'
import { searchHooks } from '../search/hooks.ts'
import { protectedAncestor } from '../security/pageLock.ts'
import { ancestry, propertySearchText } from '../components/modals/search.mts'
import type { Page } from '../types.ts'
import { getAIBridge } from './bridge.ts'
import { aiSettings, refreshAISettings } from './settingsStore.ts'
import type { EmbedStatus } from './types.ts'
import { ChunkIndex, chunkBlocks, hashText, restoreIndex, serializeIndex, type Chunk } from './retrieval.ts'

export type EmbedBackend = 'ollama' | 'apple' | 'none'
export interface IndexProgress { total: number; done: number; chunks: number; embedded: number; semantic: 'pending' | 'on' | 'unavailable'; building: boolean; backend: EmbedBackend }
export const askIndex = new ChunkIndex()
const listeners = new Set<() => void>()
let progress: IndexProgress = { total: 0, done: 0, chunks: 0, embedded: 0, semantic: 'pending', building: false, backend: 'none' }
let started = false
const queue: string[] = []
const queued = new Set<string>()
/** Chave dos vetores guardados (Ollama: nome do modelo, como antes; Apple: `apple:<modelo>`). */
let embedKey = ''
const skipped = new Set<string>()
let rerunEmbedding = false
let working = false, saveTimer: ReturnType<typeof setTimeout> | null = null, embedding = false

function emit(patch: Partial<IndexProgress> = {}) {
  progress = { ...progress, ...patch, chunks: askIndex.size, embedded: askIndex.embeddedCount() }
  listeners.forEach(listener => listener())
}
export function subscribeAskIndex(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function askIndexProgress() { return progress }

/** Página pode entrar no índice? Viva, não protegida, não é quadro/banco vazio. */
export function indexable(page: Page | undefined, pages: Record<string, Page>): boolean {
  return !!page && !!ancestry(page.id, pages) && !protectedAncestor(pages, page.id)
}
const pageKey = (page: Page) => `${page.updatedAt}:${hashText(page.title)}`

const idle = (fn: () => void) => {
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 1500 }); else setTimeout(fn, 30)
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    const bridge = getAIBridge()
    if (!bridge) return
    void bridge.aiSaveIndex(serializeIndex(askIndex, embedKey || aiSettings()?.embeddingModel || '')).catch(() => {})
  }, 3000)
}

function enqueue(id: string) { if (!queued.has(id)) { queued.add(id); queue.push(id) } }

async function indexPage(id: string, blocks?: unknown[]) {
  const pages = getState().pages, page = pages[id]
  if (!indexable(page, pages)) { if (askIndex.pageKey(id) !== undefined) { askIndex.removePage(id); scheduleSave() } return }
  const docs = blocks ?? await loadDocForIndex(id).catch(() => null) ?? []
  const chunks: Chunk[] = chunkBlocks(id, docs)
  const props = page!.props ? propertySearchText(page!, pages) : ''
  if (props.trim()) chunks.push({ id: `${id}#props`, pageId: id, path: '', text: props, hash: hashText(props) })
  if (!chunks.length && page!.title.trim()) chunks.push({ id: `${id}#title`, pageId: id, path: '', text: page!.title, hash: hashText(page!.title) })
  askIndex.setPage(id, page!.title, pageKey(page!), chunks)
  scheduleSave()
}

/** Processa a fila em fatias de ~12 ms sem travar a interface. */
function pump() {
  if (working) return
  working = true
  emit({ building: true })
  const step = async () => {
    const started = performance.now()
    while (queue.length && performance.now() - started < 12) {
      const id = queue.shift()!; queued.delete(id)
      await indexPage(id)
      progress.done++
    }
    emit()
    if (queue.length) idle(() => void step())
    else { working = false; emit({ building: false }); void embedPending() }
  }
  idle(() => void step())
}

/** Qual mecanismo de embeddings local vale agora (Automático: Ollama com modelo → Apple → só léxico). */
async function resolveBackend(): Promise<{ backend: EmbedBackend; key: string }> {
  const bridge = getAIBridge()
  if (!bridge) return { backend: 'none', key: '' }
  if (!bridge.aiEmbedStatus) return { backend: 'ollama', key: aiSettings()?.embeddingModel ?? '' } // ponte antiga: só Ollama
  try {
    const status: EmbedStatus = await bridge.aiEmbedStatus()
    if (status.backend === 'none') return { backend: 'none', key: '' }
    return { backend: status.backend, key: status.backend === 'ollama' ? status.model : `apple:${status.model}` }
  } catch { return { backend: 'none', key: '' } }
}

/** Limiar e centralização por mecanismo (os cossenos da Apple ficam todos altos; centralizar separa melhor). */
export const embedSearchOptions = (backend: EmbedBackend) => backend === 'apple' ? { center: true, semanticFloor: 0.12 } : {}

/** Embeddings 100% locais (Ollama em loopback ou Apple no helper), em lotes e com pausas; sem nenhum => só léxico. */
async function embedPending() {
  const bridge = getAIBridge()
  if (!bridge) return
  if (embedding) { rerunEmbedding = true; return }
  embedding = true
  try {
    const { backend, key } = await resolveBackend()
    if (backend === 'none') { emit({ semantic: 'unavailable', backend }); return }
    if (embedKey && key !== embedKey) { askIndex.clearVectors(); scheduleSave() } // vetores de outro mecanismo não se misturam
    embedKey = key
    emit({ backend, semantic: askIndex.embeddedCount() ? 'on' : 'pending' })
    for (let rounds = 0; rounds < 10000; rounds++) {
      const batch = askIndex.missingVectors(backend === 'apple' ? 8 : 16, skipped)
      if (!batch.length) break
      const vectors = await bridge.aiEmbed(batch.map(chunk => `${askIndex.titleOf(chunk.pageId)}\n${chunk.path}\n${chunk.text}`.slice(0, 7000)))
      // Chunk sem vetor útil não pode ficar para sempre na fila: marca com vetor nulo ignorado na busca.
      batch.forEach((chunk, i) => { askIndex.setVector(chunk.id, vectors[i]); if (!askIndex.hasVector(chunk.id)) skipped.add(chunk.id) })
      emit({ semantic: 'on' })
      scheduleSave()
      if (backend === 'apple') await new Promise(resolve => setTimeout(resolve, 200)) // baixa prioridade: não disputa CPU com a interface
      await new Promise(resolve => idle(() => resolve(null)))
    }
    if (askIndex.size) emit({ semantic: askIndex.embeddedCount() ? 'on' : progress.semantic })
  } catch { emit({ semantic: 'unavailable' }) }
  finally { embedding = false; if (rerunEmbedding) { rerunEmbedding = false; void embedPending() } }
}

/** Reavalia o mecanismo (ex.: o usuário mudou "Embeddings" nas Configurações) e reembute o que for preciso. */
export async function refreshEmbeddingBackend() {
  if (!started) return
  skipped.clear()
  emit({ semantic: 'pending' })
  await embedPending()
}

function scanStale() {
  const pages = getState().pages
  let removed = false
  for (const id of askIndex.pageIds()) if (!indexable(pages[id], pages)) { askIndex.removePage(id); removed = true }
  if (removed) scheduleSave() // o índice salvo não pode manter trechos de páginas que viraram protegidas
  let added = 0
  for (const page of Object.values(pages)) {
    if (!indexable(page, pages)) continue
    if (askIndex.pageKey(page.id) !== pageKey(page)) { enqueue(page.id); added++ }
  }
  if (added) { progress.total = progress.done + queue.length; pump() } else emit()
}

/** Inicia (idempotente): restaura o índice salvo e agenda o que mudou. */
export async function startAskIndex() {
  if (started || typeof window === 'undefined') return
  const bridge = getAIBridge()
  if (!bridge) return
  started = true
  const settings = aiSettings() ?? await refreshAISettings().catch(() => null)
  const stored = await bridge.aiLoadIndex().catch(() => null)
  const pages = getState().pages
  // Vetores guardados valem enquanto o mecanismo atual (ou, sem nenhum, o que os gerou) for o mesmo.
  const current = await resolveBackend()
  const storedKey = (stored as { embeddingModel?: string } | null)?.embeddingModel
  embedKey = current.key || (typeof storedKey === 'string' ? storedKey : settings?.embeddingModel ?? '')
  restoreIndex(askIndex, stored, id => indexable(pages[id], pages) ? pages[id].title : null, embedKey)
  emit({ backend: current.backend })
  searchHooks.documentListeners.add((id) => { enqueue(id); progress.total = progress.done + queue.length; pump() })
  let lastPages = getState().pages
  let timer: ReturnType<typeof setTimeout> | null = null
  subscribe(() => {
    const state = getState()
    if (!state.ready || state.pages === lastPages) return
    lastPages = state.pages
    if (timer) clearTimeout(timer)
    timer = setTimeout(scanStale, 1200)
  })
  scanStale()
  if (!working) void embedPending() // páginas restauradas sem vetor (mecanismo novo ou chunks adiados)
}

/** Reconstrói tudo do zero (botão "Reindexar"); tenta de novo os embeddings locais. */
export function reindexAll() {
  askIndex.clear()
  queue.length = 0; queued.clear(); skipped.clear()
  progress = { total: 0, done: 0, chunks: 0, embedded: 0, semantic: 'pending', building: false, backend: progress.backend }
  scanStale()
  if (!queue.length) void embedPending()
}

/** Busca com vetor local da pergunta, se o semântico estiver ativo. */
export async function searchNotes(question: string, options: { k?: number; accept?: (pageId: string) => boolean }) {
  let queryVector: number[] | null = null
  const bridge = getAIBridge()
  if (bridge && progress.backend !== 'none' && askIndex.embeddedCount()) { try { queryVector = (await bridge.aiEmbed([question]))[0] ?? null } catch { queryVector = null } }
  const pages = getState().pages
  return askIndex.search(question, { ...embedSearchOptions(progress.backend), ...options, queryVector, accept: id => indexable(pages[id], pages) && (!options.accept || options.accept(id)) })
}
