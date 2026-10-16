// Ditado na nota rápida (⌥⌘N): o mesmo motor local do app (createVoiceCapture), ligado à ponte mínima da janela rápida.
// O texto vai para o corpo da nota; erros de permissão abrem o painel certo e tentam de novo quando a nota é reaberta.
import { createVoiceCapture, type VoiceCapture, type VoiceSnapshot } from '../voice/voiceCapture.ts'
import type { QuickApi } from './types.ts'

/** Junta o corpo existente e o ditado: uma linha em branco depois de texto, sem espaços sobrando. */
export function joinDictation(base: string, spoken: string): string {
  const text = spoken.trim()
  if (!text) return base
  if (!base.trim()) return text
  return `${base.replace(/\s+$/, '')}\n\n${text}`
}

export function createQuickVoice(api: Pick<QuickApi, 'dictationStart' | 'dictationStop' | 'dictationCancel' | 'onDictationEvent' | 'openPrivacySettings'>, locale: 'pt-BR' | 'en-US', onChange: (snapshot: VoiceSnapshot) => void): VoiceCapture {
  return createVoiceCapture(api, locale, onChange, { openPane: (pane) => api.openPrivacySettings(pane as 'microphone' | 'speech' | 'dictation') })
}
