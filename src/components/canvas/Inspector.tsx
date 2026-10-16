// Painel de propriedades à direita (estilo Figma): posição/tamanho/rotação, alinhar/distribuir, aparência,
// preenchimento, traço, "estilo à mão" (Excalidraw), texto, conector, ordem e ações.
import { useEffect, useState, type ReactNode } from 'react'
import { useI18n } from '../../i18n'
import { CANVAS_COLORS, NOTE_COLORS, isBox, isCard, rotatable, type BoxObject, type CanvasColor, type CanvasObject, type FillKind, type FontKind, type ShapeKind, type StrokeStyle } from '../../canvas/model'
import type { Align } from '../../canvas/geometry'
import type { Reorder } from '../../canvas/ops'
import { SKETCH_LEVELS } from '../../canvas/sketch'
import { IconButton, Swatches } from './Chrome'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="cv-insp-section"><div className="cv-insp-label">{title}</div><div className="cv-insp-controls">{children}</div></div>
}

/** Numeric field that commits on Enter/blur (arrow keys ±1, ⇧ ±10, like Figma). */
function NumberField({ label, value, onCommit, suffix, min, max }: { label: string; value: number; onCommit(v: number): void; suffix?: string; min?: number; max?: number }) {
  const [draft, setDraft] = useState(String(Math.round(value)))
  useEffect(() => setDraft(String(Math.round(value))), [value])
  const commit = (raw: string) => { const v = Number(raw.replace(',', '.')); if (Number.isFinite(v)) onCommit(Math.max(min ?? -1e6, Math.min(max ?? 1e6, v))); else setDraft(String(Math.round(value))) }
  return <label className="cv-num"><span>{label}</span><input inputMode="decimal" value={draft} aria-label={label} onChange={e => setDraft(e.target.value)} onBlur={e => commit(e.target.value)}
    onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const next = Math.round(value) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1); setDraft(String(next)); commit(String(next)) } }} />{suffix && <em>{suffix}</em>}</label>
}

function Seg<T extends string | number>({ value, options, onPick }: { value: T | undefined; options: { id: T; label: string }[]; onPick(v: T): void }) {
  return <div className="cv-seg">{options.map(o => <button key={String(o.id)} type="button" className={value === o.id ? 'is-active' : ''} aria-pressed={value === o.id} onClick={() => onPick(o.id)}>{o.label}</button>)}</div>
}

interface Props {
  objects: CanvasObject[]
  onPatch(fn: (o: CanvasObject) => CanvasObject, key?: string): void
  onAlign(mode: Align | 'distributeH' | 'distributeV'): void
  onReorder(mode: Reorder): void
  onLock(): void; onGroup(): void; onUngroup(): void; onDelete(): void; onDuplicate(): void; onEdit(): void; onSaveLibrary(): void
}

