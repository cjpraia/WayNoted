import PRODUCT from '../../../shared/product.json' with { type: 'json' }
import COMPAT from '../../../shared/compatibility.ts'
import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { createReactBlockSpec } from '@blocknote/react'
import { api } from '../../store'
import { useI18n } from '../../i18n'

export function bookmarkURL(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.username || url.password || !['https:', 'http:', ...[PRODUCT.protocol, COMPAT.previousProtocol, ...PRODUCT.protocolAliases].map(scheme => scheme + ":")].includes(url.protocol)) return null
    return url.href
  } catch { return null }
}

const localImage = (value: string) => /^data:image\/(png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/i.test(value)
type BookmarkProps = { url: string; title: string; description: string; image: string }

function Bookmark({ value, editable, update }: { value: BookmarkProps; editable: boolean; update: (value: Partial<BookmarkProps>) => void }) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(!value.url)
  const [error, setError] = useState('')
  const href = bookmarkURL(value.url)
  const label = value.title || value.url || t('Novo marcador', 'New bookmark')
  return <div className="pg-bookmark" contentEditable={false}>
    <div className="pg-bookmark-preview">
      <div>{href ? <a href={href} target="_blank" rel="noreferrer">{label}</a> : <strong>{label}</strong>}
        {value.description && <p>{value.description}</p>}
        {href && <small>{new URL(href).hostname}</small>}
      </div>
      {localImage(value.image) && <img src={value.image} alt="" />}
    </div>
    {editable && <button type="button" className="pg-bookmark-edit" onClick={() => setEditing(!editing)} aria-expanded={editing} aria-label={t('Editar marcador', 'Edit bookmark')} title={t('Editar marcador', 'Edit bookmark')}><Pencil size={14} aria-hidden /></button>}
    {editable && editing && <div className="pg-bookmark-fields">
      <label>URL<input value={value.url} onChange={event => { update({ url: event.target.value }); setError('') }} placeholder="https://" /></label>
      <label>{t('Título', 'Title')}<input value={value.title} onChange={event => update({ title: event.target.value })} /></label>
      <label>{t('Descrição', 'Description')}<textarea value={value.description} onChange={event => update({ description: event.target.value })} /></label>
      <div><button type="button" onClick={() => void api.pickImage().then(image => {
        if (!image) return
        if (!localImage(image)) throw new Error(t('Escolha uma imagem PNG, JPEG, GIF, WebP ou AVIF.', 'Choose a PNG, JPEG, GIF, WebP, or AVIF image.'))
        update({ image }); setError('')
      }).catch(error => setError(String(error)))}>{t('Enviar miniatura', 'Upload thumbnail')}</button>
      {value.image && <button type="button" onClick={() => update({ image: '' })}>{t('Remover miniatura', 'Remove thumbnail')}</button>}
      <button type="button" onClick={() => {
        if (!href) { setError(t('Insira um endereço HTTP, HTTPS ou de página local válido.', 'Enter a valid HTTP, HTTPS, or local page address.')); return }
        update({ url: href }); setEditing(false)
      }}>{t('Concluir', 'Done')}</button></div>
      <small>{t('O cartão fica salvo no dispositivo. Título, descrição e imagem são preenchidos por você.', 'The card is saved on your device. You provide its title, description, and image.')}</small>
    </div>}
    {error && <div role="alert">{error}</div>}
  </div>
}

export const BookmarkBlock = createReactBlockSpec(
  { type: 'bookmark', propSchema: { url: { default: '' }, title: { default: '' }, description: { default: '' }, image: { default: '' } }, content: 'none' },
  {
    render: ({ block, editor }) => <Bookmark value={block.props} editable={editor.isEditable} update={props => editor.updateBlock(block.id, { props })} />,
    toExternalHTML: ({ block }) => <aside className="pg-bookmark"><p><a href={bookmarkURL(block.props.url) ?? undefined}>{block.props.title || block.props.url}</a></p><p>{block.props.description}</p>{localImage(block.props.image) && <img src={block.props.image} alt="" />}</aside>,
  },
)
