// Sessão de ditado: liga o helper nativo ao editor e escreve o texto ao vivo num bloco de parágrafo.
// Uma sessão por janela. Esc ou o botão do indicador encerram; o texto final substitui o trecho parcial (cinza).
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { getState } from '../../store'
import type { DictationEvent } from '../../types'
import type { PageEditorType } from '../page/schema'
import { autoFixPane } from './autoPermission'
import { composeTranscript, dictationErrorInfo, errorCode, transcriptContent, type DictationPane } from './dictationText'

export interface DictationState {
  phase: 'idle' | 'starting' | 'listening' | 'stopping' | 'error'
  level: number
  locale: 'pt-BR' | 'en-US'
  error?: string
  pane?: DictationPane
}

let state: DictationState = { phase: 'idle', level: 0, locale: 'pt-BR' }
const listeners = new Set<() => void>()
const setState = (patch: Partial<DictationState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener() }
export const dictationState = () => state
export function subscribeDictation(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }

interface Active {
  editor: PageEditorType
  blockId: string
  inserted: boolean
  sessionId: number | null
  queue: DictationEvent[]
  finals: Map<number, string>
  live: { segment: number; text: string } | null
  unsubscribe: () => void
  onKey: (event: KeyboardEvent) => void
  failsafe?: number
}
let active: Active | null = null
let root: Root | null = null

function mountIndicator() {
  if (root || typeof document === 'undefined') return
  const host = document.createElement('div')
  host.className = 'npdict-host'
  document.body.appendChild(host)
  root = createRoot(host)
  void import('./DictationIndicator').then(({ DictationIndicator }) => root?.render(createElement(DictationIndicator)))
}

const fixAttempts = { count: 0 }
let lastStart: (() => void) | null = null
function showError(code: string, message?: string) {
  const info = dictationErrorInfo(code, message, state.locale)
  setState({ phase: 'error', error: info.text, pane: info.pane, level: 0 })
  // Automático: abre o painel do macOS certo e tenta de novo quando o usuário voltar ao aplicativo.
  if (info.pane && lastStart) autoFixPane(info.pane, () => { if (state.phase === 'error') lastStart?.() }, { attempts: fixAttempts })
}

function render(final: boolean) {
  if (!active) return
  const block = active.editor.getBlock(active.blockId)
  if (!block) { void cancelDictation(); return }
  const { committed, live } = composeTranscript(active.finals, active.live)
  active.editor.updateBlock(active.blockId, { content: transcriptContent(committed, live, final) as never })
}

function handle(event: DictationEvent) {
  if (!active) return
  if (active.sessionId === null) { active.queue.push(event); return }
  if (event.sessionId !== active.sessionId) return
  switch (event.type) {
    case 'ready': setState({ phase: 'listening' }); break
    case 'level': setState({ level: event.value ?? 0 }); break
    case 'partial': active.live = { segment: event.segment ?? 0, text: event.text ?? '' }; render(false); break
    case 'final':
      active.finals.set(event.segment ?? 0, event.text ?? '')
      if (active.live?.segment === event.segment) active.live = null
      render(false)
      break
    case 'error': showError(event.code ?? 'DICTATION_FAILED', event.message); break
    case 'end': finish(event.code ? { code: event.code, message: event.message } : undefined); break
  }
}

function finish(failure?: { code: string; message?: string }) {
  const current = active
  if (!current) return
  render(true)
  const block = current.editor.getBlock(current.blockId)
  const empty = !composeTranscript(current.finals, current.live).committed && !current.live?.text
  if (block && empty && current.inserted) current.editor.removeBlocks([current.blockId])
  else if (block) { try { current.editor.setTextCursorPosition(current.blockId, 'end') } catch { /* bloco fora da tela */ } }
  current.unsubscribe()
  window.removeEventListener('keydown', current.onKey, true)
  window.clearTimeout(current.failsafe)
  active = null
  if (failure) showError(failure.code, failure.message)
  else if (state.phase !== 'error') setState({ phase: 'idle', level: 0 })
}

export function isDictating() { return !!active }

/** Inicia (ou encerra, se já ativo) o ditado no bloco atual ou num novo parágrafo abaixo dele. */
export async function toggleDictation(editor: PageEditorType, options: { blockId?: string } = {}) {
  if (active) { await stopDictation(); return }
  lastStart = () => { void toggleDictation(editor, options) }
  const locale = getState().settings.locale === 'en-US' ? 'en-US' : 'pt-BR'
  setState({ locale, error: undefined, pane: undefined, level: 0 })
  mountIndicator()
  const native = typeof window !== 'undefined' ? window.api : undefined
  if (!native?.dictationStart || !native.onDictationEvent) { showError('NOT_DESKTOP'); return }
  if (editor.isEditable === false) { showError('LOCKED'); return }
  const current = (options.blockId && editor.getBlock(options.blockId)) || editor.getTextCursorPosition().block
  const reusable = current.type === 'paragraph' && Array.isArray(current.content) && current.content.length === 0
  let blockId = current.id, inserted = false
  if (!reusable) {
    const [created] = editor.insertBlocks([{ type: 'paragraph' }], current, 'after')
    blockId = created.id; inserted = true
  }
  try { editor.setTextCursorPosition(blockId, 'end') } catch { /* ignore */ }
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void stopDictation() } }
  window.addEventListener('keydown', onKey, true)
  active = { editor, blockId, inserted, sessionId: null, queue: [], finals: new Map(), live: null, unsubscribe: native.onDictationEvent(handle), onKey }
  setState({ phase: 'starting' })
  try {
    const { sessionId } = await native.dictationStart({ locale })
    if (!active) return
    active.sessionId = sessionId
    const queued = active.queue.splice(0)
    for (const event of queued) handle(event)
  } catch (cause) {
    const { code, message } = errorCode(cause)
    finish({ code, message })
  }
}

export async function stopDictation() {
  if (!active) { if (state.phase === 'error') setState({ phase: 'idle', error: undefined }); return }
  setState({ phase: 'stopping' })
  const current = active
  current.failsafe = window.setTimeout(() => { if (active === current) { void window.api?.dictationCancel?.(); finish() } }, 6000)
  try { await window.api?.dictationStop?.() } catch { finish() }
}

export async function cancelDictation() {
  if (!active) return
  try { await window.api?.dictationCancel?.() } catch { /* processo já saiu */ }
  finish()
}

export function dismissDictationError() { if (state.phase === 'error') setState({ phase: 'idle', error: undefined, pane: undefined }) }
