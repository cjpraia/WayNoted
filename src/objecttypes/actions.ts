// Ações dos tipos de objeto sobre a store: criar/editar/excluir tipos, aplicar/remover em páginas,
// modelos, coleções e desfazer/refazer. docs/USAGE.md
import { prepareTemplate } from '../templates/apply.ts'
import { placeCursor, setPendingCursor } from '../templates/cursor.ts'
import type { TemplateCursor } from '../templates/variables.ts'
import { actions, api, getState, registerNewRowHook, registerTypeSchemaRecorder, registerVirtualRows } from '../store.ts'
import type { Page, Property, PropType, PropValue } from '../types'
import { translate } from '../localization.ts'
import { blocksToText, flushDoc } from '../components/page/util.ts'
import { isEmptyPageDocument } from '../components/page/emptyPage.ts'
import { cloneDocument } from '../workspace.ts'
import {
  applyTypePatch, canInherit, defaultCollection, effectiveProperties, findType, findTypeByName, isEmptyValue, normalizeObjectTypes, orphanTypeValues,
  pageTypeFields, purgeOrphansPatch, removeTypePatch, typeDataHidden, typeIdFromSchemaId, typeIndex, UNSUPPORTED_FIELD_TYPES, type ObjectType,
} from './model.ts'
import { asText, planConversion } from './convert.ts'
import { presetType, type PresetId } from './presets.ts'
import { setTypesPrefs, showTypesToast, typesPrefs } from './ui.ts'
import { harvestTypes } from './harvest.ts'
import { showToast } from '../components/ui/toastQueue.ts'
import { seedNativeTypes, restoreNativeTypes, missingNativePresets } from './native.ts'
import { dominantRowType, extraFieldsFor, moveRelative, moveStep } from './adjust.ts'

const uid = () => globalThis.crypto.randomUUID()
const locale = () => getState().settings.locale ?? 'pt-BR'
const tr = (pt: string, en: string, vars?: Record<string, string | number>) => translate(locale(), pt, en, vars)

export function objectTypes(): ObjectType[] { return getState().settings.objectTypes ?? [] }
/** Espaço pronto e gravável (cofre destrancado). */
function writable(): boolean { return getState().ready }

// ---------- desfazer/refazer ----------

interface PageSnap { types?: string[]; typeProps?: Record<string, PropValue>; title: string; icon: string | null }
interface Snapshot { types: ObjectType[] | undefined; pages: Record<string, PageSnap> }
/** Modelo inserido no corpo pelo passo: desfazer remove esses blocos (por id), refazer os recoloca. */
interface BodyChange { pageId: string; blocks: unknown[]; replaced: boolean }
interface HistoryEntry { label: string; before: Snapshot; after: Snapshot; body?: BodyChange[]; at: number; collectionOf?: string }
const undoStack: HistoryEntry[] = []
const redoStack: HistoryEntry[] = []
const HISTORY_LIMIT = 50

function snapshot(pageIds: Iterable<string>): Snapshot {
  const pages: Record<string, PageSnap> = {}
  const all = getState().pages
  for (const id of pageIds) { const page = all[id]; if (page) pages[id] = { types: page.types, typeProps: page.typeProps, title: page.title, icon: page.icon ?? null } }
  return { types: getState().settings.objectTypes, pages }
}
function restore(snap: Snapshot) {
  if (snap.types !== getState().settings.objectTypes) actions.updateSettings({ objectTypes: snap.types })
  for (const [id, values] of Object.entries(snap.pages)) {
    const page = getState().pages[id]
    if (!page || page.locked) continue
    actions.updatePage(id, { types: values.types, typeProps: values.typeProps, title: values.title, ...((page.icon ?? null) !== values.icon ? { icon: values.icon } : {}) }, false)
  }
}
/** Executa `run` registrando um passo desfazível (tipos + campos das páginas tocadas). */
function record<T>(label: string, pageIds: Iterable<string>, run: () => T, toast = true): T {
  const ids = [...pageIds]
  const before = snapshot(ids)
  const result = run()
  const touched = new Set([...ids, ...Object.keys(before.pages)])
  pushHistory({ label, before, after: snapshot(touched), at: Date.now() })
  if (toast) showTypesToast(label, () => undoTypes())
  return result
}
function pushHistory(entry: HistoryEntry) {
  undoStack.push(entry)
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
  redoStack.length = 0
}
export function canUndoTypes() { return undoStack.length > 0 }
export function canRedoTypes() { return redoStack.length > 0 }
/** Instante do próximo passo a desfazer (para o ⌘Z global escolher entre tipos e transações estruturais). */
export function nextTypesUndoAt(): number | null { return undoStack[undoStack.length - 1]?.at ?? null }
export function nextTypesRedoAt(): number | null { return redoStack[redoStack.length - 1]?.at ?? null }
/** Promessa do último desfazer/refazer de corpo (testes e quem precisa esperar o documento). */
let bodyWork: Promise<void> = Promise.resolve()
export function typesBodySettled(): Promise<void> { return bodyWork }
export function undoTypes(): string | null {
  const entry = undoStack.pop()
  if (!entry || !writable()) return null
  restore(entry.before); redoStack.push(entry)
  if (entry.body?.length) bodyWork = Promise.all(entry.body.map((change) => removeInserted(change))).then(() => undefined).catch(actions.reportSaveError)
  return entry.label
}
export function redoTypes(): string | null {
  const entry = redoStack.pop()
  if (!entry || !writable()) return null
  restore(entry.after); undoStack.push(entry)
  if (entry.body?.length) bodyWork = Promise.all(entry.body.map((change) => reinsert(change))).then(() => undefined).catch(actions.reportSaveError)
  return entry.label
}

// ---------- tipos ----------

function saveTypes(next: ObjectType[]) { actions.updateSettings({ objectTypes: normalizeObjectTypes(next) }) }
function patchType(id: string, fn: (type: ObjectType) => ObjectType) {
  saveTypes(objectTypes().map((type) => (type.id === id ? { ...fn(type), updatedAt: Date.now() } : type)))
}
function typeName(id: string) { return findType(objectTypes(), id)?.name || tr('Sem nome', 'Untitled') }

