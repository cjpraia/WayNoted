import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import { AlignCenter, AlignLeft, ArrowUpRight, Bookmark, Copy, Link2, Pencil, Play, RotateCcw, RotateCw, Subtitles, Trash2, WifiOff } from 'lucide-react'
import { api, useStore } from '../../store'
import { copyText } from '../../clipboard'
import { useI18n } from '../../i18n'
import { effectiveEmbedMode, fallbackVideoTitle, formatStartTime, iframeAttributes, parseVideoUrl, PROVIDER_LABEL, withStart, type VideoProvider, type VideoRef } from './videoEmbed'
import { Button } from '../ui/Button'
export type OnlineVideoProps = { url: string; title: string; caption: string; width: number; align: 'left' | 'center' }
const MIN_WIDTH = 240

export function useOnline(): [boolean, () => void] {
  const [online, setOnline] = useState(() => globalThis.navigator?.onLine !== false)
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return [online, () => setOnline(globalThis.navigator?.onLine !== false)]
}

/** Ícone do provedor em linha (traço simples, sem imagem remota). */
export function ProviderIcon({ provider, size = 22 }: { provider: VideoProvider; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false } as const
  switch (provider) {
    case 'youtube': return <svg {...common}><rect x="2" y="5" width="20" height="14" rx="4.5" fill="#e53935" /><path d="M10 9l5.5 3L10 15z" fill="#fff" /></svg>
    case 'vimeo': return <svg {...common}><rect x="2" y="3" width="20" height="18" rx="4.5" fill="#1ab7ea" /><path d="M7 10.2l.9-1c1-.8 1.7.1 1.9 1.1.2 1 .6 3.6.9 4.4.3.8.8.8 1.5.1 1.1-1.2 2-2.6 2.1-3.7.1-1.2-.7-1.4-1.6-1" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    case 'loom': return <svg {...common}><rect x="2" y="2" width="20" height="20" rx="5" fill="#625df5" /><g stroke="#fff" strokeWidth="1.6" strokeLinecap="round"><path d="M12 6.5v11M7.2 9.2l9.6 5.6M16.8 9.2l-9.6 5.6" /></g></svg>
    case 'dailymotion': return <svg {...common}><rect x="2" y="2" width="20" height="20" rx="5" fill="#0a0a0a" /><path d="M9 7.5v9l7-4.5z" fill="#fff" /></svg>
    case 'spotify': return <svg {...common}><circle cx="12" cy="12" r="10" fill="#1db954" /><g fill="none" stroke="#0b0b0b" strokeWidth="1.5" strokeLinecap="round"><path d="M7 9.5c3.5-1 7-.7 10 1" /><path d="M7.5 12.5c3-.8 5.8-.5 8.5 1" /><path d="M8 15.3c2.5-.6 4.7-.4 6.8.8" /></g></svg>
  }
}

function openInBrowser(href: string, fail: () => void) {
  if (api.openExternalPage) void api.openExternalPage(href).catch(fail)
  else window.open(href, '_blank', 'noopener,noreferrer')
}

