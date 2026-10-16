// Recuperação 100% local para "Perguntar às suas notas" (docs/AI.md §4). Puro, sem DOM nem rede.
// Pedaços por seção (título → caminho), BM25 com o normalizador da busca (src/search/normalize.ts)
// e, quando há embeddings locais (Ollama), fusão RRF com a similaridade de cosseno.
import { blockOwnText } from '../search/extract.ts'
import { baseForms, tokenize } from '../search/normalize.ts'

export interface Chunk { id: string; pageId: string; blockId?: string; path: string; text: string; hash: string; vec?: Float32Array }
export interface ChunkHit { chunk: Chunk; title: string; score: number; lexical: number; semantic: number }
export interface SearchChunksOptions { k?: number; accept?: (pageId: string) => boolean; queryVector?: number[] | Float32Array | null; semanticFloor?: number; minLexicalRatio?: number; perPage?: number; center?: boolean }

const STOPWORDS = new Set(('a o as os um uma uns umas de do da dos das em no na nos nas por para pra com sem sobre entre e ou que se nao sim mais menos muito pouco ja como qual quais quando onde quem porque ao aos a isso isto esse essa este esta aquilo foi ser era sao esta estao tem ter ha eu voce voces nos ele ela eles elas meu minha seu sua nosso nossa me te lhe the an of to in on for with and or is are was were be been it this that these those what which who whom when where why how do does did about from by at as into our your my we you they i me us them').split(' '))

/** FNV-1a curto para detectar pedaços inalterados (reaproveita embeddings). */
export function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0 }
  return hash.toString(36) + text.length.toString(36)
}

type AnyBlock = { id?: string; type?: string; props?: Record<string, unknown>; children?: unknown[] }

/** Divide os blocos de uma página em pedaços por seção, com o caminho de títulos e o 1º bloco. */
export function chunkBlocks(pageId: string, blocks: unknown[], maxChars = 900): Chunk[] {
  const chunks: Chunk[] = []
  const trail: string[] = []
  let parts: string[] = [], firstBlock: string | undefined, size = 0
  const flush = () => {
    const text = parts.join('\n').trim()
    if (text) { const path = trail.filter(Boolean).join(' › '); chunks.push({ id: `${pageId}#${chunks.length}`, pageId, blockId: firstBlock, path, text, hash: hashText(path + '\n' + text) }) }
    parts = []; firstBlock = undefined; size = 0
  }
  const add = (text: string, blockId?: string) => {
    if (!text.trim()) return
    // Bloco enorme: corta em frases sem perder o bloco de origem.
    const pieces = text.length > maxChars * 1.5 ? (text.match(new RegExp(`[\\s\\S]{1,${maxChars}}(?:[.!?…]\\s|\\n|$)|[\\s\\S]{1,${maxChars}}`, 'g')) ?? [text]) : [text]
    for (const piece of pieces) {
      if (size && size + piece.length > maxChars) flush()
      if (!parts.length) firstBlock = blockId
      parts.push(piece.trim()); size += piece.length + 1
    }
  }
  const walk = (list: unknown[], depth: number) => {
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue
      const block = raw as AnyBlock
      const id = typeof block.id === 'string' ? block.id : undefined
      const text = blockOwnText(block as never)
      if (block.type === 'heading' && depth === 0) {
        flush()
        const level = Math.min(6, Math.max(1, Number(block.props?.level) || 1))
        trail.length = level - 1; trail[level - 1] = text.trim()
        continue
      }
      add(text, id)
      if (Array.isArray(block.children) && block.children.length) walk(block.children, depth + 1)
    }
  }
  walk(Array.isArray(blocks) ? blocks : [], 0)
  flush()
  return chunks
}

/** Termos da consulta/pedaço: sem palavras vazias; cada palavra contribui com suas formas-base. */
export function terms(text: string): string[] { return tokenize(text).filter(token => token.length > 1 && !STOPWORDS.has(token)) }

function normalize(vector: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(vector as ArrayLike<number>)
  let norm = 0
  for (const value of out) norm += value * value
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < out.length; i++) out[i] /= norm
  return out
}
const dot = (a: Float32Array, b: Float32Array) => { let sum = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) sum += a[i] * b[i]; return sum }

interface Entry { chunk: Chunk; tf: Map<string, number>; length: number }

export class ChunkIndex {
  private entries = new Map<string, Entry>()
  private pages = new Map<string, { title: string; ids: string[]; key: string }>()
  private df = new Map<string, number>()
  private totalLength = 0

