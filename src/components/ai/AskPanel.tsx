import PRODUCT from '../../../shared/product.json' with { type: 'json' }
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowUp, CalendarRange, Copy, History, ListChecks, MessageCircleQuestion, Plus, RefreshCw, Search, Square, SquarePen, Trash2, X } from 'lucide-react'
import { actions, getState, useStore } from '../../store'
import { useI18n } from '../../i18n'
import { askNotes, normalizeChats, scrubChats, type AskScope, type AskSource, type Chat, type ChatTurn } from '../../ai/ask.ts'
import { askIndexProgress, reindexAll, startAskIndex, subscribeAskIndex } from '../../ai/indexRunner.ts'
import { getAIBridge } from '../../ai/bridge.ts'
import { aiErrorMessage, parseAIError } from '../../ai/errors.ts'
import { parseCitations } from '../../ai/retrieval.ts'
import { providerFor, useAISettings } from '../../ai/settingsStore.ts'
import { closeAskPanel, useAskPanel } from '../../ai/panel.ts'
import { AIBadge } from './AIBadge'
import './ai.css'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'

type ScopeKind = AskScope['kind']
const TEMPLATES = (t: (pt: string, en: string) => string) => [
  { icon: CalendarRange, label: t('Resuma esta semana', 'Summarize this week'), question: t('Resuma o que registrei nas minhas notas nesta semana, em tópicos.', 'Summarize what I wrote in my notes this week, as bullet points.'), recentDays: 7 },
  { icon: Search, label: t('O que decidimos sobre…', 'What did we decide about…'), question: t('O que decidimos sobre ', 'What did we decide about '), fill: true },
  { icon: ListChecks, label: t('Quais pendências aparecem nas notas?', 'What open items appear in my notes?'), question: t('Quais tarefas ou pendências aparecem nas minhas notas?', 'Which tasks or open items appear in my notes?') },
]

function Answer({ turn, onOpen }: { turn: ChatTurn; onOpen: (source: AskSource) => void }) {
  const { t } = useI18n()
  const sources = turn.sources ?? []
  const { parts, cited } = useMemo(() => parseCitations(turn.content, sources.length), [turn.content, sources.length])
  return <>
    <div className="ai-answer">{parts.map((part, index) => part.cite ? <button key={index} type="button" className="ai-cite" onClick={() => onOpen(sources[part.cite! - 1])} aria-label={t('Abrir fonte {n}: {title}', 'Open source {n}: {title}', { n: part.cite, title: sources[part.cite - 1]?.title || t('Sem título', 'Untitled') })}>{part.cite}</button> : <span key={index}>{part.text}</span>)}</div>
    {sources.length > 0 && <ul className="ai-sources" aria-label={t('Fontes', 'Sources')}>{sources.map((source, index) => (cited.includes(index + 1) || !cited.length) && <li key={index}><button type="button" onClick={() => onOpen(source)}><b>{index + 1}</b><span>{source.title || t('Sem título', 'Untitled')}{source.path ? ` › ${source.path}` : ''}</span></button></li>)}</ul>}
  </>
}

