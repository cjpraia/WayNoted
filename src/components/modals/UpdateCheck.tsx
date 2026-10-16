import PRODUCT from '../../../shared/product.json' with { type: 'json' }
// Configurações → Sobre → "Buscar atualizações" (F7). Sem telemetria: nada acontece sozinho. Só ao clicar o app
// faz UMA requisição HTTPS ao feed JSON cuja URL o usuário digitou (vazia por padrão). Nunca baixa nem instala.
import { useState } from 'react'
import { actions, api, useStore } from '../../store'
import { t, useI18n } from '../../i18n'
import type { UpdateCheckResult } from '../../types'
import { Button } from '../ui/Button'
import './UpdateCheck.css'

export function updateErrorText(code: Extract<UpdateCheckResult, { status: 'error' }>['code']): string {
  switch (code) {
    case 'invalid-url': return t('Endereço inválido: use um link https:// público.', 'Invalid address: use a public https:// link.')
    case 'timeout': return t('O servidor demorou demais para responder.', 'The server took too long to respond.')
    case 'http': return t('O servidor não devolveu o arquivo de versões.', 'The server did not return the versions file.')
    case 'too-large': return t('O arquivo de versões é grande demais.', 'The versions file is too large.')
    case 'invalid-feed': return t('O arquivo de versões não está no formato esperado.', 'The versions file is not in the expected format.')
    default: return t('Não foi possível acessar o endereço. Verifique a conexão.', 'Could not reach the address. Check your connection.')
  }
}

export function pickNotes(notes: Record<string, string>, locale: string): string {
  return notes[locale] || notes.default || Object.values(notes)[0] || ''
}

export function UpdateCheck() {
  const { locale } = useI18n()
  const feedUrl = useStore().settings.updateFeedUrl ?? ''
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<UpdateCheckResult | null>(null)
  const [openError, setOpenError] = useState(false)
  const [needsUrl, setNeedsUrl] = useState(false)
  const native = typeof api.checkForUpdates === 'function'

  const check = async () => {
    if (!api.checkForUpdates) return
    if (!feedUrl.trim()) { setNeedsUrl(true); setResult(null); return } // sem endereço: nada de rede, só orienta
    setNeedsUrl(false); setBusy(true); setOpenError(false)
    try { setResult(await api.checkForUpdates(feedUrl.trim())) } catch { setResult({ status: 'error', code: 'network', current: '' }) }
    finally { setBusy(false) }
  }
  const openPage = () => { setOpenError(false); void api.openUpdatePage?.().catch(() => setOpenError(true)) }

  return <div className="uc">
    <div className="uc-title">{t('Atualizações', 'Updates')}</div>
    <p className="st-hint">{t(`O ${PRODUCT.name} nunca procura atualizações sozinho e não envia nenhum dado. Se você quiser, informe o endereço de um arquivo de versões (JSON, https) e clique em Buscar atualizações: será feita uma única requisição, só nesse momento.`, `${PRODUCT.name} never checks for updates by itself and sends no data. If you want, enter the address of a versions file (JSON, https) and click Check for updates: a single request is made, only at that moment.`)}</p>
    <label className="st-label" htmlFor="uc-feed">{t('Endereço do arquivo de versões', 'Versions file address')}</label>
    <input id="uc-feed" className="st-input uc-input" type="url" inputMode="url" spellCheck={false} value={feedUrl}
      placeholder="https://exemplo.com/workspace/versao.json" disabled={!native}
      onChange={event => { setResult(null); setNeedsUrl(false); actions.updateSettings({ updateFeedUrl: event.target.value }) }} />
    <div className="uc-actions">
      <Button disabled={!native || busy} onClick={() => void check()}>{busy ? t('Buscando…', 'Checking…') : t('Buscar atualizações', 'Check for updates')}</Button>
      {!native && <span className="st-hint">{t('Disponível no aplicativo para desktop.', 'Available in the desktop app.')}</span>}
    </div>
    <div className="uc-result" role="status" aria-live="polite">
      {needsUrl && !feedUrl.trim() && <span data-testid="uc-needs-url">{t('Informe o endereço do arquivo de versões acima para buscar atualizações.', 'Enter the versions file address above to check for updates.')}</span>}
      {result?.status === 'current' && <span>{t('Você está na versão mais recente ({version}).', 'You are on the latest version ({version}).', { version: result.current })}</span>}
      {result?.status === 'available' && <>
        <strong>{t('Nova versão {version} disponível (você tem a {current}).', 'New version {version} available (you have {current}).', { version: result.latest, current: result.current })}</strong>
        {pickNotes(result.notes, locale) && <pre className="uc-notes">{pickNotes(result.notes, locale)}</pre>}
        {result.hasDownload
          ? <div className="uc-actions"><Button variant="primary" onClick={openPage}>{t('Abrir página de download', 'Open download page')}</Button><span className="st-hint">{t('Abre no navegador. O app não baixa nem instala nada sozinho.', 'Opens in your browser. The app never downloads or installs anything itself.')}</span></div>
          : <span className="st-hint">{t('O arquivo de versões não informa uma página de download.', 'The versions file does not provide a download page.')}</span>}
        {openError && <span className="uc-error" role="alert">{t('Não foi possível abrir o navegador.', 'Could not open the browser.')}</span>}
      </>}
      {result?.status === 'error' && <span className="uc-error" role="alert">{updateErrorText(result.code)}</span>}
    </div>
  </div>
}
