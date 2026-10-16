import { useEffect, useState } from 'react'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { actions, api } from '../../store'
import type { DocumentVersion } from '../../types'
import { Popover } from './Popover'
import { absoluteTime, blocksToText } from './util'
import { useI18n } from '../../i18n'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/illustrations/Illustration'

interface Props {
  pageId: string
  pageTitle: string
  locked: boolean
  anchor: HTMLElement | null
  onBack: () => void
  onClose: () => void
}

export function PageHistory({ pageId, pageTitle, locked, anchor, onBack, onClose }: Props) {
  const { locale, t } = useI18n()
  const [versions, setVersions] = useState<DocumentVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    api.listDocVersions(pageId).then(
      (items) => { if (alive) { setVersions(items); setLoading(false) } },
      (cause) => { if (alive) { setError(cause instanceof Error ? cause.message : t('Não foi possível carregar o histórico.', 'Could not load history.')); setLoading(false) } },
    )
    return () => { alive = false }
  }, [pageId, reload])

  const restore = async (version: DocumentVersion) => {
    if (busy || locked) return
    setBusy(true)
    setError(null)
    try {
      await actions.restoreDocVersion(pageId, version)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Não foi possível restaurar a versão.', 'Could not restore the version.'))
      setConfirmId(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover anchor={anchor} onClose={() => { if (!busy) onClose() }} align="end" className="pg-history" width={370}>
      <div className="pg-history-head">
        <button type="button" onClick={onBack} aria-label={t('Voltar ao menu', 'Back to menu')} disabled={busy}><ArrowLeft size={16} /></button>
        <strong>{t('Histórico da página', 'Page history')}</strong>
      </div>
      <p className="pg-history-hint">{t('Versões locais do conteúdo e dos metadados, quando disponíveis. Cada gravação diferente pode gerar um registro; sem limite por padrão. A restauração guarda o estado atual antes de substituir.', 'Local versions of content and metadata when available. Each distinct save may create a record; unlimited by default. Restoring preserves the current state first.')}</p>
      {loading ? <p className="pg-history-status">{t('Carregando versões…', 'Loading versions…')}</p> : versions.length === 0 && !error ? (
        <EmptyState illustration="pages" size={72} title={t('Ainda não há versões anteriores', 'No earlier versions yet')}>{t('Cada gravação diferente da página gera um registro aqui.', 'Each different save of the page adds a record here.')}</EmptyState>
      ) : (
        <div className="pg-history-list">
          {versions.map((version) => {
            const preview = blocksToText(version.blocks).trim()
            const confirming = confirmId === version.id
            const expanded = expandedId === version.id
            const hasMeta = Boolean(version.page)
            return (
              <div className="pg-history-version" key={version.id}>
                <time dateTime={new Date(version.savedAt).toISOString()}>{absoluteTime(version.savedAt, Date.now(), locale)}</time>
                {hasMeta ? <div className="pg-history-meta">{version.page?.title || t('Sem título', 'Untitled')}</div> : <div className="pg-history-meta">{t('Versão antiga: somente conteúdo', 'Older version: content only')}</div>}
                <p className={expanded ? 'is-expanded' : ''}>{preview ? expanded ? preview : preview.slice(0, 240) : t('Página vazia', 'Empty page')}{!expanded && preview.length > 240 ? '…' : ''}</p>
                {preview.length > 240 && <button type="button" className="pg-history-expand" onClick={() => setExpandedId(expanded ? null : version.id)}>{expanded ? t('Recolher prévia', 'Collapse preview') : t('Expandir prévia', 'Expand preview')}</button>}
                {confirming ? (
                  <div className="pg-history-confirm">
                    <span>{hasMeta ? t(`Substituir conteúdo e metadados atuais de “${pageTitle || 'Sem título'}” por esta versão? O estado atual será guardado no histórico.`, `Replace the current content and metadata of “${pageTitle || 'Untitled'}” with this version? The current state will be saved in history.`) : t(`Substituir o conteúdo atual de “${pageTitle || 'Sem título'}” por esta versão? Os metadados atuais permanecem.`, `Replace the current content of “${pageTitle || 'Untitled'}” with this version? Current metadata stays unchanged.`)}</span>
                    <div className="np-dialog-actions">
                      <Button autoFocus onClick={() => setConfirmId(null)} disabled={busy}>{t('Cancelar', 'Cancel')}</Button>
                      <Button variant="danger" onClick={() => void restore(version)} disabled={busy}>{busy ? t('Restaurando…', 'Restoring…') : t('Restaurar versão', 'Restore version')}</Button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="pg-history-restore" onClick={() => setConfirmId(version.id)} disabled={busy || locked}>
                    <RotateCcw size={14} /> {t('Restaurar', 'Restore')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {locked && <p className="pg-history-status">{t('Desbloqueie a página para restaurar uma versão.', 'Unlock the page to restore a version.')}</p>}
      {error && <div className="pg-menu-error" role="alert">{error}{!busy && <button type="button" onClick={() => setReload((value) => value + 1)}>{t('Tentar novamente', 'Try again')}</button>}</div>}
    </Popover>
  )
}
