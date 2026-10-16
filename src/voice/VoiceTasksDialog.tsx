// "Tarefas por voz" (B3): grava com o ditado local, mostra a prévia editável "Tarefas encontradas" e só então cria.
// Funciona também sem microfone: dá para colar ou digitar o texto e usar "Encontrar tarefas".
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Mic, Square, Trash2 } from 'lucide-react'
import { selectors, useStore } from '../store'
import { useI18n } from '../i18n'
import { useModalFocus } from '../a11y/useModalFocus'
import { Button } from '../components/ui/Button'
import { Select } from '../components/ui/Select'
import { Textarea } from '../components/ui/Textarea'
import { DialogActions } from '../components/ui/DialogActions'
import { isDictating } from '../components/dictation/dictationSession'
import { showToast } from '../components/ui/toastQueue'
import { createVoiceCapture, type VoiceCapture, type VoiceSnapshot } from './voiceCapture'
import { extractVoiceTasks, itemsToVoiceTasks, type VoicePriority, type VoiceTask } from './taskExtract'
import { localAiReady, splitWithLocalAi } from './aiSplit'
import { createVoiceTasks, destinationProblem, taskDatabases, type VoiceDestination } from './voiceTasksActions'
import './voice.css'

type Listener = (open: boolean) => void
const listeners = new Set<Listener>()
export function openVoiceTasks() { for (const listener of listeners) listener(true) }

const decode = (value: string): VoiceDestination => value.startsWith('page:') ? { kind: 'page', pageId: value.slice(5) } : value.startsWith('db:') ? { kind: 'database', databaseId: value.slice(3) } : { kind: 'daily' }

export function VoiceTasksHost() {
  const [open, setOpen] = useState(false)
  useEffect(() => { const listener: Listener = value => setOpen(value); listeners.add(listener); return () => { listeners.delete(listener) } }, [])
  return open ? <VoiceTasksDialog onClose={() => setOpen(false)} /> : null
}