export function AskPanel() {
  const { t, locale } = useI18n()
  const { route, pages } = useStore()
  const panel = useAskPanel()
  const settings = useAISettings()
  const provider = providerFor('ask', settings)
  const progress = useSyncExternalStore(subscribeAskIndex, askIndexProgress, askIndexProgress)
  const currentPage = route.type === 'page' ? pages[route.id] : undefined
  const [scopeKind, setScopeKind] = useState<ScopeKind>('all')
  const [question, setQuestion] = useState('')
  const [chats, setChats] = useState<Chat[]>([])
  const [chatId, setChatId] = useState<string | null>(null)
  const [view, setView] = useState<'thread' | 'history'>('thread')
  const [streaming, setStreaming] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const controller = useRef<AbortController | null>(null)
  const thread = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const chat = chats.find(item => item.id === chatId) ?? null
  const bridge = getAIBridge()

  useEffect(() => { void startAskIndex().catch(() => {}) }, [])
  useEffect(() => {
    if (!bridge) return
    let live = true
    void bridge.aiLoadChats().then(data => { if (live) setChats(scrubChats(normalizeChats(data))) }).catch(() => {})
    return () => { live = false }
  }, [])
  // Abrir com texto selecionado sugere o escopo "esta seleção".
  useEffect(() => { if (panel.selection && panel.selectionPageId) setScopeKind('selection'); input.current?.focus() }, [panel.nonce])
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => { thread.current?.scrollTo?.({ top: thread.current.scrollHeight }) }, [chat?.turns.length, streaming])

  const scopeAvailable = (kind: ScopeKind) => kind === 'all' || (kind === 'page' && !!currentPage && !currentPage.database) || (kind === 'database' && !!(currentPage?.database || (currentPage?.parentId && pages[currentPage.parentId]?.database))) || (kind === 'selection' && !!panel.selection && !!panel.selectionPageId)
  const effectiveScope: ScopeKind = scopeAvailable(scopeKind) ? scopeKind : 'all'
  const scope = (): AskScope => {
    if (effectiveScope === 'page' && currentPage) return { kind: 'page', pageId: currentPage.id }
    if (effectiveScope === 'database' && currentPage) return { kind: 'database', pageId: currentPage.database ? currentPage.id : currentPage.parentId! }
    if (effectiveScope === 'selection' && panel.selectionPageId) return { kind: 'selection', pageId: panel.selectionPageId, text: panel.selection }
    return { kind: 'all' }
  }
  const persist = (next: Chat[]) => { setChats(next); void bridge?.aiSaveChats(next.slice(0, 50)).catch(() => {}) }

  const send = async (text = question, recentDays?: number) => {
    const q = text.trim()
    if (!q || busy) return
    setError(''); setNotice(''); setQuestion(''); setBusy(true); setStreaming('')
    const now = Date.now()
    const base: Chat = chat ?? { id: crypto.randomUUID(), title: q.slice(0, 80), createdAt: now, updatedAt: now, turns: [] }
    const withQuestion: Chat = { ...base, updatedAt: now, turns: [...base.turns, { role: 'user', content: q, at: now }] }
    let list = [withQuestion, ...chats.filter(item => item.id !== base.id)]
    setChats(list); setChatId(base.id)
    const history = base.turns.slice(-6).map(turn => ({ role: turn.role, content: turn.content }))
    const abort = new AbortController(); controller.current = abort
    let partial = ''
    try {
      const result = await askNotes(q, recentDays ? { kind: 'all' } : scope(), history, { signal: abort.signal, onDelta: piece => { partial += piece; setStreaming(partial) } }, recentDays)
      const turn: ChatTurn = result.noResults
        ? { role: 'assistant', content: t('Não encontrei nada nas suas notas sobre isso. Tente outras palavras, amplie o escopo ou reindexe.', 'I did not find anything in your notes about that. Try other words, widen the scope or reindex.'), noResults: true, at: Date.now() }
        : { role: 'assistant', content: result.answer, sources: result.sources, provider: result.provider, at: Date.now() }
      list = [{ ...withQuestion, updatedAt: Date.now(), turns: [...withQuestion.turns, turn] }, ...list.slice(1)]
      persist(list)
    } catch (cause) {
      const code = parseAIError(cause).code
      if (code === 'AI_CANCELLED' && partial) persist([{ ...withQuestion, turns: [...withQuestion.turns, { role: 'assistant', content: partial, at: Date.now() }] }, ...list.slice(1)])
      else {
        // Falhou sem resposta: a pergunta volta para a caixa e não fica órfã no histórico.
        persist(base.turns.length ? [base, ...list.slice(1)] : list.slice(1))
        if (!base.turns.length) setChatId(null)
        setQuestion(q)
      }
      setError(aiErrorMessage(cause, t))
    } finally { setBusy(false); setStreaming(''); controller.current = null }
  }
  const stop = () => { controller.current?.abort() }
  const open = (source: AskSource | undefined) => {
    if (!source || !getState().pages[source.pageId]) { setError(t('A página de origem não está mais disponível.', 'The source page is no longer available.')); return }
    actions.openPage(source.pageId, source.blockId ? { blockId: source.blockId } : {})
  }
  const copy = async (text: string) => {
    try { if (window.api?.copyText) await window.api.copyText(text); else await navigator.clipboard.writeText(text); setNotice(t('Copiado.', 'Copied.')) }
    catch { setError(t('Área de transferência indisponível.', 'Clipboard unavailable.')) }
  }
  const insert = async (turn: ChatTurn) => {
    const state = getState(), target = state.route.type === 'page' ? state.pages[state.route.id] : undefined
    if (!target || target.database || target.locked || target.canvas) { setError(t('Abra uma página editável para inserir a resposta.', 'Open an editable page to insert the answer.')); return }
    const paragraph = (text: string) => ({ id: crypto.randomUUID(), type: 'paragraph', content: [{ type: 'text', text, styles: {} }], children: [] })
    const blocks = turn.content.split(/\n\s*\n/).filter(Boolean).map(paragraph)
    if (turn.sources?.length) blocks.push(paragraph(`${t('Fontes', 'Sources')}: ${turn.sources.map((source, index) => `[${index + 1}] ${source.title || t('Sem título', 'Untitled')}`).join('; ')}`))
    try { await actions.appendPageBlocks(target.id, blocks); setNotice(t('Resposta inserida no fim da página.', 'Answer inserted at the end of the page.')) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const newChat = () => { if (!busy) { setChatId(null); setView('thread'); setError(''); setNotice(''); input.current?.focus() } }

  const percent = progress.total ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 100
  return <aside className="ai-panel" aria-label={t('Perguntar às suas notas', 'Ask your notes')} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); if (busy) stop(); else closeAskPanel() } }}>
    <div className="ai-panel-head">
      <strong><MessageCircleQuestion size={16} strokeWidth={1.7} aria-hidden />{t('Perguntar', 'Ask')}<AIBadge provider={provider} /></strong>
      <button type="button" className="np-icon-btn" onClick={() => setView(view === 'history' ? 'thread' : 'history')} aria-label={t('Histórico de conversas', 'Conversation history')} aria-pressed={view === 'history'}><History size={16} strokeWidth={1.7} /></button>
      <button type="button" className="np-icon-btn" onClick={newChat} aria-label={t('Nova conversa', 'New conversation')}><SquarePen size={16} strokeWidth={1.7} /></button>
      <button type="button" className="np-icon-btn" onClick={closeAskPanel} aria-label={t('Fechar painel', 'Close panel')}><X size={16} strokeWidth={1.7} /></button>
    </div>
    {!bridge ? <div className="ai-thread"><p className="ai-empty">{t(`A IA requer o aplicativo desktop do ${PRODUCT.name}.`, `AI requires the ${PRODUCT.name} desktop app.`)}</p></div> : view === 'history' ? <div className="ai-history" role="list" aria-label={t('Conversas salvas', 'Saved conversations')}>
      {!chats.length && <p className="ai-empty">{t('Nenhuma conversa salva neste Mac.', 'No conversations saved on this Mac.')}</p>}
      {chats.map(item => <div key={item.id} className="ai-history-row" role="listitem"><button type="button" onClick={() => { setChatId(item.id); setView('thread') }}>{item.title}</button><button type="button" className="np-icon-btn" onClick={() => { persist(chats.filter(other => other.id !== item.id)); if (chatId === item.id) setChatId(null) }} aria-label={t('Apagar conversa {title}', 'Delete conversation {title}', { title: item.title })}><Trash2 size={14} /></button></div>)}
      {chats.length > 0 && <Button variant="danger-quiet" style={{ alignSelf: 'flex-start', marginTop: 8 }} onClick={() => { persist([]); setChatId(null) }}><Trash2 size={14} aria-hidden />{t('Apagar todo o histórico', 'Delete all history')}</Button>}
    </div> : <>
      <div className="ai-panel-tools">
        <label>{t('Escopo', 'Scope')} <Select value={effectiveScope} onChange={event => setScopeKind(event.target.value as ScopeKind)} aria-label={t('Escopo da pergunta', 'Question scope')}>
          <option value="all">{t('Todo o espaço', 'Whole workspace')}</option>
          <option value="page" disabled={!scopeAvailable('page')}>{t('Esta página', 'This page')}</option>
          <option value="database" disabled={!scopeAvailable('database')}>{t('Este banco', 'This database')}</option>
          <option value="selection" disabled={!scopeAvailable('selection')}>{t('Esta seleção', 'This selection')}</option>
        </Select></label>
      </div>
      <div className="ai-index" role="status" aria-live="polite">
        {progress.building ? <><span>{t('Indexando {done}/{total}', 'Indexing {done}/{total}', { done: progress.done, total: progress.total })}</span><span className="ai-index-bar" aria-hidden><i style={{ width: `${percent}%` }} /></span></>
          : <span style={{ flex: 1 }}>{t('{n} trechos', '{n} excerpts', { n: progress.chunks.toLocaleString(locale) })} · {progress.semantic === 'on' ? (progress.backend === 'apple' ? t('busca semântica local (Apple)', 'local semantic search (Apple)') : t('busca semântica local', 'local semantic search')) : progress.semantic === 'unavailable' ? t('só palavras (sem embeddings locais)', 'words only (no local embeddings)') : t('busca por palavras', 'word search')}</span>}
        <button type="button" onClick={() => reindexAll()} disabled={progress.building} title={t('Reconstruir o índice local', 'Rebuild the local index')}><RefreshCw size={12} aria-hidden />{t('Reindexar', 'Reindex')}</button>
      </div>
      <div className="ai-thread" ref={thread} aria-live="polite">
        {!chat?.turns.length && !busy && <div className="ai-empty">
          <p>{t('Pergunte sobre o que está nas suas notas. A busca roda neste Mac; só os trechos mais relevantes e a pergunta vão ao modelo, com as fontes citadas.', 'Ask about what is in your notes. The search runs on this Mac; only the most relevant excerpts and your question go to the model, with sources cited.')}</p>
          <div className="ai-templates">{TEMPLATES(t).map(template => { const Icon = template.icon; return <button type="button" key={template.label} onClick={() => { if (template.fill) { setQuestion(template.question); input.current?.focus() } else void send(template.question, template.recentDays) }}><Icon size={15} strokeWidth={1.7} aria-hidden />{template.label}</button> })}</div>
        </div>}
        {chat?.turns.map((turn, index) => turn.role === 'user' ? <div key={index} className="ai-turn-user">{turn.content}</div> : <div key={index} className="ai-turn-bot">
          {turn.noResults ? <p className="ai-answer">{turn.content}</p> : <Answer turn={turn} onOpen={open} />}
          {!turn.noResults && <div className="ai-turn-actions">
            {turn.provider && <AIBadge provider={turn.provider} />}
            <Button variant="ghost" onClick={() => void copy(turn.content)}><Copy size={13} aria-hidden />{t('Copiar', 'Copy')}</Button>
            <Button variant="ghost" onClick={() => void insert(turn)}><Plus size={13} aria-hidden />{t('Inserir na página atual', 'Insert in current page')}</Button>
          </div>}
        </div>)}
        {busy && <div className="ai-turn-bot"><span className="ai-answer">{streaming}</span><span className="ai-typing" aria-label={t('Gerando resposta', 'Generating answer')} /></div>}
        {notice && <p className="ai-feedback" role="status">{notice}</p>}
        {error && <p className="ai-error" role="alert">{error}</p>}
      </div>
      <div className="ai-composer">
        <textarea ref={input} value={question} maxLength={4000} onChange={event => setQuestion(event.target.value)} placeholder={t('Pergunte às suas notas…', 'Ask your notes…')} aria-label={t('Pergunta', 'Question')} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
        <div className="ai-composer-row"><span>{t('Enter envia · Shift+Enter quebra linha · ⌘J fecha', 'Enter sends · Shift+Enter new line · ⌘J closes')}</span>
          {busy ? <Button onClick={stop}><Square size={12} aria-hidden />{t('Parar', 'Stop')}</Button> : <Button variant="primary" disabled={!question.trim()} onClick={() => void send()}><ArrowUp size={14} aria-hidden />{t('Perguntar', 'Ask')}</Button>}
        </div>
      </div>
    </>}
  </aside>
}
