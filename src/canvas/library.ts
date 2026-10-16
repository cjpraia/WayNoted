// Biblioteca do quadro (inspirada na do Excalidraw): seleções salvas no espaço (settings.canvasLibrary),
// reutilizáveis em qualquer quadro. Tolerante: itens inválidos são descartados, nunca recusam o meta.
import { normalizeObject, type CanvasObject } from './model.ts'

export interface CanvasLibraryItem { id: string; name: string; objects: CanvasObject[]; createdAt: number }
export const LIBRARY_LIMIT = 100
/** Upper bound per item (serialized) so the meta file stays small; images make items heavy. */
export const LIBRARY_ITEM_BYTES = 512 * 1024

export function normalizeLibrary(value: unknown): CanvasLibraryItem[] {
  if (!Array.isArray(value)) return []
  const out: CanvasLibraryItem[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id || !Array.isArray(item.objects)) continue
    const objects = item.objects.map(normalizeObject).filter((o): o is CanvasObject => !!o)
    if (!objects.length) continue
    out.push({ id: item.id, name: typeof item.name === 'string' ? item.name.slice(0, 120) : '', objects, createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : 0 })
    if (out.length >= LIBRARY_LIMIT) break
  }
  return out
}

/** New library item from the copied selection; throws when too large. */
export function libraryItem(name: string, objects: readonly CanvasObject[], now = Date.now()): CanvasLibraryItem {
  const copy = structuredClone([...objects]).map(o => { delete (o as { locked?: boolean }).locked; return o })
  if (JSON.stringify(copy).length > LIBRARY_ITEM_BYTES) throw new Error('LIBRARY_ITEM_TOO_LARGE')
  return { id: globalThis.crypto.randomUUID(), name: name.trim().slice(0, 120), objects: copy, createdAt: now }
}
