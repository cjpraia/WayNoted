// Gerenciar tipos de objeto: lista, criar/editar/duplicar/excluir, campos (com conversão segura),
// ícone/cor, herança, modelo e coleção. Usado no modal "Tipos de objeto" e em Configurações → Tipos.
import { DialogActions } from '../ui/DialogActions'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Copy, FileText, LayoutGrid, Plus, Redo2, Trash2, Undo2, X } from 'lucide-react'
import { actions, getState, useStore } from '../../store'
import { useI18n } from '../../i18n'
import type { Property, PropValue } from '../../types'
import { EmojiPicker } from '../page/EmojiPicker'
import { PageIcon, iconLabel } from '../page/PageIcon'
import { PropTypeIcon } from '../database/icons'
import { PropDisplay } from '../database/PropDisplay'
import { PropertyEditor } from '../database/editors/PropertyEditor'
import { OptionChip } from '../database/OptionChip'
import { propertyTypeLabel } from '../database/labels'
import { blocksToText } from '../page/util'
import { availableTemplates } from '../page/templates'
import { canInherit, effectiveProperties, findType, isEmptyValue, TYPE_COLORS, typeAncestors, typeIndex, typeSchemaId, type ObjectType } from '../../objecttypes/model'
import { hiddenStarterTypes } from '../../objecttypes/visibility'
import { EmptyState as NpEmptyState } from '../ui/illustrations/Illustration'
import {
  addField, canRedoTypes, canUndoTypes, convertField, createType, deleteField, deleteType, duplicateType, editTemplateAsPage, moveField, reorderField,
  objectTypes, redoTypes, setFieldDefault, setTemplateBlocks, setTemplateFromPage, undoTypes, updateField, updateType, type DeleteTypeMode,
} from '../../objecttypes/actions'
import { openTypeCollection, openTypesGallery, setTypesPrefs, type ManagerTab } from '../../objecttypes/ui'
import { FieldTypeMenu } from './PageTypes'
import { HarvestNotice } from './Harvest'
import { useReorder } from './useReorder'
import './objecttypes.css'
import { Button, IconButton } from '../ui/Button'
import { Select } from '../ui/Select'
import { VariablePicker } from '../modals/VariablePicker'
import { insertTextInPageEditor } from '../../objecttypes/actions'

export function TypesManager({ initialTypeId, initialTab, embedded, onOpenPage }: { initialTypeId?: string; initialTab?: ManagerTab; embedded?: boolean; onOpenPage: (pageId: string, ids: string[]) => void }) {
  const { t } = useI18n()
  const { pages, settings } = useStore()
  const types = settings.objectTypes ?? []
  const showUnused = !!settings.objectTypesPrefs?.showUnused
  const counts = typeIndex(pages, types)
  // Tipos prontos que ninguém escolheu nem usa ficam ocultos (nada é apagado). docs/USAGE.md
  const hidden = hiddenStarterTypes(pages, types)
  const listed = showUnused ? types : types.filter((type) => !hidden.includes(type))
  const [selected, setSelected] = useState<string | null>(initialTypeId ?? listed[0]?.id ?? null)
  const [tab, setTab] = useState<ManagerTab>(initialTab ?? 'fields')
  useEffect(() => { if (selected && !findType(types, selected)) setSelected(listed[0]?.id ?? null) }, [types, selected, listed])
  const type = selected ? findType(types, selected) : undefined
  void onOpenPage
  return <div className={`ot-manager${embedded ? ' ot-manager--embedded' : ''}`} data-ot="manager">
    <nav className="ot-list" aria-label={t('Tipos', 'Types')}>
      {listed.map((candidate) => { const n = counts.get(candidate.id)?.length ?? 0; return <button key={candidate.id} type="button" className="ot-list-item" aria-current={candidate.id === selected} onClick={() => setSelected(candidate.id)}>
        <span aria-hidden><PageIcon value={candidate.icon} fallback="page" style={{ width: 16, height: 16 }} /></span>
        <span>{candidate.name || t('Sem nome', 'Untitled')}</span>
        {n > 0 ? <span className="ot-count" aria-label={t('{n} páginas', '{n} pages', { n })}>{n}</span> : hidden.includes(candidate) ? <span className="ot-count">{t('não usado', 'unused')}</span> : null}
      </button> })}
      <button type="button" className="ot-list-item" onClick={() => { const id = createType(); setSelected(id); setTab('fields') }}><Plus size={14} /> {t('Novo tipo', 'New type')}</button>
      <button type="button" className="ot-list-item" onClick={() => openTypesGallery()}><LayoutGrid size={14} /> {t('Explorar tipos prontos', 'Explore ready-made types')}</button>
      {hidden.length > 0 && <label className="ot-list-toggle"><input type="checkbox" checked={showUnused} onChange={(e) => setTypesPrefs({ showUnused: e.target.checked })} /> {t('Mostrar tipos não usados ({n})', 'Show unused types ({n})', { n: hidden.length })}</label>}
    </nav>
    <section className="ot-detail">
      {type ? <TypeDetail key={type.id} type={type} tab={tab} setTab={setTab} count={counts.get(type.id)?.length ?? 0} /> : <EmptyState />}
    </section>
  </div>
}

