// "Perguntar às suas notas": recupera localmente os top-K trechos do escopo e só então pergunta
// ao provedor ativo do recurso `ask`. Sem trechos relevantes, responde sem chamar o modelo.
import { getState } from '../store.ts'
import { runAI, type RunOptions } from './client.ts'
import { askIndex, indexable, searchNotes } from './indexRunner.ts'
import { aiSettings } from './settingsStore.ts'
import type { AIPreview, AISource, ProviderId } from './types.ts'
import type { Page } from '../types.ts'

export type AskScope = { kind: 'all' } | { kind: 'page'; pageId: string } | { kind: 'database'; pageId: string } | { kind: 'selection'; pageId: string; text: string }
export interface AskSource extends AISource { title: string }
export interface AskResult { answer: string; sources: AskSource[]; noResults: boolean; provider?: ProviderId; cloud?: boolean; preview?: AIPreview }

/** Página dentro do escopo (subpáginas contam para "esta página"; linhas e subpáginas para "este banco"). */
export function inScope(pageId: string, scope: AskScope, pages = getState().pages): boolean {
  if (scope.kind === 'all') return true
  if (scope.kind === 'selection') return pageId === scope.pageId
  const seen = new Set<string>()
  let page: Page | undefined = pages[pageId]
  while (page && !seen.has(page.id)) {
    if (page.id === scope.pageId) return true
    seen.add(page.id); page = page.parentId ? pages[page.parentId] : undefined
  }
  return false
}

/** `recentDays`: em vez da busca, usa os trechos das páginas editadas nos últimos N dias ("resuma esta semana"). */
export async function askNotes(question: string, scope: AskScope, history: { role: 'user' | 'assistant'; content: string }[], options: RunOptions = {}, recentDays?: number): Promise<AskResult> {
  const pages = getState().pages
  const locale = getState().settings.locale === 'en-US' ? 'en-US' : 'pt-BR'
  let sources: AskSource[]
  if (scope.kind === 'selection') {
    const page = pages[scope.pageId]
    sources = indexable(page, pages) && scope.text.trim() ? [{ pageId: scope.pageId, title: page.title, text: scope.text.slice(0, 20000) }] : []
  } else if (recentDays) {
    const since = Date.now() - recentDays * 86400000, k = aiSettings()?.askTopK ?? 6
    const recent = Object.values(pages).filter(page => page.updatedAt >= since && askIndex.pageKey(page.id) !== undefined && indexable(page, pages) && inScope(page.id, scope, pages)).sort((a, b) => b.updatedAt - a.updatedAt)
    sources = recent.flatMap(page => askIndex.chunksOf(page.id).slice(0, 2).map(chunk => ({ pageId: page.id, blockId: chunk.blockId, title: page.title, path: chunk.path, text: chunk.text }))).slice(0, k * 2)
  } else {
    const hits = await searchNotes(question, { k: aiSettings()?.askTopK ?? 6, accept: id => inScope(id, scope, pages) })
    sources = hits.map(hit => ({ pageId: hit.chunk.pageId, blockId: hit.chunk.blockId, title: hit.title || pages[hit.chunk.pageId]?.title || '', path: hit.chunk.path, text: hit.chunk.text }))
  }
  if (!sources.length) return { answer: '', sources: [], noResults: true }
  let answer = ''
  const result = await runAI({ feature: 'ask', operation: 'notes', prompt: question, sources, history, locale }, { ...options, onDelta: text => { answer += text; options.onDelta?.(text) } })
  // As citações seguem a numeração do que realmente foi enviado (o processo principal pode excluir fontes).
  const sent = result.preview.keptIndexes.map(index => sources[index]).filter(Boolean)
  return { answer: result.text || answer, sources: sent, noResults: false, provider: result.provider, cloud: result.preview.cloud, preview: result.preview }
}

// ---------- histórico local (cifrado no processo principal; apagável) ----------
export interface ChatTurn { role: 'user' | 'assistant'; content: string; sources?: AskSource[]; provider?: ProviderId; noResults?: boolean; at: number }
export interface Chat { id: string; title: string; createdAt: number; updatedAt: number; turns: ChatTurn[] }
export function normalizeChats(data: unknown): Chat[] {
  if (!Array.isArray(data)) return []
  return data.filter((chat): chat is Chat => !!chat && typeof chat.id === 'string' && Array.isArray(chat.turns)).slice(0, 50)
}
/** Remove do histórico trechos de páginas que passaram a ser protegidas ou foram para a lixeira. */
export function scrubChats(chats: Chat[], pages = getState().pages): Chat[] {
  return chats.map(chat => ({ ...chat, turns: chat.turns.map(turn => turn.sources ? { ...turn, sources: turn.sources.filter(source => indexable(pages[source.pageId], pages)) } : turn) }))
}
