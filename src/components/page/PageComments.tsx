import COMPAT from '../../../shared/compatibility.ts'
import { useEffect, useRef, useState } from 'react'
import { Check, Link2, MessageSquare, RotateCcw, Send } from 'lucide-react'
import { actions, api, selectors, useStore } from '../../store'
import type { CommentTextAnchor, Page, PageComment } from '../../types'
import { Popover } from './Popover'
import { blocksToText, flushDoc } from './util'
import { useI18n } from '../../i18n'
import { Select } from '../ui/Select'
import { EmptyState } from '../ui/illustrations/Illustration'

type BlockChoice = { id: string; label: string; firstText: string }
function firstText(value: unknown): string {
  if (Array.isArray(value)) return value.map(firstText).find(Boolean) ?? ''
  if (!value || typeof value !== 'object') return ''
  const item = value as { text?: string; content?: unknown }
  return item.text ?? firstText(item.content)
}
function listBlocks(blocks: unknown[]): BlockChoice[] {
  const out: BlockChoice[] = []
  const walk = (items: unknown[]) => {
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue
      const block = raw as { id?: string; type?: string; content?: unknown; children?: unknown[] }
      if (block.id) out.push({ id: block.id, label: blocksToText([{ ...block, children: [] }]).slice(0, 80) || block.type || 'Bloco', firstText: firstText(block.content) })
      if (Array.isArray(block.children)) walk(block.children)
    }
  }
  walk(blocks)
  return out.slice(0, 500)
}

