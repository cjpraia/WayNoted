import { useEffect, useState } from 'react'
import { version } from '../../../package.json'
import { t } from '../../i18n'
import { api } from '../../store'
import type { AboutInfo } from '../../types'

export function AboutBuildInfo() {
  const [info, setInfo] = useState<AboutInfo>({ version, updated: null, built: null, baseCommit: null, localChanges: false, commitSubject: null })
  useEffect(() => {
    let active = true
    api.getAboutInfo?.().then(value => { if (active) setInfo(value) }, () => {})
    return () => { active = false }
  }, [])
  const built = info.built
  const description = info.localChanges
    ? t('Inclui alterações locais (descrição indisponível)', 'Includes local changes (description unavailable)')
    : info.commitSubject ?? t('Descrição da atualização indisponível', 'Update description unavailable')
  const baseCommit = info.localChanges && info.commitSubject
    ? t(`Último commit da base: ${info.commitSubject}`, `Latest base commit: ${info.commitSubject}`)
    : null
  return <>
    <div className="st-hint">{t(`Versão ${info.version}`, `Version ${info.version}`)}</div>
    {info.updated && <div className="st-hint">{t(`Atualizado em ${info.updated.date} às ${info.updated.time} (BRT)`, `Updated on ${info.updated.date} at ${info.updated.time} (BRT)`)}</div>}
    <div className="st-hint">{built
      ? t(`Compilado em ${built.date} às ${built.time} (BRT)`, `Built on ${built.date} at ${built.time} (BRT)`)
      : t('Data da compilação indisponível', 'Build date unavailable')}</div>
    {info.baseCommit && <div className="st-hint">{t(`Commit base: ${info.baseCommit}`, `Base commit: ${info.baseCommit}`)}</div>}
    <div className="st-hint">{description}</div>
    {baseCommit && <div className="st-hint">{baseCommit}</div>}
  </>
}