/** Painel simplificado "Editar tipo" (um tipo só): Campos e Modelo; Avançado recolhido. */
export function TypeEditorPanel({ typeId, initialTab }: { typeId: string; initialTab?: ManagerTab }) {
  const { pages, settings } = useStore()
  const type = findType(settings.objectTypes ?? [], typeId)
  const [tab, setTab] = useState<ManagerTab>(initialTab ?? 'fields')
  if (!type) return null
  return <section className="ot-detail ot-detail--panel" data-ot="type-editor"><TypeDetail type={type} tab={tab} setTab={setTab} count={typeIndex(pages, settings.objectTypes ?? []).get(type.id)?.length ?? 0} /></section>
}

function EmptyState() {
  const { t } = useI18n()
  return <NpEmptyState illustration="pages" title={t('Nenhum tipo ainda', 'No types yet')} action={<div className="ot-row ot-row--center">
    <Button variant="primary" onClick={() => openTypesGallery()}><LayoutGrid size={14} /> {t('Explorar tipos', 'Explore types')}</Button>
    <Button onClick={() => createType()}>{t('Começar do zero', 'Start from scratch')}</Button>
  </div>}>{t('Um tipo dá campos e um modelo a qualquer página (ex.: Pessoa tem e-mail e telefone). As páginas continuam onde estão.', 'A type gives any page fields and a template (e.g. Person has email and phone). Pages stay where they are.')}</NpEmptyState>
}

