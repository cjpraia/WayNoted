// Índice invertido incremental da busca global.
//
// Ranking (pontuação maior primeiro; as faixas nunca se sobrepõem porque os ajustes somam < 100):
//   1000 título idêntico à consulta
//    800 título começa com a consulta
//    600 título contém todos os termos
//    400 termos no título/propriedades (ao menos um só nas propriedades)
//    200 corpo, comentários e anexos (PDF, legendas, nomes de arquivo, OCR)
//   ajustes: qualidade do casamento 0…-30 (exato 0, plural -5, prefixo -15, erro de digitação -30),
//            recência de edição 0…+30 (meia-vida de 14 dias), visitas 0…+30;
//   lixeira: -2000 (só aparece com `includeTrash`, sempre depois das páginas vivas).
import type { Page, Property } from '../types.ts'
import { resolveValue } from '../components/database/derived.ts'
import { baseForms, normalizeText, normalizeWithMap, tokenSpans, tokenize, withinOneEdit, FUZZY_MIN_LENGTH } from './normalize.ts'
import type { SearchSegment } from './extract.ts'
import { pageTypeFields, typeDataHidden } from '../objecttypes/model.ts'
import { registeredTypes } from '../objecttypes/registry.ts'

export const TIER = { titleExact: 1000, titlePrefix: 800, titleContains: 600, properties: 400, body: 200 } as const
export type SearchTier = keyof typeof TIER
export const TRASH_PENALTY = 2000
const QUALITY = { exact: 1, form: 0.95, prefix: 0.85, fuzzy: 0.7 }

const F_TITLE = 1, F_PROPS = 2, F_COMMENTS = 4, F_BODY = 8
const fieldOf = (segment: SearchSegment) => segment.kind === 'property' ? F_PROPS : segment.kind === 'comment' ? F_COMMENTS : F_BODY

export interface RichEntry { key: string; segments: SearchSegment[] }
export interface ParsedQuery { terms: string[]; phrases: string[]; excludeTerms: string[]; excludePhrases: string[]; /** Palavras incluídas, na ordem digitada. */ flat: string }
export interface SearchOptions {
  /** Só para consulta vazia (lista de recentes): devolve as `limit` páginas mais recentes, sem pontuar o resto. */
  limit?: number
  mode?: 'all' | 'any' | 'exact'
  content?: 'all' | 'title' | 'body' | 'properties' | 'comments'
  propertyName?: string
  includeTrash?: boolean
  now?: number
  recent?: string[]
  visits?: Record<string, number>
  /** Filtro adicional (escopo, tipo, datas…), aplicado antes da pontuação. */
  accept?: (page: Page, trashed: boolean) => boolean
}
export interface SearchSnippet { text: string; ranges: [number, number][] }
export interface SearchHit {
  page: Page
  score: number
  tier: SearchTier
  trashed: boolean
  segment?: SearchSegment
  snippet?: SearchSnippet
}

interface Doc {
  id: string
  page: Page
  /** Assinatura só do que muda o texto indexável do banco-pai (ver `schemaKey`). */
  schema: string
  /** Páginas citadas pelas relações desta linha (índice reverso em `SearchEngine.referrers`). */
  targets: string[]
  /** O texto depende de propriedades das páginas relacionadas (rollup/fórmula). */
  dependsOnRelated: boolean
  rich?: RichEntry
  title: string
  titleFlat: string
  segments: SearchSegment[]
  tokens: Map<string, number>
  flat?: string[]
  segTokens?: (Set<string> | undefined)[]
}

/** Achata texto normalizado para comparar frases ignorando pontuação. */
export const flatten = (text: string) => ` ${tokenize(text).join(' ')} `

