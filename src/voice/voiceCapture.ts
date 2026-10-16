// Captura de voz sem editor (B3): usa o mesmo ditado local do macOS (SFSpeechRecognizer on-device via helper nativo),
// mas entrega o texto a quem chamou em vez de escrevê-lo num bloco. Nunca usa reconhecimento em servidor.
import type { DictationEvent, NativeApi } from '../types.ts'
import { composeTranscript, dictationErrorInfo, errorCode, type DictationPane } from '../components/dictation/dictationText.ts'
import { autoFixPane } from '../components/dictation/autoPermission.ts'

export interface VoiceSnapshot {
  phase: 'idle' | 'starting' | 'listening' | 'stopping' | 'error'
  level: number
  /** Texto confirmado + trecho ao vivo. */
  text: string
  error?: string
  pane?: DictationPane
}

export type VoiceNative = Pick<NativeApi, 'dictationStart' | 'dictationStop' | 'dictationCancel' | 'onDictationEvent'>

export interface VoiceCapture {
  snapshot(): VoiceSnapshot
  start(): Promise<void>
  /** Pede o texto final e encerra; resolve com o texto quando o helper terminar. */
  stop(): Promise<string>
  cancel(): Promise<void>
}

export function createVoiceCapture(native: VoiceNative | undefined, locale: 'pt-BR' | 'en-US', onChange: (snapshot: VoiceSnapshot) => void, options: { busy?: () => boolean; failsafeMs?: number; openPane?: (pane: Exclude<DictationPane, null>) => unknown } = {}): VoiceCapture {
  let state: VoiceSnapshot = { phase: 'idle', level: 0, text: '' }
  let sessionId: number | null = null
  let finals = new Map<number, string>()
  let live: { segment: number; text: string } | null = null
  let queue: DictationEvent[] = []
  let unsubscribe: (() => void) | null = null
  let waiting: ((text: string) => void) | null = null
  let failsafe: ReturnType<typeof setTimeout> | undefined
  const set = (patch: Partial<VoiceSnapshot>) => { state = { ...state, ...patch }; onChange(state) }
  const text = () => { const part = composeTranscript(finals, live); return [part.committed, part.live].filter(Boolean).join(' ') }
  const attempts = { count: 0 }
  const fail = (code: string, message?: string) => {
    const info = dictationErrorInfo(code, message, locale)
    set({ phase: 'error', error: info.text, pane: info.pane, level: 0 })
    // Automático: abre o painel do macOS certo e tenta de novo quando o usuário voltar ao aplicativo.
    if (info.pane) autoFixPane(info.pane, () => { if (state.phase === 'error') void self.start() }, { attempts, open: options.openPane })
  }
  const finish = (failure?: { code: string; message?: string }) => {
    clearTimeout(failsafe)
    unsubscribe?.(); unsubscribe = null
    sessionId = null
    const final = text()
    if (failure) fail(failure.code, failure.message)
    else if (state.phase !== 'error') set({ phase: 'idle', level: 0, text: final })
    const resolve = waiting; waiting = null
    resolve?.(final)
  }
  const handle = (event: DictationEvent) => {
    if (sessionId === null) { queue.push(event); return }
    if (event.sessionId !== sessionId) return
    switch (event.type) {
      case 'ready': set({ phase: 'listening' }); break
      case 'level': set({ level: event.value ?? 0 }); break
      case 'partial': live = { segment: event.segment ?? 0, text: event.text ?? '' }; set({ text: text() }); break
      case 'final': finals.set(event.segment ?? 0, event.text ?? ''); if (live?.segment === event.segment) live = null; set({ text: text() }); break
      case 'error': fail(event.code ?? 'DICTATION_FAILED', event.message); break
      case 'end': finish(event.code ? { code: event.code, message: event.message } : undefined); break
    }
  }
  const self: VoiceCapture = {
    snapshot: () => state,
    async start() {
      if (state.phase === 'starting' || state.phase === 'listening') return
      finals = new Map(); live = null; queue = []
      set({ phase: 'starting', error: undefined, pane: undefined, level: 0, text: '' })
      if (!native?.dictationStart || !native.onDictationEvent) { fail('NOT_DESKTOP'); return }
      if (options.busy?.()) { fail('DICTATION_FAILED', 'busy'); return }
      unsubscribe = native.onDictationEvent(handle)
      try {
        const started = await native.dictationStart({ locale })
        sessionId = started.sessionId
        for (const event of queue.splice(0)) handle(event)
      } catch (cause) {
        const { code, message } = errorCode(cause)
        finish({ code, message })
      }
    },
    stop() {
      if (state.phase !== 'listening' && state.phase !== 'starting') return Promise.resolve(text())
      set({ phase: 'stopping' })
      return new Promise<string>(resolve => {
        waiting = resolve
        failsafe = setTimeout(() => { void native?.dictationCancel?.(); finish() }, options.failsafeMs ?? 6000)
        Promise.resolve(native?.dictationStop?.()).catch(() => finish())
      })
    },
    async cancel() {
      if (!unsubscribe && state.phase === 'idle') return
      try { await native?.dictationCancel?.() } catch { /* processo já saiu */ }
      finish()
      set({ phase: 'idle', text: '' })
    },
  }
  return self
}
