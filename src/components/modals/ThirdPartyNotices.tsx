// Configurações → Sobre → "Avisos de terceiros e licenças". Mostra THIRD-PARTY-NOTICES.md (lido pelo processo
// principal, caminho fixo), com busca, cópia e "Mostrar no Finder". Somente leitura.
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../store'
import { t } from '../../i18n'
import { copyText } from '../../clipboard'
import { BLOCKNOTE_NOTICE, WORKSPACE_LICENSE } from '../../legal'
import { Button } from '../ui/Button'
import { PanelHeader } from '../ui/PanelHeader'
import { Textarea } from '../ui/Textarea'
import './ThirdPartyNotices.css'

export function filterNotices(text: string, query: string): { text: string; matches: number } {
  const needle = query.trim().toLowerCase()
  if (!needle) return { text, matches: 0 }
  const lines = text.split('\n').filter(line => line.toLowerCase().includes(needle))
  return { text: lines.join('\n'), matches: lines.length }
}

export function ThirdPartyNotices({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<{ loading: boolean; found: boolean; text: string; version: string }>({ loading: true, found: false, text: '', version: '' })
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const native = typeof api.readThirdPartyNotices === 'function'

  useEffect(() => {
    let alive = true
    if (!api.readThirdPartyNotices) { setState(s => ({ ...s, loading: false })); return }
    api.readThirdPartyNotices().then(r => { if (alive) setState({ loading: false, ...r }) }, () => { if (alive) setState(s => ({ ...s, loading: false })) })
    return () => { alive = false }
  }, [])

  const view = useMemo(() => filterNotices(state.text, query), [state.text, query])
  const copy = async () => {
    try { await copyText(state.text); setStatus(t('Copiado.', 'Copied.')) } catch { setStatus(t('Não foi possível copiar.', 'Could not copy.')) }
  }
  const reveal = () => { void api.revealThirdPartyNotices?.().catch(() => setStatus(t('Arquivo não encontrado.', 'File not found.'))) }

  return <div className="tpn">
    <PanelHeader title={t('Avisos de terceiros e licenças', 'Third-party notices and licenses')} onBack={onClose} onClose={onClose} />
    <p className="st-p tpn-notice">{t(BLOCKNOTE_NOTICE.pt, BLOCKNOTE_NOTICE.en)}</p>
    <div className="st-hint tpn-meta">
      <span>{t('Versão', 'Version')} {state.version || '1.0.0'}</span>
      <span>{t(WORKSPACE_LICENSE.pt, WORKSPACE_LICENSE.en)}</span>
    </div>
    <div className="tpn-tools">
      <input className="st-input tpn-search" type="text" value={query} spellCheck={false}
        aria-label={t('Buscar nos avisos', 'Search the notices')} placeholder={t('Buscar pacote ou licença', 'Search package or license')}
        onChange={event => setQuery(event.target.value)} />
      <Button onClick={() => void copy()} disabled={!state.found}>{t('Copiar', 'Copy')}</Button>
      <Button onClick={reveal} disabled={!native || !state.found}>{t('Abrir no Finder', 'Show in Finder')}</Button>
    </div>
    {query.trim() && state.found && <div className="st-hint" role="status">{t(`${view.matches} linha(s) encontrada(s)`, `${view.matches} matching line(s)`)}</div>}
    {status && <div className="st-hint" role="status">{status}</div>}
    {!state.loading && !state.found
      ? <p className="st-hint" role="alert">{t('Arquivo de avisos não encontrado nesta instalação.', 'Notices file not found in this installation.')}</p>
      : <Textarea className="tpn-text" readOnly value={view.text} aria-label={t('Texto dos avisos de terceiros', 'Third-party notices text')} spellCheck={false} />}
  </div>
}
