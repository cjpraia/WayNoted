import { useEffect, useState } from 'react'
import { version } from '../../../package.json'
import { t } from '../../i18n'
import { api } from '../../store'
import type { AboutInfo } from '../../types'

export function AboutBuildInfo() {
  const [info, setInfo] = useState<AboutInfo>({ version, updated: null, localChanges: false, commitSubject: null })
  useEffect(() => {
    let active = true
    api.getAboutInfo?.().then(value => { if (active) setInfo(value) }, () => {})
    return () => { active = false }
  }, [])
  const updated = info.updated
  const description = info.localChanges
    ? t('Inclui alterações locais (descrição indisponível)', 'Includes local changes (description unavailable)')
    : info.commitSubject ?? t('Descrição da atualização indisponível', 'Update description unavailable')
  const baseCommit = info.localChanges && info.commitSubject
    ? t(`Último commit da base: ${info.commitSubject}`, `Latest base commit: ${info.commitSubject}`)
    : null
  return <>
    <div className="st-hint">{t(`Versão ${info.version}`, `Version ${info.version}`)}</div>
    <div className="st-hint">{updated
      ? t(`Atualizado em ${updated.date} às ${updated.time} (BRT)`, `Updated on ${updated.date} at ${updated.time} (BRT)`)
      : t('Data da atualização indisponível', 'Update date unavailable')}</div>
    <div className="st-hint">{description}</div>
    {baseCommit && <div className="st-hint">{baseCommit}</div>}
  </>
}
