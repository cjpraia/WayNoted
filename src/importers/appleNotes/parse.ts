// D3b — leitura (e validação) da saída JSON do osascript (electron/apple-notes.js). A saída vem de outro app:
// é tratada como dado não confiável (formas conferidas, textos limitados, árvore de pastas sem ciclos).
export interface AppleAccount { id: string; name: string }
export interface AppleFolder { id: string; name: string; accountId: string; parentId: string | null; notes: number; locked: number }
export interface AppleListing { accounts: AppleAccount[]; folders: AppleFolder[] }
export interface AppleNote { id: string; name: string; body: string; created: number | null; modified: number | null; folderId: string; locked: boolean }
export interface AppleBatch { total: number; notes: AppleNote[]; oversized: string[] }

export const APPLE_LIMITS = { accounts: 50, folders: 5000, notesPerBatch: 50, bodyBytes: 25 * 1024 * 1024, name: 300 }

export class AppleNotesParseError extends Error { constructor(message: string) { super(message); this.name = 'AppleNotesParseError' } }

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const str = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : ''
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(10_000_000, Math.floor(value)) : 0
// eslint-disable-next-line no-control-regex
const oneLine = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()

/** O osascript imprime a string devolvida; algumas versões a devolvem entre aspas (JSON dentro de JSON). */
function decode(stdout: string): unknown {
  let value: unknown
  try { value = JSON.parse(stdout.trim()) } catch { throw new AppleNotesParseError('Resposta do Notas não é JSON.') }
  if (typeof value === 'string') { try { value = JSON.parse(value) } catch { throw new AppleNotesParseError('Resposta do Notas não é JSON.') } }
  return value
}

export function parseListing(stdout: string): AppleListing {
  const raw = decode(stdout)
  if (!isObject(raw) || !Array.isArray(raw.accounts) || !Array.isArray(raw.folders)) throw new AppleNotesParseError('Lista de pastas inválida.')
  const accounts: AppleAccount[] = []
  for (const item of raw.accounts.slice(0, APPLE_LIMITS.accounts)) if (isObject(item) && typeof item.id === 'string' && item.id) accounts.push({ id: item.id.slice(0, 512), name: oneLine(str(item.name, APPLE_LIMITS.name)) || 'iCloud' })
  const known = new Set(accounts.map(account => account.id))
  const byId = new Map<string, AppleFolder>()
  for (const item of raw.folders.slice(0, APPLE_LIMITS.folders)) {
    if (!isObject(item) || typeof item.id !== 'string' || !item.id || byId.has(item.id) || !known.has(String(item.accountId))) continue
    byId.set(item.id, { id: item.id.slice(0, 512), name: oneLine(str(item.name, APPLE_LIMITS.name)) || 'Notes', accountId: String(item.accountId), parentId: typeof item.parentId === 'string' ? item.parentId : null, notes: count(item.notes), locked: count(item.locked) })
  }
  // Pai inexistente, em outra conta ou em ciclo: a pasta sobe para a raiz da conta.
  for (const folder of byId.values()) {
    const parent = folder.parentId ? byId.get(folder.parentId) : undefined
    if (!parent || parent.accountId !== folder.accountId) folder.parentId = null
  }
  for (const folder of byId.values()) {
    const seen = new Set<string>([folder.id])
    for (let cursor = folder.parentId ? byId.get(folder.parentId) : undefined; cursor; cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined) {
      if (seen.has(cursor.id)) { folder.parentId = null; break }
      seen.add(cursor.id)
    }
  }
  return { accounts, folders: [...byId.values()] }
}

function time(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed > 0 && parsed < 4_102_444_800_000 ? parsed : null
}

export function parseBatch(stdout: string, folderId: string): AppleBatch {
  const raw = decode(stdout)
  if (!isObject(raw) || !Array.isArray(raw.notes)) throw new AppleNotesParseError('Lote de notas inválido.')
  const notes: AppleNote[] = [], oversized: string[] = []
  for (const item of raw.notes.slice(0, APPLE_LIMITS.notesPerBatch)) {
    if (!isObject(item) || typeof item.id !== 'string' || !item.id) continue
    const name = oneLine(str(item.name, APPLE_LIMITS.name))
    const body = typeof item.body === 'string' ? item.body : ''
    if (body.length > APPLE_LIMITS.bodyBytes) { oversized.push(name || item.id); continue }
    notes.push({ id: item.id.slice(0, 512), name, body, created: time(item.created), modified: time(item.modified), folderId, locked: item.locked === true })
  }
  return { total: count(raw.total), notes, oversized }
}

export type AppleErrorCode = 'denied' | 'timeout' | 'unavailable' | 'aborted' | 'failed'
/** Erros do main chegam como "…APPLE_NOTES_DENIED: …" (o IPC perde o `code`). */
export function appleErrorCode(error: unknown): AppleErrorCode {
  const raw = String((error as { message?: string })?.message ?? error)
  if ((error as { name?: string })?.name === 'AbortError') return 'aborted'
  const match = /APPLE_NOTES_(DENIED|TIMEOUT|UNAVAILABLE|ABORTED)/.exec(raw)
  return match ? match[1].toLowerCase() as AppleErrorCode : 'failed'
}