export function createType(init: Partial<ObjectType> = {}): string {
  if (!writable()) return ''
  const now = Date.now()
  const type: ObjectType = { name: tr('Novo tipo', 'New type'), icon: 'lucide:tag:blue', color: 'blue', description: '', properties: [], template: {}, createdAt: now, updatedAt: now, adoptedAt: now, ...init, id: uid() }
  record(tr('Tipo “{name}” criado', 'Type “{name}” created', { name: type.name }), [], () => saveTypes([...objectTypes(), type]))
  return type.id
}

function prefs() { return getState().settings.objectTypesPrefs ?? {} }

/** Abertura do espaço: cria os tipos nativos que faltam, uma única vez (flag em `objectTypesPrefs`). Sem histórico nem aviso. */
export function ensureNativeTypes(): boolean {
  const seed = seedNativeTypes(getState().settings.objectTypes, getState().settings.objectTypesPrefs, locale())
  if (!seed) return false
  actions.updateSettings({ objectTypes: normalizeObjectTypes(seed.types), objectTypesPrefs: seed.prefs })
  return true
}

/** "Restaurar tipos nativos" (Configurações → Tipos): recria os excluídos, sem tocar nos existentes. Devolve quantos. */
export function restoreNative(): number {
  if (!writable()) return 0
  const result = restoreNativeTypes(objectTypes(), prefs(), locale())
  if (!result.created.length) return 0
  record(tr('{n} tipo(s) nativo(s) restaurado(s)', '{n} built-in type(s) restored', { n: result.created.length }), [], () => {
    saveTypes(result.types)
    actions.updateSettings({ objectTypesPrefs: result.prefs })
  })
  return result.created.length
}
export function missingNativeCount(): number { return missingNativePresets(objectTypes()).length }

/** "Ocultar da barra lateral" / mostrar de novo. Só a seção da barra lateral; o tipo continua em todo o resto. */
export function setTypeSidebarHidden(id: string, hidden: boolean) {
  if (!writable() || !findType(objectTypes(), id)) return
  const rest = (type: ObjectType) => { const { sidebarHidden, ...others } = type; void sidebarHidden; return others as ObjectType }
  saveTypes(objectTypes().map((type) => type.id === id ? { ...(hidden ? { ...type, sidebarHidden: true } : rest(type)), updatedAt: Date.now() } : type))
}

/** Reordena a seção "Tipos" da barra lateral (a ordem passa a ser manual). `current` é a ordem exibida agora. */
export function moveSidebarType(current: readonly string[], id: string, delta: -1 | 1) {
  const from = current.indexOf(id), to = from + delta
  if (from < 0 || to < 0 || to >= current.length) return
  const order = [...current]
  ;[order[from], order[to]] = [order[to], order[from]]
  actions.updateSettings({ objectTypesPrefs: { ...prefs(), sidebarOrder: order } })
}

export function createPresetTypes(ids: PresetId[], toast = true): string[] {
  if (!writable()) return []
  const existing = objectTypes()
  const now = Date.now()
  const created = ids.filter((id) => !existing.some((type) => type.preset === id)).map((id) => ({ ...presetType(id, locale(), now), adoptedAt: now }))
  if (!created.length) return []
  record(tr('{n} tipo(s) criado(s)', '{n} type(s) created', { n: created.length }), [], () => {
    saveTypes([...existing, ...created])
    const dismissed = prefs().nativeTypesDismissed
    if (dismissed?.some((id) => ids.includes(id as PresetId))) actions.updateSettings({ objectTypesPrefs: { ...prefs(), nativeTypesDismissed: dismissed.filter((id) => !ids.includes(id as PresetId)) } })
  }, toast)
  return created.map((type) => type.id)
}

/**
 * "Usar" na galeria: cria o tipo pronto (ou mostra de novo o que estava oculto, sem duplicar) e o marca como
 * escolhido. Devolve o id do tipo.
 */
export function adoptStarterType(preset: PresetId): string | null {
  if (!writable()) return null
  const name = presetType(preset, locale(), 0, () => 'x').name
  const existing = objectTypes().find((type) => type.preset === preset) ?? findTypeByName(objectTypes(), name)
  if (existing) {
    if (!existing.adoptedAt) record(tr('Tipo “{name}” pronto para usar', 'Type “{name}” ready to use', { name: existing.name }), [], () => patchType(existing.id, (type) => ({ ...type, adoptedAt: Date.now() })), false)
    return existing.id
  }
  return createPresetTypes([preset], false)[0] ?? null
}

export function updateType(id: string, patch: Partial<Omit<ObjectType, 'id'>>, label?: string) {
  if (!writable() || !findType(objectTypes(), id)) return
  if (patch.parentTypes) patch = { ...patch, parentTypes: patch.parentTypes.filter((parent) => canInherit(objectTypes(), id, parent)) }
  const run = () => patchType(id, (type) => ({ ...type, ...patch }))
  if (label) record(label, [], run, false)
  else run()
}

export function duplicateType(id: string): string | null {
  const source = findType(objectTypes(), id)
  if (!source || !writable()) return null
  const map = new Map<string, string>()
  const properties = source.properties.map((prop) => { const copy = { ...structuredClone(prop), id: uid() }; map.set(prop.id, copy.id); return copy })
  const values = Object.fromEntries(Object.entries(source.template.values ?? {}).map(([key, value]) => [map.get(key) ?? key, value]))
  const now = Date.now()
  const copy: ObjectType = { ...structuredClone(source), id: uid(), name: tr('{name} (cópia)', '{name} (copy)', { name: source.name }), properties, template: { ...structuredClone(source.template), values }, collection: undefined, preset: undefined, createdAt: now, updatedAt: now }
  record(tr('Tipo duplicado', 'Type duplicated'), [], () => saveTypes([...objectTypes(), copy]))
  return copy.id
}

