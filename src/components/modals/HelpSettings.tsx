// Configurações → Ajuda: reabrir "Primeiros passos" e ligar/desligar "Você sabia?".
import { actions, useStore } from '../../store'
import { t, useI18n } from '../../i18n'
import { checklistVisible, onboardingProgress } from '../../onboarding/model'
import { reopenOnboarding, setTipsOff } from '../../onboarding/actions'
import { TypesGuide } from '../objecttypes/TypesGallery'
import { setTypesPrefs } from '../../objecttypes/ui'
import { Button } from '../ui/Button'

export function HelpSettings() {
  const { settings } = useStore()
  useI18n()
  const { done, total } = onboardingProgress(settings.onboarding)
  const open = checklistVisible(settings.onboarding)
  return <>
    <h2 className="st-h">{t('Ajuda', 'Help')}</h2>
    <div className="st-label">{t('Primeiros passos', 'Getting started')}</div>
    <div className="st-hint st-mb">{t('{done} de {total} passos feitos. Eles se marcam sozinhos quando você usa o recurso, sem enviar nada para fora do Mac.', '{done} of {total} steps done. They tick themselves when you use the feature, and nothing leaves your Mac.', { done, total })}</div>
    <Button disabled={open} onClick={() => { reopenOnboarding(); actions.setSettingsOpen(false); actions.navigate({ type: 'home' }) }}>{open ? t('Já está no Meu dia', 'Already on My day') : t('Reabrir no Meu dia', 'Reopen on My day')}</Button>
    <div className="st-label" style={{ marginTop: 20 }}>{t('Dicas', 'Tips')}</div>
    <label className="st-label"><input type="checkbox" checked={!settings.onboarding?.tipsOff} onChange={e => setTipsOff(!e.target.checked)} /> {t('Mostrar “Você sabia?” (no máximo uma vez por sessão)', 'Show “Did you know?” (at most once per session)')}</label>
    {/* Guia "Página, Banco ou Tipo?" (docs/USAGE.md) */}
    <div className="st-label" style={{ marginTop: 20 }} id="help-types-guide">{t('Página, banco ou tipo?', 'Page, database or type?')}</div>
    <div className="st-hint st-mb">{t('Três jeitos de organizar. Escolha pelo que você quer fazer agora; dá para mudar depois.', 'Three ways to organize. Pick by what you want to do now; you can change later.')}</div>
    <TypesGuide />
    {(settings.objectTypesPrefs?.introSeen || settings.objectTypesPrefs?.confirmOff) && <Button style={{ marginTop: 12 }} onClick={() => setTypesPrefs({ introSeen: false, confirmOff: false, confirmedTypes: [] })}>{t('Mostrar de novo as explicações dos tipos', 'Show the type explanations again')}</Button>}
  </>
}
