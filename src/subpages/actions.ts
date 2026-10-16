import PRODUCT from '../../shared/product.json' with { type: 'json' }
// Subpáginas ↔ bancos de dados (docs/USAGE.md): transformar subpáginas em linhas de uma tabela
// embutida, transformar a própria página em banco (e voltar), criar um banco com páginas selecionadas e mover
// páginas para dentro/fora de bancos mapeando propriedades. Cada operação é uma transação com ⌘Z.
import { actions, api, getState, selectors } from '../store.ts'
import { t, getLocale } from '../i18n.ts'
import type { DatabaseSchema, Page, View } from '../types.ts'
import { findType } from '../objecttypes/model.ts'
import { lockedAncestor, protectedAncestor } from '../security/pageLock.ts'
import { isEmptyPageDocument } from '../components/page/emptyPage.ts'
import { classify, mapRowIntoSchema, mappingPatch, planSchema, pluralName, rowOutOfDatabase, tableSchema, type ExcludedPage } from './plan.ts'

const types = () => getState().settings.objectTypes ?? []
const uid = () => globalThis.crypto.randomUUID()
const tableView = (): View => ({ id: uid(), name: t('Tabela', 'Table'), type: 'table', filters: [], sorts: [], hidden: [], widths: {} })
const fail = (pt: string, en: string): never => { throw new Error(t(pt, en)) }

export interface ConversionPreview {
  /** Páginas que virarão linhas. */
  eligible: string[]
  excluded: ExcludedPage[]
  typeId: string | null
  typeName: string
  typeCount: number
  /** Propriedades de outras origens (valores já preenchidos) que entram no banco. */
  carried: string[]
  /** Páginas que já aparecem no corpo (citadas por bloco, link ou menção). */
  citedInBody: number
}

export function describeExclusion(reason: ExcludedPage['reason']): string {
  return reason === 'protected' ? t('protegida por senha', 'password protected')
    : reason === 'locked' ? t('bloqueada', 'locked')
    : reason === 'database' ? t('é um banco de dados', 'is a database')
    : reason === 'canvas' ? t('é uma lousa', 'is a whiteboard')
    : t('indisponível', 'unavailable')
}

function previewFor(ids: string[], cited: ReadonlySet<string> = new Set()): ConversionPreview {
  const { pages } = getState()
  const { eligible, excluded } = classify(pages, ids)
  const plan = planSchema(eligible, types(), pages, { title: t('Nome', 'Name'), tags: 'Tags' })
  return { eligible: eligible.map((p) => p.id), excluded, typeId: plan.typeId, typeName: findType(types(), plan.typeId)?.name ?? '', typeCount: plan.typeCount, carried: plan.carried, citedInBody: eligible.filter((p) => cited.has(p.id)).length }
}

/** Páginas-filhas vivas (na ordem da árvore) que podem virar linhas; `null` se a página não aceita a conversão. */
export function subpageConversionBlocker(parentId: string): string | null {
  const { pages } = getState()
  const page = pages[parentId]
  if (!page || !selectors.isLive(parentId)) return t('Esta página não está disponível.', 'This page is unavailable.')
  if (page.database) return t('Um banco de dados já tem linhas.', 'A database already has rows.')
  if (page.canvas) return t('Lousas não têm subpáginas no corpo.', 'Whiteboards do not hold subpages.')
  if (page.locked) return t('Desbloqueie a página para transformar suas subpáginas.', 'Unlock the page to transform its subpages.')
  if (lockedAncestor(pages, parentId)) return t('Desbloqueie a página protegida primeiro.', 'Unlock the protected page first.')
  if (protectedAncestor(pages, parentId)) return t('Páginas protegidas por senha não podem receber um banco novo. Remova a proteção primeiro.', 'Password-protected pages cannot receive a new database. Remove the protection first.')
  return null
}

export function previewSubpages(parentId: string): ConversionPreview {
  const page = getState().pages[parentId]
  const cited = new Set(page?.bodyOutboundPageIds ?? page?.outboundPageIds ?? [])
  return previewFor(selectors.children(parentId).map((p) => p.id), cited)
}

/** Subpáginas que ainda podem virar linhas (para mostrar ou esconder a ação). */
export function convertibleSubpageCount(parentId: string): number {
  if (subpageConversionBlocker(parentId)) return 0
  return previewSubpages(parentId).eligible.length
}

function bodyBlock(dbId: string, id = uid()) { return { id, type: 'page', props: { pageId: dbId, ownership: 'owned', display: 'inline' }, children: [] as unknown[] } }