/** Todas as páginas (inclusive lixeira) que guardam o tipo diretamente. */
function pagesCarrying(typeId: string): Page[] {
  return Object.values(getState().pages).filter((page) => page.types?.includes(typeId))
}
/** Páginas com campos de um tipo (diretamente ou por subtipo), inclusive lixeira. */
function pagesWithFieldsOf(typeId: string): Page[] {
  const types = objectTypes()
  return Object.values(getState().pages).filter((page) => page.types?.some((id) => id === typeId || effectiveProperties(types, id).some((p) => findType(types, typeId)?.properties.some((own) => own.id === p.id))))
}

export type DeleteTypeMode = 'remove' | 'convert'
/**
 * Exclui um tipo. `remove`: tira o tipo dos objetos e descarta os valores dos seus campos.
 * `convert`: antes, escreve no fim do corpo de cada página uma lista "Campo: valor".
 */
export async function deleteType(id: string, mode: DeleteTypeMode): Promise<number> {
  const type = findType(objectTypes(), id)
  if (!type || !writable()) return 0
  const pages = pagesCarrying(id)
  const own = new Set(type.properties.map((prop) => prop.id))
  if (mode === 'convert') {
    for (const page of pages) {
      if (page.locked || typeDataHidden(page)) continue
      const lines = effectiveProperties(objectTypes(), id).flatMap((prop) => { const text = asText(page.typeProps?.[prop.id] ?? null, prop, locale()); return text ? [`${prop.name}: ${text}`] : [] })
      if (lines.length) await appendBlocks(page.id, [{ type: 'paragraph', content: [{ type: 'text', text: type.name, styles: { bold: true } }] }, ...lines.map((line) => ({ type: 'bulletListItem', content: [{ type: 'text', text: line, styles: {} }] }))])
    }
  }
  record(tr('Tipo “{name}” excluído', 'Type “{name}” deleted', { name: type.name }), pages.map((page) => page.id), () => {
    for (const page of pages) {
      const current = getState().pages[page.id]
      if (!current || current.locked) continue
      const rest = current.types!.filter((typeId) => typeId !== id)
      const typeProps = Object.fromEntries(Object.entries(current.typeProps ?? {}).filter(([key]) => !own.has(key)))
      actions.updatePage(page.id, { types: rest.length ? rest : undefined, typeProps: Object.keys(typeProps).length ? typeProps : undefined }, false)
    }
    if (type.preset) actions.updateSettings({ objectTypesPrefs: { ...prefs(), nativeTypesDismissed: [...new Set([...(prefs().nativeTypesDismissed ?? []), type.preset])], ...(prefs().sidebarOrder ? { sidebarOrder: prefs().sidebarOrder!.filter((typeId) => typeId !== id) } : {}) } })
    saveTypes(objectTypes().filter((candidate) => candidate.id !== id).map((candidate) => candidate.parentTypes?.includes(id) ? { ...candidate, parentTypes: candidate.parentTypes.filter((p) => p !== id) } : candidate))
  })
  return pages.length
}

// ---------- campos ----------

export function addField(typeId: string, propType: PropType, name?: string): string | null {
  const type = findType(objectTypes(), typeId)
  if (!type || UNSUPPORTED_FIELD_TYPES.has(propType) || !writable()) return null
  const property: Property = { id: uid(), name: name ?? defaultFieldName(type, propType), type: propType }
  if (propType === 'select' || propType === 'multiSelect') property.options = []
  if (propType === 'status') property.options = [{ id: uid(), name: tr('Não iniciado', 'Not started'), color: 'gray', group: 'todo' }, { id: uid(), name: tr('Em andamento', 'In progress'), color: 'blue', group: 'progress' }, { id: uid(), name: tr('Concluído', 'Done'), color: 'green', group: 'complete' }]
  patchType(typeId, (current) => ({ ...current, properties: [...current.properties, property] }))
  return property.id
}
function defaultFieldName(type: ObjectType, propType: PropType): string {
  const base = ({ text: tr('Texto', 'Text'), number: tr('Número', 'Number'), select: tr('Seleção', 'Select'), multiSelect: tr('Multisseleção', 'Multi-select'), status: 'Status', date: tr('Data', 'Date'), checkbox: tr('Caixa de seleção', 'Checkbox'), url: 'URL', email: tr('E-mail', 'Email'), phone: tr('Telefone', 'Phone'), person: tr('Pessoa', 'Person'), files: tr('Arquivos', 'Files'), place: tr('Local', 'Place'), relation: tr('Relação', 'Relation'), createdTime: tr('Criado em', 'Created time'), updatedTime: tr('Editado em', 'Last edited time'), createdBy: tr('Criado por', 'Created by'), updatedBy: tr('Editado por', 'Last edited by') } as Partial<Record<PropType, string>>)[propType] ?? tr('Campo', 'Field')
  let name = base, n = 2
  while (type.properties.some((prop) => prop.name === name)) name = `${base} ${n++}`
  return name
}

export function updateField(typeId: string, fieldId: string, patch: Partial<Property>) {
  if (!writable()) return
  patchType(typeId, (type) => ({ ...type, properties: type.properties.map((prop) => (prop.id === fieldId ? { ...prop, ...patch, id: prop.id, type: prop.type } : prop)) }))
}

export function moveField(typeId: string, fieldId: string, delta: -1 | 1) {
  const type = findType(objectTypes(), typeId)
  if (!type || !writable()) return
  const list = moveStep(type.properties, fieldId, delta)
  if (list === type.properties) return
  record(tr('Campo movido', 'Field moved'), [], () => patchType(typeId, (current) => ({ ...current, properties: [...list] })), false)
}

/** Arrastar: move o campo para antes/depois de outro do mesmo tipo (desfazível com ⌘Z / Desfazer do painel). */
export function reorderField(typeId: string, fieldId: string, targetId: string, after: boolean) {
  const type = findType(objectTypes(), typeId)
  if (!type || !writable()) return
  const list = moveRelative(type.properties, fieldId, targetId, after)
  if (list === type.properties) return
  record(tr('Campo movido', 'Field moved'), [], () => patchType(typeId, (current) => ({ ...current, properties: [...list] })), false)
}

