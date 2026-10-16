// Lógica pura da escolha de páginas de uma relação (popover "Vincular ou criar uma página…")
// e da configuração "Relacionada a" (fontes de dados + relação bidirecional). Sem store/React,
// para rodar nos testes em Node.
import type { Page, Property } from '../../types'
import type { DatabasePropertyConfig } from '../../database-models'
import { isLivePage, matchesRelatedRules, resolveValue } from './derived.ts'
import { aggItemText, normalizeForAggregation } from './aggregations.ts'

type Pages = Record<string, Page>
type RelationProperty = Property & DatabasePropertyConfig

export const normalizeSearch = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim()

/** Texto legível de uma propriedade numa página (busca e "mostrar nos candidatos"). */
export function cellText(page: Page, property: Property, pages: Pages): string {
  const cell = normalizeForAggregation(resolveValue(page, property, pages), property, pages)
  if (cell === null) return ''
  return (Array.isArray(cell) ? cell : [cell]).map((item) => typeof item === 'boolean' ? (item ? '✓' : '') : aggItemText(item)).filter(Boolean).join(', ')
}

/** Ordenação dos candidatos pela propriedade configurada (vazios no fim). */
export function sortCandidates(candidates: Page[], sortProperty: Property | undefined, direction: 'asc' | 'desc', pages: Pages): Page[] {
  if (!sortProperty) return [...candidates].sort((a, b) => a.order - b.order)
  const key = (page: Page): string | number | null => {
    const raw = resolveValue(page, sortProperty, pages)
    if (typeof raw === 'number') return raw
    if ((sortProperty.type === 'select' || sortProperty.type === 'status') && typeof raw === 'string') return sortProperty.options?.findIndex((option) => option.id === raw) ?? null
    const text = cellText(page, sortProperty, pages)
    return text === '' ? null : text
  }
  const keyed = candidates.map((page) => ({ page, key: key(page) }))
  keyed.sort((a, b) => {
    if (a.key === b.key) return a.page.order - b.page.order
    if (a.key === null) return 1
    if (b.key === null) return -1
    const compare = typeof a.key === 'number' && typeof b.key === 'number' ? a.key - b.key : String(a.key).localeCompare(String(b.key), 'pt-BR', { numeric: true })
    return direction === 'desc' ? -compare : compare
  })
  return keyed.map((entry) => entry.page)
}

/** Linhas vivas (fora da lixeira) de um banco. */
export function relationTargetRows(pages: Pages, targetDbId: string | undefined): Page[] {
  if (!targetDbId) return []
  const rows: Page[] = []
  for (const page of Object.values(pages)) if (page.parentId === targetDbId && isLivePage(page.id, pages)) rows.push(page)
  return rows
}

export interface RelationPickerPlan {
  /** Páginas já vinculadas que casam com a busca, na ordem do valor. */
  selected: Page[]
  /** Total de páginas vinculadas (sem busca). */
  selectedCount: number
  /** Demais candidatas (filtro salvo, busca e ordenação aplicados). */
  more: Page[]
  /** Candidatas escondidas pelo filtro salvo da relação. */
  hiddenByFilter: number
  /** Texto da busca que pode virar página nova ("Criar “texto”"), ou null. */
  create: string | null
}

/**
 * Divide as páginas do banco alvo em "selecionadas" e "selecionar mais". A busca (sem acento,
 * sem caixa) vale para o título e para as propriedades exibidas; "Criar" aparece quando nenhuma
 * página do banco tem exatamente o título digitado.
 */
export function planRelationPicker(input: {
  pages: Pages
  rows: Page[]
  selectedIds: string[]
  query: string
  picker?: RelationProperty['relationPicker']
  showAll?: boolean
  shownProperties?: Property[]
}): RelationPickerPlan {
  const { pages, rows, selectedIds, picker } = input
  const q = normalizeSearch(input.query)
  const shown = input.shownProperties ?? []
  const matches = (page: Page) => !q || normalizeSearch(page.title).includes(q) || shown.some((p) => normalizeSearch(cellText(page, p, pages)).includes(q))
  const selectedSet = new Set(selectedIds)
  const linked = [...selectedSet].map((id) => pages[id]).filter((page): page is Page => !!page && isLivePage(page.id, pages))
  const rest = rows.filter((page) => !selectedSet.has(page.id))
  const filtered = picker?.filters?.length && !input.showAll ? rest.filter((page) => matchesRelatedRules(page, picker.filters, picker.filterOperator, pages)) : rest
  const sortProperty = picker?.sortPropertyId ? (pages[rows[0]?.parentId ?? '']?.database?.properties.find((p) => p.id === picker.sortPropertyId)) : undefined
  const more = sortCandidates(filtered.filter(matches), sortProperty, picker?.sortDirection ?? 'asc', pages)
  const exact = q && rows.some((page) => normalizeSearch(page.title) === q)
  return {
    selected: linked.filter(matches),
    selectedCount: linked.length,
    more,
    hiddenByFilter: rest.length - filtered.length,
    create: q && !exact ? input.query.trim() : null,
  }
}