async function editBody(ownerId: string, edit: (blocks: unknown[]) => unknown[]) {
  await actions.flushAll()
  const current = await api.loadDoc(ownerId) ?? []
  const next = edit(current)
  if (JSON.stringify(next) === JSON.stringify(current)) return
  await api.saveDoc(ownerId, next, { checkpoint: true })
  await actions.reloadDocument(ownerId)
  await actions.flushMeta()
}
const withoutDatabaseBlock = (dbId: string) => function strip(blocks: unknown[]): unknown[] {
  return blocks.filter((b) => !(b && typeof b === 'object' && (b as { type?: string }).type === 'page' && (b as { props?: { pageId?: string } }).props?.pageId === dbId))
    .map((b) => b && typeof b === 'object' && Array.isArray((b as { children?: unknown[] }).children) ? { ...(b as object), children: strip((b as { children: unknown[] }).children) } : b)
}

function applySchemaProps(dbId: string, properties: DatabaseSchema['properties']) {
  const db = getState().pages[dbId]
  if (db?.database) actions.updatePage(dbId, { database: { ...db.database, properties } }, false)
}

export interface ConversionResult { dbId: string; moved: number; excluded: ExcludedPage[]; typeName: string }

/** Subpáginas → linhas de uma tabela embutida no corpo da própria página (mesmos ids e conteúdo). */
export async function convertSubpagesToDatabase(parentId: string): Promise<ConversionResult> {
  const blocker = subpageConversionBlocker(parentId)
  if (blocker) throw new Error(blocker)
  const preview = previewSubpages(parentId)
  if (!preview.eligible.length) fail('Não há subpáginas que possam virar linhas.', 'No subpages can become rows.')
  const { pages } = getState()
  const rows = preview.eligible.map((id) => pages[id])
  const plan = planSchema(rows, types(), pages, { title: t('Nome', 'Name'), tags: 'Tags' })
  const type = findType(types(), plan.typeId)
  const title = type ? pluralName(type.name, getLocale()) : t('Subpáginas', 'Subpages')
  const blockId = uid()
  let dbId = ''
  const append = () => actions.appendPageBlocks(parentId, [bodyBlock(dbId, blockId)]).catch(actions.reportSaveError)
  actions.transact(t('Transformar subpáginas em banco de dados', 'Turn subpages into a database'), [parentId, ...preview.eligible], () => {
    dbId = actions.createDatabase(parentId, 'table', { title, blockOwnerId: parentId, ...(type?.icon ? { icon: type.icon } : {}) })
    applySchemaProps(dbId, plan.properties)
    const patches = Object.fromEntries(rows.map((row) => [row.id, mappingPatch(row, mapRowIntoSchema(row, plan.properties, types()))]))
    actions.reparentPages(preview.eligible, dbId, patches)
  }, {
    created: () => [dbId],
    undo: () => { void editBody(parentId, withoutDatabaseBlock(dbId)).catch(actions.reportSaveError) },
    redo: () => { void append() },
  })
  try { await actions.appendPageBlocks(parentId, [bodyBlock(dbId, blockId)]) }
  catch (error) { actions.undoDatabase(); throw error }
  return { dbId, moved: preview.eligible.length, excluded: preview.excluded, typeName: type?.name ?? '' }
}

/** Páginas selecionadas na barra lateral → banco novo no lugar da primeira. */
export function selectionConversionBlocker(ids: string[]): string | null {
  const { pages } = getState()
  const list = ids.map((id) => pages[id]).filter((p): p is Page => !!p)
  if (!list.length) return t('Selecione ao menos uma página.', 'Select at least one page.')
  if (new Set(list.map((p) => p.parentId)).size > 1) return t('Selecione páginas do mesmo nível: elas precisam estar dentro da mesma página.', 'Select pages on the same level: they must share the same parent page.')
  const parent = list[0].parentId ? pages[list[0].parentId] : null
  if (parent?.database) return t('Estas páginas já são linhas de um banco de dados.', 'These pages are already rows of a database.')
  if (list[0].parentId && (lockedAncestor(pages, list[0].parentId) || protectedAncestor(pages, list[0].parentId))) return t('Páginas dentro de uma página protegida por senha não podem virar um banco novo.', 'Pages inside a password-protected page cannot become a new database.')
  if (parent?.locked) return t('A página que contém estas páginas está bloqueada.', 'The page that holds these pages is locked.')
  return null
}

export function previewSelection(ids: string[]): ConversionPreview { return previewFor(orderedSiblings(ids)) }

function orderedSiblings(ids: string[]): string[] {
  const { pages } = getState()
  return ids.map((id) => pages[id]).filter((p): p is Page => !!p).sort((a, b) => a.order - b.order).map((p) => p.id)
}