/** Cartão único (modo Nunca, offline, clicar para carregar ou URL inválida). */
export function VideoCard({ variant, refo, value, editable, onLoad, onRetry, onEdit, onConvert }: {
  variant: 'never' | 'click' | 'offline' | 'invalid'
  refo: VideoRef | null; value: OnlineVideoProps; editable: boolean
  onLoad?: () => void; onRetry?: () => void; onEdit?: () => void; onConvert?: () => void
}) {
  const { t } = useI18n()
  const [message, setMessage] = useState('')
  const href = refo?.watchUrl ?? ''
  const title = value.title || (refo ? fallbackVideoTitle(refo) : t('Vídeo online', 'Online video'))
  const domain = href ? new URL(href).hostname.replace(/^www\./, '') : ''
  const note = variant === 'click' ? t('Carregar o player contacta o provedor (YouTube, Vimeo…). Nada é solicitado até você clicar.', 'Loading the player contacts the provider (YouTube, Vimeo…). Nothing is requested until you click.')
    : variant === 'offline' ? t('Sem conexão com a internet. O link continua salvo.', 'No internet connection. The link remains saved.')
    : variant === 'never' ? t('Incorporação de vídeos online desativada em Configurações → Segurança e privacidade.', 'Online video embedding is turned off in Settings → Security & privacy.')
    : !value.url.trim() ? t('Cole um link do YouTube, Vimeo, Loom, Dailymotion ou Spotify.', 'Paste a YouTube, Vimeo, Loom, Dailymotion or Spotify link.')
    : t('Endereço de vídeo não reconhecido. Use YouTube, Vimeo, Loom, Dailymotion ou Spotify.', 'Video address not recognized. Use YouTube, Vimeo, Loom, Dailymotion or Spotify.')
  return <div className="pg-video-card" data-variant={variant}>
    <span className="pg-video-card-icon">{refo ? <ProviderIcon provider={refo.provider} size={28} /> : variant === 'offline' ? <WifiOff size={22} aria-hidden /> : <Play size={22} aria-hidden />}</span>
    <div className="pg-video-card-body">
      <strong className="pg-video-card-title">{title}</strong>
      <span className="pg-video-card-domain">{refo ? `${PROVIDER_LABEL[refo.provider]} · ${domain}` : value.url || t('Adicione um link', 'Add a link')}</span>
      <small className="pg-video-card-note" role="status">{message || note}</small>
      <div className="pg-video-card-actions">
        {variant === 'click' && onLoad && <button type="button" className="pg-video-primary" onClick={onLoad}><Play size={14} aria-hidden />{t('Carregar vídeo', 'Load video')}</button>}
        {variant === 'offline' && onRetry && <button type="button" className="pg-video-primary" onClick={onRetry}><RotateCw size={14} aria-hidden />{t('Tentar de novo', 'Try again')}</button>}
        {href && <button type="button" onClick={() => openInBrowser(href, () => setMessage(t('Não foi possível abrir o navegador.', 'Could not open the browser.')))}><ArrowUpRight size={14} aria-hidden />{t('Abrir no navegador', 'Open in browser')}</button>}
        {editable && onEdit && variant === 'invalid' && value.url.trim() && <button type="button" onClick={onEdit}><Pencil size={14} aria-hidden />{t('Editar link', 'Edit link')}</button>}
        {editable && onConvert && href && <button type="button" onClick={onConvert}><Bookmark size={14} aria-hidden />{t('Converter em marcador', 'Convert to bookmark')}</button>}
      </div>
    </div>
  </div>
}

export interface VideoActions {
  update(patch: Partial<OnlineVideoProps>): void
  toBookmark(): void
  toLink(): void
  remove(): void
}