export function parseQuery(query: string, mode: SearchOptions['mode'] = 'all'): ParsedQuery {
  const parsed: ParsedQuery = { terms: [], phrases: [], excludeTerms: [], excludePhrases: [], flat: '' }
  const flat: string[] = []
  const trimmed = query.trim()
  if (!trimmed) return parsed
  if (mode === 'exact') { const phrase = tokenize(trimmed).join(' '); if (phrase) parsed.phrases.push(phrase); parsed.flat = phrase; return parsed }
  for (const match of trimmed.matchAll(/(-?)"([^"]*)"?|(\S+)/g)) {
    if (match[2] !== undefined) {
      const phrase = tokenize(match[2]).join(' ')
      if (phrase) (match[1] ? parsed.excludePhrases : parsed.phrases).push(phrase)
      if (phrase && !match[1]) flat.push(phrase)
      continue
    }
    const raw = match[3]
    const exclude = raw.length > 1 && raw.startsWith('-')
    const words = tokenize(exclude ? raw.slice(1) : raw)
    if (exclude && words.length > 1) parsed.excludePhrases.push(words.join(' '))
    else for (const word of words) { (exclude ? parsed.excludeTerms : parsed.terms).push(word); if (!exclude) flat.push(word) }
  }
  parsed.flat = flat.join(' ')
  return parsed
}

function formatDate(value: number) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : ''
}
/** Texto semântico de um valor tipado; nunca indexa base64 ou ids internos. */
export function valueText(value: unknown, property?: Property, pages: Record<string, Page> = {}): string {
  if (value === null || value === undefined || value === '') return ''
  if (Array.isArray(value)) return value.map(item => valueText(item, property, pages)).filter(Boolean).join(' ')
  if (typeof value === 'boolean') return value && property ? property.name : ''
  if (typeof value === 'number') return property && (property.type === 'createdTime' || property.type === 'updatedTime') ? formatDate(value) : String(value)
  if (typeof value === 'string') {
    if (/^data:/i.test(value)) return ''
    if (property?.type === 'relation') return pages[value]?.title || ''
    return property?.options?.find(option => option.id === value)?.name ?? value
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    return ['name', 'label', 'title', 'text', 'content', 'runs', 'address', 'start', 'end'].map(key => valueText(object[key], undefined, pages)).filter(Boolean).join(' ')
  }
  return ''
}

export function propertySegments(page: Page, pages: Record<string, Page>): SearchSegment[] {
  const properties = page.parentId ? pages[page.parentId]?.database?.properties ?? [] : []
  const out: SearchSegment[] = []
  for (const property of properties) {
    if (property.type === 'title' || property.type === 'button') continue
    let value: unknown
    try { value = resolveValue(page, property, pages) } catch { value = null }
    const text = valueText(value, property, pages)
    if (text.trim()) out.push({ text, kind: 'property', propertyName: property.name })
  }
  // Campos de tipos de objeto (src/objecttypes): indexados como propriedades; nunca de página trancada.
  if (page.types?.length && page.typeProps && !typeDataHidden(page)) for (const { property } of pageTypeFields(registeredTypes(), page)) {
    const text = valueText(page.typeProps[property.id], property, pages)
    if (text.trim()) out.push({ text, kind: 'property', propertyName: property.name })
  }
  return out
}

/** Assinatura dos campos de tipo da página (renomear/converter campo reindexa as páginas do tipo). */
const typeKeys = new WeakMap<object, { types: readonly unknown[]; key: string }>()
export function typeFieldsKey(page: Page): string {
  if (!page.types?.length) return ''
  const types = registeredTypes()
  const cached = typeKeys.get(page.types)
  if (cached && cached.types === types) return cached.key
  const key = '|t' + fingerprint(JSON.stringify(pageTypeFields(types, page).map(({ property }) => [property.id, property.name, property.type, property.options?.map((o) => o.name)])))
  typeKeys.set(page.types, { types, key })
  return key
}

export function fingerprint(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) }
  return `${text.length}:${(hash >>> 0).toString(36)}`
}
const fingerprints = new WeakMap<Page, string>()
/**
 * Chave de validade dos trechos ricos: muda quando o texto do corpo (page.text, que já inclui
 * blocos sincronizados) ou os arquivos das propriedades mudam.
 */
