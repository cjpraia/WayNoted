// Cache local (IndexedDB) do índice de busca: trechos ricos por página e texto extraído
// de PDFs/imagens por hash do arquivo. Sem IndexedDB (testes, janela privada) cai para memória.
// 'tasks': itens de checklist por página (src/tasks/taskIndex.ts).
type StoreName = 'rich' | 'pdf' | 'ocr' | 'tasks'
const DB_NAME = "workspace-search", VERSION = 2
const memory: Record<StoreName, Map<string, unknown>> = { rich: new Map(), pdf: new Map(), ocr: new Map(), tasks: new Map() }
let opening: Promise<IDBDatabase | null> | null = null
// No desktop o cache só persiste depois que o processo principal confirma que não há senha do
// espaço (VaultGate/SecuritySettings chamam setCachePersistence); antes disso fica na memória.
let persistent = typeof window === 'undefined' || !(window as unknown as { api?: unknown }).api

/**
 * With a workspace password the index must not be written to Chromium's clear-text IndexedDB:
 * the cache becomes memory-only and any copy left on disk is deleted (see src/security).
 */
/**
 * O processo principal apagou o IndexedDB do disco (proteção mudou): fecha a conexão antiga e
 * reabre sob demanda. Os dados em memória continuam; nada é regravado de páginas protegidas.
 */
export function resetCacheConnection() {
  const previous = opening
  opening = null
  void previous?.then(db => { try { db?.close() } catch { /* já fechado */ } })
}

export function setCachePersistence(enabled: boolean) {
  if (persistent === enabled) return
  persistent = enabled
  const previous = opening
  opening = null
  if (!enabled) void (async () => {
    try { (await previous)?.close() } catch { /* already closed */ }
    try { if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase(DB_NAME) } catch { /* unavailable */ }
  })()
}

function open(): Promise<IDBDatabase | null> {
  if (!persistent) return Promise.resolve(null)
  if (opening) return opening
  opening = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const request = indexedDB.open(DB_NAME, VERSION)
      request.onupgradeneeded = () => { for (const name of ['rich', 'pdf', 'ocr', 'tasks']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name) }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch { resolve(null) }
  })
  return opening
}
function run<T>(name: StoreName, mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return open().then(db => db ? new Promise<T | undefined>(resolve => {
    try {
      const request = body(db.transaction(name, mode).objectStore(name))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(undefined)
    } catch { resolve(undefined) }
  }) : undefined)
}

export async function cacheGet<T>(name: StoreName, key: string): Promise<T | undefined> {
  if (memory[name].has(key)) return memory[name].get(key) as T
  const value = await run<T>(name, 'readonly', store => store.get(key) as IDBRequest<T>)
  if (value !== undefined) memory[name].set(key, value)
  return value
}
export async function cachePut(name: StoreName, key: string, value: unknown): Promise<void> {
  memory[name].set(key, value)
  await run(name, 'readwrite', store => store.put(value, key))
}
export async function cacheDelete(name: StoreName, key: string): Promise<void> {
  memory[name].delete(key)
  await run(name, 'readwrite', store => store.delete(key))
}
/** Todas as entradas de um repositório (usado para reidratar o índice na abertura). */
export async function cacheEntries<T>(name: StoreName): Promise<[string, T][]> {
  const db = await open()
  if (!db) return [...memory[name].entries()] as [string, T][]
  const [keys, values] = await Promise.all([
    run<IDBValidKey[]>(name, 'readonly', store => store.getAllKeys()),
    run<T[]>(name, 'readonly', store => store.getAll() as IDBRequest<T[]>),
  ])
  return (keys ?? []).map((key, i) => [String(key), (values ?? [])[i]])
}
