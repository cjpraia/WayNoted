// Coleção de um tipo: "banco virtual" `np-type:<id>` sobre as páginas com o tipo (sem movê-las).
// Esquema = título + campos efetivos; visões salvas no próprio tipo; linhas = cópias estáveis das
// páginas com `props = typeProps`, no formato que TableView/BoardView/GalleryView/ListView entendem.
import type { DatabaseSchema, Page, View, ViewType } from '../types'
import { isEmptyValue, pagesWithType, schemaFromType, typeDataHidden, typeSchemaId, type ObjectType, type TypeList } from './model.ts'

export interface TypeCollection {
  db: Page
  schema: DatabaseSchema
  view: View
  rows: Page[]
  /** Páginas trancadas por senha omitidas (título oculto) ou exibidas sem campos. */
  hiddenCount: number
}

const projections = new WeakMap<Page, { key: string; row: Page }>()

/** Linha projetada: mesma identidade enquanto a página e o conjunto de campos não mudam. */
export function projectRow(page: Page, key: string, parentSchema?: DatabaseSchema): Page {
  // Campo incorporado de um banco (mesmo id): enquanto a linha está no banco `props` manda; fora dele vale `typeProps`
  // (e `props` só preenche o que ainda não tem chave própria). A chave de cache inclui os campos que o banco cobre.
  const inDb = parentSchema ? key.split(',').filter((id) => parentSchema.properties.some((prop) => prop.id === id)).join(',') : ''
  const cacheKey = inDb ? `${key}|${inDb}` : key
  const cached = projections.get(page)
  if (cached && cached.key === cacheKey) return cached.row
  // Protegida e trancada: nenhum valor de campo; o título segue a regra de `hideTitle`.
  const props = typeDataHidden(page) ? {} : { ...(page.typeProps ?? {}) }
  if (page.props && !typeDataHidden(page)) for (const id of key.split(',')) {
    if (!(id in page.props)) continue
    if (inDb && inDb.split(',').includes(id) ? !isEmptyValue(page.props[id]) : !(id in props) && !isEmptyValue(page.props[id])) props[id] = page.props[id]
  }
  const row: Page = { ...page, props, database: undefined, locked: page.locked || typeDataHidden(page) }
  projections.set(page, { key: cacheKey, row })
  return row
}

export function buildTypeCollection(pages: Record<string, Page>, types: TypeList, type: ObjectType, labels: { title: string }): TypeCollection {
  const schema = schemaFromType(types, type, labels.title)
  const view = schema.views.find((candidate) => candidate.id === schema.activeViewId) ?? schema.views[0]
  const key = schema.properties.map((prop) => prop.id).join(',')
  let hiddenCount = 0
  const rows: Page[] = []
  for (const page of pagesWithType(pages, types, type.id)) {
    if (page.passwordLock && !page.passwordLock.unlocked && page.passwordLock.hideTitle) { hiddenCount++; continue }
    rows.push(projectRow(page, key, page.parentId ? pages[page.parentId]?.database : undefined))
  }
  const db: Page = { id: typeSchemaId(type.id), parentId: null, title: type.name, icon: type.icon, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: type.createdAt, updatedAt: type.updatedAt, order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, text: '', database: schema }
  return { db, schema, view, rows, hiddenCount }
}

/** Visões oferecidas pela coleção do tipo: Calendário e Linha do tempo só quando o tipo tem um campo de data (nada de aba que não funciona). */
export function collectionLayouts(schema: Pick<DatabaseSchema, 'properties'>): ViewType[] {
  const base: ViewType[] = ['table', 'board', 'gallery', 'list']
  return schema.properties.some((prop) => prop.type === 'date') ? [...base, 'calendar', 'timeline'] : base
}