export function pageTextKey(page: Page): string {
  let key = fingerprints.get(page)
  if (key === undefined) {
    const files: string[] = []
    for (const value of Object.values(page.props ?? {})) if (Array.isArray(value)) for (const item of value) if (item && typeof item === 'object' && 'data' in item) files.push(`${(item as { id?: string }).id}:${(item as { size?: number }).size}`)
    key = fingerprint(page.text || '') + (files.length ? '|' + fingerprint(files.join(',')) : '')
    fingerprints.set(page, key)
  }
  return key
}

// Campos da propriedade que não afetam o texto indexado (só aparência/edição).
const SCHEMA_IGNORED = new Set(['color', 'relationPicker', 'buttonActions', 'numberFormat', 'currency', 'dateFormat', 'timeFormat', 'recurrenceOnComplete', 'recurrenceDoneProperty', 'width', 'wrap', 'hidden'])
const schemaByProps = new WeakMap<object, string>()
/**
 * Assinatura do esquema de um banco para a busca: considera só as propriedades (nomes, tipos,
 * opções, fórmulas, relações, rollups). Visualizações (filtros, ordenação, ocultas, larguras,
 * loadLimit…) e demais configurações do banco nunca disparam reindexação.
 */
export function schemaKey(database: { properties?: Property[] } | undefined | null): string {
  const properties = database?.properties
  if (!properties) return ''
  let key = schemaByProps.get(properties)
  if (key === undefined) {
    key = fingerprint(JSON.stringify(properties, (name, value) => SCHEMA_IGNORED.has(name) ? undefined : value))
    schemaByProps.set(properties, key)
  }
  return key
}

export interface SearchEngineOptions {
  /**
   * Orçamento (ms) de cada fatia de reindexação. Sem ele `sync` reindexa tudo na hora (testes,
   * scripts). Com ele, o excedente vai para uma fila processada em fatias ociosas.
   */
  sliceMs?: number
  /** Chamado após cada fatia de reindexação em segundo plano. */
  onProgress?: () => void
  /** Agenda a próxima fatia (padrão: requestIdleCallback/scheduler/setTimeout). */
  schedule?: (callback: () => void) => void
}

const defaultSchedule = (callback: () => void) => {
  const w = globalThis as typeof globalThis & { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }
  if (w.requestIdleCallback) w.requestIdleCallback(callback, { timeout: 200 }); else setTimeout(callback, 0)
}

export class SearchEngine {
  private docs = new Map<string, Doc>()
  private postings = new Map<string, Map<string, number>>()
  private forms = new Map<string, Set<string>>()
  private prefixes = new Map<string, Set<string>>()
  private lengths = new Map<number, Set<string>>()
  private rich = new Map<string, RichEntry>()
  private pagesRef: Record<string, Page> | null = null
  /** alvo da relação → linhas que o citam. */
  private referrers = new Map<string, Set<string>>()
  /** Linhas à espera de reindexação em fatias (ordem de inserção = prioridade). */
  private pending = new Set<string>()
  private scheduled = false
  private idleWaiters: (() => void)[] = []
  private options: SearchEngineOptions

  constructor(options: SearchEngineOptions = {}) { this.options = options }
  configure(options: SearchEngineOptions) { this.options = { ...this.options, ...options } }

  get size() { return this.docs.size }
  get vocabularySize() { return this.postings.size }
  /** Linhas ainda na fila de reindexação em segundo plano. */
  get pendingCount() { return this.pending.size }
  /** Linhas que citam `id` por alguma relação (índice reverso). */
  referrersOf(id: string): string[] { return [...this.referrers.get(id) ?? []] }

  /** Trechos ricos (blocos, PDF, OCR) valem enquanto `key` bate com `page.text`. */
  setRich(id: string, entry: RichEntry | null) {
    if (entry) this.rich.set(id, entry); else this.rich.delete(id)
    const doc = this.docs.get(id)
    if (doc && this.pagesRef) this.index(this.pagesRef[id] ?? doc.page, this.pagesRef)
  }
  richEntry(id: string) { return this.rich.get(id) }
  hasFreshRich(page: Page) { return this.rich.get(page.id)?.key === pageTextKey(page) }