export function createDatabaseFromPages(ids: string[]): ConversionResult {
  const blocker = selectionConversionBlocker(ids)
  if (blocker) throw new Error(blocker)
  const preview = previewSelection(ids)
  if (!preview.eligible.length) fail('Nenhuma das páginas selecionadas pode virar linha.', 'None of the selected pages can become a row.')
  const { pages } = getState()
  const rows = preview.eligible.map((id) => pages[id])
  const first = rows[0], parentId = first.parentId
  const plan = planSchema(rows, types(), pages, { title: t('Nome', 'Name'), tags: 'Tags' })
  const type = findType(types(), plan.typeId)
  const title = type ? pluralName(type.name, getLocale()) : t('Novo banco de dados', 'New database')
  const before = selectors.children(parentId).filter((p) => !preview.eligible.includes(p.id) && p.order < first.order).length
  let dbId = ''
  actions.transact(t('Criar banco de dados com as páginas', 'Create database from pages'), [...(parentId ? [parentId] : []), ...preview.eligible], () => {
    dbId = actions.createDatabase(parentId, 'table', { title, ...(type?.icon ? { icon: type.icon } : {}) })
    applySchemaProps(dbId, plan.properties)
    const patches = Object.fromEntries(rows.map((row) => [row.id, mappingPatch(row, mapRowIntoSchema(row, plan.properties, types()))]))
    actions.reparentPages(preview.eligible, dbId, patches)
    actions.reparentPages([dbId], parentId, {}, before)
  }, { created: () => [dbId] })
  return { dbId, moved: preview.eligible.length, excluded: preview.excluded, typeName: type?.name ?? '' }
}

/** Bancos que podem receber páginas como linhas (não vinculados, não bloqueados, fora da própria seleção). */
export function databaseTargets(excludeIds: string[], query = ''): Page[] {
  const { pages } = getState()
  const q = query.trim().toLocaleLowerCase()
  const blocked = new Set(excludeIds)
  return Object.values(pages).filter((p) => {
    if (!p.database || p.trashed || p.locked || p.database.linkedSourceId || p.database.sourceDatabaseIds?.length) return false
    if (!selectors.isLive(p.id) || lockedAncestor(pages, p.id) || blocked.has(p.id)) return false
    if (excludeIds.some((id) => selectors.ancestors(p.id).some((a) => a.id === id))) return false
    return !q || p.title.toLocaleLowerCase().includes(q)
  }).sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
}

export interface MoveResult { moved: number; excluded: ExcludedPage[]; into: 'database' | 'plain' | 'out'; hidden: number; databaseTitle: string }

/**
 * Move páginas para um novo pai respeitando bancos: ao entrar num banco copia os valores para as propriedades
 * de mesmo nome/tipo; ao sair, devolve os campos do tipo e avisa quantos valores ficam guardados.
 */
export function movePagesTo(ids: string[], parentId: string | null, index?: number): MoveResult {
  const { pages } = getState()
  const dest = parentId ? pages[parentId] : undefined
  const destSchema = dest?.database && !dest.database.linkedSourceId ? dest.database : undefined
  const sourceDb = (id: string) => selectors.parentDatabase(id)
  const sameDb = (id: string) => !!parentId && pages[id]?.parentId === parentId
  const leaving = ids.filter((id) => sourceDb(id) && !sameDb(id) && !destSchema)
  if (!destSchema && !leaving.length) {
    ids.forEach((id, i) => actions.movePage(id, parentId, index === undefined ? undefined : index + i))
    return { moved: ids.length, excluded: [], into: 'plain', hidden: 0, databaseTitle: '' }
  }
  const { eligible, excluded } = destSchema ? classify(pages, ids.filter((id) => !sameDb(id))) : { eligible: ids.map((id) => pages[id]).filter((p): p is Page => !!p), excluded: [] }
  const rows = destSchema ? [...eligible, ...ids.filter(sameDb).map((id) => pages[id])] : eligible
  const patches: Record<string, Partial<Page>> = {}
  let hidden = 0
  for (const row of rows) {
    if (destSchema && !sameDb(row.id)) patches[row.id] = mappingPatch(row, mapRowIntoSchema(row, destSchema.properties, types(), sourceDb(row.id)?.database?.properties))
    else if (!destSchema && sourceDb(row.id)) { const out = rowOutOfDatabase(row, sourceDb(row.id)!.database!.properties, types()); patches[row.id] = out.patch; hidden += out.hidden }
  }
  const tracked = [...rows.map((r) => r.id), ...(parentId ? [parentId] : [])]
  let moved: string[] = []
  actions.transact(destSchema ? t('Adicionar como linha de banco', 'Add as database row') : t('Mover para fora do banco', 'Move out of database'), tracked, () => {
    moved = actions.reparentPages(rows.map((r) => r.id), parentId, patches, index)
  })
  return { moved: moved.length, excluded, into: destSchema ? 'database' : 'out', hidden, databaseTitle: dest?.title ?? '' }
}

