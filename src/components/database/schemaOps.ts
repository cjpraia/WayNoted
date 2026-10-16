// Operações de esquema dos bancos de dados (propriedades, opções, conversão de tipo),
// incluindo a limpeza dos valores das linhas e das referências nas visualizações.
import { looseNumberValue } from '../../input/liberal.ts'
import { actions, getState } from '../../store.ts'
import { findType, schemaFromType, typeIdFromSchemaId } from '../../objecttypes/model.ts'
import type { DatabaseSchema, OptionColor, Page, Property, PropType, PropValue, SelectOption, View } from '../../types'
import { filterOpsFor, findOption, formatDateValue, hasOptions, isDateValue, randomColor, PROP_TYPE_LABELS } from './lib.ts'
import { isComputedProperty, isFileArray, isStringArray } from './derived.ts'
import { removeFilterRule } from './filterTree.ts'
import { isRichTextValue, richTextPlain } from './richText.ts'
import { resolveLinkedRoot } from './linkedSource.ts'
import { isGroupableType } from './grouping.ts'

const uid = () => crypto.randomUUID()

/** Todas as linhas do banco, inclusive as que estão na lixeira (para manter os valores consistentes). */
function allRows(dbId: string): Page[] {
  // Visão vinculada: as linhas (e as propriedades) são da fonte.
  const rootId = rowsOwner(dbId)
  return Object.values(getState().pages).filter((p) => p.parentId === rootId)
}

/** Banco que guarda linhas e propriedades: a fonte, para uma visualização vinculada. */
function rowsOwner(dbId: string): string {
  const pages = getState().pages
  return pages[dbId]?.database?.linkedSourceId ? resolveLinkedRoot(pages, dbId) : dbId
}

/** Bloqueado aqui ou na fonte (visão vinculada): nada de escrever no esquema nem nas linhas. */
function schemaLockedFor(dbId: string): boolean {
  const pages = getState().pages
  return !!pages[dbId]?.locked || !!pages[rowsOwner(dbId)]?.locked
}

function getProp(dbId: string, propId: string): Property | undefined {
  return (getState().pages[rowsOwner(dbId)]?.database ?? virtualSchema(dbId))?.properties.find((p) => p.id === propId)
}

/** Esquemas virtuais (coleções de tipos de objeto `np-type:…`) não são páginas (src/objecttypes). */
function virtualSchema(dbId: string): DatabaseSchema | undefined {
  const typeId = typeIdFromSchemaId(dbId)
  const types = getState().settings?.objectTypes ?? []
  const type = typeId ? findType(types, typeId) : undefined
  return type ? schemaFromType(types, type) : undefined
}

/** Altera os `props` de várias linhas; `fn` devolve o novo valor ou `undefined` para não mexer. */
function mapRowValues(dbId: string, propId: string, fn: (v: PropValue, row: Page) => PropValue | undefined | typeof REMOVE) {
  if (schemaLockedFor(dbId)) return
  for (const row of allRows(dbId)) {
    const cur = row.props?.[propId] ?? null
    const next = fn(cur, row)
    if (next === undefined) continue
    if (next === REMOVE) {
      if (!row.props || !(propId in row.props)) continue
      const { [propId]: _gone, ...rest } = row.props
      actions.updatePage(row.id, { props: rest }, false)
    } else if (next !== cur) {
      actions.updatePage(row.id, { props: { ...row.props, [propId]: next } }, false)
    }
  }
}
const REMOVE = Symbol('remove')