export function OnlineVideo({ value, editable, actions }: { value: OnlineVideoProps; editable: boolean; actions: VideoActions }) {
  const { t } = useI18n()
  const { settings } = useStore()
  const mode = effectiveEmbedMode(settings)
  const [online, recheck] = useOnline()
  const refo = parseVideoUrl(value.url)
  const [loaded, setLoaded] = useState(false)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'slow'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState(!value.url)
  const [captionOpen, setCaptionOpen] = useState(!!value.caption)
  const [resizing, setResizing] = useState(false)
  const [draftWidth, setDraftWidth] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const frame = refo ? iframeAttributes(refo, value.title || `${refo.label}`) : null
  const showPlayer = !!refo && online && (mode === 'always' || (mode === 'click' && loaded))

  useEffect(() => { setLoaded(false); setPhase('loading') }, [value.url])
  useEffect(() => {
    if (!showPlayer || phase !== 'loading') return
    const timer = setTimeout(() => setPhase(current => current === 'loading' ? 'slow' : current), 20_000)
    return () => clearTimeout(timer)
  }, [showPlayer, phase, attempt, value.url])
  useEffect(() => { if (!status) return; const timer = setTimeout(() => setStatus(''), 2200); return () => clearTimeout(timer) }, [status])

  const parentWidth = () => box.current?.parentElement?.clientWidth ?? 720
  const width = draftWidth ?? (value.width > 0 ? value.width : 0)
  const clamp = (next: number) => Math.round(Math.max(MIN_WIDTH, Math.min(parentWidth(), next)))
  const startResize = (side: 'left' | 'right') => (event: ReactPointerEvent<HTMLElement>) => {
    if (!editable || event.button !== 0) return
    event.preventDefault()
    const target = event.currentTarget
    target.setPointerCapture?.(event.pointerId)
    const startX = event.clientX, startWidth = box.current?.offsetWidth ?? parentWidth()
    const factor = (side === 'right' ? 1 : -1) * (value.align === 'center' ? 2 : 1)
    setResizing(true)
    let last = startWidth
    const move = (e: PointerEvent) => { last = clamp(startWidth + (e.clientX - startX) * factor); setDraftWidth(last) }
    const up = () => {
      target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up)
      setResizing(false); setDraftWidth(null)
      actions.update({ width: last >= parentWidth() - 2 ? 0 : last })
    }
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up)
  }
  const resizeKey = (event: KeyboardEvent<HTMLElement>) => {
    if (!editable || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const current = box.current?.offsetWidth ?? parentWidth()
    const next = clamp(current + (event.key === 'ArrowRight' ? 24 : -24))
    actions.update({ width: next >= parentWidth() - 2 ? 0 : next })
  }

  const copy = () => { if (!refo) return; void copyText(refo.watchUrl).then(() => setStatus(t('Link copiado.', 'Link copied.'))).catch(() => setStatus(t('Não foi possível copiar.', 'Could not copy.'))) }
  const restart = () => { if (refo) actions.update({ url: withStart(refo, 0).watchUrl }) }
  const caption = <VideoCaption value={value} editable={editable} open={captionOpen} onChange={caption => actions.update({ caption: caption.slice(0, 500) })} />

  let body: ReactNode
  if (!refo) body = <VideoCard variant="invalid" refo={null} value={value} editable={editable} onEdit={() => setEditing(true)} />
  else if (mode === 'never') body = <VideoCard variant="never" refo={refo} value={value} editable={editable} onConvert={actions.toBookmark} />
  else if (!online) body = <VideoCard variant="offline" refo={refo} value={value} editable={editable} onRetry={() => { setAttempt(n => n + 1); setPhase('loading'); recheck() }} onConvert={actions.toBookmark} />
  else if (mode === 'click' && !loaded) body = <VideoCard variant="click" refo={refo} value={value} editable={editable} onLoad={() => setLoaded(true)} onConvert={actions.toBookmark} />
  else if (showPlayer && frame) body = <div className="pg-video-frame" data-provider={refo.provider} style={refo.height ? { height: refo.height } : { aspectRatio: String(refo.ratio) }}>
    <iframe key={`${frame.src}#${attempt}`} src={frame.src} title={frame.title} sandbox={frame.sandbox} allow={frame.allow} referrerPolicy={frame.referrerPolicy} loading={frame.loading}
      style={resizing ? { pointerEvents: 'none' } : undefined} onLoad={() => setPhase('ready')} />
    {phase === 'slow' && <div className="pg-video-slow" role="status"><span>{t('O player demora a responder.', 'The player is slow to respond.')}</span>
      <button type="button" onClick={() => { setAttempt(n => n + 1); setPhase('loading') }}><RotateCw size={13} aria-hidden />{t('Tentar de novo', 'Try again')}</button>
      <button type="button" onClick={() => openInBrowser(refo.watchUrl, () => setStatus(t('Não foi possível abrir o navegador.', 'Could not open the browser.')))}><ArrowUpRight size={13} aria-hidden />{t('Abrir no navegador', 'Open in browser')}</button></div>}
  </div>
  else body = null

  const label = refo ? `${PROVIDER_LABEL[refo.provider]}${value.title ? ` — ${value.title}` : ''}` : t('Vídeo online', 'Online video')
  return <div className="pg-video-block" data-align={value.align} contentEditable={false}>
    <div ref={box} className="pg-video" data-resizing={resizing || undefined} style={width && showPlayer ? { width: `${width}px` } : undefined} role="group" aria-label={label}>
      {body}
      {editable && showPlayer && <>
        <span className="pg-video-handle" data-side="left" role="separator" aria-orientation="vertical" tabIndex={0} aria-label={t('Redimensionar vídeo', 'Resize video')} onPointerDown={startResize('left')} onKeyDown={resizeKey} />
        <span className="pg-video-handle" data-side="right" role="separator" aria-orientation="vertical" tabIndex={0} aria-label={t('Redimensionar vídeo', 'Resize video')} onPointerDown={startResize('right')} onKeyDown={resizeKey} />
      </>}
      {(refo || editable) && <div className="pg-video-toolbar" role="toolbar" aria-label={t('Ações do vídeo', 'Video actions')}>
        {refo && <button type="button" onClick={() => openInBrowser(refo.watchUrl, () => setStatus(t('Não foi possível abrir o navegador.', 'Could not open the browser.')))} title={t('Abrir no navegador', 'Open in browser')} aria-label={t('Abrir no navegador', 'Open in browser')}><ArrowUpRight size={15} /></button>}
        {refo && <button type="button" onClick={copy} title={t('Copiar link', 'Copy link')} aria-label={t('Copiar link', 'Copy link')}><Copy size={15} /></button>}
        {editable && <button type="button" onClick={() => setEditing(!editing)} title={t('Trocar vídeo', 'Change video')} aria-label={t('Trocar vídeo', 'Change video')} aria-expanded={editing}><Pencil size={15} /></button>}
        {editable && refo && refo.start > 0 && <button type="button" onClick={restart} title={t('Reiniciar em 0:00', 'Restart at 0:00')} aria-label={t('Reiniciar em 0:00', 'Restart at 0:00')}><RotateCcw size={15} /></button>}
        {editable && <button type="button" onClick={() => setCaptionOpen(!captionOpen)} title={t('Legenda', 'Caption')} aria-label={t('Legenda', 'Caption')} aria-pressed={captionOpen}><Subtitles size={15} /></button>}
        {editable && <button type="button" onClick={() => actions.update({ align: value.align === 'left' ? 'center' : 'left' })} title={value.align === 'left' ? t('Centralizar', 'Center') : t('Alinhar à esquerda', 'Align left')} aria-label={value.align === 'left' ? t('Centralizar', 'Center') : t('Alinhar à esquerda', 'Align left')}>{value.align === 'left' ? <AlignCenter size={15} /> : <AlignLeft size={15} />}</button>}
        {editable && refo && <button type="button" onClick={actions.toBookmark} title={t('Converter em marcador', 'Convert to bookmark')} aria-label={t('Converter em marcador', 'Convert to bookmark')}><Bookmark size={15} /></button>}
        {editable && refo && <button type="button" onClick={actions.toLink} title={t('Converter em link', 'Convert to link')} aria-label={t('Converter em link', 'Convert to link')}><Link2 size={15} /></button>}
        {editable && <button type="button" onClick={actions.remove} title={t('Excluir', 'Delete')} aria-label={t('Excluir vídeo', 'Delete video')}><Trash2 size={15} /></button>}
      </div>}
      {status && <span className="pg-video-status" role="status">{status}</span>}
    </div>
    {caption}
    {editable && editing && <VideoEditor value={value} onChange={actions.update} onDone={() => setEditing(false)} />}
  </div>
}