/** Exclui o campo do tipo; os valores ficam nas páginas até serem descartados. */
export function deleteField(typeId: string, fieldId: string) {
  const type = findType(objectTypes(), typeId)
  if (!type || !writable()) return
  record(tr('Campo excluído', 'Field deleted'), [], () => patchType(typeId, (current) => ({ ...current, properties: current.properties.filter((prop) => prop.id !== fieldId), template: { ...current.template, values: Object.fromEntries(Object.entries(current.template.values ?? {}).filter(([key]) => key !== fieldId)) } })))
  // Excluir de propósito não pode voltar como "campo faltando" (os valores ficam nas páginas).
  dismissHarvest(typeId, [fieldId])
}

// ---------- campos retroativos (docs/USAGE.md) ----------

/** "Agora não": lembra, por tipo, os campos que o usuário não quer incorporar (reabrível em Revisar tipos). */
export function dismissHarvest(typeId: string, fieldIds: readonly string[]) {
  const current = typesPrefs().harvestDismissed ?? {}
  const merged = [...new Set([...(current[typeId] ?? []), ...fieldIds])].slice(-500)
  if (merged.length === (current[typeId]?.length ?? 0)) return
  setTypesPrefs({ harvestDismissed: { ...current, [typeId]: merged } })
}
/** Reabre os campos dispensados de um tipo (ou só alguns). */
export function restoreHarvest(typeId: string, fieldIds?: readonly string[]) {
  const current = typesPrefs().harvestDismissed ?? {}
  if (!current[typeId]) return
  const left = fieldIds ? current[typeId].filter((id) => !fieldIds.includes(id)) : []
  const next = { ...current }
  if (left.length) next[typeId] = left; else delete next[typeId]
  setTypesPrefs({ harvestDismissed: next })
}

export interface HarvestSelection { typeId: string; fieldIds: readonly string[] }
const propKey = (prop: Property) => `${prop.name.trim().toLowerCase()}|${prop.type}`
/**
 * Incorpora aos tipos os campos das páginas que eles ainda não têm: mesmo id e mesma configuração (os valores
 * continuam valendo), valor espelhado em `typeProps` (a linha segue no banco, onde `props` manda). Vários tipos
 * e campos num único passo desfazível. Devolve quantos campos entraram.
 */
export function incorporateHarvested(selections: readonly HarvestSelection[], options: { toast?: boolean } = {}): number {
  if (!writable()) return 0
  const harvests = harvestTypes(getState().pages, objectTypes())
  const plan = selections.flatMap(({ typeId, fieldIds }) => {
    const wanted = new Set(fieldIds)
    const fields = (harvests.get(typeId)?.fields ?? []).filter((field) => wanted.has(field.property.id))
    return fields.length ? [{ typeId, fields }] : []
  })
  const total = plan.reduce((sum, entry) => sum + entry.fields.length, 0)
  if (!total) return 0
  const pageIds = new Set(plan.flatMap((entry) => entry.fields.flatMap((field) => field.pageIds)))
  const label = plan.length === 1
    ? tr('{n} campo(s) incorporado(s) ao tipo {name}', '{n} field(s) added to the {name} type', { n: total, name: typeName(plan[0].typeId) })
    : tr('{n} campo(s) incorporado(s) a {types} tipos', '{n} field(s) added to {types} types', { n: total, types: plan.length })
  record(label, pageIds, () => {
    for (const { typeId, fields } of plan) {
      patchType(typeId, (type) => {
        const taken = new Set(type.properties.map(propKey))
        const added = fields.map((field) => {
          const copy = structuredClone(field.property)
          while (taken.has(propKey(copy))) copy.name = `${copy.name} 2`
          taken.add(propKey(copy))
          return copy
        })
        return { ...type, properties: [...type.properties, ...added] }
      })
      for (const field of fields) {
        const id = field.property.id
        for (const pageId of field.pageIds) {
          const page = getState().pages[pageId]
          if (!page?.props || page.locked || !(id in page.props) || isEmptyValue(page.props[id])) continue
          if (JSON.stringify(page.typeProps?.[id] ?? null) === JSON.stringify(page.props[id])) continue
          actions.updatePage(pageId, { typeProps: { ...page.typeProps, [id]: page.props[id] } }, false)
        }
      }
    }
  }, options.toast !== false)
  return total
}

/** Muda o tipo de um campo e converte os valores em todas as páginas (mesmas regras dos bancos). */
export function convertField(typeId: string, fieldId: string, nextType: PropType): boolean {
  const type = findType(objectTypes(), typeId)
  const prop = type?.properties.find((candidate) => candidate.id === fieldId)
  if (!type || !prop || UNSUPPORTED_FIELD_TYPES.has(nextType) || !writable()) return false
  const holders = pagesWithFieldsOf(typeId).filter((page) => page.typeProps && fieldId in page.typeProps)
  const plan = planConversion(prop, nextType, holders.map((page) => page.typeProps![fieldId]))
  if (!plan) return false
  record(tr('Campo convertido', 'Field converted'), holders.map((page) => page.id), () => {
    for (const page of holders) {
      const current = getState().pages[page.id]
      if (!current?.typeProps) continue
      const next = plan.convert(current.typeProps[fieldId])
      if (next === undefined) continue
      actions.updatePage(page.id, { typeProps: { ...current.typeProps, [fieldId]: next } }, false)
    }
    patchType(typeId, (current) => {
      const defaults = { ...(current.template.values ?? {}) }
      if (fieldId in defaults) { const value = plan.convert(defaults[fieldId]); if (value === undefined) { /* mantém */ } else if (isEmptyValue(value)) delete defaults[fieldId]; else defaults[fieldId] = value }
      return { ...current, properties: current.properties.map((candidate) => (candidate.id === fieldId ? { ...candidate, ...plan.property, name: candidate.name } : candidate)), template: { ...current.template, values: defaults } }
    })
  })
  return true
}

export function setFieldDefault(typeId: string, fieldId: string, value: PropValue) {
  patchType(typeId, (type) => {
    const values = { ...(type.template.values ?? {}) }
    if (isEmptyValue(value)) delete values[fieldId]; else values[fieldId] = value
    return { ...type, template: { ...type.template, values } }
  })
}

