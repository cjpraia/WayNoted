import COMPAT from '../../../shared/compatibility.ts'
// Seletor de ícone de página: aba Emoji (categorias, busca, aleatório), aba Ícones (ícones de linha com cor,
// gravados como `lucide:nome:cor` — ver src/components/ui/icons) e imagem local.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Shuffle } from 'lucide-react'
import { Icon } from '../ui/icons/Icon'
import { GLYPH_CATEGORIES, searchGlyphs, type GlyphEntry } from '../ui/icons/catalog'
import { ICON_COLORS, formatGlyphIcon, parseIconValue, type IconColor } from '../ui/icons/iconValue'
import { EMOJI_CATEGORIES, randomEmoji, searchEmojis, type EmojiItem } from './emojiData'
import { Popover } from './Popover'
import { useI18n } from '../../i18n'

interface Props {
  anchor: HTMLElement | null
  /** Ícone atual: abre na aba Ícones (com a cor dele) quando for um ícone de linha. */
  value?: string | null
  onSelect: (emoji: string) => void
  onRemove: () => void
  onClose: () => void
}

const LS_COLOR = COMPAT.record037
function storedColor(): IconColor {
  try { const value = localStorage.getItem(LS_COLOR); return (ICON_COLORS as readonly string[]).includes(value ?? '') ? value as IconColor : 'default' } catch { return 'default' }
}