function TypeDetail({ type, tab, setTab, count }: { type: ObjectType; tab: ManagerTab; setTab: (tab: ManagerTab) => void; count: number }) {
  const { t } = useI18n()
  const [emoji, setEmoji] = useState(false)
  const [name, setName] = useState(type.name)
  const [deleting, setDeleting] = useState(false)
  const iconRef = useRef<HTMLButtonElement>(null)
  useEffect(() => setName(type.name), [type.name])
  const types = objectTypes()
  const parents = (type.parentTypes ?? []).map((id) => findType(types, id)).filter((p): p is ObjectType => !!p)
  const candidates = types.filter((candidate) => candidate.id !== type.id && !type.parentTypes?.includes(candidate.id) && canInherit(types, type.id, candidate.id))
  return <>
    <div className="ot-detail-head">
      <button ref={iconRef} type="button" className={`ot-type-icon db-color-${type.color}`} aria-label={t('Ícone do tipo', 'Type icon')} onClick={() => setEmoji(true)}><PageIcon value={type.icon || 'lucide:tag:gray'} /></button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <input className="ot-name" aria-label={t('Nome do tipo', 'Type name')} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name !== type.name) updateType(type.id, { name: name.trim() }, t('Tipo renomeado', 'Type renamed')) }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
        <textarea className="ot-desc" rows={1} aria-label={t('Descrição', 'Description')} placeholder={t('Para que serve este tipo? (opcional)', 'What is this type for? (optional)')} defaultValue={type.description} onBlur={(e) => { if (e.target.value !== type.description) updateType(type.id, { description: e.target.value }) }} />
        <button type="button" className="ot-link ot-detail-pages" onClick={() => openTypeCollection(type.id)}>{count ? t('{n} página(s) com este tipo · abrir coleção', '{n} page(s) with this type · open collection', { n: count }) : t('Abrir coleção', 'Open collection')}</button>
      </div>
    </div>
    {emoji && <EmojiPicker anchor={iconRef.current} value={type.icon} onSelect={(icon) => { updateType(type.id, { icon }); setEmoji(false) }} onRemove={() => { updateType(type.id, { icon: null }); setEmoji(false) }} onClose={() => setEmoji(false)} />}
    <div className="ot-tabs" role="tablist">
      {(['fields', 'template'] as ManagerTab[]).map((key) => <button key={key} type="button" role="tab" className="ot-tab" aria-selected={tab === key} onClick={() => setTab(key)}>{key === 'fields' ? t('Campos', 'Fields') : t('Modelo', 'Template')}</button>)}
    </div>
    {tab === 'fields' && <FieldsEditor type={type} />}
    {tab === 'template' && <TemplateEditor type={type} />}
    <details className="ot-advanced">
      <summary>{t('Avançado', 'Advanced')}</summary>
      <div className="ot-meta">
        <span>{t('Cor', 'Color')}</span>
        <div className="ot-colors" role="group" aria-label={t('Cor', 'Color')}>{TYPE_COLORS.map((color) => <button key={color} type="button" className={`ot-color db-color-${color}`} aria-pressed={type.color === color} aria-label={color} title={color} onClick={() => updateType(type.id, { color })} />)}</div>
        <span title={t('Os campos do tipo de origem aparecem primeiro, e as páginas deste tipo entram também na coleção dele.', 'The source type fields come first, and pages of this type also join its collection.')}>{t('Herda campos de', 'Inherits fields from')}</span>
        <div className="ot-parents">
          {parents.map((parent) => <span key={parent.id} className={`ot-chip db-color-${parent.color}`}>{parent.icon && <PageIcon value={parent.icon} style={{ width: 14, height: 14 }} />} {parent.name}<span className="ot-chip-x" role="button" aria-label={t('Remover herança', 'Remove inheritance')} onClick={() => updateType(type.id, { parentTypes: type.parentTypes!.filter((id) => id !== parent.id) })}><X size={12} /></span></span>)}
          {candidates.length > 0 && <Select aria-label={t('Herdar campos de outro tipo', 'Inherit fields from another type')} value="" onChange={(e) => { if (e.target.value) updateType(type.id, { parentTypes: [...(type.parentTypes ?? []), e.target.value] }) }}>
            <option value="">{parents.length ? t('+ outro', '+ another') : t('Nenhum (opcional)', 'None (optional)')}</option>
            {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{iconLabel(candidate.icon) ? iconLabel(candidate.icon) + ' ' : ''}{candidate.name}</option>)}
          </Select>}
          {!candidates.length && !parents.length && <span className="ot-inherited">{t('Crie outro tipo para herdar os campos dele.', 'Create another type to inherit its fields.')}</span>}
        </div>
        <span>{t('Título automático', 'Automatic title')}</span>
        <input type="text" aria-label={t('Título automático', 'Automatic title')} title={t('Usado quando a página não tem título. {data} vira a data de hoje e {n} o número.', 'Used when the page has no title. {date} becomes today and {n} the number.')} placeholder={t('ex.: Reunião {data}', 'e.g. Meeting {date}')} defaultValue={type.titleTemplate ?? ''} onBlur={(e) => { const value = e.target.value.trim(); if (value !== (type.titleTemplate ?? '')) updateType(type.id, { titleTemplate: value || undefined }) }} />
      </div>
      <div className="ot-row">
        <Button onClick={() => duplicateType(type.id)}><Copy size={14} /> {t('Duplicar tipo', 'Duplicate type')}</Button>
        <Button variant="danger-quiet" onClick={() => setDeleting(true)}><Trash2 size={14} /> {t('Excluir tipo…', 'Delete type…')}</Button>
      </div>
    </details>
    <p className="ot-collection-note ot-autosave">{t('As mudanças são salvas sozinhas. Use Desfazer se mudar de ideia.', 'Changes save on their own. Use Undo if you change your mind.')}</p>
    {deleting && <DeleteTypeDialog type={type} count={count} onClose={() => setDeleting(false)} />}
  </>
}