// ---------- aplicar/remover ----------

/** Expande para subpáginas/linhas (lote da barra lateral); páginas-banco contam pelas linhas. */
export function expandTargets(pageIds: string[], includeChildren: boolean): string[] {
  const pages = getState().pages
  const out = new Set<string>()
  const childrenOf = new Map<string, string[]>()
  if (includeChildren) for (const page of Object.values(pages)) if (page.parentId && !page.trashed) { let list = childrenOf.get(page.parentId); if (!list) childrenOf.set(page.parentId, (list = [])); list.push(page.id) }
  const visit = (id: string, depth: number) => {
    const page = pages[id]
    if (!page || page.trashed || depth > 64) return
    if (!page.database) out.add(id)
    if (includeChildren || page.database) for (const child of childrenOf.get(id) ?? Object.values(pages).filter((p) => p.parentId === id && !p.trashed).map((p) => p.id)) visit(child, depth + 1)
  }
  for (const id of pageIds) visit(id, 0)
  return [...out]
}

/**
 * Incorpora ao tipo campos do banco da(s) página(s) (mesmo id e mesma configuração, para os valores continuarem
 * valendo). Chamado dentro de um passo desfazível. Devolve quantos campos entraram.
 */
function incorporateFields(typeId: string, propIds: readonly string[], pageIds: string[]): number {
  if (!propIds.length) return 0
  const extras = extraFieldsFor(getState().pages, objectTypes(), pageIds, typeId).filter((extra) => propIds.includes(extra.property.id))
  if (!extras.length) return 0
  patchType(typeId, (type) => ({ ...type, properties: [...type.properties, ...extras.map((extra) => structuredClone(extra.property))] }))
  // Espelha o valor em `typeProps` (a linha segue no banco, onde `props` manda; se sair dele o valor continua valendo).
  // O tipo ainda não está na página neste ponto: usa o campo do tipo direto.
  const ids = new Set(extras.map((extra) => extra.property.id))
  for (const pageId of new Set(extras.flatMap((extra) => extra.pageIds))) {
    const page = getState().pages[pageId]
    if (!page?.props || page.locked) continue
    const typeProps = { ...page.typeProps }
    let changed = false
    for (const id of ids) if (id in page.props && !isEmptyValue(page.props[id]) && JSON.stringify(typeProps[id] ?? null) !== JSON.stringify(page.props[id])) { typeProps[id] = page.props[id]; changed = true }
    if (changed) actions.updatePage(pageId, { typeProps }, false)
  }
  return extras.length
}

export interface ApplyResult { applied: string[]; skipped: string[] }
/** Aplica o tipo; páginas bloqueadas/trancadas são puladas. Não mexe no corpo (veja `offerTemplate`). */
export function applyType(pageIds: string[], typeId: string, options: { toast?: boolean; incorporate?: readonly string[] } = {}): ApplyResult {
  const types = objectTypes()
  const type = findType(types, typeId)
  const result: ApplyResult = { applied: [], skipped: [] }
  if (!type || !writable()) return { applied: [], skipped: pageIds }
  const count = typeIndex(getState().pages, types).get(typeId)?.length ?? 0
  const name = type.name
  record(pageIds.length === 1 ? tr('Tipo “{name}” aplicado', 'Type “{name}” applied', { name }) : tr('Tipo “{name}” aplicado a {n} páginas', 'Type “{name}” applied to {n} pages', { name, n: pageIds.length }), pageIds, () => {
    if (options.incorporate?.length) incorporateFields(typeId, options.incorporate, pageIds)
    for (const id of pageIds) {
      const page = getState().pages[id]
      if (!page || page.locked || page.trashed || typeDataHidden(page)) { result.skipped.push(id); continue }
      const patch = applyTypePatch(types, page, typeId, { count: count + result.applied.length, locale: locale() })
      if (!patch) { result.skipped.push(id); continue }
      actions.updatePage(id, patch)
      result.applied.push(id)
    }
    if (result.applied.length && !findType(objectTypes(), typeId)?.adoptedAt) patchType(typeId, (current) => ({ ...current, adoptedAt: Date.now() }))
  }, options.toast !== false)
  return result
}

/** Resumo do que aplicar um tipo faz (diálogo de confirmação e aviso). */
export function applySummary(typeId: string): { name: string; fields: string[]; hasTemplate: boolean } {
  const type = findType(objectTypes(), typeId)
  return { name: type?.name ?? '', fields: type ? effectiveProperties(objectTypes(), typeId).map((prop) => prop.name) : [], hasTemplate: !!(type?.template.blocks?.length || type?.template.sourcePageId) }
}

export interface ApplyStepResult { applied: boolean; fields: number; template: boolean; icon: boolean; incorporated?: number }
/**
 * Aplicar um tipo a UMA página com transparência: campos + ícone (só se a página não tem um) + modelo no topo
 * (ou no lugar do corpo vazio), num único passo desfazível — o desfazer tira os campos, o ícone e os blocos do
 * modelo (por id; o resto do texto não é tocado). Mostra "Tipo X aplicado · N campos · modelo inserido — Desfazer".
 */
