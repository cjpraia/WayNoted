// Seção "Menções não vinculadas" da página: textos que citam o título sem link, com ação "Vincular".
import { useDeferredValue, useMemo, useState } from 'react'
import { ChevronRight, Link2 } from 'lucide-react'
import { actions, api, getState, useStore } from '../../store'
import { t } from '../../i18n'
import { findUnlinkedMentions, linkFirstMention, searchableTitle } from '../../graph/unlinked'
import { PageIcon } from '../page/PageIcon'
import { clearDraft, windowDraftId } from '../page/util'
import './graph.css'

/** Converte a primeira ocorrência do título em `sourceId` num link para `targetId`. */
export async function linkUnlinkedMention(sourceId: string, targetId: string): Promise<boolean> {
  await actions.flushAll()
  const { pages } = getState()
  const source = pages[sourceId], target = pages[targetId]
  if (!source || !target) return false
  if (source.locked) throw new Error(t('A página de origem está bloqueada.', 'The source page is locked.'))
  const blocks = await api.loadDoc(sourceId) ?? []
  const result = linkFirstMention(blocks, target.title, targetId)
  if (!result.linked) return false
  await api.saveDoc(sourceId, result.blocks, { checkpoint: true })
  clearDraft(sourceId)
  await api.draftDelete?.(sourceId, windowDraftId())
  return true
}

export function UnlinkedMentions({ pageId }: { pageId: string }) {
  const { pages } = useStore()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const deferredPages = useDeferredValue(pages)
  const title = pages[pageId]?.title ?? ''
  const mentions = useMemo(() => open ? findUnlinkedMentions(deferredPages, pageId, { limit: 100 }) : [], [open, deferredPages, pageId])
  if (!searchableTitle(title)) return null
  const link = async (sourceId: string) => {
    setBusy(sourceId); setError('')
    try {
      const ok = await linkUnlinkedMention(sourceId, pageId)
      if (!ok) setError(t('A ocorrência não foi encontrada em texto simples (pode estar em uma propriedade ou com formatação dividida).', 'The occurrence was not found in plain text (it may be in a property or split across formatting).'))
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('Não foi possível vincular.', 'Could not link.')) }
    finally { setBusy(null) }
  }
  return <section className={`gr-unlinked${open ? ' is-open' : ''}`} aria-label={t('Menções não vinculadas', 'Unlinked mentions')}>
    <h2><button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
      <ChevronRight size={14} strokeWidth={1.8} aria-hidden />{t('Menções não vinculadas', 'Unlinked mentions')}
      {open && <span className="gr-unlinked-count">{mentions.length}</span>}
    </button></h2>
    {open && <div className="gr-unlinked-list">
      {error && <p className="gr-unlinked-error" role="alert">{error}</p>}
      {!mentions.length && <p className="gr-unlinked-empty">{t('Nenhuma outra página cita “{title}” sem link.', 'No other page mentions “{title}” without a link.', { title })}</p>}
      {mentions.map(mention => <div className="gr-unlinked-item" key={mention.pageId}>
        <button type="button" className="gr-unlinked-source" onClick={event => event.metaKey || event.ctrlKey ? actions.openInNewTab({ type: 'page', id: mention.pageId }) : actions.openPage(mention.pageId)}>
          <span aria-hidden><PageIcon value={mention.icon || '📄'} /></span>
          <span className="gr-unlinked-title">{mention.title || t('Sem título', 'Untitled')}</span>
          {mention.count > 1 && <span className="gr-unlinked-times">{t('{n} ocorrências', '{n} occurrences', { n: mention.count })}</span>}
        </button>
        <p className="gr-unlinked-snippet">{mention.before}<mark>{mention.match}</mark>{mention.after}</p>
        <button type="button" className="gr-unlinked-link" disabled={busy !== null || !!pages[mention.pageId]?.locked} onClick={() => void link(mention.pageId)}
          title={pages[mention.pageId]?.locked ? t('Página bloqueada', 'Page locked') : t('Transformar a primeira ocorrência em menção a esta página', 'Turn the first occurrence into a mention of this page')}>
          <Link2 size={14} /> {busy === mention.pageId ? t('Vinculando…', 'Linking…') : t('Vincular', 'Link')}
        </button>
      </div>)}
    </div>}
  </section>
}