  /**
   * Sincroniza por identidade de objeto: só reindexa páginas que mudaram, linhas cujo esquema
   * (assinatura textual) mudou e linhas que citam por relação uma página renomeada.
   */
  sync(pages: Record<string, Page>) {
    if (this.pagesRef === pages) return
    const previous = this.pagesRef
    this.pagesRef = pages
    const direct: string[] = []
    const cascade = new Set<string>()
    const touch = (target: string, onlyDependent: boolean) => {
      const set = this.referrers.get(target)
      if (set) for (const id of set) if (!onlyDependent || this.docs.get(id)?.dependsOnRelated) cascade.add(id)
    }
    for (const id of [...this.docs.keys()]) if (!pages[id]) { this.remove(id); touch(id, false) }
    const schemas = new Map<string, string>()
    for (const id in pages) {
      const page = pages[id], doc = this.docs.get(id)
      if (!doc) { direct.push(id); if (previous) touch(id, false); continue }
      if (doc.page !== page) {
        direct.push(id)
        if (doc.page.title !== page.title || doc.page.trashed !== page.trashed) touch(id, false)
        else if (doc.page.props !== page.props) touch(id, true)
        continue
      }
      let schema = ''
      if (page.parentId) {
        schema = schemas.get(page.parentId) ?? ''
        if (!schemas.has(page.parentId)) { schema = schemaKey(pages[page.parentId]?.database); schemas.set(page.parentId, schema) }
      }
      const rich = this.rich.get(id)
      schema += typeFieldsKey(page)
      if (doc.schema !== schema || doc.rich !== (rich?.key === pageTextKey(page) ? rich : undefined)) cascade.add(id)
    }
    for (const id of direct) cascade.delete(id)
    // Edições diretas primeiro; o efeito em cascata (esquema, relações) por último.
    const work = direct.length ? (cascade.size ? [...direct, ...cascade] : direct) : [...cascade]
    if (!work.length) return
    const budget = this.options.sliceMs
    if (budget === undefined) { for (const id of work) this.index(pages[id], pages); return }
    const started = performance.now()
    let i = 0
    // Sempre indexa ao menos as edições diretas pequenas (uma linha editada aparece na hora).
    for (; i < work.length; i++) {
      if (i >= 16 && performance.now() - started >= budget) break
      this.index(pages[work[i]], pages)
    }
    for (; i < work.length; i++) this.pending.add(work[i])
    this.schedule()
  }

  /** Processa toda a fila pendente agora (testes e exportações que precisam do índice completo). */
  flush() {
    const pages = this.pagesRef
    if (pages) for (const id of [...this.pending]) this.reindexPending(id, pages)
    this.pending.clear()
    this.resolveIdle()
  }

  /** Resolve quando a fila de reindexação em fatias esvaziar; `onSlice` recebe a duração de cada fatia. */
  whenIdle(onSlice?: (ms: number) => void): Promise<void> {
    if (!this.pending.size) return Promise.resolve()
    if (onSlice) this.sliceListeners.add(onSlice)
    return new Promise(resolve => this.idleWaiters.push(() => { if (onSlice) this.sliceListeners.delete(onSlice); resolve() }))
  }
  private sliceListeners = new Set<(ms: number) => void>()

  private resolveIdle() {
    if (this.pending.size) return
    const waiters = this.idleWaiters; this.idleWaiters = []
    waiters.forEach(resolve => resolve())
  }

  private reindexPending(id: string, pages: Record<string, Page>) {
    this.pending.delete(id)
    const page = pages[id]
    if (page) this.index(page, pages); else this.remove(id)
  }

  private schedule() {
    if (this.scheduled || !this.pending.size) { this.resolveIdle(); return }
    this.scheduled = true
    ;(this.options.schedule ?? defaultSchedule)(() => {
      this.scheduled = false
      const pages = this.pagesRef
      if (!pages) return
      const started = performance.now()
      const budget = this.options.sliceMs ?? 8
      for (const id of this.pending) {
        this.reindexPending(id, pages)
        if (performance.now() - started >= budget) break
      }
      const ms = performance.now() - started
      this.sliceListeners.forEach(listener => listener(ms))
      this.options.onProgress?.()
      if (this.pending.size) this.schedule(); else this.resolveIdle()
    })
  }

