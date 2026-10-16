// "Pular para o conteúdo": primeiro item na ordem de foco; leva o foco ao <main> (id "app-main", tabIndex -1).
import { useI18n } from '../i18n'

export const MAIN_ID = 'app-main'

export function SkipLink() {
  const { t } = useI18n()
  return <a className="np-skip-link" href={`#${MAIN_ID}`} onClick={event => {
    // Em file:// (app empacotado) o âncora mudaria a URL; foca direto.
    event.preventDefault()
    const main = document.getElementById(MAIN_ID)
    main?.focus({ preventScroll: false })
  }}>{t('Pular para o conteúdo', 'Skip to content')}</a>
}