export function BoardInspector({ objects, onPatch, onAlign, onReorder, onLock, onGroup, onUngroup, onDelete, onDuplicate, onEdit, onSaveLibrary }: Props) {
  const { t } = useI18n()
  const first = objects[0]
  const types = new Set(objects.map(o => o.type))
  const only = types.size === 1 ? first.type : null
  const locked = objects.some(o => o.locked)
  const grouped = objects.some(o => o.groupId)
  const boxes = objects.filter(isBox)
  const single = objects.length === 1 && isBox(first) ? first as BoxObject : null
  const stroked = objects.every(o => o.type === 'shape' || o.type === 'connector' || o.type === 'draw')
  const sketchable = objects.every(o => o.type === 'shape' || o.type === 'connector' || o.type === 'note' || o.type === 'section')
  const texty = objects.every(o => o.type === 'note' || o.type === 'text' || o.type === 'shape' || o.type === 'connector' || o.type === 'section')
  const colorable = objects.every(o => 'color' in o)
  const typeLabel: Record<string, string> = { note: t('Nota', 'Note'), text: t('Texto', 'Text'), shape: t('Forma', 'Shape'), section: t('Seção', 'Section'), connector: t('Conector', 'Connector'), draw: t('Desenho', 'Drawing'), image: t('Imagem', 'Image'), file: t('Arquivo', 'File'), page: t('Página', 'Page'), database: t('Banco de dados', 'Database') }
  const style = first as Partial<{ opacity: number; strokeStyle: StrokeStyle; strokeWidth: number; sketch: number; font: FontKind; color: CanvasColor; fill: FillKind; shape: ShapeKind; radius: number; route: string; startArrow: boolean; endArrow: boolean; fontSize: number; align: string; size: number }>
  const patchBox = (key: string, change: (o: BoxObject) => BoxObject) => onPatch(o => isBox(o) ? change(o) : o, key)
  return <aside className="cv-inspector" aria-label={t('Propriedades do objeto', 'Object properties')} onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <div className="cv-insp-head"><strong>{objects.length > 1 ? t('{n} objetos', '{n} objects', { n: objects.length }) : only ? typeLabel[only] : ''}</strong>{locked && <span className="cv-insp-badge">{t('Travado', 'Locked')}</span>}</div>
    {single && !locked && <Section title={t('Posição e tamanho', 'Position and size')}>
      <div className="cv-num-grid">
        <NumberField label="X" value={single.x} onCommit={v => patchBox(`geom:${single.id}`, o => ({ ...o, x: v }))} />
        <NumberField label="Y" value={single.y} onCommit={v => patchBox(`geom:${single.id}`, o => ({ ...o, y: v }))} />
        <NumberField label="L" value={single.w} min={8} onCommit={v => patchBox(`geom:${single.id}`, o => ({ ...o, w: v }))} />
        <NumberField label="A" value={single.h} min={8} onCommit={v => patchBox(`geom:${single.id}`, o => ({ ...o, h: v }))} />
        {rotatable(single) && <NumberField label="↻" suffix="°" value={single.rotation ?? 0} min={-180} max={180} onCommit={v => patchBox(`geom:${single.id}`, o => ({ ...o, rotation: v || undefined }))} />}
        {single.type === 'shape' && single.shape === 'rect' && <NumberField label="◜" value={single.radius ?? 8} min={0} max={200} onCommit={v => patchBox(`geom:${single.id}`, o => o.type === 'shape' ? { ...o, radius: v === 8 ? undefined : v } : o)} />}
      </div>
    </Section>}
    {boxes.length >= 2 && !locked && <Section title={t('Alinhar', 'Align')}>
      <IconButton icon="alignLeft" size={16} label={t('Alinhar à esquerda', 'Align left')} onClick={() => onAlign('left')} />
      <IconButton icon="alignHCenter" size={16} label={t('Centralizar na horizontal', 'Align centre')} onClick={() => onAlign('hcenter')} />
      <IconButton icon="alignRight" size={16} label={t('Alinhar à direita', 'Align right')} onClick={() => onAlign('right')} />
      <IconButton icon="alignTop" size={16} label={t('Alinhar ao topo', 'Align top')} onClick={() => onAlign('top')} />
      <IconButton icon="alignVCenter" size={16} label={t('Centralizar na vertical', 'Align middle')} onClick={() => onAlign('vcenter')} />
      <IconButton icon="alignBottom" size={16} label={t('Alinhar à base', 'Align bottom')} onClick={() => onAlign('bottom')} />
      {boxes.length >= 3 && <><IconButton icon="distributeH" size={16} label={t('Distribuir na horizontal', 'Distribute horizontally')} onClick={() => onAlign('distributeH')} /><IconButton icon="distributeV" size={16} label={t('Distribuir na vertical', 'Distribute vertically')} onClick={() => onAlign('distributeV')} /></>}
    </Section>}
    {!locked && !objects.some(isCard) && <Section title={t('Opacidade', 'Opacity')}>
      <input type="range" className="cv-range" min={10} max={100} step={5} value={Math.round((style.opacity ?? 1) * 100)} aria-label={t('Opacidade', 'Opacity')}
        onChange={e => { const v = Number(e.target.value) / 100; onPatch(o => ({ ...o, opacity: v >= 1 ? undefined : v }) as CanvasObject, 'opacity') }} />
      <span className="cv-range-value">{Math.round((style.opacity ?? 1) * 100)}%</span>
    </Section>}
    {colorable && !locked && <Section title={only === 'shape' ? t('Preenchimento', 'Fill') : t('Cor', 'Colour')}>
      <Swatches colors={only === 'note' ? NOTE_COLORS : CANVAS_COLORS} value={style.color} ink={only === 'draw' || only === 'connector' || only === 'text'} onPick={c => onPatch(o => 'color' in o ? { ...o, color: c } as CanvasObject : o)} />
      {only === 'shape' && <Seg<FillKind> value={style.fill} onPick={fill => onPatch(o => o.type === 'shape' ? { ...o, fill } : o)} options={[{ id: 'tint', label: t('Suave', 'Tint') }, { id: 'solid', label: t('Sólido', 'Solid') }, { id: 'hachure', label: t('Hachura', 'Hatch') }, { id: 'cross', label: t('Cruzada', 'Cross') }, { id: 'none', label: t('Vazio', 'None') }]} />}
    </Section>}
    {only === 'shape' && !locked && <Section title={t('Forma', 'Shape')}>{(['rect', 'ellipse', 'diamond'] as ShapeKind[]).map(s => <IconButton key={s} icon={s} size={16} label={s === 'rect' ? t('Retângulo', 'Rectangle') : s === 'ellipse' ? t('Elipse', 'Ellipse') : t('Losango', 'Diamond')} active={style.shape === s} onClick={() => onPatch(o => o.type === 'shape' ? { ...o, shape: s } : o)} />)}</Section>}
    {stroked && !locked && <Section title={t('Traço', 'Stroke')}>
      <IconButton icon="straight" size={16} label={t('Sólido', 'Solid')} active={!style.strokeStyle} onClick={() => onPatch(o => ({ ...o, strokeStyle: undefined }) as CanvasObject)} />
      <IconButton icon="dashed" size={16} label={t('Tracejado', 'Dashed')} active={style.strokeStyle === 'dashed'} onClick={() => onPatch(o => ({ ...o, strokeStyle: 'dashed' }) as CanvasObject)} />
      <IconButton icon="dotted" size={16} label={t('Pontilhado', 'Dotted')} active={style.strokeStyle === 'dotted'} onClick={() => onPatch(o => ({ ...o, strokeStyle: 'dotted' }) as CanvasObject)} />
      <Seg<number> value={only === 'draw' ? style.size : style.strokeWidth ?? 2} onPick={w => onPatch(o => o.type === 'draw' ? { ...o, size: w } : ({ ...o, strokeWidth: w === 2 ? undefined : w }) as CanvasObject)} options={[{ id: 1, label: '1' }, { id: 2, label: '2' }, { id: 4, label: '4' }, { id: 8, label: '8' }]} />
    </Section>}
    {sketchable && !locked && <Section title={t('Estilo à mão', 'Hand-drawn')}>
      <Seg<number> value={style.sketch ?? 0} onPick={level => onPatch(o => ({ ...o, sketch: level || undefined }) as CanvasObject)} options={[{ id: 0, label: t('Preciso', 'Crisp') }, ...SKETCH_LEVELS.map(l => ({ id: l.id as number, label: t(l.pt, l.en) }))]} />
    </Section>}
    {only === 'connector' && !locked && <Section title={t('Conector', 'Connector')}>
      {(['curve', 'straight', 'orthogonal'] as const).map(r => <IconButton key={r} icon={r} size={16} label={r === 'curve' ? t('Curva', 'Curved') : r === 'straight' ? t('Reta', 'Straight') : t('Ortogonal', 'Elbow')} active={style.route === r} onClick={() => onPatch(o => o.type === 'connector' ? { ...o, route: r } : o)} />)}
      <IconButton icon="arrowStart" size={16} label={t('Seta no início', 'Start arrow')} active={!!style.startArrow} onClick={() => onPatch(o => o.type === 'connector' ? { ...o, startArrow: !o.startArrow || undefined } : o)} />
      <IconButton icon="arrowEnd" size={16} label={t('Seta no fim', 'End arrow')} active={!!style.endArrow} onClick={() => onPatch(o => o.type === 'connector' ? { ...o, endArrow: !o.endArrow || undefined } : o)} />
    </Section>}
    {texty && !locked && <Section title={t('Texto', 'Text')}>
      <Seg<FontKind> value={style.font ?? 'sans'} onPick={font => onPatch(o => ({ ...o, font: font === 'sans' ? undefined : font }) as CanvasObject)} options={[{ id: 'sans', label: 'Sans' }, { id: 'hand', label: t('À mão', 'Hand') }, { id: 'mono', label: 'Mono' }]} />
      {only === 'text' && <Seg<number> value={style.fontSize} onPick={n => onPatch(o => o.type === 'text' ? { ...o, fontSize: n, h: Math.max(o.h, n * 1.4) } : o)} options={[{ id: 14, label: 'P' }, { id: 20, label: 'M' }, { id: 32, label: 'G' }, { id: 56, label: 'XG' }]} />}
      {only === 'text' && <Seg<string> value={style.align ?? 'left'} onPick={a => onPatch(o => o.type === 'text' ? { ...o, align: a === 'left' ? undefined : a as 'center' | 'right' } : o)} options={[{ id: 'left', label: '⟸' }, { id: 'center', label: '≡' }, { id: 'right', label: '⟹' }]} />}
    </Section>}
    <Section title={t('Ordem', 'Order')}>
      <IconButton icon="front" size={16} label={t('Trazer para a frente', 'Bring to front')} kbd="⌘⇧]" onClick={() => onReorder('front')} />
      <IconButton icon="forward" size={16} label={t('Avançar', 'Bring forward')} kbd="⌘]" onClick={() => onReorder('forward')} />
      <IconButton icon="backward" size={16} label={t('Recuar', 'Send backward')} kbd="⌘[" onClick={() => onReorder('backward')} />
      <IconButton icon="back" size={16} label={t('Enviar para o fundo', 'Send to back')} kbd="⌘⇧[" onClick={() => onReorder('back')} />
    </Section>
    <div className="cv-insp-actions">
      {objects.length === 1 && texty && !locked && <IconButton icon="text" size={16} label={t('Editar texto', 'Edit text')} kbd="↵" onClick={onEdit} />}
      {objects.length > 1 && !grouped && <IconButton icon="group" size={16} label={t('Agrupar', 'Group')} kbd="⌘G" onClick={onGroup} />}
      {grouped && <IconButton icon="ungroup" size={16} label={t('Desagrupar', 'Ungroup')} kbd="⌘⇧G" onClick={onUngroup} />}
      <IconButton icon={locked ? 'unlock' : 'lock'} size={16} label={locked ? t('Destravar', 'Unlock') : t('Travar', 'Lock')} kbd="⌘L" active={locked} onClick={onLock} />
      <IconButton icon="duplicate" size={16} label={t('Duplicar', 'Duplicate')} kbd="⌘D" onClick={onDuplicate} />
      <IconButton icon="library" size={16} label={t('Salvar na biblioteca', 'Save to library')} onClick={onSaveLibrary} />
      <span className="cv-insp-spacer" aria-hidden />
      <IconButton icon="trash" size={16} danger label={t('Apagar', 'Delete')} kbd="⌫" disabled={locked} onClick={onDelete} />
    </div>
    {objects.length === 1 && isCard(first) && <div className="cv-insp-hint">{t('Clique no corpo do cartão para editar a página no lugar.', 'Click the card body to edit the page in place.')}</div>}
  </aside>
}
