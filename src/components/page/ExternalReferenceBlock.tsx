import { useEffect, useState } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import { ArrowUpRight, Pencil, RotateCw } from 'lucide-react'
import { api } from '../../store'
import { useI18n } from '../../i18n'
import { parseVideoUrl } from './videoEmbed'

type Reference = { provider: string; url: string; title: string; description: string; image: string; icon: string }
const imageData = (value: string) => /^data:image\/(png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/i.test(value)

export function referenceURL(value: string): string | null {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}

export function ExternalReferenceCard({ value, editable, update }: { value: Reference; editable: boolean; update: (patch: Partial<Reference>) => void }) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(!value.url)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const href = referenceURL(value.url)
  const isVideo = value.provider === 'Video'
  const domain = href ? new URL(href).hostname.replace(/^www\./, '') : ''

  useEffect(() => {
    if (!editable || !href || value.title || value.image || !api.fetchLinkPreview) return
    let live = true
    setLoading(true)
    void api.fetchLinkPreview(href).then(preview => {
      if (!live) return
      update({ title: preview.title, description: preview.description, image: preview.image, icon: preview.icon })
      setMessage('')
    }).catch(() => { if (live) setMessage(t('Prévia indisponível; o link continua acessível.', 'Preview unavailable; the link remains accessible.')) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [href, editable, value.title, value.image])

  const refresh = async () => {
    if (!href || !api.fetchLinkPreview) return
    setLoading(true); setMessage('')
    try {
      const preview = await api.fetchLinkPreview(href)
      update({ title: preview.title, description: preview.description, image: preview.image, icon: preview.icon })
    } catch { setMessage(t('Não foi possível atualizar a prévia.', 'Could not refresh the preview.')) }
    finally { setLoading(false) }
  }
  const openFullPage = () => {
    if (!href) return
    if (api.openExternalPage) void api.openExternalPage(href).catch(() => setMessage(t('Não foi possível abrir o site.', 'Could not open the site.')))
    else window.open(href, '_blank', 'noopener,noreferrer')
  }

  return <div className="pg-external-card" contentEditable={false}>
    <div className="pg-external-card-main">
      {imageData(value.image) && <img className="pg-external-card-image" src={value.image} alt="" />}
      <div className="pg-external-card-body">
        <div className="pg-external-card-heading">
          {imageData(value.icon) && <img className="pg-external-card-icon" src={value.icon} alt="" />}
          {!imageData(value.icon) && <span className="pg-external-card-fallback" aria-hidden="true">{domain.slice(0, 1).toUpperCase() || '↗'}</span>}
          {editable && <div className="pg-external-card-controls">
            <button type="button" onClick={() => setEditing(!editing)} aria-label={t('Editar incorporação', 'Edit embed')} title={t('Editar incorporação', 'Edit embed')}><Pencil size={16} /></button>
            <button type="button" disabled={!href || loading || !api.fetchLinkPreview} onClick={() => void refresh()} aria-label={t('Atualizar prévia', 'Refresh preview')} title={t('Atualizar prévia', 'Refresh preview')}><RotateCw size={16} /></button>
          </div>}
        </div>
        <strong className="pg-external-card-title">{value.title || domain || t('Incorporar site', 'Embed website')}</strong>
        {value.description && <p className="pg-external-card-description">{value.description}</p>}
        {loading && <small role="status">{t('Carregando prévia…', 'Loading preview…')}</small>}
        {message && <small role="status">{message}</small>}
        <span className="pg-external-card-url">{href || t('Adicione a URL do site', 'Add the website URL')}</span>
        {href && <button type="button" className="pg-external-card-open" onClick={openFullPage}><ArrowUpRight size={16} />{t('Abrir site inteiro', 'Open full website')}</button>}
      </div>
    </div>
    {editable && editing && <div className="pg-external-card-edit">
      <label>URL<input value={value.url} onChange={event => update({ url: event.target.value.slice(0, 2048), title: '', description: '', image: '', icon: '' })} placeholder="https://" /></label>
      <label>{t('Título', 'Title')}<input value={value.title} onChange={event => update({ title: event.target.value.slice(0, 200) })} /></label>
      <label>{t('Descrição', 'Description')}<textarea value={value.description} onChange={event => update({ description: event.target.value.slice(0, 500) })} /></label>
      <button type="button" onClick={() => setEditing(false)}>{t('Concluir', 'Done')}</button>
    </div>}
  </div>
}

/** Cartões "Vídeo" antigos (offline) com link de provedor reconhecido viram o player incorporado ao abrir a página. */
function ExternalReferenceView({ block, editor }: { block: { id: string; props: Reference }; editor: { isEditable: boolean; updateBlock: (id: string, update: never) => unknown } }) {
  const video = block.props.provider === 'Video' ? parseVideoUrl(block.props.url) : null
  useEffect(() => {
    if (video && editor.isEditable) editor.updateBlock(block.id, { type: 'onlineVideo', props: { url: video.watchUrl, title: block.props.title } } as never)
  }, [video?.watchUrl, editor.isEditable, block.id])
  return <ExternalReferenceCard value={block.props} editable={editor.isEditable} update={patch => editor.updateBlock(block.id, { props: patch } as never)} />
}

export const ExternalReferenceBlock = createReactBlockSpec(
  { type: 'externalReference', propSchema: {
    provider: { default: 'Embed' }, url: { default: '' }, title: { default: '' },
    description: { default: '' }, image: { default: '' }, icon: { default: '' },
  }, content: 'none' },
  { render: ({ block, editor }) => <ExternalReferenceView block={block} editor={editor} />,
    toExternalHTML: ({ block }) => <aside><strong>{block.props.title || block.props.provider}</strong>{block.props.description && <p>{block.props.description}</p>}<p><a href={referenceURL(block.props.url) ?? undefined}>{block.props.url}</a></p></aside> },
)
