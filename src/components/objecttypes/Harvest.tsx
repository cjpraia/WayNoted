// Campos retroativos (docs/USAGE.md): aviso em "Editar tipo → Campos", "Revisar tipos" e o selo discreto.
// Os campos vêm de `harvestTypes` (puro); incorporar usa `incorporateHarvested` (um passo desfazível).
import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../../store'
import { useI18n } from '../../i18n'
import { PropTypeIcon } from '../database/icons'
import { propertyTypeLabel } from '../database/labels'
import { PageIcon } from '../page/PageIcon'
import { Button, IconButton } from '../ui/Button'
import { dismissHarvest, incorporateHarvested, restoreHarvest } from '../../objecttypes/actions'
import { harvestTypes, pendingFields, reviewList, type HarvestField, type TypeHarvest } from '../../objecttypes/harvest'
import { findType } from '../../objecttypes/model'
import { openTypesManager, openTypesReview, patchTypesUi, useTypesUi } from '../../objecttypes/ui'
import './objecttypes.css'

/** Campos faltando de todos os tipos (recalculado só quando páginas ou tipos mudam). */
export function useHarvests(): { harvests: Map<string, TypeHarvest>; dismissed: Record<string, string[]> } {
  const { pages, settings } = useStore()
  const types = settings.objectTypes
  const harvests = useMemo(() => (types?.length ? harvestTypes(pages, types) : new Map<string, TypeHarvest>()), [pages, types])
  return { harvests, dismissed: settings.objectTypesPrefs?.harvestDismissed ?? {} }
}

/** Total de campos pendentes (para o selo). */
export function useReviewCount(): number {
  const { harvests, dismissed } = useHarvests()
  return useMemo(() => reviewList(harvests, dismissed).reduce((sum, entry) => sum + entry.fields.length, 0), [harvests, dismissed])
}

function fieldNote(t: ReturnType<typeof useI18n>['t'], field: HarvestField, pageCount: number) {
  const pagesText = t('em {n} de {total} páginas', 'in {n} of {total} pages', { n: field.pageIds.length, total: pageCount })
  return `${pagesText} · ${field.filled ? t('{n} com valor', '{n} with a value', { n: field.filled }) : t('sem valores', 'no values')}`
}

function FieldRow({ field, pageCount, checked, onToggle }: { field: HarvestField; pageCount: number; checked: boolean; onToggle: () => void }) {
  const { t } = useI18n()
  return <li><label>
    <input type="checkbox" checked={checked} onChange={onToggle} aria-label={field.property.name || t('Sem nome', 'Untitled')} />
    <PropTypeIcon type={field.property.type} /> <span>{field.property.name || t('Sem nome', 'Untitled')}</span>
    <em className="ot-harvest-kind">{propertyTypeLabel(field.property.type)}</em>
    <small>{fieldNote(t, field, pageCount)}{field.duplicateOf ? ` · ${t('parecido com outro campo', 'similar to another field')}` : ''}</small>
  </label></li>
}

