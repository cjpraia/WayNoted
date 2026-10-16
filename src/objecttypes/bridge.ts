// Ponte tipo → banco de dados: "Transformar em banco de dados" na coleção de um tipo. docs/USAGE.md
// Decisão: cria um banco NOVO na raiz ("Pessoas") com os campos do tipo (mesmos ids e opções) e as páginas do
// tipo viram as linhas (mesmos ids e conteúdo; o tipo continua aplicado). É o que "transformar" promete, igual a
// "Transformar subpáginas em banco de dados"; a prévia avisa que as páginas saem de onde estão, e ⌘Z desfaz tudo.
// Uma "visualização vinculada" não serve aqui: visualizações vinculadas mostram um banco, e um tipo não é banco.
import { actions, getState } from '../store.ts'
import { t, getLocale } from '../i18n.ts'
import type { Page } from '../types'
import { effectiveProperties, findType, pagesWithType } from './model.ts'
import { classify, mapRowIntoSchema, mappingPatch, planSchema, pluralName, type ExcludedPage } from '../subpages/plan.ts'

const types = () => getState().settings.objectTypes ?? []

export interface TypeToDatabasePreview {
  title: string
  eligible: Page[]
  excluded: ExcludedPage[]
  /** Linhas de outros bancos: ficam onde estão (não são arrancadas de outro banco). */
  inOtherDatabases: Page[]
  fields: string[]
}

export function previewTypeToDatabase(typeId: string): TypeToDatabasePreview | null {
  const type = findType(types(), typeId)
  if (!type) return null
  const { pages } = getState()
  // Só quem tem o tipo diretamente (subtipos ficam na coleção do subtipo).
  const all = pagesWithType(pages, types(), typeId).filter((page) => page.types?.includes(typeId))
  const inOtherDatabases = all.filter((page) => page.parentId && pages[page.parentId]?.database)
  const { eligible, excluded } = classify(pages, all.filter((page) => !inOtherDatabases.includes(page)).map((page) => page.id))
  return { title: pluralName(type.name, getLocale()), eligible, excluded, inOtherDatabases, fields: ['Tags', ...effectiveProperties(types(), typeId).map((prop) => prop.name)] }
}

/** Executa a ponte numa transação com ⌘Z. Devolve o id do banco novo. */
export function convertTypeToDatabase(typeId: string): { dbId: string; moved: number } {
  const type = findType(types(), typeId)
  const preview = previewTypeToDatabase(typeId)
  if (!type || !preview) throw new Error(t('Este tipo não está disponível.', 'This type is unavailable.'))
  if (!preview.eligible.length) throw new Error(t('Não há páginas deste tipo que possam virar linhas.', 'No pages of this type can become rows.'))
  const { pages } = getState()
  const rows = preview.eligible
  const plan = planSchema(rows, types(), pages, { title: t('Nome', 'Name'), tags: 'Tags' })
  const parents = [...new Set(rows.map((row) => row.parentId).filter((id): id is string => !!id))]
  let dbId = ''
  actions.transact(t('Transformar o tipo {name} em banco de dados', 'Turn the {name} type into a database', { name: type.name }), [...parents, ...rows.map((row) => row.id)], () => {
    dbId = actions.createDatabase(null, 'table', { title: preview.title, ...(type.icon ? { icon: type.icon } : {}) })
    const db = getState().pages[dbId]
    if (db?.database) actions.updatePage(dbId, { database: { ...db.database, properties: plan.properties } }, false)
    const patches = Object.fromEntries(rows.map((row) => [row.id, mappingPatch(row, mapRowIntoSchema(row, plan.properties, types()))]))
    actions.reparentPages(rows.map((row) => row.id), dbId, patches)
  }, { created: () => [dbId] })
  return { dbId, moved: rows.length }
}