export function VoiceTasksDialog({ onClose }: { onClose(): void }) {
  const { t, locale } = useI18n()
  const { pages } = useStore()
  const lang = locale === 'en-US' ? 'en-US' : 'pt-BR'
  const [snapshot, setSnapshot] = useState<VoiceSnapshot>({ phase: 'idle', level: 0, text: '' })
  const [transcript, setTranscript] = useState('')
  const [tasks, setTasks] = useState<VoiceTask[]>([])
  const [analyzed, setAnalyzed] = useState(false)
  const [destination, setDestination] = useState<string>('daily')
  const [aiReady, setAiReady] = useState(false)
  const [useAi, setUseAi] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const capture = useRef<VoiceCapture | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const hasMic = typeof window !== 'undefined' && !!window.api?.dictationStart
  useModalFocus(root)

  useEffect(() => {
    let alive = true
    void localAiReady().then(ready => { if (alive) setAiReady(ready) })
    return () => { alive = false }
  }, [])
  useEffect(() => () => { void capture.current?.cancel() }, [])

  const analyze = useCallback(async (text: string, withAi: boolean) => {
    setError('')
    let found: VoiceTask[] | null = null
    if (withAi) {
      setBusy(true)
      const items = await splitWithLocalAi(text, lang)
      setBusy(false)
      if (items) found = itemsToVoiceTasks(items, { locale: lang })
      else setError(t('A IA local não respondeu; usei a separação simples.', 'The local AI did not answer; I used the simple split.'))
    }
    setTasks(found ?? extractVoiceTasks(text, { locale: lang }))
    setAnalyzed(true)
  }, [lang, t])

  const record = async () => {
    setError('')
    if (!capture.current) capture.current = createVoiceCapture(window.api, lang, setSnapshot, { busy: isDictating })
    await capture.current.start()
  }
  const stop = async () => {
    const text = await capture.current?.stop()
    if (text?.trim()) { setTranscript(text); await analyze(text, useAi && aiReady) }
  }
  const listening = snapshot.phase === 'listening' || snapshot.phase === 'starting'
  const shown = listening || snapshot.phase === 'stopping' ? snapshot.text : transcript

  const patch = (id: string, change: Partial<VoiceTask>) => setTasks(list => list.map(task => task.id === id ? { ...task, ...change } : task))
  const included = tasks.filter(task => task.include && task.title.trim())

  const options = useMemo(() => {
    const textPages = Object.values(pages).filter(page => !page.database && !page.canvas && selectors.isLive(page.id) && !destinationProblem(page.id)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 25)
    return { textPages, databases: taskDatabases(pages) }
  }, [pages])

  const create = async () => {
    setBusy(true); setError('')
    try {
      const result = await createVoiceTasks(tasks, decode(destination))
      showToast({ message: t('{n} tarefas criadas.', '{n} tasks created.', { n: result.created }) })
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const close = () => { void capture.current?.cancel(); onClose() }

  return <div className="vt-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <div ref={root} className="vt-dialog" role="dialog" aria-modal="true" aria-label={t('Tarefas por voz', 'Tasks by voice')} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
      <h3>{t('Tarefas por voz', 'Tasks by voice')}</h3>
      <p className="vt-hint">{t('Fale suas tarefas de uma vez, por exemplo “ligar para o João amanhã às 10 e depois comprar pão”. O reconhecimento é feito neste computador e nada é criado antes da sua confirmação.', 'Say your tasks in one go, for example “call John tomorrow at 10 and then buy bread”. Recognition runs on this computer and nothing is created before you confirm.')}</p>
      <div className="vt-rec">
        {hasMic && (listening
          ? <Button variant="danger" onClick={() => void stop()}><Square size={14} aria-hidden /> {t('Parar', 'Stop')}</Button>
          : <Button variant="primary" onClick={() => void record()} disabled={snapshot.phase === 'stopping' || busy}><Mic size={14} aria-hidden /> {transcript ? t('Gravar de novo', 'Record again') : t('Gravar', 'Record')}</Button>)}
        {listening && <span className="vt-level" aria-hidden><i style={{ width: `${Math.round(snapshot.level * 100)}%` }} /></span>}
        <span className="vt-status" role="status">{snapshot.phase === 'starting' ? t('Iniciando…', 'Starting…') : snapshot.phase === 'listening' ? t('Ouvindo…', 'Listening…') : snapshot.phase === 'stopping' ? t('Finalizando…', 'Finishing…') : ''}</span>
        {aiReady && <label className="vt-ai"><input type="checkbox" checked={useAi} onChange={event => setUseAi(event.target.checked)} /> {t('Separar com IA local', 'Split with local AI')}</label>}
      </div>
      {snapshot.phase === 'error' && snapshot.error && <p className="vt-error" role="alert">{snapshot.error} {snapshot.pane && <button type="button" className="tk-link" onClick={() => void window.api?.openPrivacySettings?.(snapshot.pane!)}>{t('Abrir Ajustes do Sistema', 'Open System Settings')}</button>}</p>}
      {!hasMic && <p className="vt-hint">{t('O ditado requer o aplicativo para desktop. Cole ou digite o texto abaixo.', 'Dictation requires the desktop app. Paste or type the text below.')}</p>}
      <label className="vt-field"><span>{t('Transcrição', 'Transcript')}</span>
        <Textarea rows={3} value={shown} readOnly={listening} placeholder={t('O que você disser aparece aqui. Você pode editar.', 'What you say appears here. You can edit it.')} onChange={event => { setTranscript(event.target.value); setAnalyzed(false) }} />
      </label>
      <div className="vt-row"><Button disabled={!transcript.trim() || listening || busy} onClick={() => void analyze(transcript, useAi && aiReady)}>{analyzed ? t('Reanalisar', 'Analyze again') : t('Encontrar tarefas', 'Find tasks')}</Button></div>

      {analyzed && <section aria-labelledby="vt-found">
        <h4 id="vt-found">{t('Tarefas encontradas', 'Tasks found')} <span className="tk-badge">{tasks.length}</span></h4>
        {!tasks.length && <p className="vt-hint">{t('Não encontrei tarefas nesse texto. Tente frases curtas, como “comprar pão amanhã”.', 'I found no tasks in that text. Try short phrases like “buy bread tomorrow”.')}</p>}
        <ul className="vt-list">
          {tasks.map(task => <li key={task.id} className={`vt-task${task.include ? '' : ' is-off'}`}>
            <input type="checkbox" checked={task.include} aria-label={t('Criar “{title}”', 'Create “{title}”', { title: task.title })} onChange={event => patch(task.id, { include: event.target.checked })} />
            <input className="vt-title" value={task.title} aria-label={t('Título da tarefa', 'Task title')} onChange={event => patch(task.id, { title: event.target.value })} />
            <input type="date" className="vt-date" value={task.date ?? ''} aria-label={t('Data', 'Date')} onChange={event => patch(task.id, { date: event.target.value || null, ...(event.target.value ? {} : { time: null }) })} />
            <input type="time" className="vt-time" value={task.time ?? ''} disabled={!task.date} aria-label={t('Hora', 'Time')} onChange={event => patch(task.id, { time: event.target.value || null })} />
            <Select value={task.priority} aria-label={t('Prioridade', 'Priority')} onChange={event => patch(task.id, { priority: event.target.value as VoicePriority })}>
              <option value="high">{t('Alta', 'High')}</option><option value="normal">{t('Normal', 'Normal')}</option><option value="low">{t('Baixa', 'Low')}</option>
            </Select>
            <Button variant="ghost" aria-label={t('Remover da lista', 'Remove from list')} onClick={() => setTasks(list => list.filter(item => item.id !== task.id))}><Trash2 size={14} aria-hidden /></Button>
          </li>)}
        </ul>
        {tasks.length > 0 && <label className="vt-field"><span>{t('Destino', 'Destination')}</span>
          <Select value={destination} onChange={event => setDestination(event.target.value)}>
            <option value="daily">{t('Nota diária de hoje', 'Today’s daily note')}</option>
            {options.databases.length > 0 && <optgroup label={t('Bancos de tarefas', 'Task databases')}>{options.databases.map(page => <option key={page.id} value={`db:${page.id}`}>{page.title || t('Sem título', 'Untitled')}</option>)}</optgroup>}
            {options.textPages.length > 0 && <optgroup label={t('Páginas', 'Pages')}>{options.textPages.map(page => <option key={page.id} value={`page:${page.id}`}>{page.title || t('Sem título', 'Untitled')}</option>)}</optgroup>}
          </Select>
        </label>}
      </section>}
      {error && <p className="vt-error" role="alert">{error}</p>}
      <DialogActions confirmLabel={t('Criar {n} tarefas', 'Create {n} tasks', { n: included.length })} onConfirm={() => void create()} onCancel={close} disabled={!analyzed || !included.length} busy={busy} />
    </div>
  </div>
}