  get size() { return this.entries.size }
  get pageCount() { return this.pages.size }
  pageKey(pageId: string) { return this.pages.get(pageId)?.key }
  pageIds() { return [...this.pages.keys()] }
  chunksOf(pageId: string): Chunk[] { return (this.pages.get(pageId)?.ids ?? []).map(id => this.entries.get(id)!.chunk) }
  titleOf(pageId: string) { return this.pages.get(pageId)?.title ?? '' }
  embeddedCount() { let n = 0; for (const entry of this.entries.values()) if (entry.chunk.vec) n++; return n }
  /** Pedaços ainda sem vetor (para o indexador pedir embeddings locais). */
  missingVectors(limit: number, skip?: Set<string>): Chunk[] { const out: Chunk[] = []; for (const entry of this.entries.values()) { if (!entry.chunk.vec && !skip?.has(entry.chunk.id)) out.push(entry.chunk); if (out.length >= limit) break } return out }
  hasVector(chunkId: string) { return !!this.entries.get(chunkId)?.chunk.vec }
  setVector(chunkId: string, vector: ArrayLike<number>) {
    const entry = this.entries.get(chunkId)
    if (!entry) return
    const next = normalize(vector)
    // Vetor nulo (texto ilegível para o embedder) não entra: evita similaridades falsas.
    if (next.every(value => value === 0)) { delete entry.chunk.vec; return }
    entry.chunk.vec = next
    this.meanCache = null
  }
  clearVectors() { for (const entry of this.entries.values()) delete entry.chunk.vec; this.meanCache = null }
  private meanCache: Float32Array | null = null
  /** Média dos vetores (embeddings da Apple são anisotrópicos: centralizar melhora o ranking). */
  private mean(): Float32Array | null {
    if (this.meanCache) return this.meanCache
    let sum: Float32Array | null = null, count = 0
    for (const entry of this.entries.values()) {
      const vec = entry.chunk.vec
      if (!vec) continue
      sum ??= new Float32Array(vec.length)
      if (vec.length !== sum.length) continue
      for (let i = 0; i < vec.length; i++) sum[i] += vec[i]
      count++
    }
    if (!sum || !count) return null
    for (let i = 0; i < sum.length; i++) sum[i] /= count
    return (this.meanCache = sum)
  }

  setPage(pageId: string, title: string, key: string, chunks: Chunk[]) {
    const previous = new Map(this.chunksOf(pageId).map(chunk => [chunk.hash, chunk.vec]))
    this.removePage(pageId)
    const ids: string[] = []
    for (const chunk of chunks) {
      const tf = new Map<string, number>()
      const words = terms(`${title} ${chunk.path} ${chunk.text}`)
      for (const word of words) for (const form of baseForms(word)) tf.set(form, (tf.get(form) ?? 0) + 1)
      for (const form of tf.keys()) this.df.set(form, (this.df.get(form) ?? 0) + 1)
      const vec = chunk.vec ?? previous.get(chunk.hash)
      const stored: Chunk = { ...chunk, ...(vec ? { vec: vec instanceof Float32Array ? vec : normalize(vec) } : {}) }
      this.entries.set(chunk.id, { chunk: stored, tf, length: words.length })
      this.totalLength += words.length
      ids.push(chunk.id)
    }
    this.meanCache = null
    this.pages.set(pageId, { title, ids, key })
  }
  setTitle(pageId: string, title: string) { const page = this.pages.get(pageId); if (page && page.title !== title) this.setPage(pageId, title, page.key, this.chunksOf(pageId)) }
  removePage(pageId: string) {
    const page = this.pages.get(pageId)
    if (!page) return
    for (const id of page.ids) {
      const entry = this.entries.get(id)
      if (!entry) continue
      for (const form of entry.tf.keys()) { const n = (this.df.get(form) ?? 1) - 1; if (n > 0) this.df.set(form, n); else this.df.delete(form) }
      this.totalLength -= entry.length
      this.entries.delete(id)
    }
    this.meanCache = null
    this.pages.delete(pageId)
  }
  clear() { this.meanCache = null; this.entries.clear(); this.pages.clear(); this.df.clear(); this.totalLength = 0 }

