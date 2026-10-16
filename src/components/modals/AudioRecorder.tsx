import { useEffect, useRef, useState } from 'react'
import { Mic, Pause, Play, Square, X, Download, Save } from 'lucide-react'
import { actions, api, selectors } from '../../store'
import { useI18n } from '../../i18n'
import { registerCloseGuard } from '../../close-guards'
import { localIntegrationError } from './localIntegrationErrors'
import './AudioRecorder.css'
import { Select } from '../ui/Select'

const LIMIT = 64 * 1024 * 1024
const blobData = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob) })
const blobBytes = (blob: Blob) => new Promise<Uint8Array>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer)); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob) })

export function AudioRecorder({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const { t } = useI18n()
  const [state, setState] = useState<'idle'|'requesting'|'recording'|'paused'|'ready'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [title, setTitle] = useState(t('Gravação de áudio', 'Audio recording'))
  const [blob, setBlob] = useState<Blob | null>(null)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [modelPath, setModelPath] = useState('')
  const [language, setLanguage] = useState<'auto'|'pt'|'en'>('auto')
  const [transcribing, setTranscribing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [transcriptSaved, setTranscriptSaved] = useState(false)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const audioInsertion = useRef<{ blob: Blob; title: string; id: string } | null>(null)
  const transcriptInsertion = useRef<{ text: string; blocks: unknown[] } | null>(null)
  const size = useRef(0)
  const cancelled = useRef(false)
  const box = useRef<HTMLDivElement>(null)
  const closeState = useRef({ state, blob, busy })
  closeState.current = { state, blob, busy }
  useEffect(() => registerCloseGuard(() => {
    const current = closeState.current
    if (current.busy || current.blob || current.state !== 'idle') {
      throw new Error(t('Salve ou descarte a gravação no gravador antes de fechar ou recarregar a janela.', 'Save or discard the recording in the recorder before closing or reloading the window.'))
    }
  }), [t])
  useEffect(() => {
    cancelled.current = false
    const previous = document.activeElement as HTMLElement | null
    box.current?.focus()
    return () => {
      cancelled.current = true
      void api.cancelTranscription?.().catch(()=>{})
      if (recorder.current?.state !== 'inactive') recorder.current?.stop()
      stream.current?.getTracks().forEach(track => track.stop())
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  useEffect(() => { if (state !== 'recording') return; const timer = setInterval(() => setSeconds(value => value+1), 1000); return () => clearInterval(timer) }, [state])
  useEffect(() => { if (!blob) { setUrl(''); return }; const value = URL.createObjectURL(blob); setUrl(value); return () => URL.revokeObjectURL(value) }, [blob])
  const stop = () => { if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop() }
  const start = async () => {
    setError(''); setState('requesting'); setBlob(null); setSeconds(0); chunks.current=[]; size.current=0
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error(t('A gravação não está disponível neste ambiente.', 'Audio recording is unavailable in this environment.'))
      const media = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      if (cancelled.current) { media.getTracks().forEach(track => track.stop()); return }
      stream.current = media
      const mimeType = ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].find(type => MediaRecorder.isTypeSupported(type))
      const instance = new MediaRecorder(media, { ...(mimeType ? {mimeType} : {}), audioBitsPerSecond: 64000 })
      recorder.current = instance
      instance.ondataavailable = event => {
        if (!event.data.size) return
        chunks.current.push(event.data); size.current += event.data.size
        if (size.current > LIMIT && instance.state !== 'inactive') { setError(t('A gravação atingiu 64 MB e foi interrompida. Salve ou baixe este áudio.', 'Recording reached 64 MB and stopped. Save or download this audio.')); instance.stop() }
      }
      instance.onstop = () => {
        media.getTracks().forEach(track => track.stop()); stream.current=null
        if (!cancelled.current) { setBlob(new Blob(chunks.current,{type:instance.mimeType || 'audio/webm'})); setState('ready') }
      }
      instance.onerror = () => { setError(t('O gravador encontrou um erro. O áudio já capturado pode ser salvo.', 'The recorder encountered an error. Audio already captured can be saved.')); stop() }
      instance.start(1000); setState('recording')
    } catch (cause) { stream.current?.getTracks().forEach(track => track.stop()); setState('idle'); setError(cause instanceof Error ? cause.message : t('Não foi possível acessar o microfone.', 'Could not access the microphone.')) }
  }
  const togglePause = () => {
    const instance=recorder.current
    if (instance?.state === 'recording') { instance.pause(); setState('paused') }
    else if (instance?.state === 'paused') { instance.resume(); setState('recording') }
  }
  const extension = blob?.type.includes('mp4') ? 'm4a' : blob?.type.includes('ogg') ? 'ogg' : 'webm'
  const name = `${title.trim() || t('Gravação', 'Recording')}.${extension}`
  const save = async () => {
    if (!blob || busy) return
    setBusy(true); setError('')
    try {
      if (!selectors.isLive(pageId) || selectors.page(pageId)?.locked) throw new Error(t('A página está bloqueada ou indisponível.', 'The page is locked or unavailable.'))
      const data = await blobData(blob)
      if(audioInsertion.current?.blob!==blob||audioInsertion.current.title!==title) audioInsertion.current={blob,title,id:crypto.randomUUID()}
      await actions.appendPageBlocks(pageId, [{id:audioInsertion.current.id,type:'audio',props:{url:data,name,caption:title.trim(),showPreview:true},children:[]}])
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('Não foi possível salvar o áudio. Você ainda pode baixá-lo.', 'Could not save the audio. You can still download it.')) }
    finally { setBusy(false) }
  }
  const chooseModel = async () => {
    setError('')
    try {
      const selected=await api.pickTranscriptionModel?.()
      if(selected&&!cancelled.current)setModelPath(selected)
    }catch(cause){if(!cancelled.current)setError(localIntegrationError(cause,'transcription',t))}
  }
  const transcribe = async () => {
    if(!blob||!modelPath||transcribing)return
    setTranscribing(true);setError('');setTranscriptSaved(false)
    try {
      if(!api.transcribeAudio)throw new Error(t('A transcrição local requer o aplicativo desktop.', 'Local transcription requires the desktop app.'))
      const text=await api.transcribeAudio({data:await blobBytes(blob),mimeType:blob.type,modelPath,language})
      if(!cancelled.current)setTranscript(text)
    }catch(cause){if(!cancelled.current)setError(localIntegrationError(cause,'transcription',t))}
    finally{if(!cancelled.current)setTranscribing(false)}
  }
  const saveTranscript = async () => {
    if(!transcript.trim()||busy)return
    setBusy(true);setError('')
    try {
      if(!selectors.isLive(pageId)||selectors.page(pageId)?.locked)throw new Error(t('A página está bloqueada ou indisponível.', 'The page is locked or unavailable.'))
      if(transcriptInsertion.current?.text!==transcript) transcriptInsertion.current={text:transcript,blocks:transcript.split(/\n\s*\n/).map(text=>({id:crypto.randomUUID(),type:'paragraph',content:[{type:'text',text,styles:{}}],children:[]}))}
      await actions.appendPageBlocks(pageId,transcriptInsertion.current.blocks)
      setTranscriptSaved(true)
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause))}
    finally{setBusy(false)}
  }
  const close = () => {
    if (busy) return
    if (state === 'recording' || state === 'paused') { stop(); setDiscard(true); return }
    if (blob && !discard) { setDiscard(true); return }
    onClose()
  }
  return <div className="rec-overlay" onKeyDown={event => {
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close()}
    if(event.key==='Tab') { const items=[...(box.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,a[href],audio')??[])]; if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus()} else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus()} }
  }}><div className="rec-dialog" ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="rec-title">
    <header><Mic size={20}/><h2 id="rec-title">{t('Gravar áudio', 'Record audio')}</h2><button onClick={close} disabled={busy} aria-label={t('Fechar gravador', 'Close recorder')}><X size={18}/></button></header>
    <p className="rec-description">{t('Grave com seu microfone e salve na página. Áudio e transcrição permanecem neste dispositivo. Para transcrever, escolha um modelo Whisper local; nenhum modelo é baixado automaticamente.', 'Record your microphone and save it to the page. Audio and transcription stay on this device. To transcribe, choose a local Whisper model; no model is downloaded automatically.')}</p>
    <label>{t('Nome da gravação', 'Recording name')}<input value={title} onChange={event=>setTitle(event.target.value)} disabled={busy}/></label>
    <div className={`rec-clock${state==='recording'?' is-recording':''}`} aria-live="off"><span/>{String(Math.floor(seconds/60)).padStart(2,'0')}:{String(seconds%60).padStart(2,'0')}</div>
    <p className="rec-status" role="status">{state==='requesting'?t('Aguardando permissão do microfone…','Waiting for microphone permission…'):state==='recording'?t('Gravando','Recording'):state==='paused'?t('Pausado','Paused'):state==='ready'?t('Gravação pronta','Recording ready'):t('O microfone só será acessado quando você clicar em Gravar.','The microphone is accessed only when you click Record.')}</p>
    <div className="rec-controls">{state==='idle'&&<button className="is-primary" onClick={()=>void start()}><Mic size={16}/>{t('Gravar','Record')}</button>}{(state==='recording'||state==='paused')&&<><button onClick={togglePause}>{state==='paused'?<Play size={16}/>:<Pause size={16}/>} {state==='paused'?t('Continuar','Resume'):t('Pausar','Pause')}</button><button onClick={stop}><Square size={16}/>{t('Parar','Stop')}</button></>}</div>
    {url&&<audio controls src={url} aria-label={t('Ouvir gravação','Play recording')}/>}
    {blob&&<div className="rec-actions"><a href={url} download={name}><Download size={16}/>{t('Baixar áudio','Download audio')}</a><button onClick={()=>void save()} disabled={busy} className="is-primary"><Save size={16}/>{busy?t('Salvando…','Saving…'):t('Adicionar à página','Add to page')}</button></div>}
    {blob&&api.pickTranscriptionModel&&<section className="rec-transcription">
      <h3>{t('Transcrição local opcional','Optional local transcription')}</h3>
      <p>{t('Requer whisper-cli, ffmpeg e um modelo compatível já instalado. Revise a prévia antes de adicioná-la à página.', 'Requires whisper-cli, ffmpeg and an installed compatible model. Review the preview before adding it to the page.')}</p>
      <button onClick={()=>void chooseModel()} disabled={transcribing||busy}>{modelPath?t('Trocar modelo local','Change local model'):t('Escolher modelo local','Choose local model')}</button>
      {modelPath&&<small title={modelPath}>{modelPath.split(/[\\/]/).at(-1)}</small>}
      <label>{t('Idioma falado','Spoken language')}<Select value={language} onChange={event=>setLanguage(event.target.value as typeof language)} disabled={transcribing}><option value="auto">{t('Detectar automaticamente','Detect automatically')}</option><option value="pt">Português</option><option value="en">English</option></Select></label>
      <button onClick={()=>void transcribe()} disabled={!modelPath||transcribing||busy}>{transcribing?t('Transcrevendo no dispositivo…','Transcribing on device…'):t('Transcrever localmente','Transcribe locally')}</button>
      {transcribing&&<button onClick={()=>void api.cancelTranscription?.().catch(cause=>setError(String(cause)))}>{t('Cancelar transcrição','Cancel transcription')}</button>}
      {transcript&&<><label>{t('Prévia editável da transcrição','Editable transcription preview')}<textarea value={transcript} onChange={event=>{setTranscript(event.target.value);setTranscriptSaved(false)}}/></label><button onClick={()=>void saveTranscript()} disabled={busy||transcriptSaved}>{t('Adicionar transcrição à página','Add transcription to page')}</button>{transcriptSaved&&<p role="status">{t('Transcrição adicionada. Você ainda pode guardar o áudio acima.', 'Transcription added. You can still save the audio above.')}</p>}</>}
    </section>}
    {discard&&<div className="rec-discard" role="alert"><p>{t('Fechar sem adicionar o áudio à página? Baixe a gravação acima para guardar uma cópia.','Close without adding audio to the page? Download the recording above to keep a copy.')}</p><button onClick={()=>setDiscard(false)}>{t('Continuar aqui','Keep recording open')}</button><button onClick={onClose}>{t('Descartar e fechar','Discard and close')}</button></div>}
    {error&&<p className="rec-error" role="alert">{error}</p>}
  </div></div>
}