function FieldsEditor({ type }: { type: ObjectType }) {
  const { t } = useI18n()
  const { pages } = useStore()
  const [typeMenu, setTypeMenu] = useState<{ prop: Property; el: Element } | null>(null)
  const [adding, setAdding] = useState<Element | null>(null)
  const [editingDefault, setEditingDefault] = useState<{ prop: Property; el: Element } | null>(null)
  const types = objectTypes()
  const inherited = useMemo(() => { const own = new Set(type.properties.map((p) => p.id)); return effectiveProperties(types, type.id).filter((p) => !own.has(p.id)) }, [types, type])
  const owner = (prop: Property) => typeAncestors(types, type.id).find((ancestor) => ancestor.properties.some((p) => p.id === prop.id))
  const defaults = type.template.values ?? {}
  const reorder = useReorder((id, targetId, after) => reorderField(type.id, id, targetId, after), (id, delta) => moveField(type.id, id, delta))
  return <div role="table" aria-label={t('Campos', 'Fields')}>
    <HarvestNotice typeId={type.id} />
    <p className="ot-collection-note ot-fields-hint">{t('Os campos aparecem em toda página com este tipo.', 'Fields show up on every page with this type.')}</p>
    <div className="ot-field-row ot-field-head" role="row"><span /><span /><span>{t('Nome', 'Name')}</span><span>{t('Tipo do campo', 'Field type')}</span><span>{t('Valor padrão', 'Default value')}</span><span /></div>
    {inherited.map((prop) => <div key={prop.id} className="ot-field-row" role="row"><span /><PropTypeIcon type={prop.type} /><span className="ot-inherited">{prop.name}</span><span className="ot-inherited">{propertyTypeLabel(prop.type)}</span><span className="ot-inherited">{t('herdado de {name}', 'inherited from {name}', { name: owner(prop)?.name ?? '' })}</span><span /></div>)}
    {type.properties.map((prop, index) => <div key={prop.id} role="row" {...reorder.row(prop.id)}>
      <div className="ot-field-row">
        {reorder.grip(prop.id, prop.name)}
        <PropTypeIcon type={prop.type} />
        <input type="text" aria-label={t('Nome do campo', 'Field name')} defaultValue={prop.name} onBlur={(e) => { const value = e.target.value.trim(); if (value && value !== prop.name) updateField(type.id, prop.id, { name: value }) }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
        <Button aria-label={t('Tipo do campo {name}', 'Field type {name}', { name: prop.name })} onClick={(e) => setTypeMenu({ prop, el: e.currentTarget })}>{propertyTypeLabel(prop.type)}</Button>
        <div className="ot-default" role="button" tabIndex={0} aria-label={t('Valor padrão de {name}', 'Default value of {name}', { name: prop.name })} onClick={(e) => { if (!['createdTime', 'updatedTime', 'createdBy', 'updatedBy'].includes(prop.type)) { if (prop.type === 'checkbox') setFieldDefault(type.id, prop.id, defaults[prop.id] === true ? null : true); else setEditingDefault({ prop, el: e.currentTarget }) } }}>
          {isEmptyValue(defaults[prop.id]) && prop.type !== 'checkbox' ? <span className="dbv-rp-empty">{t('Nenhum', 'None')}</span> : <PropDisplay property={prop} value={(defaults[prop.id] ?? null) as PropValue} />}
        </div>
        <span className="ot-actions">
          <IconButton disabled={index === 0} label={t('Mover para cima', 'Move up')} onClick={() => moveField(type.id, prop.id, -1)}><ArrowUp size={14} /></IconButton>
          <IconButton disabled={index === type.properties.length - 1} label={t('Mover para baixo', 'Move down')} onClick={() => moveField(type.id, prop.id, 1)}><ArrowDown size={14} /></IconButton>
          <IconButton label={t('Excluir campo {name}', 'Delete field {name}', { name: prop.name })} onClick={() => deleteField(type.id, prop.id)}><Trash2 size={14} /></IconButton>
        </span>
      </div>
      <FieldExtras type={type} prop={prop} pages={pages} />
    </div>)}
    <div className="ot-row" style={{ marginTop: 10 }}>
      <Button onClick={(e) => setAdding(e.currentTarget)}><Plus size={14} /> {t('Adicionar campo', 'Add field')}</Button>
    </div>
    {typeMenu && <FieldTypeMenu anchor={typeMenu.el} current={typeMenu.prop.type} onClose={() => setTypeMenu(null)} onPick={(next) => { const prop = typeMenu.prop; setTypeMenu(null); if (next !== prop.type) convertField(type.id, prop.id, next) }} />}
    {adding && <FieldTypeMenu anchor={adding} onClose={() => setAdding(null)} onPick={(next) => { setAdding(null); addField(type.id, next) }} />}
    {editingDefault && editingDefault.el.isConnected && <PropertyEditor dbId={typeSchemaId(type.id)} property={type.properties.find((p) => p.id === editingDefault.prop.id) ?? editingDefault.prop} value={(objectTypes().find((c) => c.id === type.id)?.template.values?.[editingDefault.prop.id] ?? null) as PropValue} anchor={editingDefault.el} onChange={(value) => setFieldDefault(type.id, editingDefault.prop.id, value)} onClose={() => setEditingDefault(null)} />}
  </div>
}

/** Configuração própria do tipo de campo: opções, formato do número, banco da relação. */
function FieldExtras({ type, prop }: { type: ObjectType; prop: Property; pages: Record<string, unknown> }) {
  const { t } = useI18n()
  const [option, setOption] = useState('')
  if (prop.type === 'select' || prop.type === 'multiSelect' || prop.type === 'status') return <div className="ot-field-extra">
    {(prop.options ?? []).map((o) => <span key={o.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><OptionChip name={o.name} color={o.color} dot={prop.type === 'status'} custom={o.customColor} /><IconButton style={{ width: 18, height: 18 }} label={t('Remover opção {name}', 'Remove option {name}', { name: o.name })} onClick={() => updateField(type.id, prop.id, { options: prop.options!.filter((x) => x.id !== o.id) })}><X size={11} /></IconButton></span>)}
    <input type="text" placeholder={t('Nova opção…', 'New option…')} aria-label={t('Nova opção para {name}', 'New option for {name}', { name: prop.name })} value={option} onChange={(e) => setOption(e.target.value)} onKeyDown={(e) => {
      if (e.key !== 'Enter' || !option.trim()) return
      const name = option.trim()
      if (!(prop.options ?? []).some((o) => o.name.toLowerCase() === name.toLowerCase())) updateField(type.id, prop.id, { options: [...(prop.options ?? []), { id: globalThis.crypto.randomUUID(), name, color: TYPE_COLORS[1 + ((prop.options?.length ?? 0) % 9)], ...(prop.type === 'status' ? { group: 'todo' as const } : {}) }] })
      setOption('')
    }} />
  </div>
  if (prop.type === 'number') return <div className="ot-field-extra"><Select aria-label={t('Formato do número', 'Number format')} value={prop.numberFormat ?? 'number'} onChange={(e) => updateField(type.id, prop.id, { numberFormat: e.target.value as Property['numberFormat'] })}>
    <option value="number">{t('Número', 'Number')}</option><option value="currency">{t('Moeda', 'Currency')}</option><option value="percent">{t('Porcentagem', 'Percent')}</option><option value="progress">{t('Progresso', 'Progress')}</option>
  </Select></div>
  if (prop.type === 'relation') {
    const dbs = Object.values(getState().pages).filter((page) => page.database && !page.trashed && !page.database.linkedSourceId)
    return <div className="ot-field-extra"><Select aria-label={t('Banco relacionado', 'Related database')} value={prop.relationDatabaseId ?? ''} onChange={(e) => updateField(type.id, prop.id, { relationDatabaseId: e.target.value || undefined })}>
      <option value="">{t('Escolha um banco…', 'Choose a database…')}</option>
      {dbs.map((db) => <option key={db.id} value={db.id}>{db.title || t('Sem título', 'Untitled')}</option>)}
    </Select></div>
  }
  return null
}

function TemplateEditor({ type }: { type: ObjectType }) {
  const { t } = useI18n()
  const { route, pages } = useStore()
  const [error, setError] = useState('')
  const source = type.template.sourcePageId ? pages[type.template.sourcePageId] : undefined
  const preview = blocksToText(type.template.blocks ?? []).trim()
  const currentPage = route.type === 'page' ? pages[route.id] : undefined
  const run = (operation: () => unknown) => { setError(''); void Promise.resolve().then(operation).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))) }
  return <div>
    <p className="ot-collection-note">{t('O modelo é o conteúdo inicial: entra no topo da página quando o tipo é aplicado (dá para desmarcar ou desfazer).', 'The template is the starting content: it goes at the top of the page when the type is applied (you can untick it or undo).')}</p>
    {source && !source.trashed ? <div className="ot-row" style={{ margin: '10px 0' }}><FileText size={14} /> {t('Página-modelo (lida ao vivo):', 'Template page (read live):')} <button type="button" className="ot-link" onClick={() => actions.openPage(source.id)}>{source.title || t('Sem título', 'Untitled')}</button><Button onClick={() => updateType(type.id, { template: { ...type.template, sourcePageId: undefined } })}>{t('Desvincular', 'Unlink')}</Button></div>
      : <><div className="ot-section">{t('Conteúdo', 'Content')}</div><div className="ot-template-preview">{preview || (type.template.blocks?.length ? t('(blocos sem texto)', '(blocks without text)') : t('Sem modelo de conteúdo.', 'No content template.'))}</div></>}
    <p className="ot-collection-note">{t('Dica: use {{data}}, {{titulo}}, {{prop:Nome}}, {{pergunta:Texto}} ou {{cursor}} no modelo; elas são preenchidas ao aplicar o tipo. Veja a lista em “Inserir variável”.', 'Tip: use {{date}}, {{title}}, {{prop:Name}}, {{ask:Text}} or {{cursor}} in the template; they are filled in when the type is applied. See the list under “Insert variable”.')}</p>
    <div className="ot-row" style={{ marginTop: 12 }}>
      <Button variant="primary" onClick={() => run(() => editTemplateAsPage(type.id))}>{t('Editar como página', 'Edit as a page')}</Button>
      <VariablePicker scope="row" onPick={(token) => run(async () => {
        if (source && insertTextInPageEditor(source.id, token)) return
        await navigator.clipboard?.writeText(token)
        setError(t('Copiado: {token}. Abra o modelo com “Editar como página” e cole onde quiser.', 'Copied: {token}. Open the template with “Edit as a page” and paste it where you want.', { token }))
      })} />
      <Select aria-label={t('Usar um modelo pronto', 'Use a ready-made template')} value="" onChange={(e) => { const template = availableTemplates().find((item) => item.id === e.target.value); if (template) setTemplateBlocks(type.id, structuredClone(template.blocks)) }}>
        <option value="">{t('Usar modelo pronto…', 'Use ready-made template…')}</option>
        {availableTemplates().map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}
      </Select>
      {currentPage && !currentPage.database && <Button onClick={() => run(() => setTemplateFromPage(type.id, currentPage.id))}>{t('Copiar da página “{name}”', 'Copy from “{name}”', { name: currentPage.title || t('Sem título', 'Untitled') })}</Button>}
      {(type.template.blocks?.length || source) && <Button variant="danger-quiet" onClick={() => setTemplateBlocks(type.id, undefined)}>{t('Limpar', 'Clear')}</Button>}
    </div>
    {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
  </div>
}

