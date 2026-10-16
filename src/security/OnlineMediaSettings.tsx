import PRODUCT from '../../shared/product.json' with { type: 'json' }
// Configurações → Segurança e privacidade → conteúdo remoto: players de vídeo online (docs/SECURITY.md).
import { actions, useStore } from '../store'
import { t } from '../i18n'
import { effectiveEmbedMode, normalizeEmbedMode, type EmbedMode } from '../components/page/videoEmbed'

export function OnlineMediaSettings() {
  const { settings } = useStore()
  const blocked = settings.blockRemoteContent === true
  const mode = effectiveEmbedMode(settings)
  const stored = normalizeEmbedMode(settings.embedVideos)
  const options: { id: EmbedMode; label: string; hint: string }[] = [
    { id: 'always', label: t('Sempre', 'Always'), hint: t('O player carrega ao abrir a página.', 'The player loads when the page opens.') },
    { id: 'click', label: t('Clicar para carregar', 'Click to load'), hint: t('Cartão local com botão “Carregar vídeo”; nada de rede até clicar.', 'Local card with a “Load video” button; no network until you click.') },
    { id: 'never', label: t('Nunca', 'Never'), hint: t('Só um cartão com o link; o vídeo abre no navegador.', 'Just a card with the link; the video opens in your browser.') },
  ]
  return <section className="st-row st-row-col" aria-labelledby="st-embed-title">
    <span className="st-label" id="st-embed-title">{t('Incorporar vídeos online (YouTube, Vimeo)', 'Embed online videos (YouTube, Vimeo)')}</span>
    <div role="radiogroup" aria-labelledby="st-embed-title" style={{ display: 'grid', gap: 6 }}>
      {options.map(option => <label key={option.id} className="st-hint">
        <input type="radio" name="st-embed-mode" checked={mode === option.id} disabled={blocked && option.id !== 'never'} onChange={() => actions.updateSettings({ embedVideos: option.id })} /> <b>{option.label}</b> — {option.hint}
      </label>)}
    </div>
    <label className="st-label"><input type="checkbox" checked={blocked} onChange={event => actions.updateSettings({ blockRemoteContent: event.target.checked })} /> {t('Bloquear conteúdo remoto', 'Block remote content')}</label>
    <span className="st-hint">{blocked
      ? t('Ligado: nenhum player é carregado, qualquer que seja a escolha acima.', 'On: no player is loaded, whatever you chose above.')
      : t('Desligado: vale o modo escolhido acima.', 'Off: the mode chosen above applies.')}{blocked && stored !== 'never' ? ` ${t('(Escolha salva:', '(Saved choice:')} ${options.find(option => option.id === stored)?.label}.)` : ''}</span>
    <span className="st-hint">{t(`Carregar um player contacta o provedor (YouTube em modo de privacidade aprimorado, Vimeo, Loom, Dailymotion, Spotify), que pode registrar seu endereço IP e cookies do player. O ${PRODUCT.name} não envia o conteúdo das suas páginas. Páginas protegidas por senha só carregam players depois de desbloqueadas.`, `Loading a player contacts the provider (YouTube in enhanced privacy mode, Vimeo, Loom, Dailymotion, Spotify), which may record your IP address and player cookies. ${PRODUCT.name} does not send your page content. Password-protected pages load players only after being unlocked.`)}</span>
  </section>
}