/** Alterna uma página no valor da relação (sem duplicar; mantém a ordem). */
export function toggleRelationValue(selectedIds: string[], id: string): string[] {
  return selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]
}

export interface DataSourceEntry { id: string; title: string; path: string; rows: number; properties: number; icon: string | null }

/** Caminho (trilha) de uma página: títulos dos ancestrais, da raiz para baixo. */
export function pagePath(pages: Pages, id: string, untitled = ''): string {
  const parts: string[] = []
  const seen = new Set<string>([id])
  let current = pages[id]?.parentId ?? null
  while (current && !seen.has(current) && parts.length < 8) {
    seen.add(current)
    const page = pages[current]
    if (!page) break
    parts.unshift(page.title || untitled)
    current = page.parentId
  }
  return parts.join(' / ')
}

/**
 * Fontes de dados que podem ser alvo de uma relação: bancos vivos e próprios (visualizações
 * vinculadas apontam para a fonte original e ficam de fora). Ordem: título.
 */
export function listDataSources(pages: Pages, query = '', untitled = ''): DataSourceEntry[] {
  const q = normalizeSearch(query)
  const rowCounts = new Map<string, number>()
  for (const page of Object.values(pages)) if (page.parentId && pages[page.parentId]?.database && !page.trashed) rowCounts.set(page.parentId, (rowCounts.get(page.parentId) ?? 0) + 1)
  const out: DataSourceEntry[] = []
  for (const page of Object.values(pages)) {
    const schema = page.database as (Page['database'] & { linkedSourceId?: string }) | undefined
    if (!schema || schema.linkedSourceId || !isLivePage(page.id, pages)) continue
    const title = page.title || untitled
    const path = pagePath(pages, page.id, untitled)
    if (q && !normalizeSearch(title).includes(q) && !normalizeSearch(path).includes(q)) continue
    out.push({ id: page.id, title, path, rows: rowCounts.get(page.id) ?? 0, properties: schema.properties.length, icon: page.icon })
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR', { numeric: true }) || a.id.localeCompare(b.id))
}

/**
 * Propriedade do banco alvo que pode servir de espelho de `property` (relação bidirecional):
 * a já pareada ou uma relação de volta ainda sem par. undefined = criar uma nova.
 */
export function findMirrorCandidate(pages: Pages, dbId: string, property: RelationProperty): RelationProperty | undefined {
  const target = property.relationDatabaseId ? pages[property.relationDatabaseId]?.database : undefined
  if (!target) return undefined
  const back = target.properties.filter((p) => p.type === 'relation' && p.id !== property.id && (p as RelationProperty).relationDatabaseId === dbId) as RelationProperty[]
  return back.find((p) => p.id === property.relationMirrorPropertyId) ?? back.find((p) => p.relationMirrorPropertyId === property.id)
}

/** Nome padrão da propriedade espelho: o nome do banco de origem (como no Export Bundle), sem repetir. */
export function mirrorPropertyName(pages: Pages, dbId: string, targetDbId: string, untitled: string): string {
  const base = pages[dbId]?.title || untitled
  const names = new Set(pages[targetDbId]?.database?.properties.map((p) => p.name) ?? [])
  if (!names.has(base)) return base
  let i = 2
  while (names.has(`${base} ${i}`)) i++
  return `${base} ${i}`
}

/**
 * Ao ligar a relação bidirecional numa relação que já tem dados, calcula o valor do espelho em
 * cada página alvo: une o que já existe com as páginas de origem que apontam para ela (nada é
 * apagado). Retorna apenas as páginas que mudam.
 */
export function backfillMirror(pages: Pages, dbId: string, propertyId: string, targetDbId: string, reverseId: string): { rowId: string; value: string[] }[] {
  const incoming = new Map<string, string[]>()
  for (const row of Object.values(pages)) {
    if (row.parentId !== dbId || !isLivePage(row.id, pages)) continue
    const value = row.props?.[propertyId]
    if (!Array.isArray(value)) continue
    for (const id of value) if (typeof id === 'string') incoming.set(id, [...(incoming.get(id) ?? []), row.id])
  }
  const out: { rowId: string; value: string[] }[] = []
  for (const [id, sources] of incoming) {
    const target = pages[id]
    if (!target || target.parentId !== targetDbId || !isLivePage(id, pages)) continue
    const current = Array.isArray(target.props?.[reverseId]) ? (target.props![reverseId] as unknown[]).filter((item): item is string => typeof item === 'string') : []
    const value = [...new Set([...current, ...sources])]
    if (value.length !== current.length) out.push({ rowId: id, value })
  }
  return out
}