function cleanViewsFor(schema: DatabaseSchema, prop: Property | null, propId: string): View[] {
  return schema.views.map((v) => {
    const out: View = { ...v }
    if (!prop) {
      out.filters = v.filters.filter((f) => f.propertyId !== propId)
      out.filterTree = v.filters.filter((f) => f.propertyId === propId).reduce((tree, filter) => removeFilterRule(tree, filter.id), v.filterTree)
      out.sorts = v.sorts.filter((s) => s.propertyId !== propId)
      out.hidden = v.hidden.filter((h) => h !== propId)
      if (v.wrappedColumns) out.wrappedColumns = v.wrappedColumns.filter(id => id !== propId)
      if (propId in v.widths) {
        const { [propId]: _w, ...widths } = v.widths
        out.widths = widths
      }
      if (v.colorRules) out.colorRules = v.colorRules.filter((rule) => rule.propertyId !== propId)
      if (v.subgroupBy === propId) out.subgroupBy = undefined
    } else {
      const ops = filterOpsFor(prop.type)
      out.filters = v.filters.filter((f) => f.propertyId !== propId || ops.includes(f.op))
      out.filters = out.filters.map((f) => (f.propertyId === propId ? { ...f, value: null } : f))
    }
    if (v.groupBy === propId && (!prop || !isGroupableType(prop.type))) {
      // Outra propriedade só assume o agrupamento no quadro; nas demais visualizações o agrupamento é desligado.
      out.groupBy = v.type === 'board' ? schema.properties.find((p) => p.id !== propId && (p.type === 'select' || p.type === 'status'))?.id : undefined
    }
    if (v.dateProp === propId && (!prop || prop.type !== 'date')) {
      out.dateProp = schema.properties.find((p) => p.id !== propId && p.type === 'date')?.id
    }
    if (v.chartGroupBy === propId && !prop) out.chartGroupBy = undefined
    if (v.chartValueId === propId && !prop) out.chartValueId = undefined
    if (v.tableCalculations && !prop) {
      const { [propId]: _calculation, ...rest } = v.tableCalculations
      out.tableCalculations = rest
    }
    return out
  })
}

// ---------- Propriedades ----------

export function defaultPropName(schema: DatabaseSchema, type: PropType): string {
  const base = PROP_TYPE_LABELS[type]
  const names = new Set(schema.properties.map((p) => p.name))
  if (!names.has(base)) return base
  let i = 2
  while (names.has(`${base} ${i}`)) i++
  return `${base} ${i}`
}

/** Cria uma propriedade (após `afterId`, ou no fim) e devolve o id. */
export function addProperty(dbId: string, type: PropType, afterId?: string): string {
  const id = uid()
  actions.updateSchema(dbId, (s) => {
    const prop: Property = { id, name: defaultPropName(s, type), type, ...(hasOptions(type) ? { options: type === 'status' ? defaultStatusOptions() : [] } : {}), ...(type === 'formula' ? { formula: '' } : {}) }
    const props = [...s.properties]
    const at = afterId ? props.findIndex((p) => p.id === afterId) + 1 : props.length
    props.splice(at > 0 ? at : props.length, 0, prop)
    const views = s.views.map((v) => {
      if (type === 'date' && !v.dateProp) return { ...v, dateProp: id }
      // Só o quadro precisa de uma propriedade de agrupamento; tabela/lista/galeria só agrupam se o usuário pedir.
      if ((type === 'select' || type === 'status') && !v.groupBy && v.type === 'board') return { ...v, groupBy: id }
      return v
    })
    return { ...s, properties: props, views }
  })
  return id
}

function defaultStatusOptions(): SelectOption[] {
  return [
    { id: uid(), name: 'Não iniciado', color: 'gray', group: 'todo' },
    { id: uid(), name: 'Em andamento', color: 'blue', group: 'progress' },
    { id: uid(), name: 'Concluído', color: 'green', group: 'complete' },
  ]
}

export function renameProperty(dbId: string, propId: string, name: string) {
  actions.updateSchema(dbId, (s) => ({ ...s, properties: s.properties.map((p) => (p.id === propId ? { ...p, name } : p)) }))
}

export function deleteProperty(dbId: string, propId: string) {
  return actions.trackDbUndo('Excluir propriedade', dbId, () => deletePropertyNow(dbId, propId))
}

function deletePropertyNow(dbId: string, propId: string) {
  const prop = getProp(dbId, propId)
  if (!prop || prop.type === 'title') return
  actions.updateSchema(dbId, (s) => {
    const next = { ...s, properties: s.properties.filter((p) => p.id !== propId).map((p) => p.rollup?.relationPropertyId === propId || p.rollup?.targetPropertyId === propId ? { ...p, rollup: undefined } : p) }
    return { ...next, views: cleanViewsFor(next, null, propId) }
  })
  mapRowValues(dbId, propId, () => REMOVE)
}

export function duplicateProperty(dbId: string, propId: string): string | null {
  return actions.trackDbUndo('Duplicar propriedade', dbId, () => duplicatePropertyNow(dbId, propId))
}