export async function applyTypeStep(pageId: string, typeId: string, options: { template?: boolean; toast?: boolean; prompt?: boolean; incorporate?: readonly string[] } = {}): Promise<ApplyStepResult> {
  const types = objectTypes()
  const type = findType(types, typeId)
  const page = getState().pages[pageId]
  const none: ApplyStepResult = { applied: false, fields: 0, template: false, icon: false }
  if (!type || !page || page.locked || page.trashed || typeDataHidden(page) || !writable()) return none
  const patch = applyTypePatch(types, page, typeId, { count: typeIndex(getState().pages, types).get(typeId)?.length ?? 0, locale: locale() })
  if (!patch) return none
  let blocks = options.template === false ? [] : await templateBlocks(type)
  let cursor: TemplateCursor | null = null
  if (blocks.length) {
    // Variáveis {{…}} do corpo-modelo; perguntas só quando o usuário aplicou (não em linhas criadas por regra). Cancelar = nada muda.
    const inRow = !!(page.parentId && getState().pages[page.parentId]?.database)
    const prepared = await prepareTemplate(blocks, { title: page.title, row: inRow ? page : undefined, prompt: options.prompt !== false && options.toast !== false, heading: type.name })
    if (!prepared) return none
    blocks = prepared.blocks as unknown[]; cursor = prepared.cursor
  }
  const empty = blocks.length ? await pageBodyEmpty(pageId) : false
  const current = getState().pages[pageId]
  if (!current || current.locked) return none
  const before = snapshot([pageId])
  const incorporated = options.incorporate?.length ? incorporateFields(typeId, options.incorporate, [pageId]) : 0
  const icon = !current.icon && !!type.icon
  // A incorporação acima já espelhou valores em `typeProps`: eles vencem os padrões do modelo calculados antes.
  const mirrored = getState().pages[pageId]?.typeProps
  if (incorporated && mirrored) patch.typeProps = { ...patch.typeProps, ...mirrored }
  actions.updatePage(pageId, { ...patch, ...(icon ? { icon: type.icon } : {}) })
  if (!type.adoptedAt) patchType(typeId, (value) => ({ ...value, adoptedAt: Date.now() }))
  let body: BodyChange | undefined
  if (blocks.length) {
    body = { pageId, blocks: withIds(cloneDocument(blocks, {})), replaced: empty }
    await insertBody(body)
    const open = editors.get(pageId)
    if (!cursor) { /* sem {{cursor}} */ } else if (!open || !placeCursor(open as never, cursor, 0, blocks.length)) setPendingCursor(pageId, cursor)
  }
  const fields = effectiveProperties(objectTypes(), typeId).length
  const label = [tr('Tipo {name} aplicado', 'Type {name} applied', { name: type.name }), fields ? tr('{n} campos', '{n} fields', { n: fields }) : '', incorporated ? tr('{n} da página', '{n} from the page', { n: incorporated }) : '', body ? tr('modelo inserido', 'template inserted') : ''].filter(Boolean).join(' · ')
  pushHistory({ label, before, after: snapshot([pageId]), body: body ? [body] : undefined, at: Date.now() })
  if (options.toast !== false) showTypesToast(label, () => undoTypes())
  return { applied: true, fields, template: !!body, icon, ...(incorporated ? { incorporated } : {}) }
}

/** Blocos de topo com ids próprios (para o desfazer achá-los depois). */
function withIds(blocks: unknown[]): unknown[] {
  return blocks.map((block) => (block && typeof block === 'object' && !(block as { id?: unknown }).id ? { ...(block as object), id: uid() } : block))
}
const blockId = (block: unknown) => (block && typeof block === 'object' ? (block as { id?: string }).id : undefined)

async function insertBody(change: BodyChange) {
  const editor = editors.get(change.pageId)
  const fresh = structuredClone(change.blocks)
  if (editor && editor.isEditable !== false) {
    const document = editor.document
    if (change.replaced && isEmptyPageDocument(document)) editor.replaceBlocks(document, fresh)
    else editor.insertBlocks(fresh, (document[0] as { id: string }).id, 'before')
    await flushDoc(change.pageId)
    return
  }
  await flushDoc(change.pageId)
  const current = (await api.loadDoc(change.pageId)) ?? []
  const next = change.replaced && isEmptyPageDocument(current) ? fresh : [...fresh, ...current]
  await api.saveDoc(change.pageId, next as unknown[])
  actions.updatePage(change.pageId, { text: blocksToText(next), bodyText: blocksToText(next) }, false)
}
async function removeInserted(change: BodyChange) {
  const ids = new Set(change.blocks.map(blockId).filter(Boolean))
  const editor = editors.get(change.pageId)
  if (editor && editor.isEditable !== false) {
    const present = editor.document.filter((block) => ids.has(blockId(block)))
    if (!present.length) return
    if (present.length === editor.document.length) editor.replaceBlocks(editor.document, [{ type: 'paragraph' }])
    else editor.removeBlocks?.(present)
    await flushDoc(change.pageId)
    return
  }
  await flushDoc(change.pageId)
  const current = (await api.loadDoc(change.pageId)) ?? []
  const next = current.filter((block) => !ids.has(blockId(block)))
  if (next.length === current.length) return
  await api.saveDoc(change.pageId, next as unknown[])
  actions.updatePage(change.pageId, { text: blocksToText(next), bodyText: blocksToText(next) }, false)
}
async function reinsert(change: BodyChange) {
  const editor = editors.get(change.pageId)
  const document = editor ? editor.document : ((await api.loadDoc(change.pageId)) ?? [])
  const ids = new Set(change.blocks.map(blockId))
  if (document.some((block) => ids.has(blockId(block)))) return
  await insertBody({ ...change, replaced: isEmptyPageDocument(document) })
}

/**
 * Remove o tipo; por padrão os valores ficam guardados até `purgeOrphans`. Com `discard`, descarta na hora os
 * valores dos campos que nenhum outro tipo da página usa (desfazível pelo aviso).
 */
export function removeType(pageIds: string[], typeId: string, options: { discard?: boolean } = {}) {
  if (!writable()) return
  const label = options.discard ? tr('Tipo “{name}” removido — valores descartados', 'Type “{name}” removed — values discarded', { name: typeName(typeId) }) : tr('Tipo “{name}” removido — valores guardados', 'Type “{name}” removed — values kept', { name: typeName(typeId) })
  record(label, pageIds, () => {
    for (const id of pageIds) {
      const page = getState().pages[id]
      if (!page || page.locked) continue
      const patch = removeTypePatch(page, typeId)
      if (!patch) continue
      if (options.discard && page.typeProps) {
        const kept = new Set((patch.types ?? []).flatMap((other) => effectiveProperties(objectTypes(), other).map((prop) => prop.id)))
        const drop = new Set(effectiveProperties(objectTypes(), typeId).map((prop) => prop.id).filter((propId) => !kept.has(propId)))
        const typeProps = Object.fromEntries(Object.entries(page.typeProps).filter(([key]) => !drop.has(key)))
        patch.typeProps = Object.keys(typeProps).length ? typeProps : undefined
      }
      actions.updatePage(id, patch)
    }
  })
}