  private unlinkTargets(doc: Doc) {
    for (const target of doc.targets) { const set = this.referrers.get(target); set?.delete(doc.id); if (set && !set.size) this.referrers.delete(target) }
  }
  private remove(id: string) {
    const doc = this.docs.get(id)
    if (!doc) return
    this.unlinkTargets(doc)
    for (const token of doc.tokens.keys()) {
      const posting = this.postings.get(token)
      if (!posting) continue
      posting.delete(id)
      if (!posting.size) this.dropToken(token)
    }
    this.docs.delete(id)
  }
  private addToken(token: string) {
    for (const form of baseForms(token)) { let set = this.forms.get(form); if (!set) this.forms.set(form, set = new Set()); set.add(token) }
    for (const key of [token.slice(0, 1), token.slice(0, 2), token.slice(0, 3)]) { if (key.length < 1) continue; let set = this.prefixes.get(key); if (!set) this.prefixes.set(key, set = new Set()); set.add(token) }
    if (token.length >= FUZZY_MIN_LENGTH - 1) { let set = this.lengths.get(token.length); if (!set) this.lengths.set(token.length, set = new Set()); set.add(token) }
  }
  private dropToken(token: string) {
    this.postings.delete(token)
    for (const form of baseForms(token)) { const set = this.forms.get(form); set?.delete(token); if (set && !set.size) this.forms.delete(form) }
    for (const key of [token.slice(0, 1), token.slice(0, 2), token.slice(0, 3)]) { const set = this.prefixes.get(key); set?.delete(token); if (set && !set.size) this.prefixes.delete(key) }
    const set = this.lengths.get(token.length); set?.delete(token)
  }

  private index(page: Page, pages: Record<string, Page>) {
    this.remove(page.id)
    this.pending.delete(page.id)
    const candidate = this.rich.get(page.id)
    const rich = candidate && candidate.key === pageTextKey(page) ? candidate : undefined
    const segments: SearchSegment[] = [...propertySegments(page, pages)]
    for (const comment of page.comments ?? []) if (comment.body?.trim()) segments.push({ text: `${comment.body}`, kind: 'comment', blockId: comment.blockId, commentId: comment.id })
    if (rich) segments.push(...rich.segments)
    else if (page.text?.trim()) segments.push({ text: page.text, kind: 'body' })
    const tokens = new Map<string, number>()
    const add = (token: string, field: number) => tokens.set(token, (tokens.get(token) ?? 0) | field)
    for (const token of tokenize(page.title)) add(token, F_TITLE)
    for (const segment of segments) { const field = fieldOf(segment); for (const token of tokenize(segment.text)) add(token, field) }
    for (const [token, mask] of tokens) {
      let posting = this.postings.get(token)
      if (!posting) { this.postings.set(token, posting = new Map()); this.addToken(token) }
      posting.set(page.id, mask)
    }
    const database = page.parentId ? pages[page.parentId]?.database : undefined
    const targets: string[] = []
    let dependsOnRelated = false
    for (const property of database?.properties ?? []) {
      if (property.type === 'rollup' || property.type === 'formula') dependsOnRelated = true
      if (property.type !== 'relation') continue
      const value = page.props?.[property.id]
      if (typeof value === 'string' && value) targets.push(value)
      else if (Array.isArray(value)) for (const item of value) if (typeof item === 'string' && item) targets.push(item)
    }
    for (const target of targets) { let set = this.referrers.get(target); if (!set) this.referrers.set(target, set = new Set()); set.add(page.id) }
    this.docs.set(page.id, { id: page.id, page, schema: schemaKey(database) + typeFieldsKey(page), targets, dependsOnRelated, rich, title: page.title, titleFlat: tokenize(page.title).join(' '), segments, tokens })
  }