  /** Busca híbrida: BM25 + cosseno (se houver vetor da consulta), fundidos por RRF. */
  search(query: string, options: SearchChunksOptions = {}): ChunkHit[] {
    const { k = 6, accept, queryVector, semanticFloor = 0.45, minLexicalRatio = 0.25, perPage = 3, center = false } = options
    const queryTerms = [...new Set(terms(query))]
    const n = this.entries.size
    if (!n) return []
    const average = this.totalLength / n || 1
    const lexical = new Map<string, number>()
    if (queryTerms.length) for (const [id, entry] of this.entries) {
      if (accept && !accept(entry.chunk.pageId)) continue
      let score = 0, matched = 0
      for (const term of queryTerms) {
        let best = 0
        for (const form of baseForms(term)) {
          const tf = entry.tf.get(form)
          if (!tf) continue
          const df = this.df.get(form) ?? 0
          const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
          best = Math.max(best, idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * entry.length / average)))
        }
        if (best) { score += best; matched++ }
      }
      if (score) lexical.set(id, score * Math.sqrt(matched / queryTerms.length))
    }
    const semantic = new Map<string, number>()
    if (queryVector && queryVector.length) {
      const mean = center ? this.mean() : null
      // Cosseno após subtrair a média (vetores unitários): sem alocar um vetor por pedaço.
      const q = normalize(queryVector)
      const qm = mean && mean.length === q.length ? dot(q, mean) : 0, mm = mean ? dot(mean, mean) : 0
      const qNorm2 = mean ? 1 - 2 * qm + mm : 1
      for (const [id, entry] of this.entries) {
        if (!entry.chunk.vec || (accept && !accept(entry.chunk.pageId))) continue
        const vec = entry.chunk.vec
        let similarity = 0
        if (mean && mean.length === vec.length) {
          const vm = dot(vec, mean), vNorm2 = 1 - 2 * vm + mm
          // Vetor praticamente igual à média não carrega informação própria: sem similaridade (evita dividir por ~0).
          if (vNorm2 > 1e-3 && qNorm2 > 1e-3) similarity = (dot(q, vec) - qm - vm + mm) / Math.sqrt(qNorm2 * vNorm2)
        } else similarity = dot(q, vec)
        if (similarity >= semanticFloor) semantic.set(id, similarity)
      }
    }
    const top = Math.max(0, ...lexical.values())
    const lexRanked = [...lexical].filter(([, score]) => score >= top * minLexicalRatio).sort((a, b) => b[1] - a[1]).slice(0, 50)
    const semRanked = [...semantic].sort((a, b) => b[1] - a[1]).slice(0, 50)
    const fused = new Map<string, number>()
    lexRanked.forEach(([id], rank) => fused.set(id, (fused.get(id) ?? 0) + 1 / (60 + rank)))
    semRanked.forEach(([id], rank) => fused.set(id, (fused.get(id) ?? 0) + 1 / (60 + rank)))
    const perPageCount = new Map<string, number>()
    const hits: ChunkHit[] = []
    for (const [id, score] of [...fused].sort((a, b) => b[1] - a[1])) {
      const entry = this.entries.get(id)!
      const count = perPageCount.get(entry.chunk.pageId) ?? 0
      if (count >= perPage) continue
      perPageCount.set(entry.chunk.pageId, count + 1)
      hits.push({ chunk: entry.chunk, title: this.titleOf(entry.chunk.pageId), score, lexical: lexical.get(id) ?? 0, semantic: semantic.get(id) ?? 0 })
      if (hits.length >= k) break
    }
    return hits
  }
}

// ---------- persistência (o arquivo é cifrado no processo principal) ----------
export interface StoredIndex { version: 1; embeddingModel: string; pages: Record<string, { key: string; chunks: { id: string; blockId?: string; path: string; text: string; hash: string; vec?: string }[] }> }

export function vectorToBase64(vector: Float32Array): string {
  const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
export function base64ToVector(text: string): Float32Array | undefined {
  try { const binary = atob(text); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return bytes.length % 4 ? undefined : new Float32Array(bytes.buffer) } catch { return undefined }
}
export function serializeIndex(index: ChunkIndex, embeddingModel: string): StoredIndex {
  const pages: StoredIndex['pages'] = {}
  for (const pageId of index.pageIds()) pages[pageId] = { key: index.pageKey(pageId) ?? '', chunks: index.chunksOf(pageId).map(chunk => ({ id: chunk.id, blockId: chunk.blockId, path: chunk.path, text: chunk.text, hash: chunk.hash, ...(chunk.vec ? { vec: vectorToBase64(chunk.vec) } : {}) })) }
  return { version: 1, embeddingModel, pages }
}
/** Restaura só páginas aceitas (`keep`): protegidas/lixeira/removidas ficam de fora. */
export function restoreIndex(index: ChunkIndex, data: unknown, keep: (pageId: string) => string | null, embeddingModel: string): number {
  const stored = data as StoredIndex | null
  if (!stored || stored.version !== 1 || typeof stored.pages !== 'object') return 0
  const sameModel = stored.embeddingModel === embeddingModel
  let restored = 0
  for (const [pageId, page] of Object.entries(stored.pages)) {
    const title = keep(pageId)
    if (title === null || !Array.isArray(page?.chunks)) continue
    index.setPage(pageId, title, String(page.key ?? ''), page.chunks.filter(c => typeof c?.text === 'string').map(c => ({ id: String(c.id), pageId, blockId: typeof c.blockId === 'string' ? c.blockId : undefined, path: String(c.path ?? ''), text: c.text, hash: String(c.hash ?? hashText(c.text)), ...(sameModel && typeof c.vec === 'string' ? { vec: base64ToVector(c.vec) } : {}) })))
    restored++
  }
  return restored
}

// ---------- citações ----------
export interface CitationPart { text?: string; cite?: number }
/** Divide a resposta em texto e citações `[n]` válidas (1..count); números inexistentes são removidos. */
export function parseCitations(answer: string, count: number): { parts: CitationPart[]; cited: number[] } {
  const parts: CitationPart[] = []
  const cited = new Set<number>()
  let last = 0
  for (const match of answer.matchAll(/\[(\d{1,2}(?:\s*[,;]\s*\d{1,2})*)\]/g)) {
    if (match.index! > last) parts.push({ text: answer.slice(last, match.index) })
    for (const number of match[1].split(/[,;]/).map(value => Number(value.trim()))) if (number >= 1 && number <= count) { parts.push({ cite: number }); cited.add(number) }
    last = match.index! + match[0].length
  }
  if (last < answer.length) parts.push({ text: answer.slice(last) })
  return { parts, cited: [...cited].sort((a, b) => a - b) }
}
