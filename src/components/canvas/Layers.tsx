// Painel "Camadas" (painel direito): árvore dos objetos por seção e ordem Z (mais à frente em cima), com
// renomear (duplo clique/F2), ocultar, travar, selecionar ao clicar e arrastar para reordenar o Z.
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useI18n } from '../../i18n'
import { buildLayerTree, descendantIds, flattenLayers, layerLabel } from '../../canvas/layers'
import type { CanvasObject } from '../../canvas/model'
import { IconButton } from '../ui/Button'
import { CanvasIcon, type CanvasIconName } from './icons'

export interface LayersProps {
  objects: readonly CanvasObject[]
  selection: ReadonlySet<string>
  readOnly: boolean
  cardTitle(pageId: string): string
  onSelect(ids: string[], additive: boolean): void
  /** Altera propriedades de camada (nome, oculto, travado) de um ou mais objetos. */
  onPatch(ids: string[], patch: { layerName?: string | null; hidden?: boolean; locked?: boolean }): void
  onMove(id: string, targetId: string, position: 'above' | 'below'): void
  onClose(): void
}

const ICON: Record<string, CanvasIconName> = { note: 'note', text: 'text', section: 'section', image: 'image', file: 'file', page: 'page', database: 'database', draw: 'pen', connector: 'arrow' }
const iconOf = (o: CanvasObject): CanvasIconName => o.type === 'shape' ? o.shape : ICON[o.type] ?? 'canvas'

/** Campo de renomear: Enter/blur grava, Esc cancela (vazio limpa o nome e volta ao rótulo automático). */
function RenameField({ initial, label, onDone }: { initial: string; label: string; onDone(name: string | undefined): void }) {
  const cancelled = useRef(false)
  return <input className="cv-layer-rename" autoFocus defaultValue={initial} aria-label={label} onFocus={e => e.currentTarget.select()}
    onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}
    onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur() } }}
    onBlur={e => onDone(cancelled.current ? undefined : e.currentTarget.value.trim())} />
}