  /** Palavras do vocabulário que casam com um termo, com a qualidade do casamento. */
  expand(term: string, allowLoose = true): Map<string, number> {
    const out = new Map<string, number>()
    const put = (token: string, quality: number) => { if ((out.get(token) ?? 0) < quality) out.set(token, quality) }
    if (this.postings.has(term)) put(term, QUALITY.exact)
    for (const form of baseForms(term)) for (const token of this.forms.get(form) ?? []) put(token, QUALITY.form)
    if (!allowLoose) return out
    if (term.length >= 2) for (const token of this.prefixes.get(term.slice(0, 3)) ?? []) if (token.length > term.length && token.startsWith(term)) put(token, QUALITY.prefix)
    if (term.length >= FUZZY_MIN_LENGTH && !/^\d+$/.test(term)) {
      for (let length = term.length - 1; length <= term.length + 1; length++) for (const token of this.lengths.get(length) ?? []) if (!out.has(token) && withinOneEdit(term, token)) put(token, QUALITY.fuzzy)
    }
    return out
  }

  private flatSegments(doc: Doc): string[] {
    if (!doc.flat) doc.flat = doc.segments.map(segment => flatten(segment.text))
    return doc.flat
  }
  private segmentTokens(doc: Doc, index: number): Set<string> {
    doc.segTokens ??= []
    let set = doc.segTokens[index]
    if (!set) doc.segTokens[index] = set = new Set(tokenize(doc.segments[index].text))
    return set
  }
  private phraseIn(doc: Doc, phrase: string, mask: number): boolean {
    const needle = ` ${phrase} `
    if (mask & F_TITLE && ` ${doc.titleFlat} `.includes(needle)) return true
    const flat = this.flatSegments(doc)
    return doc.segments.some((segment, i) => (fieldOf(segment) & mask) !== 0 && flat[i].includes(needle))
  }

  search(query: string, options: SearchOptions = {}): SearchHit[] {
    const parsed = parseQuery(query, options.mode)
    return this.searchParsed(parsed, options)
  }

