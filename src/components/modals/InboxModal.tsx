import { useEffect, useRef, useState } from 'react'
import { Bell, Check, CheckCheck, Clock, Pencil, Plus, Trash2, X } from 'lucide-react'
import { actions, selectors, useStore } from '../../store'
import { useI18n } from '../../i18n'
import type { LocalNotification } from '../../types'
import { PageIcon } from '../page/PageIcon'
import './InboxModal.css'
import { Illustration } from '../ui/illustrations/Illustration'
import { Select } from '../ui/Select'
import { Button } from '../ui/Button'

const inputDate = (timestamp: number) => { const date = new Date(timestamp); return new Date(timestamp - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }

export function InboxModal() {
  const { notifications, pages, route } = useStore()
  const { t, locale } = useI18n()
  const [filter, setFilter] = useState<'unread' | 'all' | 'scheduled'>('unread')
  const [clock, setClock] = useState(Date.now())
  const [editing, setEditing] = useState<string | null | undefined>(undefined)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pageId, setPageId] = useState('')
  const [due, setDue] = useState(inputDate(Date.now() + 3600000))
  const [repeat, setRepeat] = useState<NonNullable<LocalNotification['repeat']>>('none')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const box = useRef<HTMLDivElement>(null)
  const close = () => { if (!savingRef.current) actions.setInboxOpen(false) }
  const live = Object.values(pages).filter(page => selectors.isLive(page.id)).sort((a,b) => a.title.localeCompare(b.title, locale))
  const all = Object.values(notifications).filter(item => item.dismissedAt == null)
  const unread = all.filter(item => item.dueAt <= clock && item.readAt === null)
  const items = all.filter(item => filter === 'scheduled' ? item.dueAt > clock : filter === 'unread' ? item.dueAt <= clock && item.readAt === null : true).sort((a,b) => filter === 'scheduled' ? a.dueAt - b.dueAt : b.dueAt - a.dueAt)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    box.current?.focus()
    const timer = setInterval(() => setClock(Date.now()), 30000)
    return () => { clearInterval(timer); if (previous?.isConnected) previous.focus() }
  }, [])
  const start = (item?: LocalNotification) => {
    setEditing(item?.id ?? null); setError('')
    setPageId(item?.pageId ?? (route.type === 'page' && selectors.isLive(route.id) ? route.id : live[0]?.id ?? ''))
    setTitle(item?.title ?? ''); setBody(item?.body ?? '')
    setDue(inputDate(item?.dueAt ?? Date.now() + 3600000)); setRepeat(item?.repeat ?? 'none')
  }
  const save = async () => {
    if (savingRef.current) return
    savingRef.current = true; setSaving(true)
    try {
      const timestamp = new Date(due).getTime()
      if (!pageId || !selectors.isLive(pageId)) throw new Error(t('Escolha uma página disponível.', 'Choose an available page.'))
      if (!Number.isFinite(timestamp)) throw new Error(t('Informe uma data e hora válidas.', 'Enter a valid date and time.'))
      const name = title.trim() || pages[pageId]?.title || t('Lembrete', 'Reminder')
      if (editing) actions.updateNotification(editing, { pageId, title: name, body, dueAt: timestamp, repeat, readAt: null, firedAt: null })
      else setEditing(actions.scheduleReminder(pageId, timestamp, name, body, repeat))
      await actions.flushMeta()
      setEditing(undefined); setFilter(timestamp > Date.now() ? 'scheduled' : 'unread'); setClock(Date.now())
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('Não foi possível salvar o lembrete.', 'Could not save the reminder.')) }
    finally { savingRef.current = false; setSaving(false) }
  }
  const mutate = (operation: () => void) => { operation(); void actions.flushMeta().catch(actions.reportSaveError) }
  return <div className="inbox-overlay" onMouseDown={event => event.target === event.currentTarget && close()} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (savingRef.current) return; if (editing !== undefined) setEditing(undefined); else close() }
    if (event.key === 'Tab') {
      const focusable = [...(box.current?.querySelectorAll<HTMLElement>('input,select,textarea,button:not(:disabled)') ?? [])]
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus() }
    }
  }}><div className="inbox-modal" ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="inbox-title">
    <header><Bell size={20} /><h1 id="inbox-title">{t('Notificações', 'Inbox')}</h1><button onClick={close} aria-label={t('Fechar notificações', 'Close inbox')}><X size={18} /></button></header>
    {editing !== undefined ? <form className="inbox-form" onSubmit={event => { event.preventDefault(); void save() }}>
      <h2>{editing ? t('Editar lembrete', 'Edit reminder') : t('Novo lembrete', 'New reminder')}</h2>
      <label>{t('Página', 'Page')}<Select value={pageId} onChange={event => setPageId(event.target.value)}><option value="">{t('Escolher página…', 'Choose page…')}</option>{live.map(page => <option key={page.id} value={page.id}>{page.title || t('Sem título', 'Untitled')}</option>)}</Select></label>
      <label>{t('Título', 'Title')}<input value={title} onChange={event => setTitle(event.target.value)} placeholder={t('Usar título da página', 'Use the page title')} /></label>
      <label>{t('Detalhes', 'Details')}<textarea value={body} onChange={event => setBody(event.target.value)} rows={3} /></label>
      <div className="inbox-form-row"><label>{t('Quando', 'When')}<input type="datetime-local" value={due} onChange={event => setDue(event.target.value)} required /></label><label>{t('Repetir', 'Repeat')}<Select value={repeat} onChange={event => setRepeat(event.target.value as typeof repeat)}><option value="none">{t('Não repetir', 'Never')}</option><option value="daily">{t('Diariamente', 'Daily')}</option><option value="weekly">{t('Semanalmente', 'Weekly')}</option><option value="monthly">{t('Mensalmente', 'Monthly')}</option></Select></label></div>
      {error && <p role="alert" className="inbox-error">{error}</p>}
      <div className="inbox-form-actions"><Button disabled={saving} onClick={() => setEditing(undefined)}>{t('Cancelar', 'Cancel')}</Button><Button variant="primary" type="submit" disabled={saving}>{saving ? t('Salvando…', 'Saving…') : t('Salvar lembrete', 'Save reminder')}</Button></div>
    </form> : <>
      <nav className="inbox-tabs" aria-label={t('Filtrar notificações', 'Filter notifications')}>{(['unread','all','scheduled'] as const).map(tab => <button key={tab} aria-pressed={filter === tab} onClick={() => setFilter(tab)}>{tab === 'unread' ? t('Não lidas', 'Unread') : tab === 'all' ? t('Todas', 'All') : t('Agendadas', 'Scheduled')}{tab === 'unread' && unread.length > 0 && <span>{unread.length}</span>}</button>)}</nav>
      <div className="inbox-toolbar"><button onClick={() => start()}><Plus size={16} />{t('Novo lembrete', 'New reminder')}</button><button disabled={!unread.length} onClick={() => mutate(() => unread.forEach(item => actions.updateNotification(item.id, { readAt: Date.now() })))}><CheckCheck size={16} />{t('Marcar todas como lidas', 'Mark all as read')}</button></div>
      <div className="inbox-items">{items.length ? items.map(item => {
        const page = pages[item.pageId]
        return <article className={`inbox-item${item.readAt === null && item.dueAt <= clock ? ' is-unread' : ''}`} key={item.id}>
          <button className="inbox-item-main" disabled={!selectors.isLive(item.pageId)} onClick={() => { actions.updateNotification(item.id, { readAt: Date.now() }); actions.openPage(item.pageId); close() }}>
            <span className="inbox-page-icon">{page?.icon ? <PageIcon value={page.icon} style={{width:20,height:20}} /> : <Bell size={20} />}</span><span><strong>{item.source && <span className="inbox-recur" title={t('Lembrete da data da tarefa', 'Task date reminder')}>{item.body.includes('↻') ? '↻ ' : ''}</span>}{item.title}</strong>{item.body && <p>{item.body}</p>}<small>{page?.title || t('Página indisponível', 'Page unavailable')} · {new Date(item.dueAt).toLocaleString(locale, { dateStyle:'medium', timeStyle:'short' })}{item.repeat && item.repeat !== 'none' && ` · ${item.repeat === 'daily' ? t('Diariamente','Daily') : item.repeat === 'weekly' ? t('Semanalmente','Weekly') : t('Mensalmente','Monthly')}`}</small></span>
          </button>
          <div className="inbox-item-actions">{!item.source && <button title={t('Editar lembrete', 'Edit reminder')} onClick={() => start(item)}><Pencil size={14} /></button>}<button title={t('Adiar 10 minutos', 'Snooze for 10 minutes')} onClick={() => mutate(() => actions.updateNotification(item.id, { dueAt: Date.now()+600000, firedAt:null,readAt:null, ...(item.source ? { source: { ...item.source, snoozed: true } } : {}) }))}><Clock size={14} /></button><button title={item.readAt ? t('Marcar não lida', 'Mark unread') : t('Marcar lida', 'Mark read')} onClick={() => mutate(() => actions.updateNotification(item.id, { readAt: item.readAt ? null : Date.now() }))}><Check size={14} /></button><button title={t('Excluir lembrete', 'Delete reminder')} onClick={() => mutate(() => actions.removeNotification(item.id))}><Trash2 size={14} /></button></div>
        </article>
      }) : <div className="inbox-empty"><Illustration name="inbox" size={84} /><strong className="np-display">{filter === 'scheduled' ? t('Nenhum lembrete agendado', 'No scheduled reminders') : t('Tudo em dia', 'You’re all caught up')}</strong><p>{t('Crie um lembrete para voltar a uma página na hora certa.', 'Create a reminder to return to a page at the right time.')}</p></div>}</div>
      <footer>{t('Os lembretes são verificados enquanto o app está aberto. Os atrasados aparecem quando você voltar.', 'Reminders are checked while the app is open. Overdue reminders appear when you return.')}</footer>
    </>}
  </div></div>
}
