// Descrição de um banco que era uma página: o corpo original continua acima da tabela, editável.
// Criado por "Transformar em banco de dados" (src/subpages/actions.ts; docs/USAGE.md).
import { useEffect, useState } from 'react'
import { api, selectors, useStore } from '../../store'
import { useI18n } from '../../i18n'
import { PageEditor } from '../page/PageEditor'
import { EditorBoundary } from '../page/EditorBoundary'
import '../page/editor.css'
import '../../subpages/subpages.css'

export function DatabaseDescription({ pageId }: { pageId: string }) {
  const { locale, t } = useI18n()
  const { docRevision } = useStore()
  const page = selectors.page(pageId)
  const [blocks, setBlocks] = useState<unknown[] | null | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    void api.loadDoc(pageId).then((loaded) => { if (alive) setBlocks(Array.isArray(loaded) ? loaded : null) }).catch(() => { if (alive) setBlocks(null) })
    return () => { alive = false }
  }, [pageId, docRevision, attempt])
  if (!page || blocks === undefined) return null
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  return (
    <section className="dbv-description pg-body" aria-label={t('Descrição', 'Description')}>
      <EditorBoundary resetKey={`${pageId}:${docRevision}:${attempt}`} locale={locale} onRetry={() => setAttempt((n) => n + 1)}>
        <PageEditor key={`${docRevision}:${attempt}`} pageId={pageId} initial={blocks} theme={theme} editable={!page.locked} onReady={() => {}} />
      </EditorBoundary>
    </section>
  )
}