export function DeleteTypeDialog({ type, count, onClose }: { type: ObjectType; count: number; onClose: () => void }) {
  const { t } = useI18n()
  const [mode, setMode] = useState<DeleteTypeMode>('remove')
  const [busy, setBusy] = useState(false)
  return <div className="ot-overlay" role="dialog" aria-modal="true" aria-label={t('Excluir tipo', 'Delete type')} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div className="ot-dialog">
      <h3>{t('Excluir o tipo “{name}”?', 'Delete the “{name}” type?', { name: type.name })}</h3>
      <p>{t('{n} página(s) usam este tipo. As páginas não são excluídas. O que fazer com os valores dos campos?', '{n} page(s) use this type. Pages are not deleted. What should happen to the field values?', { n: count })}</p>
      <label><input type="radio" name="ot-delete" checked={mode === 'remove'} onChange={() => setMode('remove')} /><span>{t('Remover dos objetos (descarta os valores)', 'Remove from objects (discard values)')}</span></label>
      <label><input type="radio" name="ot-delete" checked={mode === 'convert'} onChange={() => setMode('convert')} /><span>{t('Converter em texto: cada página recebe no fim uma lista “Campo: valor”', 'Convert to text: each page gets a “Field: value” list at the end')}</span></label>
      <DialogActions destructive busy={busy} onCancel={onClose} confirmLabel={t('Excluir tipo', 'Delete type')} onConfirm={() => { setBusy(true); void deleteType(type.id, mode).catch(actions.reportSaveError).finally(onClose) }} />
    </div>
  </div>
}

export function UndoRedoButtons() {
  const { t } = useI18n()
  useStore()
  return <>
    <IconButton disabled={!canUndoTypes()} label={t('Desfazer', 'Undo')} onClick={() => undoTypes()}><Undo2 size={16} /></IconButton>
    <IconButton disabled={!canRedoTypes()} label={t('Refazer', 'Redo')} onClick={() => redoTypes()}><Redo2 size={16} /></IconButton>
  </>
}