/** Aviso no topo de "Editar tipo → Campos". Sem campos faltando não mostra nada (só o link dos dispensados). */
export function HarvestNotice({ typeId }: { typeId: string }) {
  const { t } = useI18n()
  const { harvests, dismissed } = useHarvests()
  const harvest = harvests.get(typeId)
  const pending = pendingFields(harvest, dismissed[typeId])
  const skipped = (harvest?.fields.length ?? 0) - pending.length
  const [off, setOff] = useState<Set<string>>(() => new Set((harvest?.fields ?? []).filter((field) => field.duplicateOf).map((field) => field.property.id)))
  if (!harvest || (!pending.length && !skipped)) return null
  if (!pending.length) return <p className="ot-collection-note ot-harvest-skipped" data-ot="harvest-skipped">
    {t('{n} campo(s) das páginas dispensado(s).', '{n} page field(s) dismissed.', { n: skipped })} <button type="button" className="ot-link" onClick={() => restoreHarvest(typeId)}>{t('Rever', 'Review')}</button>
  </p>
  const chosen = pending.filter((field) => !off.has(field.property.id))
  const toggle = (id: string) => setOff((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  return <section className="ot-harvest" data-ot="harvest" aria-label={t('Campos das páginas fora do tipo', 'Page fields outside the type')}>
    <p className="ot-harvest-title" role="status">{pending.length === 1
      ? t('1 campo das páginas deste tipo ainda não está no tipo', '1 field from the pages of this type is not in the type yet')
      : t('{n} campos das páginas deste tipo ainda não estão no tipo', '{n} fields from the pages of this type are not in the type yet', { n: pending.length })}</p>
    <p className="ot-collection-note">{t('Ao incorporar, os valores das páginas continuam valendo. Dá para desfazer.', 'When you add them, the page values keep working. You can undo.')}</p>
    <ul className="ot-inc-list">{pending.map((field) => <FieldRow key={field.property.id} field={field} pageCount={harvest.pageCount} checked={!off.has(field.property.id)} onToggle={() => toggle(field.property.id)} />)}</ul>
    <div className="ot-row ot-harvest-actions">
      <Button variant="primary" disabled={!chosen.length} onClick={() => incorporateHarvested([{ typeId, fieldIds: chosen.map((field) => field.property.id) }])}>{t('Incorporar selecionados', 'Add selected')}</Button>
      <Button onClick={() => dismissHarvest(typeId, pending.map((field) => field.property.id))}>{t('Agora não', 'Not now')}</Button>
    </div>
  </section>
}

/** "Revisar tipos": todos os tipos com campos faltando, com seleção por tipo e por campo, prévia e um desfazer para o lote. */
export function ReviewTypesDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const { settings } = useStore()
  const { harvests, dismissed } = useHarvests()
  const [showDismissed, setShowDismissed] = useState(false)
  const entries = useMemo(() => reviewList(harvests, dismissed, showDismissed), [harvests, dismissed, showDismissed])
  const hiddenCount = useMemo(() => reviewList(harvests, dismissed, true).reduce((sum, entry) => sum + entry.dismissedCount, 0), [harvests, dismissed])
  const [off, setOff] = useState<Set<string>>(() => new Set())
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close.current() } }
    window.addEventListener('keydown', onKey)
    box.current?.querySelector<HTMLElement>('button')?.focus()
    return () => { window.removeEventListener('keydown', onKey); if (opener?.isConnected) opener.focus() }
  }, [])
  const key = (typeId: string, fieldId: string) => `${typeId}:${fieldId}`
  const isOn = (entry: { typeId: string }, field: HarvestField) => !off.has(key(entry.typeId, field.property.id)) && (!field.duplicateOf || off.has(`~${key(entry.typeId, field.property.id)}`))
  // Duplicados nascem desmarcados; marcar um deles grava "~chave" para sobrepor o padrão.
  const toggleField = (typeId: string, field: HarvestField) => setOff((current) => {
    const next = new Set(current)
    const k = key(typeId, field.property.id)
    if (field.duplicateOf) { if (next.has(`~${k}`)) next.delete(`~${k}`); else next.add(`~${k}`) }
    else if (next.has(k)) next.delete(k); else next.add(k)
    return next
  })
  const toggleType = (entry: { typeId: string; fields: HarvestField[] }) => {
    const all = entry.fields.every((field) => isOn(entry, field))
    setOff((current) => {
      const next = new Set(current)
      for (const field of entry.fields) {
        const k = key(entry.typeId, field.property.id)
        if (field.duplicateOf) { if (all) next.delete(`~${k}`); else next.add(`~${k}`) }
        else if (all) next.add(k); else next.delete(k)
      }
      return next
    })
  }
  const selections = entries.map((entry) => ({ typeId: entry.typeId, fieldIds: entry.fields.filter((field) => isOn(entry, field)).map((field) => field.property.id) })).filter((selection) => selection.fieldIds.length)
  const total = selections.reduce((sum, selection) => sum + selection.fieldIds.length, 0)
  const valueCount = entries.reduce((sum, entry) => sum + entry.fields.filter((field) => isOn(entry, field)).reduce((inner, field) => inner + field.filled, 0), 0)
  void settings
  return <div className="ot-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div ref={box} className="ot-gallery ot-review" role="dialog" aria-modal="true" aria-labelledby="ot-review-title" data-ot="review">
      <div className="ot-gallery-head">
        <div>
          <h2 id="ot-review-title" className="np-display">{t('Revisar tipos', 'Review types')}</h2>
          <p>{t('Campos que as páginas têm e o tipo delas ainda não. Marque o que deve fazer parte do tipo; os valores continuam valendo e nada é apagado.', 'Fields the pages have and their type does not yet. Tick what should become part of the type; values keep working and nothing is deleted.')}</p>
        </div>
        <IconButton label={t('Fechar', 'Close')} onClick={onClose}><X size={16} /></IconButton>
      </div>
      {!entries.length ? <p className="ot-collection-note" role="status">{t('Todos os tipos já têm os campos das suas páginas.', 'Every type already has its pages’ fields.')}</p>
        : <div className="ot-review-list">{entries.map((entry) => {
          const type = findType(settings.objectTypes ?? [], entry.typeId)
          if (!type) return null
          const on = entry.fields.filter((field) => isOn(entry, field)).length
          return <section key={entry.typeId} className="ot-review-type" data-type={entry.typeId}>
            <label className="ot-review-head">
              <input type="checkbox" checked={on === entry.fields.length} ref={(el) => { if (el) el.indeterminate = on > 0 && on < entry.fields.length }} onChange={() => toggleType(entry)} aria-label={type.name} />
              {type.icon && <PageIcon value={type.icon} style={{ width: 16, height: 16 }} />} <strong>{type.name}</strong>
              <small>{t('{n} campo(s) · {pages} página(s)', '{n} field(s) · {pages} page(s)', { n: entry.fields.length, pages: entry.pageCount })}</small>
            </label>
            <ul className="ot-inc-list">{entry.fields.map((field) => <FieldRow key={field.property.id} field={field} pageCount={entry.pageCount} checked={isOn(entry, field)} onToggle={() => toggleField(entry.typeId, field)} />)}</ul>
            <div className="ot-row"><Button onClick={() => dismissHarvest(entry.typeId, entry.fields.map((field) => field.property.id))}>{t('Agora não, neste tipo', 'Not now, for this type')}</Button>
              <Button onClick={() => openTypesManager(entry.typeId, 'fields')}>{t('Editar tipo', 'Edit type')}</Button></div>
          </section>
        })}</div>}
      {(hiddenCount > 0 || showDismissed) && <label className="ot-dialog-quiet"><input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} /> <span>{t('Mostrar dispensados ({n})', 'Show dismissed ({n})', { n: hiddenCount })}</span></label>}
      {showDismissed && entries.some((entry) => entry.dismissedCount) && <div className="ot-row"><Button onClick={() => entries.forEach((entry) => restoreHarvest(entry.typeId))}>{t('Reabrir todos os dispensados', 'Reopen all dismissed')}</Button></div>}
      <div className="np-dialog-actions">
        <span className="ot-review-preview" role="status" data-ot="review-preview">{total
          ? t('Vai adicionar {n} campo(s) a {types} tipo(s); {values} valor(es) preservado(s). Um só Desfazer.', 'Will add {n} field(s) to {types} type(s); {values} value(s) kept. A single Undo.', { n: total, types: selections.length, values: valueCount })
          : t('Nada selecionado.', 'Nothing selected.')}</span>
        <Button onClick={onClose}>{t('Fechar', 'Close')}</Button>
        <Button variant="primary" disabled={!total} onClick={() => { incorporateHarvested(selections); onClose() }}>{t('Incorporar tudo selecionado', 'Add everything selected')}</Button>
      </div>
    </div>
  </div>
}

/** Selo discreto "N campos a revisar" (barra lateral e configurações). Só aparece quando há o que revisar. */
export function ReviewBadge({ className }: { className?: string }) {
  const { t } = useI18n()
  const count = useReviewCount()
  if (!count) return null
  return <button type="button" className={`ot-review-badge${className ? ` ${className}` : ''}`} data-ot="review-badge" onClick={openTypesReview}>
    {count === 1 ? t('1 campo a revisar', '1 field to review') : t('{n} campos a revisar', '{n} fields to review', { n: count })}
  </button>
}

export function ReviewHost() {
  const ui = useTypesUi()
  return ui.review ? <ReviewTypesDialog onClose={() => patchTypesUi({ review: false })} /> : null
}
