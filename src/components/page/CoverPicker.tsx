// Popover "Alterar capa": galeria de cores/gradientes, enviar imagem e remover.
import { useState } from 'react'
import { Upload } from 'lucide-react'
import { api } from '../../store'
import { GRADIENT_COVERS, SOLID_COVERS, coverStyle, type CoverOption } from './covers'
import { Popover } from './Popover'
import { useI18n } from '../../i18n'

interface Props {
  anchor: HTMLElement | null
  onSelect: (cover: string) => void
  onRemove: () => void
  onClose: () => void
}

export function CoverPicker({ anchor, onSelect, onRemove, onClose }: Props) {
  const { locale, t } = useI18n()
  const coverEn: Record<string, string> = {
    Areia: 'Sand', Terracota: 'Terracotta', Mostarda: 'Mustard', Sálvia: 'Sage', Oceano: 'Ocean',
    Lavanda: 'Lavender', Rosado: 'Rose', Grafite: 'Graphite', Amanhecer: 'Dawn', Lagoa: 'Lagoon',
    Pomar: 'Orchard', Crepúsculo: 'Twilight', Névoa: 'Mist', Brasa: 'Ember', Aurora: 'Aurora',
    Algodão: 'Cotton', Noturno: 'Night', Pêssego: 'Peach', Menta: 'Mint', Ametista: 'Amethyst',
  }
  const [tab, setTab] = useState<'gallery' | 'upload'>('gallery')

  const section = (label: string, items: CoverOption[]) => (
    <div className="pg-cover-section">
      <div className="pg-cover-section-label">{label}</div>
      <div className="pg-cover-grid">
        {items.map((c) => (
          <button key={c.value} className="pg-cover-swatch" title={locale === 'en-US' ? coverEn[c.label] ?? c.label : c.label} style={coverStyle(c.value, 50)} onClick={() => onSelect(c.value)} />
        ))}
      </div>
    </div>
  )

  const upload = async () => {
    const url = await api.pickImage()
    if (url) onSelect(url)
  }

  return (
    <Popover anchor={anchor} onClose={onClose} align="end" className="pg-cover-picker" width={460}>
      <div className="pg-emoji-head">
        <button className={`pg-tab${tab === 'gallery' ? ' is-active' : ''}`} onClick={() => setTab('gallery')}>
          {t('Galeria', 'Gallery')}
        </button>
        <button className={`pg-tab${tab === 'upload' ? ' is-active' : ''}`} onClick={() => setTab('upload')}>
          {t('Enviar imagem', 'Upload image')}
        </button>
        <div style={{ flex: 1 }} />
        <button className="pg-text-btn" onClick={onRemove}>
          {t('Remover', 'Remove')}
        </button>
      </div>
      {tab === 'gallery' ? (
        <div className="pg-cover-body">
          {section(t('Cores', 'Colors'), SOLID_COVERS)}
          {section(t('Gradientes', 'Gradients'), GRADIENT_COVERS)}
        </div>
      ) : (
        <div className="pg-cover-upload">
          <button className="pg-upload-btn" onClick={upload}>
            <Upload size={14} /> {t('Escolher uma imagem', 'Choose an image')}
          </button>
          <div className="pg-hint">{t('Imagens mais largas que 1500 px funcionam melhor.', 'Images wider than 1500 px work best.')}</div>
        </div>
      )}
    </Popover>
  )
}
