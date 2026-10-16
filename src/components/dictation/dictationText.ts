import PRODUCT from '../../../shared/product.json' with { type: 'json' }
// Texto do ditado (puro): junta trechos finais e o trecho parcial atual, e traduz códigos de erro.

/** Junta segmentos finais (em ordem) e devolve o texto confirmado e o trecho ao vivo. */
export function composeTranscript(finals: ReadonlyMap<number, string>, live: { segment: number; text: string } | null): { committed: string; live: string } {
  const committed = [...finals.entries()].sort((a, b) => a[0] - b[0]).map(([, text]) => text.trim()).filter(Boolean).join(' ')
  const current = live && !finals.has(live.segment) ? live.text.trim() : ''
  return { committed, live: current }
}

/** Conteúdo inline do bloco: texto confirmado normal e trecho parcial em cinza. */
export function transcriptContent(committed: string, live: string, final: boolean): { type: 'text'; text: string; styles: Record<string, string> }[] {
  if (final) { const text = [committed, live].filter(Boolean).join(' '); return text ? [{ type: 'text', text, styles: {} }] : [] }
  if (!live) return committed ? [{ type: 'text', text: committed, styles: {} }] : []
  return [
    ...(committed ? [{ type: 'text' as const, text: `${committed} `, styles: {} }] : []),
    { type: 'text', text: live, styles: { textColor: 'gray' } },
  ]
}

export type DictationPane = 'microphone' | 'speech' | 'dictation' | null

/** Mensagem e painel dos Ajustes do Sistema para cada código do helper. */
export function dictationErrorInfo(code: string | undefined, message: string | undefined, locale: 'pt-BR' | 'en-US'): { text: string; pane: DictationPane } {
  const en = locale === 'en-US'
  const windows = typeof window !== 'undefined' && window.api?.platform === 'win32'
  if (windows && code === 'ON_DEVICE_UNAVAILABLE') return { pane: 'dictation', text: en ? 'Install the offline speech recognizer for this language in Windows Settings → Time & language → Speech. Audio is never uploaded.' : 'Instale o reconhecedor de fala offline deste idioma em Configurações do Windows → Hora e idioma → Fala. Nenhum áudio é enviado.' }
  if (windows && ['MIC_DENIED', 'ACCESS_DENIED'].includes(code ?? '')) return { pane: 'microphone', text: en ? 'Allow desktop apps to use your microphone in Windows Settings → Privacy & security → Microphone.' : 'Permita o acesso de aplicativos de área de trabalho ao microfone nas Configurações do Windows → Privacidade e segurança → Microfone.' }
  const language = en ? (message?.includes('pt-BR') ? 'Portuguese (Brazil)' : 'English (US)') : (message?.includes('en-US') ? 'inglês (EUA)' : 'português (Brasil)')
  // O macOS devolve kLSRErrorDomain 201 quando o Ditado está desligado em Ajustes do Sistema → Teclado.
  if (/Siri and Dictation are disabled|kLSRErrorDomain\D*201/i.test(message ?? '')) return { pane: 'dictation', text: en
    ? 'Dictation is turned off on this Mac. Turn on Dictation in System Settings → Keyboard → Dictation, then try again. Recognition stays on this Mac.'
    : 'O Ditado está desligado neste Mac. Ative em Ajustes do Sistema → Teclado → Ditado e tente de novo. O reconhecimento continua sendo feito neste Mac.' }
  switch (code) {
    case 'ON_DEVICE_UNAVAILABLE': return { pane: 'dictation', text: en
      ? `On-device speech recognition isn’t available for ${language} on this Mac. Turn on Dictation in System Settings → Keyboard so macOS downloads the language. ${PRODUCT.name} never uses cloud recognition.`
      : `O reconhecimento de fala no dispositivo não está disponível para ${language} neste Mac. Ative o Ditado em Ajustes do Sistema → Teclado para o macOS baixar o idioma. O ${PRODUCT.name} nunca usa reconhecimento na nuvem.` }
    case 'SPEECH_DENIED': return { pane: 'speech', text: en ? `Speech Recognition permission was denied. Enable ${PRODUCT.name} in System Settings → Privacy & Security → Speech Recognition.` : `A permissão de Reconhecimento de Fala foi negada. Ative o ${PRODUCT.name} em Ajustes do Sistema → Privacidade e Segurança → Reconhecimento de Fala.` }
    case 'SPEECH_RESTRICTED': return { pane: 'speech', text: en ? 'Speech recognition is restricted on this Mac.' : 'O reconhecimento de fala está restrito neste Mac.' }
    case 'MIC_DENIED': return { pane: 'microphone', text: en ? `Microphone access was denied. Enable ${PRODUCT.name} in System Settings → Privacy & Security → Microphone.` : `O acesso ao microfone foi negado. Ative o ${PRODUCT.name} em Ajustes do Sistema → Privacidade e Segurança → Microfone.` }
    case 'NO_AUDIO_INPUT': return { pane: null, text: en ? 'No microphone input is available.' : 'Nenhuma entrada de microfone disponível.' }
    case 'UNSUPPORTED_LOCALE': return { pane: null, text: en ? 'Dictation supports Portuguese (Brazil) and English (US).' : 'O ditado suporta português (Brasil) e inglês (EUA).' }
    case 'NATIVE_HELPER_MISSING': return { pane: null, text: en ? 'The native dictation component is missing from this build (npm run build:native).' : 'O componente nativo de ditado não está neste build (npm run build:native).' }
    case 'NATIVE_UNSUPPORTED': case 'NOT_DESKTOP': return { pane: null, text: en ? `Dictation requires the ${PRODUCT.name} desktop app.` : `O ditado requer o app ${PRODUCT.name} para desktop.` }
    case 'LOCKED': return { pane: null, text: en ? 'This page is locked.' : 'Esta página está bloqueada.' }
    default: return { pane: null, text: (en ? 'Dictation stopped: ' : 'O ditado parou: ') + (message || code || (en ? 'unknown error' : 'erro desconhecido')) }
  }
}

/** Extrai o código de um erro vindo do IPC ("Error invoking remote method …: Error: MIC_DENIED: …"). */
export function errorCode(error: unknown): { code: string; message: string } {
  const text = error instanceof Error ? error.message : String(error ?? '')
  const match = text.match(/\b([A-Z][A-Z_]{3,}):\s*(.*)$/)
  return match ? { code: match[1], message: match[2] } : { code: 'DICTATION_FAILED', message: text }
}
