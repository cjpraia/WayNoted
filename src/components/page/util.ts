import COMPAT from '../../../shared/compatibility.ts'
// Utilidades da página: tempo relativo, texto puro dos blocos, sincronização de saves.
import { translate, type Locale } from '../../localization.ts'
import { blockAttachmentText } from '../../search/extract.ts'
import { canvasText } from '../../canvas/model.ts'

export const UNTITLED = 'Sem título'

let fallbackWindowId: string | null = null
export function windowDraftId(): string {
  if (fallbackWindowId) return fallbackWindowId
  try {
    const key = COMPAT.record040
    const stored = sessionStorage.getItem(key)
    if (stored && /^[a-z0-9-]{8,80}$/i.test(stored)) return (fallbackWindowId = stored)
    const id = crypto.randomUUID()
    sessionStorage.setItem(key, id)
    return (fallbackWindowId = id)
  } catch {
    return (fallbackWindowId = crypto.randomUUID())
  }
}

export const legacyDraftKey = (pageId: string) => `${COMPAT.record041}${pageId}`
export const draftKey = (pageId: string) => `${COMPAT.record041}${windowDraftId()}:${pageId}`
export function clearDraft(pageId: string): void {
  localStorage.removeItem(draftKey(pageId))
  localStorage.removeItem(legacyDraftKey(pageId))
}

const dirtyOwners = new Map<string, Set<string>>()
export function markDocDirty(pageId: string, dirty: boolean, owner = 'default'): void {
  const owners = dirtyOwners.get(pageId) ?? new Set<string>()
  if (dirty) owners.add(owner)
  else owners.delete(owner)
  if (owners.size) dirtyOwners.set(pageId, owners)
  else dirtyOwners.delete(pageId)
}
export function isDocDirty(pageId: string): boolean { return Boolean(dirtyOwners.get(pageId)?.size) }

/** "agora mesmo", "há 5 min", "há 2 h", "ontem", "há 3 dias", "em 12 de mar." */
export function relativeTime(ts: number, now = Date.now(), locale: Locale = 'pt-BR'): string {
  const t = (pt: string, en: string) => translate(locale, pt, en)
  const diff = Math.max(0, now - ts)
  const min = Math.floor(diff / 60000)
  if (min < 1) return t('agora mesmo', 'just now')
  if (min < 60) return t(`há ${min} min`, `${min} min ago`)
  const h = Math.floor(min / 60)
  if (h < 24) return t(`há ${h} h`, `${h} h ago`)
  const d = Math.floor(h / 24)
  if (d === 1) return t('ontem', 'yesterday')
  if (d < 30) return t(`há ${d} dias`, `${d} days ago`)
  const date = new Date(ts)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return t('em ', 'on ') + date.toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** "hoje às 15:20", "ontem às 09:02", "12 de mar. de 2025 às 10:00" */
export function absoluteTime(ts: number, now = Date.now(), locale: Locale = 'pt-BR'): string {
  const t = (pt: string, en: string) => translate(locale, pt, en)
  const date = new Date(ts)
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const today = new Date(now)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  if (ts >= startOfToday) return t(`hoje às ${time}`, `today at ${time}`)
  if (ts >= startOfToday - 86400000) return t(`ontem às ${time}`, `yesterday at ${time}`)
  return t(`${date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })} às ${time}`, `${date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })} at ${time}`)
}

export function wordCount(text: string): number {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}

type AnyBlock = { type?: string; content?: unknown; children?: unknown[]; props?: Record<string, unknown> }

function inlineToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!content) return ''
  if (Array.isArray(content)) return content.map(inlineToText).join('')
  if (typeof content === 'object') {
    const c = content as { type?: string; text?: string; content?: unknown; rows?: { cells: unknown[] }[] }
    if (c.type === 'tableContent' && Array.isArray(c.rows)) {
      return c.rows.map((r) => (r.cells ?? []).map(inlineToText).join(' ')).join('\n')
    }
    if (typeof c.text === 'string') return c.text
    if (c.content !== undefined) return inlineToText(c.content)
  }
  return ''
}

/** Texto puro de uma lista de blocos BlockNote (para a busca e a contagem de palavras). */
export function blocksToText(blocks: unknown[]): string {
  const lines: string[] = []
  const walk = (list: unknown[]) => {
    for (const b of list as AnyBlock[]) {
      let t = b.type === 'bookmark' || b.type === 'externalReference' || b.type === 'onlineVideo' ? [b.props?.title, b.props?.description, b.props?.caption, b.props?.url].filter(value => typeof value === 'string').join('\n') : inlineToText(b.content)
      if (b.type === 'mermaid') t = typeof b.props?.source === 'string' ? b.props.source : ''
      // Consulta viva: indexa o texto da consulta, nunca os resultados (que pertencem a outras páginas).
      if (b.type === 'query') t = typeof b.props?.text === 'string' ? b.props.text : ''
      // Lousa: texto das notas/formas/rótulos (nunca o conteúdo das páginas dos cartões).
      if (b.type === 'canvas') t = canvasText(b.props)
      if (b.type === 'htmlSandbox') t = typeof b.props?.html === 'string' ? b.props.html.replace(/<[^>]*>/g, ' ') : ''
      if (b.type === 'aiBlock' || b.type === 'aiMeetingNotes') t = [b.props?.prompt, b.props?.context, b.props?.output].filter(value => typeof value === 'string').join('\n')
      if (b.type === 'tabs' && typeof b.props?.tabsJson === 'string') {
        try { const tabs = JSON.parse(b.props.tabsJson); if (Array.isArray(tabs)) t = tabs.flatMap(tab => [tab?.title, tab?.body]).filter(value => typeof value === 'string').join('\n') } catch { /* Preserve invalid tabs for the editor to report. */ }
      }
      if (t) lines.push(t)
      const attachment = blockAttachmentText(b)
      if (attachment) lines.push(attachment)
      if (Array.isArray(b.children)) walk(b.children)
    }
  }
  walk(blocks)
  return lines.join('\n')
}

// Registro de "flush" dos editores montados: permite que outras partes (exportar,
// duplicar) forcem a gravação do conteúdo pendente antes de ler o documento.
const flushers = new Map<string, () => Promise<void>>()

export function registerFlush(pageId: string, fn: () => Promise<void>): () => void {
  flushers.set(pageId, fn)
  return () => {
    if (flushers.get(pageId) === fn) flushers.delete(pageId)
  }
}

export async function flushDoc(pageId: string): Promise<void> {
  await flushers.get(pageId)?.()
}

export async function flushAllDocs(): Promise<void> {
  await Promise.all([...flushers.values()].map(flush => flush()))
}