export function EmojiPicker({ anchor, value, onSelect, onRemove, onClose }: Props) {
  const { locale, t } = useI18n()
  const categoryEn: Record<string, string> = {
    rostos: 'Faces and emotions', pessoas: 'People and gestures', natureza: 'Animals and nature',
    comida: 'Food and drink', atividades: 'Activities', viagens: 'Travel and places',
    objetos: 'Objects', simbolos: 'Symbols',
  }
  const [query, setQuery] = useState('')
  const current = parseIconValue(value)
  const [tab, setTab] = useState<'emoji' | 'icons'>(current?.kind === 'glyph' ? 'icons' : 'emoji')
  const [color, setColorState] = useState<IconColor>(current?.kind === 'glyph' ? current.color : storedColor)
  const setColor = (next: IconColor) => { setColorState(next); try { localStorage.setItem(LS_COLOR, next) } catch { /* preferência opcional */ } }
  const colorNames: Record<IconColor, [string, string]> = {
    default: ['Padrão', 'Default'], gray: ['Cinza', 'Gray'], brown: ['Marrom', 'Brown'], orange: ['Laranja', 'Orange'], yellow: ['Amarelo', 'Yellow'],
    green: ['Verde', 'Green'], blue: ['Azul', 'Blue'], purple: ['Roxo', 'Purple'], pink: ['Rosa', 'Pink'], red: ['Vermelho', 'Red'],
  }
  const bodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  useEffect(() => {
    const t = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(t)
  }, [])
  const results = useMemo(() => (tab === 'emoji' && query.trim() ? searchEmojis(query) : null), [query, tab])
  const glyphResults = useMemo(() => (tab === 'icons' && query.trim() ? searchGlyphs(query) : null), [query, tab])
  const pickGlyph = (name: string) => onSelect(formatGlyphIcon(name, color))
  const glyphGrid = (items: GlyphEntry[]) => (
    <div className="pg-glyph-grid" role="listbox" aria-label={t('Ícones', 'Icons')}>
      {items.map((g) => {
        const label = locale === 'en-US' ? g.en.split(' ')[0] : g.pt.split(' ')[0]
        const selected = current?.kind === 'glyph' && current.name === g.name
        return <button key={g.name} type="button" role="option" aria-selected={selected} className={`pg-glyph-cell${selected ? ' is-selected' : ''}`} title={label} aria-label={label} data-glyph={g.name} onClick={() => pickGlyph(g.name)}>
          <Icon name={g.name} size={20} tone={color === 'default' ? 'strong' : color} />
        </button>
      })}
    </div>
  )

  const jump = (id: string) => {
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-cat="${id}"]`)
    if (el && bodyRef.current) bodyRef.current.scrollTop = el.offsetTop - 4
  }

  const grid = (items: EmojiItem[]) => (
    <div className="pg-emoji-grid">
      {items.map((e) => (
        <button key={e.emoji} className="pg-emoji-cell" title={locale === 'en-US' ? e.english || e.emoji : e.keywords.split(' ')[0]} onClick={() => onSelect(e.emoji)}>
          {e.emoji}
        </button>
      ))}
    </div>
  )

  return (
    <Popover anchor={anchor} onClose={onClose} className="pg-emoji-picker" width={408}>
      <div className="pg-emoji-head">
        <button type="button" className={`pg-tab${tab === 'emoji' ? ' is-active' : ''}`} aria-pressed={tab === 'emoji'} onClick={() => { setTab('emoji'); setQuery('') }}>Emoji</button>
        <button type="button" className={`pg-tab${tab === 'icons' ? ' is-active' : ''}`} aria-pressed={tab === 'icons'} onClick={() => { setTab('icons'); setQuery('') }}>{t('Ícones', 'Icons')}</button>
        <button className="pg-text-btn" onClick={() => fileRef.current?.click()}>{t('Arquivo local', 'Local file')}</button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (!file) return
          if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 256 * 1024) {
            setFileError(t('Escolha PNG, JPEG, WebP ou GIF com até 256 KB.', 'Choose a PNG, JPEG, WebP or GIF up to 256 KB.'))
            return
          }
          const reader = new FileReader()
          reader.onload = () => { if (typeof reader.result === 'string') onSelect(reader.result) }
          reader.onerror = () => setFileError(t('Não foi possível ler a imagem local.', 'Could not read the local image.'))
          reader.readAsDataURL(file)
        }} />
        <div style={{ flex: 1 }} />
        <button className="pg-text-btn" onClick={onRemove}>
          {t('Remover', 'Remove')}
        </button>
      </div>
      {fileError && <div className="pg-menu-error" role="alert">{fileError}</div>}
      <div className="pg-emoji-search">
        <div className="pg-input-wrap">
          <Search size={14} className="pg-input-icon" />
          <input
            ref={inputRef}
            className="pg-input"
            placeholder={tab === 'icons' ? t('Buscar ícone (ex.: livro, meta, casa)…', 'Search icons (e.g. book, goal, home)…') : t('Filtrar…', 'Filter…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results?.length) onSelect(results[0].emoji)
              if (e.key === 'Enter' && glyphResults?.length) pickGlyph(glyphResults[0].name)
            }}
          />
        </div>
        {tab === 'emoji' && <button className="pg-emoji-random" title={t('Aleatório', 'Random')} aria-label={t('Emoji aleatório', 'Random emoji')} onClick={() => onSelect(randomEmoji())}>
          <Shuffle size={16} strokeWidth={1.75} />
        </button>}
      </div>
      {tab === 'icons' && <div className="pg-glyph-colors" role="radiogroup" aria-label={t('Cor do ícone', 'Icon color')}>
        {ICON_COLORS.map((c) => <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={t(colorNames[c][0], colorNames[c][1])} title={t(colorNames[c][0], colorNames[c][1])} className={`pg-glyph-swatch${color === c ? ' is-active' : ''}`} style={{ ['--swatch' as string]: c === 'default' ? 'var(--text)' : `var(--icon-tint-${c})` }} onClick={() => setColor(c)} />)}
      </div>}
      <div className="pg-emoji-body" ref={bodyRef}>
        {tab === 'icons' ? (glyphResults ? (glyphResults.length ? <><div className="pg-emoji-cat-label">{t('Resultados', 'Results')}</div>{glyphGrid(glyphResults)}</> : <div className="pg-emoji-empty">{t('Nenhum ícone encontrado', 'No icon found')}</div>)
          : GLYPH_CATEGORIES.map((c) => <div key={c.id} data-cat={c.id}><div className="pg-emoji-cat-label">{locale === 'en-US' ? c.en : c.pt}</div>{glyphGrid(c.items)}</div>))
        : results ? (
          results.length ? (
            <>
              <div className="pg-emoji-cat-label">{t('Resultados', 'Results')}</div>
              {grid(results)}
            </>
          ) : (
            <div className="pg-emoji-empty">{t('Nenhum emoji encontrado', 'No emoji found')}</div>
          )
        ) : (
          EMOJI_CATEGORIES.map((c) => (
            <div key={c.id} data-cat={c.id}>
              <div className="pg-emoji-cat-label">{locale === 'en-US' ? categoryEn[c.id] ?? c.label : c.label}</div>
              {grid(c.items)}
            </div>
          ))
        )}
      </div>
      {tab === 'emoji' && !results && (
        <div className="pg-emoji-foot">
          {EMOJI_CATEGORIES.map((c) => (
            <button key={c.id} className="pg-emoji-cat-btn" title={c.label} onClick={() => jump(c.id)}>
              {c.items[0].emoji}
            </button>
          ))}
        </div>
      )}
    </Popover>
  )
}