/** Descarta valores guardados de tipos removidos/campos excluídos (confirmação explícita). */
export function purgeOrphans(pageId: string) {
  const page = getState().pages[pageId]
  if (!page || page.locked || !writable()) return
  const patch = purgeOrphansPatch(objectTypes(), page)
  if (patch) record(tr('Valores guardados descartados', 'Kept values discarded'), [pageId], () => actions.updatePage(pageId, patch))
}

/** Tipos que voltariam a exibir os valores guardados desta página. */
export function restorableTypes(page: Page): ObjectType[] {
  const orphans = new Set(orphanTypeValues(objectTypes(), page))
  if (!orphans.size) return []
  return objectTypes().filter((type) => !page.types?.includes(type.id) && effectiveProperties(objectTypes(), type.id).some((prop) => orphans.has(prop.id)))
}

/** Tipo por `#nome` (aceita o nome com ou sem #). */
export function typeByTag(tag: string): ObjectType | undefined { return findTypeByName(objectTypes(), tag) }

// ---------- modelos ----------

type AnyEditor = { document: unknown[]; isEditable?: boolean; replaceBlocks: (a: unknown[], b: unknown[]) => unknown; insertBlocks: (blocks: unknown[], ref: unknown, placement: 'before' | 'after') => unknown; removeBlocks?: (blocks: unknown[]) => unknown; insertInlineContent?: (content: unknown[]) => void; focus?: () => void }
const editors = new Map<string, AnyEditor>()
/** PageView registra o editor montado (inserção de modelo e conversão em texto no lugar). */
export function registerTypeEditor(pageId: string, editor: unknown): () => void {
  editors.set(pageId, editor as AnyEditor)
  return () => { if (editors.get(pageId) === editor) editors.delete(pageId) }
}

/** Insere texto (ex.: uma {{variável}}) no cursor do editor aberto da página. Devolve false se a página não está aberta/editável. */
export function insertTextInPageEditor(pageId: string, value: string): boolean {
  const editor = editors.get(pageId)
  if (!editor?.insertInlineContent || editor.isEditable === false) return false
  editor.focus?.()
  editor.insertInlineContent([{ type: 'text', text: value, styles: {} }])
  return true
}

async function templateBlocks(type: ObjectType): Promise<unknown[]> {
  const source = type.template.sourcePageId
  if (source && getState().pages[source] && !getState().pages[source].trashed) {
    try { await flushDoc(source) } catch { /* usa o último salvo */ }
    const blocks = await api.loadDoc(source)
    if (blocks?.length) return blocks
  }
  return type.template.blocks ?? []
}

async function appendBlocks(pageId: string, blocks: unknown[], replaceIfEmpty = false) {
  const editor = editors.get(pageId)
  const fresh = cloneDocument(blocks, {})
  if (editor && editor.isEditable !== false) {
    const document = editor.document
    if (replaceIfEmpty && isEmptyPageDocument(document)) editor.replaceBlocks(document, fresh)
    else editor.insertBlocks(fresh, (document[document.length - 1] as { id: string }).id, 'after')
    await flushDoc(pageId)
    return
  }
  await flushDoc(pageId)
  const current = (await api.loadDoc(pageId)) ?? []
  const next = replaceIfEmpty && isEmptyPageDocument(current) ? fresh : [...current, ...fresh]
  await api.saveDoc(pageId, next as unknown[])
  actions.updatePage(pageId, { text: blocksToText(next), bodyText: blocksToText(next) }, false)
}

/** Corpo da página está vazio? (editor aberto, senão o documento salvo). */
export async function pageBodyEmpty(pageId: string): Promise<boolean> {
  const editor = editors.get(pageId)
  if (editor) return isEmptyPageDocument(editor.document)
  return isEmptyPageDocument(await api.loadDoc(pageId))
}

/** Insere o modelo do tipo: `ifEmpty` só em corpo vazio; `append` no fim. Devolve se inseriu. */
export async function insertTemplate(pageId: string, typeId: string, mode: 'ifEmpty' | 'append'): Promise<boolean> {
  const type = findType(objectTypes(), typeId)
  const page = getState().pages[pageId]
  if (!type || !page || page.locked || typeDataHidden(page) || !writable()) return false
  const raw = await templateBlocks(type)
  if (!raw.length) return false
  const empty = await pageBodyEmpty(pageId)
  if (mode === 'ifEmpty' && !empty) return false
  const inRow = !!(page.parentId && getState().pages[page.parentId]?.database)
  const prepared = await prepareTemplate(raw, { title: page.title, row: inRow ? page : undefined, heading: type.name })
  if (!prepared) return false
  await appendBlocks(pageId, prepared.blocks as unknown[], empty)
  return true
}

/** Após aplicar: modelo direto se vazio; senão devolve 'ask' para a interface perguntar. */
export async function offerTemplate(pageId: string, typeId: string): Promise<'inserted' | 'ask' | 'none'> {
  const type = findType(objectTypes(), typeId)
  if (!type || (!type.template.blocks?.length && !type.template.sourcePageId)) return 'none'
  if (await insertTemplate(pageId, typeId, 'ifEmpty')) return 'inserted'
  return (await templateBlocks(type)).length ? 'ask' : 'none'
}

