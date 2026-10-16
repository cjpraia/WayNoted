// Configurações → Segurança e privacidade → ranking de uso local (docs/DEVELOPMENT.md, "Leis aplicadas").
import { useSyncExternalStore } from 'react'
import { t } from '../i18n'
import { Button } from '../components/ui/Button'
import { clearUsage, setUsageEnabled, subscribeUsage, usageCount, usageEnabled, usageVersion } from '../usage/usage'

export function UsageSettings() {
  useSyncExternalStore(subscribeUsage, usageVersion)
  const enabled = usageEnabled()
  const count = usageCount()
  return <section className="st-row st-row-col" aria-labelledby="st-usage-title">
    <span className="st-label" id="st-usage-title">{t('Ordenar comandos pelo meu uso', 'Order commands by my usage')}</span>
    <label className="st-label"><input type="checkbox" checked={enabled} onChange={event => setUsageEnabled(event.target.checked)} /> {t('Lembrar os comandos que mais uso', 'Remember the commands I use most')}</label>
    <span className="st-hint">{t('Guarda só o identificador do comando (como “Título 1”) e quantas vezes foi usado, com peso menor para usos antigos. Fica neste computador, não é enviado a ninguém e nunca inclui o conteúdo das suas páginas. Alimenta Recentes e Sugeridos do menu “/” e a ordem do ⌘K.', 'Stores only the command identifier (like “Heading 1”) and how often it was used, with older uses weighing less. It stays on this computer, is never sent anywhere and never includes your page content. It feeds Recent and Suggested in the “/” menu and the order in ⌘K.')}</span>
    <div className="st-confirm">
      <Button type="button" disabled={!count} onClick={clearUsage}>{t('Apagar histórico de uso', 'Clear usage history')}</Button>
      <span className="st-hint">{count ? t('{n} comandos lembrados', '{n} commands remembered', { n: count }) : t('Nada guardado.', 'Nothing stored.')}</span>
    </div>
  </section>
}
