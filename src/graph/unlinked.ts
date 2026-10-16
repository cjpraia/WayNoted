// Menções não vinculadas: páginas cujo texto contém o título de outra página sem linká-la.
// Puro (sem DOM/store): busca no texto indexado e conversão da ocorrência em link nos blocos.
import type { Page } from '../types'
import { normalizeText, normalizeWithMap } from '../search/normalize.ts'
import { livePageIds } from './edges.ts'

export interface UnlinkedMention { pageId: string; title: string; icon: string | null; count: number; before: string; match: string; after: string }

const WORD_CHAR = /[\p{L}\p{N}]/u

/** Primeira ocorrência de `needle` (já normalizado) como palavra inteira em `normalized`, a partir de `from`. */
export function findWholeWord(normalized: string, needle: string, from = 0): number {
  if (!needle) return -1
  let index = normalized.indexOf(needle, from)
  while (index >= 0) {
    const before = index > 0 ? normalized[index - 1] : ''
    const after = normalized[index + needle.length] ?? ''
    if ((!before || !WORD_CHAR.test(before)) && (!after || !WORD_CHAR.test(after))) return index
    index = normalized.indexOf(needle, index + 1)
  }
  return -1
}

/** Intervalos [início, fim) no texto original de cada ocorrência inteira do título. */
export function wholeWordRanges(original: string, title: string): [number, number][] {
  const needle = normalizeText(title.trim())
  if (!needle) return []
  const { text, map } = normalizeWithMap(original)
  const out: [number, number][] = []
  let index = findWholeWord(text, needle)
  while (index >= 0) {
    out.push([map[index], map[index + needle.length]])
    index = findWholeWord(text, needle, index + needle.length)
  }
  return out
}

/** Título é específico o bastante para procurar (evita "a", "x", páginas sem título). */
export function searchableTitle(title: string): boolean {
  const needle = normalizeText(title.trim())
  return needle.length >= 3 && /[\p{L}\p{N}]/u.test(needle)
}

export function findUnlinkedMentions(pages: Record<string, Page>, targetId: string, options: { limit?: number; context?: number } = {}): UnlinkedMention[] {
  const target = pages[targetId]
  if (!target || !searchableTitle(target.title)) return []
  const context = options.context ?? 48
  const live = livePageIds(pages)
  if (!live.has(targetId)) return []
  const needle = normalizeText(target.title.trim())
  const out: UnlinkedMention[] = []
  for (const id of live) {
    if (id === targetId) continue
    const page = pages[id]
    if (page.outboundPageIds?.includes(targetId)) continue
    const text = page.bodyText ?? page.text ?? ''
    if (!text) continue
    // Pré-filtro barato antes do mapeamento por caractere.
    if (!normalizeText(text).includes(needle)) continue
    const ranges = wholeWordRanges(text, target.title)
    if (!ranges.length) continue
    const [start, end] = ranges[0]
    const flat = (value: string) => value.replace(/\s+/g, ' ')
    const from = Math.max(0, start - context), to = Math.min(text.length, end + context)
    out.push({ pageId: id, title: page.title, icon: page.icon, count: ranges.length,
      before: (from > 0 ? '…' : '') + flat(text.slice(from, start)).trimStart(),
      match: text.slice(start, end),
      after: flat(text.slice(end, to)).trimEnd() + (to < text.length ? '…' : '') })
  }
  out.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, 'pt-BR'))
  return options.limit ? out.slice(0, options.limit) : out
}

type Inline = { type?: string; text?: string; styles?: Record<string, unknown>; href?: string; content?: unknown }

/**
 * Converte a primeira ocorrência inteira do título num link `workspace://page/<id>`.
 * Só altera texto simples (fora de links existentes). Devolve uma cópia; não muta a entrada.
 */
export function linkFirstMention(blocks: unknown[], title: string, targetId: string): { blocks: unknown[]; linked: boolean } {
  const copy = structuredClone(blocks) as unknown[]
  let linked = false
  const inline = (items: unknown[]): void => {
    for (let i = 0; i < items.length && !linked; i++) {
      const item = items[i] as Inline
      if (!item || typeof item !== 'object' || item.type !== 'text' || typeof item.text !== 'string') continue
      const range = wholeWordRanges(item.text, title)[0]
      if (!range) continue
      const [start, end] = range
      const styles = item.styles ?? {}
      const piece = (text: string) => ({ type: 'text', text, styles: { ...styles } })
      const replacement: unknown[] = []
      if (start > 0) replacement.push(piece(item.text.slice(0, start)))
      replacement.push({ type: 'link', href: `workspace://page/${targetId}`, content: [piece(item.text.slice(start, end))] })
      if (end < item.text.length) replacement.push(piece(item.text.slice(end)))
      items.splice(i, 1, ...replacement)
      linked = true
    }
  }
  const content = (value: unknown): void => {
    if (linked || !value) return
    if (Array.isArray(value)) { inline(value); return }
    if (typeof value === 'object') {
      const table = value as { rows?: { cells?: unknown[] }[] }
      for (const row of table.rows ?? []) for (const cell of row.cells ?? []) {
        if (linked) return
        if (Array.isArray(cell)) inline(cell)
        else if (cell && typeof cell === 'object' && Array.isArray((cell as { content?: unknown }).content)) inline((cell as { content: unknown[] }).content)
      }
    }
  }
  const walk = (list: unknown[]): void => {
    for (const raw of list) {
      if (linked) return
      if (!raw || typeof raw !== 'object') continue
      const block = raw as { content?: unknown; children?: unknown[] }
      if (typeof block.content === 'string') {
        const items: unknown[] = [{ type: 'text', text: block.content, styles: {} }]
        inline(items)
        if (linked) block.content = items
      } else content(block.content)
      if (Array.isArray(block.children)) walk(block.children)
    }
  }
  walk(copy)
  return { blocks: linked ? copy : blocks, linked }
}
