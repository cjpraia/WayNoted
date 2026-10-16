import COMPAT from '../../shared/compatibility.ts'
// Ponte entre a store, o contador em memória e o armazenamento do espaço (productivity.json no
// Electron, localStorage no navegador). Grava em lote com debounce; nada é varrido a cada tecla.
import { applyBackfill, applyDelta, clearedData, dayKey, emptyData, normalizeData, type ProductivityData, type ProductivityDay, type ProductivityDelta } from '../../electron/productivity-data.mjs'
import type { NativeApi } from '../types'
import { ActivityRecorder } from './recorder.ts'
import type { DocStats } from './words.ts'

export const LS_PRODUCTIVITY = COMPAT.record024
/** Espera entre o primeiro incremento pendente e a gravação. */
export const FLUSH_DELAY_MS = 15000

type Locked = { locked: true }
export interface ProductivityBackend {
  load(): Promise<ProductivityData | null>
  record(delta: ProductivityDelta): Promise<ProductivityData | Locked>
  backfill(days: Record<string, Partial<ProductivityDay>>): Promise<ProductivityData | Locked>
  clear(): Promise<ProductivityData | Locked>
  /** Gravação síncrona (fechamento da aba no navegador). */
  recordSync?(delta: ProductivityDelta): void
}

export function browserBackend(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage, key = LS_PRODUCTIVITY): ProductivityBackend {
  const read = () => { try { return normalizeData(JSON.parse(storage.getItem(key) ?? 'null')) } catch { return emptyData() } }
  const write = (data: ProductivityData) => { storage.setItem(key, JSON.stringify(data)); return data }
  return {
    async load() { return read() },
    async record(delta) { return write(applyDelta(read(), delta)) },
    async backfill(days) { const current = read(); return current.backfilledAt ? current : write(applyBackfill(current, days)) },
    async clear() { return write(clearedData()) },
    recordSync(delta) { write(applyDelta(read(), delta)) },
  }
}

export function nativeBackend(api: NativeApi): ProductivityBackend | null {
  if (!api.productivityLoad || !api.productivityRecord || !api.productivityBackfill || !api.productivityClear) return null
  return { load: () => api.productivityLoad!(), record: delta => api.productivityRecord!(delta), backfill: days => api.productivityBackfill!(days), clear: () => api.productivityClear!() }
}

const isLocked = (value: unknown): value is Locked => !!value && typeof value === 'object' && (value as Locked).locked === true

export class ProductivityClient {
  readonly recorder: ActivityRecorder
  private data: ProductivityData | null = null
  private loading: Promise<ProductivityData | null> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private writing: Promise<void> | null = null
  private listeners = new Set<() => void>()
  private version = 0
  private cached: { version: number; value: ProductivityData } | null = null
  error: string | null = null

  private readonly backend: ProductivityBackend
  private readonly enabled: () => boolean
  private readonly delay: number

  constructor(backend: ProductivityBackend, enabled: () => boolean, recorder?: ActivityRecorder, delay = FLUSH_DELAY_MS) {
    this.backend = backend
    this.enabled = enabled
    this.delay = delay
    this.recorder = recorder ?? new ActivityRecorder()
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getVersion = () => this.version
  private changed() { this.version++; this.listeners.forEach(listener => listener()) }

  async load(force = false): Promise<ProductivityData | null> {
    if (this.data && !force) return this.data
    if (!this.loading) this.loading = this.backend.load().then(data => { this.data = data ? normalizeData(data) : null; this.changed(); return this.data }).finally(() => { this.loading = null })
    return this.loading
  }

  /** Dados gravados + incrementos ainda na memória (o painel mostra tudo sem esperar a gravação). */
  view(): ProductivityData {
    if (this.cached?.version === this.version) return this.cached.value
    const pending = this.recorder.peek()
    const value = pending ? applyDelta(this.data ?? emptyData(), pending) : this.data ?? emptyData()
    this.cached = { version: this.version, value }
    return value
  }

  loaded() { return this.data !== null }

  private schedule() {
    this.changed()
    if (this.timer) return
    this.timer = setTimeout(() => { this.timer = null; void this.flush().catch(() => {}) }, this.delay)
    ;(this.timer as { unref?: () => void }).unref?.()
  }

  docSaved(pageId: string, before: DocStats, after: DocStats, named: boolean) { if (!this.enabled()) return; this.recorder.docSaved(pageId, before, after, named); this.schedule() }
  edited(pageId: string, named: boolean) { if (!this.enabled()) return; this.recorder.edited(pageId, named); this.schedule() }
  created(pageId: string, named: boolean) { if (!this.enabled()) return; this.recorder.created(pageId, named); this.schedule() }
  taskCompleted(rowId: string, named: boolean) { if (!this.enabled()) return; this.recorder.taskCompleted(rowId, named); this.schedule() }

  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (this.writing) { await this.writing; if (!this.recorder.hasPending()) return }
    if (!this.enabled()) { this.recorder.reset(); return }
    const delta = this.recorder.take()
    if (!delta) return
    this.writing = (async () => {
      try {
        const result = await this.backend.record(delta)
        // Espaço bloqueado: nada é gravado; os incrementos ficam na memória até o desbloqueio.
        if (isLocked(result)) { this.recorder.restore(delta); return }
        this.data = normalizeData(result)
        this.error = null
      } catch (error) {
        this.recorder.restore(delta)
        this.error = error instanceof Error ? error.message : String(error)
      } finally { this.changed() }
    })()
    try { await this.writing } finally { this.writing = null }
  }

  /** Fechamento da aba no navegador: grava de forma síncrona o que houver. */
  flushSync() {
    if (!this.backend.recordSync || !this.enabled()) return
    const delta = this.recorder.take()
    if (delta) { try { this.backend.recordSync(delta) } catch { this.recorder.restore(delta) } }
  }

  async backfill(days: Record<string, Partial<ProductivityDay>>) {
    const result = await this.backend.backfill(days)
    if (!isLocked(result)) { this.data = normalizeData(result); this.changed() }
  }

  async clear() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (this.writing) await this.writing
    this.recorder.reset()
    const result = await this.backend.clear()
    if (isLocked(result)) throw new Error('VAULT_LOCKED')
    this.data = normalizeData(result)
    this.changed()
  }

  /** Registro desligado: descarta o que estiver pendente (nada é gravado). */
  disable() { if (this.timer) { clearTimeout(this.timer); this.timer = null } this.recorder.reset(); this.changed() }

  /** Dia de hoje para a interface (fuso local). */
  today(now = Date.now()) { return dayKey(now) }
}
