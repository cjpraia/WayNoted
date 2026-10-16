import PRODUCT from '../../shared/product.json' with { type: 'json' }
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Calendar, ChevronDown, Database, FileText, Inbox, Link2, Lock, Mic, Search, Square, Tag, X } from 'lucide-react'
import { translate, type Locale } from '../localization'
import { markdownToBlocks, blocksPlainText } from './markdown'
import { extractQuickTokens } from './tokens'
import { createQuickVoice, joinDictation } from './voice'
import type { VoiceCapture, VoiceSnapshot } from '../voice/voiceCapture'
import type { QuickDestination, QuickDestinationInfo, QuickDraft, QuickInit, QuickPrefill } from './types'

const quick = () => window.quickApi!

function mergePrefill(draft: QuickDraft, prefill: QuickPrefill | null): QuickDraft {
  if (!prefill || (!prefill.text && !prefill.title && !prefill.sourceUrl)) return draft
  const body = [draft.body?.trim(), prefill.text?.trim()].filter(Boolean).join('\n\n')
  return { ...draft, title: draft.title?.trim() ? draft.title : prefill.title ?? '', body, sourceUrl: prefill.sourceUrl ?? draft.sourceUrl ?? null }
}

export function QuickNote() {
  const [init, setInit] = useState<QuickInit | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [destination, setDestination] = useState<QuickDestination | null>(null)
  const [info, setInfo] = useState<QuickDestinationInfo | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [date, setDate] = useState('')
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<QuickDestination[]>([])
  const [highlight, setHighlight] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const loaded = useRef(false)
  const [voice, setVoice] = useState<VoiceSnapshot>({ phase: 'idle', level: 0, text: '' })
  const voiceBase = useRef('')
  const voiceRef = useRef<VoiceCapture | null>(null)
  const locale: Locale = init?.locale ?? 'en-US'
  const t = useCallback((pt: string, en: string, vars?: Record<string, string | number>) => translate(locale, pt, en, vars), [locale])

  // Ditado: o texto entra no corpo (ao vivo) a partir do que já estava escrito quando o microfone foi ligado.
  const voiceOn = voice.phase === 'listening' || voice.phase === 'starting' || voice.phase === 'stopping'
  useEffect(() => {
    voiceRef.current = createQuickVoice(quick(), locale, snapshot => {
      setVoice(snapshot)
      setBody(joinDictation(voiceBase.current, snapshot.text))
    })
    return () => { void voiceRef.current?.cancel() }
  }, [locale])
  const toggleVoice = useCallback(() => {
    const capture = voiceRef.current
    if (!capture) return
    if (voice.phase === 'listening' || voice.phase === 'starting') { void capture.stop(); return }
    voiceBase.current = bodyRef.current?.value ?? ''
    void capture.start()
  }, [voice.phase])

  const apply = useCallback((value: QuickInit, prefill: QuickPrefill | null) => {
    const draft = mergePrefill(value.draft ?? {}, prefill)
    loaded.current = false
    setInit(value)
    setLocked(!!value.locked)
    setTitle(draft.title ?? ''); setBody(draft.body ?? ''); setDestination(draft.destination ?? null)
    setTags(draft.tags ?? []); setDate(draft.date ?? ''); setSourceUrl(draft.sourceUrl ?? null)
    setError(null); setPickerOpen(false); setTagInput('')
    requestAnimationFrame(() => {
      loaded.current = true
      const target = draft.title?.trim() || prefill?.text ? bodyRef.current : titleRef.current
      target?.focus()
      if (target === bodyRef.current && bodyRef.current) bodyRef.current.selectionStart = bodyRef.current.selectionEnd = bodyRef.current.value.length
    })
  }, [])

  useEffect(() => {
    void quick().init().then(value => apply(value, value.prefill))
    const off = quick().onShow(() => { void quick().init().then(value => apply(value, value.prefill)) })
    const media = matchMedia('(prefers-color-scheme: dark)')
    const onMedia = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', onMedia)
    return () => { off(); media.removeEventListener('change', onMedia) }
  }, [apply])

  const theme = init?.theme === 'dark' || (init?.theme !== 'light' && systemDark) ? 'dark' : 'light'
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => { document.documentElement.lang = locale }, [locale])

  // Rascunho preservado: Esc, clique fora ou ⌘Q não perdem o texto.
  const draft = useMemo<QuickDraft>(() => ({ title, body, destination, tags, date, sourceUrl }), [title, body, destination, tags, date, sourceUrl])
  useEffect(() => {
    if (!loaded.current) return
    const timer = setTimeout(() => void quick().saveDraft(draft).then(result => { if (result) setLocked(result.locked) }).catch(() => {}), 250)
    return () => clearTimeout(timer)
  }, [draft])

  useEffect(() => {
    setInfo(null)
    if (destination?.database) void quick().destination(destination.id).then(setInfo).catch(() => setInfo(null))
  }, [destination])

  useEffect(() => {
    if (!pickerOpen) return
    let canceled = false
    void quick().search(query).then(list => { if (!canceled) { setResults(list); setHighlight(0) } })
    return () => { canceled = true }
  }, [pickerOpen, query])

  const close = useCallback(async () => {
    await quick().saveDraft(draft).catch(() => {})
    await quick().close()
  }, [draft])

  // "@amanhã às 9h" e "#tag" no título/corpo: só quando o destino tem data/etiquetas (a caixa de entrada tem ambos).
  const canDate = !destination || !!info?.date, canTags = !destination || !!info?.tags
  const tokens = useMemo(() => extractQuickTokens(title, body, { locale, dates: canDate, tags: canTags }), [title, body, locale, canDate, canTags])
  const save = useCallback(async () => {
    if (busy) return
    if (locked) { await quick().saveDraft(draft).catch(() => {}); return }
    const blocks = markdownToBlocks(tokens.body)
    if (!tokens.title.trim() && !blocksPlainText(blocks).trim()) { setError(t('Escreva algo antes de salvar.', 'Write something before saving.')); return }
    setBusy(true); setError(null)
    const pendingTags = [...(tagInput.trim() ? [...tags, tagInput.trim()] : tags), ...tokens.tags]
    const dateValue = tokens.date
    try {
      await quick().save({ title: tokens.title.trim(), blocks, destinationId: destination?.id ?? null, tags: canTags ? pendingTags : [], date: dateValue ? dateValue.start : info?.date && date ? date : null, dateValue: dateValue ?? undefined, sourceUrl })
      loaded.current = false
      setTitle(''); setBody(''); setTags([]); setTagInput(''); setDate(''); setSourceUrl(null)
      await quick().close()
    } catch (cause) {
      if (/VAULT_LOCKED/.test(String((cause as Error)?.message ?? cause))) { setLocked(true); await quick().saveDraft(draft).catch(() => {}); return }
      setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(cause))
    } finally { setBusy(false) }
  }, [busy, locked, draft, tokens, tags, tagInput, destination, info, date, sourceUrl, t, canTags])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void save(); return }
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        if (voiceRef.current && (voiceRef.current.snapshot().phase === 'listening' || voiceRef.current.snapshot().phase === 'starting')) { void voiceRef.current.stop(); return }
        if (pickerOpen) { setPickerOpen(false); bodyRef.current?.focus() } else void close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, close, pickerOpen])

  const choose = (item: QuickDestination | null) => {
    setDestination(item); setPickerOpen(false); setQuery('')
    requestAnimationFrame(() => (title.trim() ? bodyRef.current : titleRef.current)?.focus())
  }
  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    const total = results.length + 1
    if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight(index => (index + 1) % total) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight(index => (index - 1 + total) % total) }
    else if (event.key === 'Enter' && !event.metaKey) { event.preventDefault(); choose(highlight === 0 ? null : results[highlight - 1]) }
  }
  const addTag = (value: string) => {
    const name = value.trim().replace(/,$/, '').trim()
    if (name && !tags.some(tag => tag.toLowerCase() === name.toLowerCase())) setTags([...tags, name])
    setTagInput('')
  }

  if (!init) return <div className="qn" aria-busy="true" />
  const destinationLabel = destination ? destination.title || t('Sem título', 'Untitled') : t('Caixa de entrada rápida', 'Quick inbox')
  const words = (title + ' ' + body).trim().split(/\s+/).filter(Boolean).length

  return (
    <div className="qn" role="dialog" aria-label={t('Nova nota rápida', 'New quick note')}>
      <header className="qn-head">
        <button className="qn-dest" onClick={() => { setPickerOpen(!pickerOpen); requestAnimationFrame(() => searchRef.current?.focus()) }} aria-haspopup="listbox" aria-expanded={pickerOpen} title={t('Escolher destino', 'Choose destination')}>
          {destination ? (destination.icon ? <span className="qn-emoji">{destination.icon}</span> : destination.database ? <Database size={14} /> : <FileText size={14} />) : <Inbox size={14} />}
          <span className="qn-dest-label">{destinationLabel}</span>
          <ChevronDown size={14} />
        </button>
        <span className="qn-space">{init.workspaceName}</span>
        <button className="qn-icon-btn" onClick={() => void close()} aria-label={t('Fechar (o rascunho é mantido)', 'Close (draft is kept)')}><X size={16} /></button>
      </header>
      {pickerOpen && <div className="qn-picker">
        <div className="qn-picker-search"><Search size={14} /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onSearchKey} placeholder={t('Buscar página ou banco de dados…', 'Search for a page or database…')} aria-label={t('Buscar destino', 'Search destination')} /></div>
        <div className="qn-picker-list" role="listbox">
          <button role="option" aria-selected={highlight === 0} className={`qn-option${highlight === 0 ? ' is-active' : ''}`} onMouseEnter={() => setHighlight(0)} onClick={() => choose(null)}>
            <Inbox size={16} /><span><b>{t('Caixa de entrada rápida', 'Quick inbox')}</b><small>{t('Banco “Notas rápidas”', '“Quick notes” database')}</small></span>
          </button>
          {results.map((item, index) => <button key={item.id} role="option" aria-selected={highlight === index + 1} className={`qn-option${highlight === index + 1 ? ' is-active' : ''}`} onMouseEnter={() => setHighlight(index + 1)} onClick={() => choose(item)}>
            {item.icon ? <span className="qn-emoji">{item.icon}</span> : item.database ? <Database size={16} /> : <FileText size={16} />}
            <span><b>{item.title || t('Sem título', 'Untitled')}</b>{item.path && <small>{item.path}</small>}</span>
          </button>)}
          {!results.length && query && <div className="qn-empty">{t('Nenhuma página encontrada', 'No pages found')}</div>}
        </div>
      </div>}
      <input ref={titleRef} className="qn-title" value={title} onChange={event => setTitle(event.target.value)} placeholder={t('Título', 'Title')} aria-label={t('Título', 'Title')}
        onKeyDown={event => { if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) { event.preventDefault(); bodyRef.current?.focus() } }} />
      <textarea ref={bodyRef} className="qn-body" value={body} onChange={event => setBody(event.target.value)} spellCheck
        placeholder={t('Escreva… Markdown leve: # título, - lista, [ ] tarefa, **negrito** · @amanhã às 9h define a data · #tag', 'Write… Light Markdown: # heading, - list, [ ] task, **bold** · @tomorrow 9am sets the date · #tag')} aria-label={t('Conteúdo', 'Content')} />
      {(info?.database && (info.tags || info.date)) || sourceUrl ? <div className="qn-meta">
        {info?.tags && <label className="qn-field qn-tags"><Tag size={14} aria-hidden />
          {tags.map(tag => <span key={tag} className="qn-chip">{tag}<button onClick={() => setTags(tags.filter(item => item !== tag))} aria-label={t('Remover {tag}', 'Remove {tag}', { tag })}><X size={11} /></button></span>)}
          <input list="qn-tag-options" value={tagInput} onChange={event => event.target.value.endsWith(',') ? addTag(event.target.value) : setTagInput(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.metaKey && tagInput.trim()) { event.preventDefault(); addTag(tagInput) } else if (event.key === 'Backspace' && !tagInput && tags.length) setTags(tags.slice(0, -1)) }}
            placeholder={tags.length ? '' : info.tags.name} aria-label={info.tags.name} />
          <datalist id="qn-tag-options">{info.tags.options.filter(option => !tags.includes(option)).map(option => <option key={option} value={option} />)}</datalist>
        </label>}
        {info?.date && <label className="qn-field qn-date"><Calendar size={14} aria-hidden /><input type="date" value={date} onChange={event => setDate(event.target.value)} aria-label={info.date.name} /></label>}
        {sourceUrl && <span className="qn-field qn-source" title={sourceUrl}><Link2 size={14} aria-hidden /><span>{sourceUrl.replace(/^https?:\/\//, '')}</span><button onClick={() => setSourceUrl(null)} aria-label={t('Remover fonte', 'Remove source')}><X size={11} /></button></span>}
      </div> : null}
      {(tokens.date || tokens.tags.length > 0) && <div className="qn-tokens" role="status" aria-label={t('Reconhecido no texto', 'Recognized in the text')}>
        {tokens.date && <span className="qn-token"><Calendar size={12} aria-hidden /> {t('Entendi:', 'Got it:')} <mark>{tokens.dateLabel}</mark></span>}
        {tokens.tags.map(tag => <span key={tag} className="qn-token"><Tag size={12} aria-hidden /> {tag}</span>)}
      </div>}
      {locked && <div className="qn-error qn-locked" role="alert"><Lock size={14} aria-hidden /> {t(`Desbloqueie o ${PRODUCT.name} para salvar. O rascunho fica guardado até lá.`, `Unlock ${PRODUCT.name} to save. Your draft is kept until then.`)}</div>}
      {error && !locked && <div className="qn-error" role="alert">{error}</div>}
      {voice.phase === 'error' && voice.error && <div className="qn-error" role="alert">{voice.error}{voice.pane ? ' ' + t('Abrimos o painel certo; reabra a nota rápida depois de permitir.', 'We opened the right pane; reopen quick note after allowing.') : ''}</div>}
      <footer className="qn-foot">
        <button type="button" className={`qn-icon-btn qn-mic${voice.phase === 'listening' ? ' is-rec' : ''}`} onClick={toggleVoice} disabled={locked || voice.phase === 'stopping'} aria-pressed={voice.phase === 'listening' || voice.phase === 'starting'}
          aria-label={voice.phase === 'listening' || voice.phase === 'starting' ? t('Parar ditado', 'Stop dictation') : t('Ditar com a voz', 'Dictate with your voice')} title={voice.phase === 'listening' ? t('Gravando… clique para parar (Esc)', 'Recording… click to stop (Esc)') : t('Ditar com a voz (reconhecimento neste Mac)', 'Dictate with your voice (recognized on this Mac)')}>
          {voice.phase === 'listening' || voice.phase === 'starting' ? <Square size={13} fill="currentColor" aria-hidden /> : <Mic size={15} aria-hidden />}
        </button>
        <span className="qn-hint" role="status">{voice.phase === 'listening' && <span className="qn-rec" style={{ opacity: 0.4 + voice.level * 0.6 }} aria-hidden />}{voice.phase === 'listening' ? <>{t('Ouvindo…', 'Listening…')} · </> : voice.phase === 'starting' ? <>{t('Iniciando o microfone…', 'Starting the microphone…')} · </> : null}{words > 0 && <>{t('{n} palavras', '{n} words', { n: words })} · </>}<kbd>Esc</kbd> {t('fechar', 'close')}</span>
        <button className="qn-save" disabled={busy || locked} title={locked ? t(`Desbloqueie o ${PRODUCT.name} para salvar`, `Unlock ${PRODUCT.name} to save`) : undefined} onClick={() => void save()}>{busy ? t('Salvando…', 'Saving…') : t('Salvar', 'Save')}<kbd>⌘↵</kbd></button>
      </footer>
    </div>
  )
}