export function PageComments({ page, inline = false }: { page: Page; inline?: boolean }) {
  const { settings } = useStore()
  const { locale, t } = useI18n()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const [blockChoices, setBlockChoices] = useState<BlockChoice[]>([])
  const [blockId, setBlockId] = useState('')
  const [propertyId, setPropertyId] = useState('')
  const [textAnchor, setTextAnchor] = useState<CommentTextAnchor | null>(null)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [suggestionMode, setSuggestionMode] = useState(false)
  const [originalText, setOriginalText] = useState('')
  const [replacementText, setReplacementText] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const comments = page.comments ?? []
  const readOnly = page.locked
  const propertyChoices = (page.parentId ? selectors.page(page.parentId)?.database?.properties : undefined) ?? []
  const visible = comments.filter((comment) => !comment.parentId && (showResolved || !comment.resolved))
  const openCount = comments.filter((comment) => !comment.resolved).length

  useEffect(() => {
    const onSelection = (event: Event) => {
      const detail = (event as CustomEvent<{ pageId: string; anchor: CommentTextAnchor; suggestionMode?: boolean }>).detail
      if (detail.pageId !== page.id || readOnly) return
      setTextAnchor(detail.anchor); setBlockId(detail.anchor.segments[0].blockId); setPropertyId(''); setReplyTo(null); setSuggestionMode(detail.suggestionMode === true)
      setOriginalText(detail.anchor.segments.map(segment => segment.quote).join('\n')); setOpen(true)
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
    window.addEventListener(COMPAT.record038, onSelection)
    return () => window.removeEventListener(COMPAT.record038, onSelection)
  }, [page.id, readOnly])

  useEffect(() => {
    if (!open) return
    let alive = true
    void flushDoc(page.id).then(() => api.loadDoc(page.id)).then(
      (blocks) => { if (alive) setBlockChoices(listBlocks(blocks ?? [])) },
      (cause) => { if (alive) setError(cause instanceof Error ? cause.message : t('Não foi possível carregar os blocos.', 'Could not load blocks.')) },
    )
    return () => { alive = false }
  }, [open, page.id, locale])

  const add = () => {
    const text = body.trim()
    if ((!text && !suggestionMode) || readOnly) return
    if (suggestionMode && (!blockId || propertyId || !originalText)) {
      setError(t('Escolha um bloco e informe os textos original e proposto.', 'Choose a block and enter the original and suggested text.'))
      return
    }
    const parent = replyTo ? comments.find((comment) => comment.id === replyTo) : undefined
    const now = Date.now()
    const comment: PageComment = {
      id: crypto.randomUUID(), body: text, createdAt: now, updatedAt: now,
      author: settings.userName.trim() || t('Você', 'You'), resolved: false,
      ...(parent ? { parentId: parent.id, blockId: parent.blockId, propertyId: parent.propertyId, textAnchor: parent.textAnchor } : propertyId ? { propertyId } : blockId ? { blockId, ...(textAnchor ? { textAnchor } : {}) } : {}),
      ...(suggestionMode && !parent ? { suggestion: { originalText, replacementText, status: 'open' as const } } : {}),
    }
    actions.updatePage(page.id, { comments: [...comments, comment] })
    setBody('')
    setReplyTo(null)
    setSuggestionMode(false)
    setOriginalText('')
    setReplacementText('')
    setError(null)
    setTextAnchor(null)
  }

  const toggleResolved = (id: string) => {
    if (readOnly) return
    actions.updatePage(page.id, {
      comments: comments.map((comment) => comment.id === id
        ? { ...comment, resolved: !comment.resolved, updatedAt: Date.now() }
        : comment),
    })
  }

  const decide = async (id: string, accept: boolean) => {
    setBusyId(id)
    setError(null)
    try { await actions.applyPageSuggestion(page.id, id, accept) }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('Não foi possível aplicar a sugestão.', 'Could not apply the suggestion.')) }
    finally { setBusyId(null) }
  }

  return (
    <>
      {inline && <strong className="pg-row-comments-title">{t('Comentários', 'Comments')}</strong>}
      <button
        ref={buttonRef}
        className={`${inline ? 'pg-row-comment-start' : 'pg-tb-btn pg-comments-trigger'}${open ? ' is-active' : ''}`}
        title={t('Comentários desta página', 'Page comments')}
        aria-label={t(`Comentários desta página${openCount ? `, ${openCount} abertos` : ''}`, `Page comments${openCount ? `, ${openCount} open` : ''}`)}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {inline ? <><span className="pg-comment-avatar">{(settings.userName || t('Você', 'You')).slice(0, 1).toUpperCase()}</span>{t('Adicionar comentário…', 'Add a comment…')}</> : <MessageSquare size={18} strokeWidth={1.7} />}
        {openCount > 0 && <span className="pg-comments-count">{openCount}</span>}
      </button>
      {open && (
        <CommentPanel inline={inline} anchor={buttonRef.current} onClose={() => setOpen(false)} align="end" width={360} className="pg-comments-panel">
          <div className="pg-comments-head">
            <strong>{t('Comentários', 'Comments')}</strong>
            <button className="pg-text-btn" onClick={() => setShowResolved((value) => !value)}>
              {showResolved ? t('Ocultar resolvidos', 'Hide resolved') : t('Mostrar resolvidos', 'Show resolved')}
            </button>
          </div>
          <div className="pg-comments-list">
            {visible.length === 0 ? (
              <EmptyState className="pg-comments-empty" illustration="inbox" size={72} title={showResolved ? t('Nenhum comentário nesta página', 'No comments on this page') : t('Nenhum comentário em aberto', 'No open comments')} />
            ) : visible.map((comment) => (
              <div key={comment.id}>
              {[comment, ...comments.filter((reply) => reply.parentId === comment.id && (showResolved || !reply.resolved))].map((item) => <article key={item.id} className={`pg-comment${item.resolved ? ' is-resolved' : ''}${item.parentId ? ' is-reply' : ''}`}>
                <div className="pg-comment-meta">
                  <span className="pg-comment-avatar" aria-hidden>{(item.author || '?').trim().slice(0, 1).toUpperCase()}</span>
                  <strong>{item.author}</strong>
                  <time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}</time>
                </div>
                {item.blockId && <button className="pg-comment-anchor" onClick={() => { actions.openPage(page.id, { blockId: item.blockId, commentId: item.textAnchor ? item.id : undefined }); setOpen(false) }}><Link2 size={12} /> {item.textAnchor ? t('Ir ao trecho', 'Go to passage') : t('Ir ao bloco', 'Go to block')}</button>}
                {item.textAnchor && <blockquote className="pg-comment-quote">{item.textAnchor.segments.map(segment => segment.quote).join('\n')}</blockquote>}
                {item.propertyId && <span className="pg-comment-anchor"><Link2 size={12} /> {t('Propriedade', 'Property')}: {propertyChoices.find((property) => property.id === item.propertyId)?.name ?? t('Propriedade removida', 'Deleted property')}</span>}
                {item.body && <p>{item.body}</p>}
                {item.suggestion && <div className="pg-comment-suggestion">
                  <div><del>{item.suggestion.originalText}</del> → <ins>{item.suggestion.replacementText}</ins></div>
                  {item.suggestion.status === 'open' && !readOnly ? <div className="pg-comment-actions">
                    <button disabled={busyId !== null} onClick={() => void decide(item.id, true)}>{t('Aceitar', 'Accept')}</button>
                    <button disabled={busyId !== null} onClick={() => void decide(item.id, false)}>{t('Rejeitar', 'Reject')}</button>
                  </div> : <small>{item.suggestion.status === 'accepted' ? t('Aceita', 'Accepted') : item.suggestion.status === 'rejected' ? t('Rejeitada', 'Rejected') : t('Pendente', 'Pending')}</small>}
                </div>}
                {!readOnly && (
                  <div className="pg-comment-actions">
                    {!item.parentId && <button onClick={() => { setReplyTo(item.id); setSuggestionMode(false); textareaRef.current?.focus() }}>{t('Responder', 'Reply')}</button>}
                    <button className="pg-comment-resolve" onClick={() => toggleResolved(item.id)}>
                      {item.resolved ? <RotateCcw size={14} /> : <Check size={14} />}
                      {item.resolved ? t('Reabrir', 'Reopen') : t('Resolver', 'Resolve')}
                    </button>
                  </div>
                )}
              </article>)}
              </div>
            ))}
          </div>
          {!readOnly && (
            <div className="pg-comments-compose">
              {textAnchor && !replyTo && <blockquote className="pg-comment-quote">{textAnchor.segments.map(segment => segment.quote).join('\n')} <button onClick={() => setTextAnchor(null)}>{t('Remover seleção', 'Remove selection')}</button></blockquote>}
              {replyTo && <div className="pg-comment-replying">{t('Respondendo ao comentário', 'Replying to comment')} <button onClick={() => setReplyTo(null)}>{t('Cancelar', 'Cancel')}</button></div>}
              {!replyTo && propertyChoices.length > 0 && <Select aria-label={t('Associar a uma propriedade', 'Attach to property')} value={propertyId} onChange={(event) => { setTextAnchor(null); setPropertyId(event.target.value); if (event.target.value) { setBlockId(''); setOriginalText(''); setSuggestionMode(false) } }}>
                <option value="">{t('Sem propriedade específica', 'No specific property')}</option>
                {propertyChoices.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
              </Select>}
              {!replyTo && <Select aria-label={t('Associar a um bloco', 'Attach to block')} value={blockId} onChange={(event) => { setTextAnchor(null); setBlockId(event.target.value); if (event.target.value) setPropertyId(''); setOriginalText(blockChoices.find((item) => item.id === event.target.value)?.firstText ?? '') }}>
                <option value="">{t('Página inteira', 'Whole page')}</option>
                {blockChoices.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </Select>}
              <textarea
                ref={textareaRef}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); add() }
                }}
                placeholder={t('Escreva um comentário…', 'Write a comment…')}
                aria-label={t('Novo comentário', 'New comment')}
                rows={1}
              />
              {!replyTo && <label className="pg-comment-suggest-toggle"><input type="checkbox" checked={suggestionMode} disabled={Boolean(propertyId)} onChange={(event) => setSuggestionMode(event.target.checked)} />{t('Sugerir edição no bloco', 'Suggest an edit to the block')}</label>}
              {suggestionMode && !replyTo && <div className="pg-comment-suggest-fields">
                <input aria-label={t('Texto original exato', 'Exact original text')} placeholder={t('Texto original exato', 'Exact original text')} value={originalText} onChange={(event) => setOriginalText(event.target.value)} />
                <input aria-label={t('Texto proposto', 'Suggested text')} placeholder={t('Texto proposto; vazio para excluir', 'Suggested text; leave empty to delete')} value={replacementText} onChange={(event) => setReplacementText(event.target.value)} />
              </div>}
              <button onClick={add} disabled={!body.trim() && !suggestionMode}><Send size={14} /> {suggestionMode ? t('Sugerir', 'Suggest') : replyTo ? t('Responder', 'Reply') : t('Comentar', 'Comment')}</button>
            </div>
          )}
          {error && <div className="pg-menu-error" role="alert">{error}</div>}
        </CommentPanel>
      )}
    </>
  )
}

function CommentPanel({ inline, ...props }: React.ComponentProps<typeof Popover> & { inline: boolean }) { return inline ? <div className="pg-comments-inline">{props.children}</div> : <Popover {...props} /> }
