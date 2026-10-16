// Indicador flutuante do ditado: nível do microfone, estado e botão de parar (Esc também para).
import { useSyncExternalStore } from 'react'
import { Mic, Square, X } from 'lucide-react'
import { useI18n } from '../../i18n'
import { dictationState, dismissDictationError, stopDictation, subscribeDictation } from './dictationSession'
import './dictation.css'

export function DictationIndicator() {
  const { t } = useI18n()
  const state = useSyncExternalStore(subscribeDictation, dictationState)
  if (state.phase === 'idle') return null
  if (state.phase === 'error') {
    return <div className="npdict-pill is-error" role="alert">
      <span className="npdict-error-text">{state.error}</span>
      {state.pane && <button type="button" className="npdict-btn" onClick={() => void window.api?.openPrivacySettings?.(state.pane!)}>{t('Abrir Ajustes do Sistema', 'Open System Settings')}</button>}
      <button type="button" className="npdict-icon-btn" aria-label={t('Fechar', 'Close')} onClick={dismissDictationError}><X size={14} /></button>
    </div>
  }
  const label = state.phase === 'starting' ? t('Preparando o ditado…', 'Preparing dictation…') : state.phase === 'stopping' ? t('Finalizando…', 'Finishing…') : t('Ouvindo', 'Listening')
  return <button type="button" className="npdict-pill" data-phase={state.phase} onClick={() => void stopDictation()} title={t('Parar ditado (Esc)', 'Stop dictation (Esc)')} aria-live="polite">
    <span className="npdict-mic" style={{ ['--npdict-level' as string]: String(state.level) }}><Mic size={14} aria-hidden /></span>
    <span className="npdict-label">{label}</span>
    <span className="npdict-meta">{state.locale} · {t('no dispositivo', 'on device')}</span>
    <span className="npdict-stop"><Square size={11} aria-hidden /> Esc</span>
  </button>
}