/** Mover para banco: igual a `movePagesTo(ids, dbId)`, resolvendo visualizações vinculadas para o banco de origem. */
export function movePagesToDatabase(ids: string[], dbId: string): MoveResult {
  const db = getState().pages[dbId]
  if (!db?.database) fail('Este banco de dados não está disponível.', 'This database is unavailable.')
  if (db!.locked) fail('O banco de dados está bloqueado.', 'The database is locked.')
  const targetId = db!.database!.linkedSourceId ?? dbId
  return movePagesTo(ids, targetId)
}

// ---------------------------------------------------------------- página ↔ banco

export function pageConversionBlocker(pageId: string): string | null {
  const { pages } = getState()
  const page = pages[pageId]
  if (!page || !selectors.isLive(pageId)) return t('Esta página não está disponível.', 'This page is unavailable.')
  if (page.database) return t('Esta página já é um banco de dados.', 'This page is already a database.')
  if (page.canvas) return t('Lousas não podem virar banco de dados.', 'Whiteboards cannot become databases.')
  if (page.locked) return t('Desbloqueie a página antes de transformá-la em banco de dados.', 'Unlock the page before turning it into a database.')
  if (lockedAncestor(pages, pageId)) return t('Desbloqueie a página protegida primeiro.', 'Unlock the protected page first.')
  const parent = page.parentId ? pages[page.parentId] : null
  if (parent?.database) return t('Linhas de um banco não viram bancos; use um banco embutido no corpo.', 'Rows cannot become databases; use a database embedded in the body.')
  return null
}

export function previewPage(pageId: string): ConversionPreview { return previewFor(selectors.children(pageId).map((p) => p.id)) }

/** A própria página vira um banco; o corpo permanece acima da tabela, como descrição, e as subpáginas viram linhas. */
export async function convertPageToDatabase(pageId: string): Promise<{ moved: number; excluded: ExcludedPage[] }> {
  const blocker = pageConversionBlocker(pageId)
  if (blocker) throw new Error(blocker)
  const { pages } = getState()
  const preview = previewPage(pageId)
  const rows = preview.eligible.map((id) => pages[id])
  const plan = planSchema(rows, types(), pages, { title: t('Nome', 'Name'), tags: 'Tags' })
  const doc = await api.loadDoc(pageId)
  const bodyDescription = !isEmptyPageDocument(doc)
  const schema = tableSchema(plan.properties, tableView(), bodyDescription ? { bodyDescription: true } : {})
  actions.transact(t('Transformar página em banco de dados', 'Turn page into a database'), [pageId, ...preview.eligible], () => {
    actions.patchPages(Object.fromEntries(rows.map((row) => [row.id, mappingPatch(row, mapRowIntoSchema(row, plan.properties, types()))])))
    actions.updatePage(pageId, { database: schema })
  })
  return { moved: rows.length, excluded: preview.excluded }
}

export function databaseConversionBlocker(dbId: string): string | null {
  const { pages, settings } = getState()
  const page = pages[dbId]
  if (!page?.database || !selectors.isLive(dbId)) return t('Este banco de dados não está disponível.', 'This database is unavailable.')
  if (page.locked) return t('Desbloqueie o banco de dados primeiro.', 'Unlock the database first.')
  if (page.database.linkedSourceId || page.database.sourceDatabaseIds?.length) return t('Visualizações vinculadas não têm linhas próprias.', 'Linked views have no rows of their own.')
  if (settings.dailyFlow?.databaseId === dbId) return t(`O banco das notas diárias é gerenciado pelo ${PRODUCT.name}.`, `The daily notes database is managed by ${PRODUCT.name}.`)
  if (lockedAncestor(pages, dbId)) return t('Desbloqueie a página protegida primeiro.', 'Unlock the protected page first.')
  return null
}

/** Volta um banco a página comum: as linhas viram subpáginas (conteúdo intacto); valores de propriedades ficam guardados. */
export function convertDatabaseToPages(dbId: string): { rows: number; hidden: number } {
  const blocker = databaseConversionBlocker(dbId)
  if (blocker) throw new Error(blocker)
  const db = getState().pages[dbId]
  const rows = selectors.rows(dbId)
  const patches: Record<string, Partial<Page>> = {}
  let hidden = 0
  for (const row of rows) { const out = rowOutOfDatabase(row, db.database!.properties, types()); patches[row.id] = out.patch; hidden += out.hidden }
  actions.transact(t('Converter banco em páginas', 'Convert database to pages'), [dbId, ...rows.map((r) => r.id)], () => {
    actions.patchPages(patches)
    actions.updatePage(dbId, { database: undefined })
  })
  return { rows: rows.length, hidden }
}