function VideoCaption({ value, editable, open, onChange }: { value: OnlineVideoProps; editable: boolean; open: boolean; onChange: (value: string) => void }) {
  const { t } = useI18n()
  if (!value.caption && !(editable && open)) return null
  return editable
    ? <input className="pg-video-caption" value={value.caption} placeholder={t('Escreva uma legenda', 'Write a caption')} aria-label={t('Legenda do vídeo', 'Video caption')} onChange={event => onChange(event.target.value)} onKeyDown={event => event.stopPropagation()} />
    : <figcaption className="pg-video-caption">{value.caption}</figcaption>
}

function VideoEditor({ value, onChange, onDone }: { value: OnlineVideoProps; onChange: (patch: Partial<OnlineVideoProps>) => void; onDone: () => void }) {
  const { t } = useI18n()
  const [url, setUrl] = useState(value.url)
  const [title, setTitle] = useState(value.title)
  const parsed = url.trim() ? parseVideoUrl(url) : null
  const invalid = !!url.trim() && !parsed
  const apply = () => {
    if (!parsed) return
    onChange({ url: parsed.watchUrl, title: title.slice(0, 200) }); onDone()
  }
  return <form className="pg-video-edit" onSubmit={event => { event.preventDefault(); apply() }} onKeyDown={event => event.stopPropagation()}>
    <label>URL<input autoFocus value={url} onChange={event => setUrl(event.target.value.slice(0, 2048))} placeholder="https://www.youtube.com/watch?v=…" aria-invalid={invalid || undefined} /></label>
    <label>{t('Título (opcional)', 'Title (optional)')}<input value={title} onChange={event => setTitle(event.target.value)} /></label>
    {invalid && <small role="alert">{t('Use um link do YouTube, Vimeo, Loom, Dailymotion ou Spotify.', 'Use a YouTube, Vimeo, Loom, Dailymotion or Spotify link.')}</small>}
    {parsed && parsed.start > 0 && <small>{t('Começa em', 'Starts at')} {formatStartTime(parsed.start)}</small>}
    <small>{t('Mostrar o player contacta o provedor. Ajuste em Configurações → Segurança e privacidade.', 'Showing the player contacts the provider. Adjust in Settings → Security & privacy.')}</small>
    <div className="np-dialog-actions"><Button onClick={onDone}>{t('Cancelar', 'Cancel')}</Button><Button variant="primary" type="submit" disabled={!parsed}>{t('Aplicar', 'Apply')}</Button></div>
  </form>
}

