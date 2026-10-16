// Explicação curta do que é um tipo, mostrada na primeira vez (seletor "+ Tipo" e galeria) até "Entendi".
// Paradoxo do usuário ativo: a ajuda aparece no contexto, uma vez, e some. docs/USAGE.md
import { useStore } from '../../store'
import { useI18n } from '../../i18n'
import { PageIcon } from '../page/PageIcon'
import { setTypesPrefs } from '../../objecttypes/ui'
import { Button } from '../ui/Button'

export function typesIntroText(t: (pt: string, en: string) => string) {
  return t('Um tipo dá campos e um modelo a qualquer página (ex.: Pessoa tem e-mail e telefone). As páginas continuam onde estão.', 'A type gives any page fields and a template (e.g. Person has email and phone). Pages stay where they are.')
}

export function TypesIntro({ compact }: { compact?: boolean }) {
  const { t } = useI18n()
  const { settings } = useStore()
  if (settings.objectTypesPrefs?.introSeen) return null
  return <div className={`ot-intro${compact ? ' ot-intro--compact' : ''}`} role="note" data-ot="intro">
    <div className="ot-intro-example" aria-hidden>
      <span className="ot-chip db-color-blue"><span className="ot-chip-icon"><PageIcon value="lucide:user:blue" style={{ width: 14, height: 14 }} /></span><span className="ot-chip-name">{t('Pessoa', 'Person')}</span></span>
      <span className="ot-intro-fields">{t('E-mail · Telefone · Empresa', 'Email · Phone · Company')}</span>
    </div>
    <p>{typesIntroText(t)}</p>
    <Button onClick={(e) => { e.stopPropagation(); setTypesPrefs({ introSeen: true }) }}>{t('Entendi', 'Got it')}</Button>
  </div>
}