function duplicatePropertyNow(dbId: string, propId: string): string | null {
  if (schemaLockedFor(dbId)) return null
  const prop = getProp(dbId, propId)
  if (!prop || prop.type === 'title') return null
  const id = uid()
  // As opções ganham novos ids; os valores das linhas são copiados com o mapeamento.
  const map = new Map<string, string>()
  const options = prop.options?.map((o) => {
    const nid = uid()
    map.set(o.id, nid)
    return { ...o, id: nid }
  })
  actions.updateSchema(dbId, (s) => {
    const props = [...s.properties]
    const at = props.findIndex((p) => p.id === propId) + 1
    const names = new Set(s.properties.map((p) => p.name))
    let name = `${prop.name} (1)`
    for (let i = 2; names.has(name); i++) name = `${prop.name} (${i})`
    props.splice(at, 0, { ...prop, id, name, ...(options ? { options } : {}) })
    return { ...s, properties: props }
  })
  for (const row of allRows(dbId)) {
    if (isComputedProperty(prop)) continue
    const v = row.props?.[propId]
    if (v === undefined || v === null) continue
    let copy: PropValue = v
    if (isStringArray(v)) copy = v.map((x) => map.get(x) ?? x)
    else if (isFileArray(v)) copy = structuredClone(v)
    else if (typeof v === 'string' && map.has(v)) copy = map.get(v)!
    else if (isDateValue(v)) copy = { ...v }
    actions.updatePage(row.id, { props: { ...row.props, [id]: copy } }, false)
  }
  return id
}

/** Move a propriedade `propId` para antes/depois de `targetId` na ordem das colunas. */
export function moveProperty(dbId: string, propId: string, targetId: string, after: boolean) {
  if (propId === targetId) return
  actions.updateSchema(dbId, (s) => {
    const props = s.properties.filter((p) => p.id !== propId)
    const moving = s.properties.find((p) => p.id === propId)
    if (!moving) return s
    const at = props.findIndex((p) => p.id === targetId)
    if (at < 0) return s
    props.splice(after ? at + 1 : at, 0, moving)
    return { ...s, properties: props }
  })
}

// ---------- Conversão de tipo ----------

function parseNumber(text: string): number | null { return looseNumberValue(text) }
export { parseNumber }

function asText(v: PropValue, prop: Property): string | null {
  if (v === null || v === '') return null
  if (typeof v === 'string') {
    if (prop.type === 'select' || prop.type === 'status') return findOption(prop, v)?.name ?? null
    return v
  }
  if (typeof v === 'number') return String(v).replace('.', ',')
  if (isStringArray(v)) return v.map((id) => findOption(prop, id)?.name).filter(Boolean).join(', ') || null
  if (isFileArray(v)) return v.map((file) => file.name).join(', ') || null
  if (isDateValue(v)) return formatDateValue(v, prop)
  if (isRichTextValue(v)) return richTextPlain(v)
  return null
}

/** Converte a propriedade para `type`, preservando os valores que fizerem sentido. */
export function convertProperty(dbId: string, propId: string, type: PropType) {
  return actions.trackDbUndo('Converter propriedade', dbId, () => convertPropertyNow(dbId, propId, type))
}

