import { useState } from 'react'
import { MessageSquare, Plus } from 'lucide-react'
import type { Page, Property } from '../../types'
import { actions, getState } from '../../store'
import { t } from '../../i18n'
import { DbPopover } from './ui/Popover'

/** `onlyWhenPresent`: na tabela o ícone só aparece se a célula já tem comentários (como no Export Bundle); sem isso, é o botão de adicionar da página da linha. */
export function CellComments({ row, property, onlyWhenPresent = false }: { row: Page; property: Property; onlyWhenPresent?: boolean }) {
  const [anchor, setAnchor] = useState<Element | null>(null)
  const [draft, setDraft] = useState('')
  const comments = (row.comments ?? []).filter((comment) => comment.propertyId === property.id)
  const openCount = comments.filter((comment) => !comment.resolved).length
  const add = () => {
    const body = draft.trim()
    if (!body || row.locked) return
    const now = Date.now()
    actions.updatePage(row.id, { comments: [...(row.comments ?? []), { id: crypto.randomUUID(), body, createdAt: now, updatedAt: now, author: getState().settings.userName || t('Eu', 'Me'), resolved: false, propertyId: property.id }] })
    setDraft('')
  }
  if (onlyWhenPresent && comments.length === 0) return null
  return <>
    <button type="button" className={`db-cell-comment${openCount ? ' db-cell-comment--active' : ''}`} title={t('Comentários da célula', 'Cell comments')} aria-label={t('Comentários de {name}: {count}', '{name} comments: {count}', { name: property.name, count: openCount })} onClick={(event) => { event.stopPropagation(); setAnchor(event.currentTarget) }}><MessageSquare size={14} />{openCount > 0 && <span>{openCount}</span>}</button>
    {anchor && <DbPopover anchor={anchor} onClose={() => setAnchor(null)} label={t('Comentários: {name}', 'Comments: {name}', { name: property.name })} className="db-cell-comments-pop">
      <div className="db-cell-comments">
        {comments.length === 0 && <p>{t('Ainda não há comentários nesta propriedade.', 'No comments on this property yet.')}</p>}
        {comments.map((comment) => <div key={comment.id} className={comment.resolved ? 'db-cell-comment-resolved' : ''}><strong>{comment.author}</strong><small>{new Date(comment.createdAt).toLocaleString()}</small><p>{comment.body}</p>{!row.locked && <button type="button" onClick={() => actions.updatePage(row.id, { comments: row.comments?.map((item) => item.id === comment.id ? { ...item, resolved: !item.resolved, updatedAt: Date.now() } : item) })}>{comment.resolved ? t('Reabrir', 'Reopen') : t('Resolver', 'Resolve')}</button>}</div>)}
        {!row.locked && <form onSubmit={(event) => { event.preventDefault(); add() }}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t('Escreva um comentário…', 'Write a comment…')} aria-label={t('Novo comentário', 'New comment')} /><button type="submit" disabled={!draft.trim()}><Plus size={14} />{t('Adicionar', 'Add')}</button></form>}
      </div>
    </DbPopover>}
  </>
}