const safeHref = (url: string) => parseVideoUrl(url)?.watchUrl

export const OnlineVideoBlock = createReactBlockSpec(
  { type: 'onlineVideo', propSchema: {
    url: { default: '' }, title: { default: '' }, caption: { default: '' },
    width: { default: 0 }, align: { default: 'center', values: ['left', 'center'] },
  }, content: 'none' },
  {
    render: ({ block, editor }) => {
      const update = (patch: Partial<OnlineVideoProps>) => editor.updateBlock(block.id, { props: patch as never })
      const props = block.props as OnlineVideoProps
      return <OnlineVideo value={props} editable={editor.isEditable} actions={{
        update,
        toBookmark: () => editor.updateBlock(block.id, { type: 'bookmark', props: { url: props.url, title: props.title, description: '', image: '' } } as never),
        toLink: () => editor.replaceBlocks([block.id], [{ type: 'paragraph', content: [{ type: 'link', href: props.url, content: [{ type: 'text', text: props.title || props.url, styles: {} }] }] }] as never),
        remove: () => editor.removeBlocks([block.id]),
      }} />
    },
    toExternalHTML: ({ block }) => <figure><a href={safeHref(block.props.url)}>{block.props.title || block.props.url}</a>{block.props.caption && <figcaption>{block.props.caption}</figcaption>}</figure>,
  },
)