  searchParsed(parsed: ParsedQuery, options: SearchOptions = {}): SearchHit[] {
    const now = options.now ?? Date.now()
    const content = options.content ?? 'all'
    const fieldMask = content === 'title' ? F_TITLE : content === 'body' ? F_BODY : content === 'properties' ? F_PROPS : content === 'comments' ? F_COMMENTS : F_TITLE | F_PROPS | F_COMMENTS | F_BODY
    const propertyName = options.propertyName ? normalizeText(options.propertyName.trim()) : ''
    const pages = this.pagesRef ?? {}
    /** 0 viva, 1 na lixeira (própria ou ancestral), 2 ciclo malformado (nunca listada). */
    const status = (page: Page) => { let current: Page | undefined = page, trashed = false; const seen = new Set<string>(); while (current) { if (current.trashed) trashed = true; if (seen.has(current.id)) return 2; seen.add(current.id); current = current.parentId ? pages[current.parentId] : undefined } return trashed ? 1 : 0 }
    const phraseWords = parsed.phrases.flatMap(phrase => phrase.split(' '))
    const terms = [...new Set([...parsed.terms])]
    const required = [...terms.map(term => ({ term, loose: true })), ...[...new Set(phraseWords)].filter(word => !terms.includes(word)).map(term => ({ term, loose: false }))]
    const expansions = required.map(({ term, loose }) => this.expand(term, loose))

    // Por termo: doc → [qualidade no título, nas propriedades, no resto]
    const perTerm: Map<string, [number, number, number]>[] = expansions.map(expansion => {
      const docs = new Map<string, [number, number, number]>()
      for (const [token, quality] of expansion) {
        const posting = this.postings.get(token)
        if (!posting) continue
        for (const [id, rawMask] of posting) {
          const mask = rawMask & fieldMask
          if (!mask) continue
          let entry = docs.get(id)
          if (!entry) docs.set(id, entry = [0, 0, 0])
          if (mask & F_TITLE && entry[0] < quality) entry[0] = quality
          if (mask & F_PROPS && entry[1] < quality) entry[1] = quality
          if (mask & (F_COMMENTS | F_BODY) && entry[2] < quality) entry[2] = quality
        }
      }
      return docs
    })
    let candidates: Iterable<string>
    if (!required.length) {
      // Consulta vazia com `limit`: percorre das mais recentes e para ao completar (Doherty: ⌘K em 22 mil páginas).
      candidates = options.limit && !options.includeTrash ? [...this.docs.values()].sort((a, b) => b.page.updatedAt - a.page.updatedAt || a.page.id.localeCompare(b.page.id)).map(doc => doc.page.id) : this.docs.keys()
    }
    else if (options.mode === 'any') { const union = new Set<string>(); for (const docs of perTerm) for (const id of docs.keys()) union.add(id); candidates = union }
    else {
      const order = perTerm.map((docs, i) => i).sort((a, b) => perTerm[a].size - perTerm[b].size)
      candidates = [...perTerm[order[0]].keys()].filter(id => order.every(i => perTerm[i].has(id)))
    }
    const excluded = new Set<string>()
    for (const term of parsed.excludeTerms) for (const token of this.expand(term, false).keys()) for (const id of this.postings.get(token)?.keys() ?? []) excluded.add(id)

    const recentIndex = new Map((options.recent ?? []).map((id, i) => [id, i]))
    const queryFlat = parsed.flat
    const hits: SearchHit[] = []
    const stopAt = !required.length && options.limit && !options.includeTrash ? options.limit : Infinity
    for (const id of candidates) {
      if (hits.length >= stopAt) break
      if (excluded.has(id)) continue
      const doc = this.docs.get(id)
      if (!doc) continue
      const state = status(doc.page)
      if (state === 2) continue
      const trashed = state === 1
      if (trashed && !options.includeTrash) continue
      if (options.accept && !options.accept(doc.page, trashed)) continue
      if (parsed.excludePhrases.some(phrase => this.phraseIn(doc, phrase, F_TITLE | F_PROPS | F_COMMENTS | F_BODY))) continue
      if (parsed.phrases.length && !parsed.phrases.every(phrase => this.phraseIn(doc, phrase, fieldMask))) continue
      if (propertyName) {
        const named = doc.segments.map((segment, i) => ({ segment, i })).filter(({ segment }) => segment.kind === 'property' && normalizeText(segment.propertyName ?? '') === propertyName)
        if (!named.length) continue
        if (required.length && !expansions.every(expansion => named.some(({ i }) => [...this.segmentTokens(doc, i)].some(token => expansion.has(token))))) continue
      }
      let tier: SearchTier = 'body', quality = 1
      if (required.length) {
        const entries = perTerm.map(docs => docs.get(id)).filter((entry): entry is [number, number, number] => !!entry)
        const inTitle = entries.every(entry => entry[0] > 0) && parsed.phrases.every(phrase => ` ${doc.titleFlat} `.includes(` ${phrase} `))
        const inTitleOrProps = entries.every(entry => entry[0] > 0 || entry[1] > 0)
        if (inTitle && fieldMask & F_TITLE) {
          tier = doc.titleFlat === queryFlat ? 'titleExact' : doc.titleFlat.startsWith(queryFlat) ? 'titlePrefix' : 'titleContains'
          quality = entries.reduce((sum, entry) => sum + entry[0], 0) / entries.length
        } else if (inTitleOrProps) {
          tier = 'properties'
          quality = entries.reduce((sum, entry) => sum + Math.max(entry[0], entry[1]), 0) / entries.length
        } else quality = entries.reduce((sum, entry) => sum + Math.max(...entry), 0) / entries.length
      }
      const ageDays = Math.max(0, now - doc.page.updatedAt) / 86400000
      const recency = 30 * Math.pow(0.5, ageDays / 14)
      const position = recentIndex.get(id)
      const visits = Math.min(30, (position === undefined ? 0 : 15 * (1 - position / 50)) + Math.min(15, 5 * Math.log2(1 + (options.visits?.[id] ?? 0))))
      const score = TIER[tier] + Math.round((quality - 1) * 100) + recency + visits - (trashed ? TRASH_PENALTY : 0)
      hits.push({ page: doc.page, score, tier, trashed })
    }
    hits.sort((a, b) => b.score - a.score || b.page.updatedAt - a.page.updatedAt || a.page.id.localeCompare(b.page.id))
    return hits
  }