export function BoardLayers({ objects, selection, readOnly, cardTitle, onSelect, onPatch, onMove, onClose }: LayersProps) {
  const { t } = useI18n()
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; position: 'above' | 'below' } | null>(null)
  const dragging = useRef<string | null>(null)
  const tree = useMemo(() => buildLayerTree(objects), [objects])
  const rows = useMemo(() => flattenLayers(tree, collapsed), [tree, collapsed])
  const byId = useMemo(() => new Map(objects.map(o => [o.id, o] as const)), [objects])
  // Seleção feita no quadro (clique, laço, ⌘A) rola a lista até a primeira camada selecionada.
  const list = useRef<HTMLDivElement>(null)
  const firstSelected = rows.find(r => selection.has(r.id))?.id
  useEffect(() => {
    if (!firstSelected) return
    const el = [...(list.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].find(item => item.dataset.id === firstSelected)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [firstSelected])
  const typeName = (type: string) => ({ note: t('Nota', 'Note'), text: t('Texto', 'Text'), shape: t('Forma', 'Shape'), section: t('Seção', 'Section'), connector: t('Conector', 'Connector'), draw: t('Desenho', 'Drawing'), image: t('Imagem', 'Image'), file: t('Arquivo', 'File'), page: t('Página', 'Page'), database: t('Banco', 'Database') } as Record<string, string>)[type] ?? type

  const withContent = (o: CanvasObject) => o.type === 'section' ? [o.id, ...descendantIds(tree, o.id)] : [o.id]
  const dropPosition = (e: DragEvent<HTMLElement>): 'above' | 'below' => { const r = e.currentTarget.getBoundingClientRect(); return e.clientY - r.top < r.height / 2 ? 'above' : 'below' }
  const onRowKey = (e: KeyboardEvent<HTMLElement>, o: CanvasObject, index: number) => {
    e.stopPropagation()
    if (e.key === 'Enter') { e.preventDefault(); onSelect([o.id], e.shiftKey || e.metaKey || e.ctrlKey) }
    else if (e.key === 'F2' && !readOnly) { e.preventDefault(); setRenaming(o.id) }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="treeitem"]')[index + (e.key === 'ArrowDown' ? 1 : -1)]
      next?.focus()
    }
  }

  return <aside className="cv-layers" aria-label={t('Camadas', 'Layers')} onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
    <div className="cv-layers-head">
      <strong>{t('Camadas', 'Layers')}</strong>
      <span className="cv-layers-count">{objects.length}</span>
      <IconButton label={t('Fechar camadas', 'Close layers')} onClick={onClose}>×</IconButton>
    </div>
    {rows.length === 0 && <div className="cv-layers-empty">{t('A lousa ainda não tem objetos.', 'The whiteboard has no objects yet.')}</div>}
    <div className="cv-layers-list" ref={list} role="tree" aria-label={t('Objetos da lousa, do mais à frente ao mais ao fundo', 'Whiteboard objects, front to back')}>
      {rows.map((row, index) => {
        const o = byId.get(row.id)
        if (!o) return null
        const label = layerLabel(o, typeName, cardTitle)
        const selected = selection.has(o.id)
        const isOpen = row.hasChildren && !collapsed.has(o.id)
        return <div key={o.id} role="treeitem" aria-selected={selected} aria-level={row.depth + 1} aria-expanded={row.hasChildren ? isOpen : undefined} tabIndex={0}
          data-id={o.id} data-depth={row.depth}
          className={`cv-layer${selected ? ' is-selected' : ''}${o.hidden ? ' is-hidden' : ''}${o.locked ? ' is-locked' : ''}${drop?.id === o.id ? ` is-drop-${drop.position}` : ''}`}
          style={{ paddingLeft: 6 + row.depth * 14 }}
          draggable={!readOnly && !o.locked && renaming !== o.id}
          onClick={e => onSelect([o.id], e.shiftKey || e.metaKey || e.ctrlKey)}
          onDoubleClick={() => { if (!readOnly) setRenaming(o.id) }}
          onKeyDown={e => onRowKey(e, o, index)}
          onDragStart={e => { dragging.current = o.id; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', o.id) } catch { /* sem dataTransfer em ambientes de teste */ } }}
          onDragOver={e => { if (!dragging.current || dragging.current === o.id) return; e.preventDefault(); const position = dropPosition(e); setDrop(d => d?.id === o.id && d.position === position ? d : { id: o.id, position }) }}
          onDragLeave={() => setDrop(d => d?.id === o.id ? null : d)}
          onDrop={e => { e.preventDefault(); const from = dragging.current; const position = dropPosition(e); dragging.current = null; setDrop(null); if (from && from !== o.id) onMove(from, o.id, position) }}
          onDragEnd={() => { dragging.current = null; setDrop(null) }}>
          {row.hasChildren
            ? <button type="button" className={`cv-layer-twist${isOpen ? ' is-open' : ''}`} aria-label={isOpen ? t('Recolher', 'Collapse') : t('Expandir', 'Expand')} onClick={e => { e.stopPropagation(); setCollapsed(prev => { const next = new Set(prev); if (next.has(o.id)) next.delete(o.id); else next.add(o.id); return next }) }}><CanvasIcon name="chevron" size={12} /></button>
            : <span className="cv-layer-twist is-empty" />}
          <span className="cv-layer-icon"><CanvasIcon name={iconOf(o)} size={14} /></span>
          {renaming === o.id
            ? <RenameField initial={o.layerName ?? label} label={t('Nome da camada', 'Layer name')} onDone={name => { setRenaming(null); if (name !== undefined) onPatch([o.id], { layerName: name || null }) }} />
            : <span className="cv-layer-name" title={label}>{label}</span>}
          {!readOnly && <button type="button" className={`cv-layer-btn${o.locked ? ' is-on' : ''}`} aria-label={o.locked ? t('Destravar camada', 'Unlock layer') : t('Travar camada', 'Lock layer')} aria-pressed={!!o.locked} title={o.locked ? t('Destravar', 'Unlock') : t('Travar', 'Lock')}
            onClick={e => { e.stopPropagation(); const lock = !o.locked; onPatch(withContent(o), { locked: lock }) }}><CanvasIcon name={o.locked ? 'lock' : 'unlock'} size={13} /></button>}
          {!readOnly && <button type="button" className={`cv-layer-btn${o.hidden ? ' is-on' : ''}`} aria-label={o.hidden ? t('Mostrar camada', 'Show layer') : t('Ocultar camada', 'Hide layer')} aria-pressed={!!o.hidden} title={o.hidden ? t('Mostrar', 'Show') : t('Ocultar', 'Hide')}
            onClick={e => { e.stopPropagation(); const hide = !o.hidden; onPatch(withContent(o), { hidden: hide }) }}><CanvasIcon name={o.hidden ? 'eyeOff' : 'eye'} size={13} /></button>}
        </div>
      })}
    </div>
  </aside>
}