function convertPropertyNow(dbId: string, propId: string, type: PropType) {
  if (schemaLockedFor(dbId)) return
  const prop = getProp(dbId, propId)
  if (!prop || prop.type === 'title' || type === 'title' || prop.type === type) return
  const from = prop.type
  const rows = allRows(dbId)
  if (isComputedProperty(prop) || ['createdTime', 'updatedTime', 'formula', 'rollup', 'relation'].includes(type)) mapRowValues(dbId, propId, () => REMOVE)
  let options: SelectOption[] | undefined = prop.options ? [...prop.options] : undefined
  const fromOptions = hasOptions(from)
  const toOptions = hasOptions(type)

  // Texto → opções: cria uma opção por valor distinto (multi: separa por vírgula).
  if (['createdTime', 'updatedTime', 'formula', 'rollup', 'relation'].includes(type)) {
    options = undefined
  } else if (toOptions && !fromOptions) {
    options = []
    const used: OptionColor[] = []
    const byName = new Map<string, string>()
    for (const row of rows) {
      const text = asText(row.props?.[propId] ?? null, prop)
      if (!text) continue
      const parts = type === 'multiSelect' ? text.split(',').map((x) => x.trim()).filter(Boolean) : [text.trim()]
      for (const name of parts) {
        if (byName.has(name)) continue
        const color = randomColor(used)
        used.push(color)
        const o = { id: uid(), name, color }
        byName.set(name, o.id)
        options.push(o)
      }
    }
    mapRowValues(dbId, propId, (v) => {
      const text = asText(v, prop)
      if (!text) return null
      if (type === 'multiSelect') return text.split(',').map((x) => byName.get(x.trim())).filter((x): x is string => !!x)
      return byName.get(text.trim()) ?? null
    })
  } else if (toOptions && fromOptions) {
    if (type === 'status' && !options?.length) options = defaultStatusOptions()
    mapRowValues(dbId, propId, (v) => {
      if (type === 'multiSelect') return typeof v === 'string' ? [v] : isStringArray(v) ? v : null
      return isStringArray(v) ? (v[0] ?? null) : typeof v === 'string' ? v : null
    })
  } else {
    mapRowValues(dbId, propId, (v) => {
      if (v === null) return undefined
      switch (type) {
        case 'text':
        case 'url':
        case 'email':
        case 'phone':
          return asText(v, prop)
        case 'number':
          return typeof v === 'number' ? v : typeof v === 'string' && !fromOptions ? parseNumber(v) : null
        case 'checkbox':
          if (typeof v === 'boolean') return v
          if (typeof v === 'string') return ['sim', 'true', 'x', '1', 'yes'].includes(v.trim().toLowerCase()) ? true : null
          return null
        case 'date':
          if (isDateValue(v)) return v
          if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return { start: v.trim() }
          return null
        default:
          return null
      }
    })
    if (!toOptions) options = undefined
  }

  actions.updateSchema(dbId, (s) => {
    const nextProp: Property = { id: prop.id, name: prop.name, type, ...(toOptions ? { options: options ?? [] } : {}), ...(type === 'formula' ? { formula: '' } : {}) }
    const next = { ...s, properties: s.properties.map((p) => (p.id === propId ? nextProp : p)) }
    return { ...next, views: cleanViewsFor(next, nextProp, propId) }
  })
}

// ---------- Opções ----------

export function createOption(dbId: string, propId: string, name: string, group: NonNullable<SelectOption['group']> = 'todo'): SelectOption | null {
  if (schemaLockedFor(dbId)) return null
  const prop = getProp(dbId, propId)
  if (!prop) return null
  const option: SelectOption = { id: uid(), name: name.trim(), color: randomColor((prop.options ?? []).map((o) => o.color)), ...(prop.type === 'status' ? { group } : {}) }
  actions.updateSchema(dbId, (s) => ({
    ...s,
    properties: s.properties.map((p) => (p.id === propId ? { ...p, options: [...(p.options ?? []), option] } : p)),
  }))
  return option
}

export function updateOption(dbId: string, propId: string, optionId: string, patch: Partial<SelectOption>) {
  actions.updateSchema(dbId, (s) => ({
    ...s,
    properties: s.properties.map((p) =>
      p.id === propId ? { ...p, options: (p.options ?? []).map((o) => (o.id === optionId ? { ...o, ...patch } : o)) } : p,
    ),
  }))
}

export function deleteOption(dbId: string, propId: string, optionId: string) {
  return actions.trackDbUndo('Excluir opção', dbId, () => deleteOptionNow(dbId, propId, optionId))
}

function deleteOptionNow(dbId: string, propId: string, optionId: string) {
  actions.updateSchema(dbId, (s) => ({
    ...s,
    properties: s.properties.map((p) => (p.id === propId ? { ...p, options: (p.options ?? []).filter((o) => o.id !== optionId) } : p)),
    views: s.views.map((v) => ({ ...v, filters: v.filters.map((f) => (f.propertyId === propId && f.value === optionId ? { ...f, value: null } : f)) })),
  }))
  mapRowValues(dbId, propId, (v) => {
    if (isStringArray(v)) return v.includes(optionId) ? v.filter((x) => x !== optionId) : undefined
    return v === optionId ? null : undefined
  })
}

export function moveOption(dbId: string, propId: string, optionId: string, targetId: string, after: boolean) {
  if (optionId === targetId) return
  actions.updateSchema(dbId, (s) => ({
    ...s,
    properties: s.properties.map((p) => {
      if (p.id !== propId || !p.options) return p
      const moving = p.options.find((o) => o.id === optionId)
      if (!moving) return p
      const opts = p.options.filter((o) => o.id !== optionId)
      const at = opts.findIndex((o) => o.id === targetId)
      opts.splice(after ? at + 1 : at, 0, moving)
      return { ...p, options: opts }
    }),
  }))
}