  private expansions(query: string, mode?: SearchOptions['mode']) {
    const parsed = parseQuery(query, mode)
    const words = [...parsed.terms, ...parsed.phrases.flatMap(phrase => phrase.split(' '))]
    return words.map((word, i) => this.expand(word, i < parsed.terms.length))
  }
  /** Palavras do índice que a consulta casa (para destacar títulos). */
  matchSet(query: string, mode?: SearchOptions['mode']): Set<string> {
    const matched = new Set<string>()
    for (const expansion of this.expansions(query, mode)) for (const token of expansion.keys()) matched.add(token)
    return matched
  }

  /** Trecho em que a consulta aparece (com destaques) e o bloco a abrir. Chame só para os resultados visíveis. */
  locate(hit: SearchHit, query: string, options: Pick<SearchOptions, 'mode' | 'content'> = {}): SearchHit {
    const doc = this.docs.get(hit.page.id)
    if (!doc) return hit
    const expansions = this.expansions(query, options.mode)
    if (!expansions.length) return hit
    const matched = new Set<string>(); for (const expansion of expansions) for (const token of expansion.keys()) matched.add(token)
    const content = options.content ?? 'all'
    const allowed = (segment: SearchSegment) => content === 'all' || (content === 'body' ? fieldOf(segment) === F_BODY : content === 'properties' ? segment.kind === 'property' : content === 'comments' ? segment.kind === 'comment' : false)
    let best = -1, bestCount = 0
    const preferProps = hit.tier === 'properties'
    doc.segments.forEach((segment, i) => {
      if (!allowed(segment)) return
      const tokens = this.segmentTokens(doc, i)
      let count = 0
      for (const expansion of expansions) for (const token of tokens) if (expansion.has(token)) { count++; break }
      if (!count) return
      const weight = count * 10 + (preferProps && segment.kind === 'property' ? 5 : 0) + (segment.blockId ? 1 : 0)
      if (weight > bestCount) { best = i; bestCount = weight }
    })
    if (best < 0) return hit
    const segment = doc.segments[best]
    return { ...hit, segment, snippet: makeSnippet(segment.text, matched) }
  }
}

/** Faixas (no texto original) das palavras casadas. */
export function highlightRanges(text: string, matched: Set<string>): [number, number][] {
  const { text: normalized, map } = normalizeWithMap(text)
  return tokenSpans(normalized).filter(span => matched.has(span.token)).map(span => [map[span.start], map[span.end]])
}

/** Recorta ~120 caracteres em volta do primeiro termo e devolve faixas a destacar. */
export function makeSnippet(text: string, matched: Set<string>, radius = 48, length = 140): SearchSnippet {
  const { text: normalized, map } = normalizeWithMap(text)
  const spans = tokenSpans(normalized).filter(span => matched.has(span.token))
  const first = spans[0]
  const originalStart = first ? map[first.start] : 0
  let start = Math.max(0, originalStart - radius)
  if (start > 0) { const space = text.lastIndexOf(' ', originalStart - radius / 2); if (space > start) start = space + 1 }
  let end = Math.min(text.length, start + length)
  if (end < text.length) { const space = text.indexOf(' ', end); if (space > 0 && space - end < 20) end = space }
  const prefix = start > 0 ? '…' : '', suffix = end < text.length ? '…' : ''
  const raw = text.slice(start, end)
  const body = raw.replace(/\s/g, ' ')
  const ranges: [number, number][] = []
  for (const span of spans) {
    const a = map[span.start], b = map[span.end]
    if (a >= start && b <= end) ranges.push([a - start + prefix.length, b - start + prefix.length])
  }
  return { text: prefix + body + suffix, ranges }
}