export async function setTemplateFromPage(typeId: string, pageId: string) {
  await flushDoc(pageId)
  const blocks = (await api.loadDoc(pageId)) ?? []
  if (JSON.stringify(blocks).length > 2_000_000) throw new Error(tr('Este modelo excede 2 MB.', 'This template exceeds 2 MB.'))
  patchType(typeId, (type) => ({ ...type, template: { ...type.template, blocks: structuredClone(blocks), sourcePageId: undefined } }))
}
export function setTemplateBlocks(typeId: string, blocks: unknown[] | undefined) {
  patchType(typeId, (type) => ({ ...type, template: { ...type.template, blocks, sourcePageId: blocks ? type.template.sourcePageId : undefined } }))
}
/** Abre (ou cria) a página-modelo do tipo, lida ao vivo ao aplicar o modelo. */
export async function editTemplateAsPage(typeId: string): Promise<string | null> {
  const type = findType(objectTypes(), typeId)
  if (!type || !writable()) return null
  const existing = type.template.sourcePageId && getState().pages[type.template.sourcePageId] && !getState().pages[type.template.sourcePageId].trashed ? type.template.sourcePageId : null
  if (existing) { actions.openPage(existing); return existing }
  const id = actions.createPage(null, { title: tr('Modelo: {name}', 'Template: {name}', { name: type.name }), icon: type.icon })
  const blocks = cloneDocument(type.template.blocks ?? [], {})
  await api.saveDoc(id, blocks as unknown[])
  actions.updatePage(id, { text: blocksToText(blocks), bodyText: blocksToText(blocks) }, false)
  patchType(typeId, (current) => ({ ...current, template: { ...current.template, sourcePageId: id } }))
  await actions.flushMeta()
  actions.openPage(id)
  return id
}

// ---------- coleção ----------

/** Cria um objeto (página na raiz) com o tipo, valores e modelo. Usado pelo "+ Novo" da coleção. */
export function createObject(typeId: string, props: Record<string, PropValue> = {}, init: Partial<Page> = {}): string {
  const types = objectTypes()
  const type = findType(types, typeId)
  if (!type) throw new Error(tr('Tipo indisponível.', 'Type unavailable.'))
  const count = typeIndex(getState().pages, types).get(typeId)?.length ?? 0
  const id = actions.createPage(null, { icon: type.icon, ...init })
  const page = getState().pages[id]
  const patch = applyTypePatch(types, page, typeId, { count, locale: locale() }) ?? {}
  const fields = new Set(effectiveProperties(types, typeId).map((prop) => prop.id))
  const typeProps = { ...(patch.typeProps ?? {}), ...Object.fromEntries(Object.entries(props).filter(([key]) => fields.has(key))) }
  actions.updatePage(id, { ...patch, typeProps: Object.keys(typeProps).length ? typeProps : undefined })
  void insertTemplate(id, typeId, 'ifEmpty').catch(actions.reportSaveError)
  return id
}

registerVirtualRows((dbId, props, init) => createObject(typeIdFromSchemaId(dbId)!, props, init))

/** Garante as visões salvas da coleção (criadas sob demanda na primeira abertura). */
/** Filtros, ordem e agrupamento da coleção: um passo desfazível (⌘Z), fundindo ajustes seguidos do mesmo tipo (arrastar largura, digitar valor). */
const COLLECTION_MERGE_MS = 1200
registerTypeSchemaRecorder((typeId, run) => {
  const before = snapshot([])
  run()
  const after = snapshot([])
  if (before.types === after.types) return
  const now = Date.now()
  const last = undoStack[undoStack.length - 1]
  if (last && last.collectionOf === typeId && now - last.at < COLLECTION_MERGE_MS && Object.keys(last.after.pages).length === 0) {
    last.after = after; last.at = now; redoStack.length = 0
    return
  }
  pushHistory({ label: tr('Alterar a coleção', 'Change the collection'), before, after, at: now, collectionOf: typeId })
})

export function ensureCollection(typeId: string) {
  const type = findType(objectTypes(), typeId)
  if (!type || type.collection || !writable()) return
  patchType(typeId, (current) => ({ ...current, collection: defaultCollection(current, { table: tr('Tabela', 'Table') }) }))
}


// ---------- linhas novas de um banco ----------

let suppressNewRowType = false

/** Cria uma linha já com o tipo (campos + modelo do tipo), sem a regra automática do banco. */
export function createRowOfType(dbId: string, typeId: string, props: Record<string, PropValue> = {}): string {
  suppressNewRowType = true
  let id = ''
  try { id = actions.createRow(dbId, props) } finally { suppressNewRowType = false }
  void applyTypeStep(id, typeId, { template: true }).catch(actions.reportSaveError)
  return id
}

/** "Tipo das novas linhas" do banco: um tipo, `null` (nenhum, e não sugerir mais) ou `undefined` (nunca decidido). */
export function setNewRowType(dbId: string, typeId: string | null | undefined) {
  if (!writable() || !getState().pages[dbId]?.database) return
  actions.updateSchema(dbId, (schema) => {
    const next = { ...schema }
    if (typeId === undefined) delete next.newRowTypeId; else next.newRowTypeId = typeId
    return next
  })
}

registerNewRowHook((dbId, rowId) => {
  if (suppressNewRowType || !writable()) return
  const schema = getState().pages[dbId]?.database
  if (!schema || schema.newRowTypeId === null) return
  const types = objectTypes()
  let typeId = schema.newRowTypeId
  let suggested = false
  if (typeId === undefined) {
    const dominant = dominantRowType(getState().pages, types, dbId, new Set([rowId]))
    if (!dominant) return
    typeId = dominant.type.id
    suggested = true
  }
  const type = findType(types, typeId)
  if (!type) return
  if (suggested) setNewRowType(dbId, typeId)
  void applyTypeStep(rowId, typeId, { template: true, toast: false, prompt: false }).then(() => {
    if (!suggested) return
    const mark = undoStack[undoStack.length - 1]
    const revert = (decision: string | null | undefined) => {
      setNewRowType(dbId, decision)
      if (undoStack[undoStack.length - 1] === mark) undoTypes(); else removeType([rowId], typeId!)
    }
    showToast({
      message: tr('Novas linhas deste banco usarão o tipo {name}', 'New rows in this database will use the {name} type', { name: type.name }),
      actionLabel: tr('Desfazer', 'Undo'), onAction: () => revert(undefined),
      secondaryLabel: tr('Não usar', 'Don’t use'), onSecondary: () => revert(null), duration: 8000,
    })
  }).catch(actions.reportSaveError)
})

export { pageTypeFields }
