import type { DatabaseSchema, Page, PropValue, Property, SelectOption, View } from '../../types'

/** Tipos que podem agrupar. Multisseleção, relação e pessoa colocam a linha em TODOS os seus grupos. */
export const GROUPABLE_TYPES: readonly Property['type'][] = ['select', 'status', 'multiSelect', 'relation', 'person']
export const isGroupableType = (type: string | undefined) => !!type && (GROUPABLE_TYPES as readonly string[]).includes(type)
/** Propriedades em que uma linha pode estar em vários grupos ao mesmo tempo. */
export const isMultiGroupType = (type: string | undefined) => type === 'multiSelect' || type === 'relation' || type === 'person'

export interface ViewGroup {
  key: string
  label: string
  /** Opção real (select/status/multiSelect) ou sintética (relação/pessoa: id = página relacionada / nome). null = "Sem valor". */
  option: SelectOption | null
  rows: Page[]
}

type Pages = Record<string, Page>

const splitPeople = (value: string) => value.split(/[,;\n]/).map((name) => name.trim()).filter(Boolean)

/**
 * Fichas de grupo de uma linha: ids de opção (select/status/multiSelect), ids de página viva (relação)
 * ou nomes (pessoa, separados por vírgula). Sem repetição; vazio = a linha vai para "Sem valor".
 */
export function groupTokens(row: Page, property: Property, pages?: Pages, labels?: Map<string, string>): string[] {
  const value = row.props?.[property.id]
  const known = property.options ? new Set(property.options.map((option) => option.id)) : null
  const uniq = (list: string[]) => [...new Set(list)]
  switch (property.type) {
    case 'select': case 'status':
      return typeof value === 'string' && known?.has(value) ? [value] : []
    case 'multiSelect':
      return Array.isArray(value) ? uniq((value as unknown[]).filter((id): id is string => typeof id === 'string' && !!known?.has(id))) : []
    case 'relation': {
      if (!Array.isArray(value)) return []
      return uniq((value as unknown[]).filter((id): id is string => typeof id === 'string' && (!pages || (!!pages[id] && !pages[id].trashed))))
    }
    case 'person': {
      if (typeof value !== 'string') return []
      // Ficha = nome sem diferença de caixa ("Ana" e "ana" são o mesmo grupo); `labels` guarda a grafia da primeira ocorrência.
      const out: string[] = []
      for (const name of splitPeople(value)) { const folded = name.toLocaleLowerCase(); if (!out.includes(folded)) { out.push(folded); if (labels && !labels.has(folded)) labels.set(folded, name) } }
      return out
    }
    default: return []
  }
}

/** Grupos estáveis por ID de opção; a ausência tem chave própria e não colide com rótulos. */
export function groupsFor(rows: Page[], property: Property, view: View, emptyLabel: string, pages?: Pages): ViewGroup[] {
  const dynamic = property.type === 'relation' || property.type === 'person'
  const options: SelectOption[] = dynamic ? [] : property.options ?? []
  const labels = new Map<string, string>()
  const buckets = new Map<string | null, { option: SelectOption | null; rows: Page[] }>([[null, { option: null, rows: [] }]])
  for (const option of options) buckets.set(option.id, { option, rows: [] })
  for (const row of rows) {
    const tokens = groupTokens(row, property, pages, labels)
    if (!tokens.length) { buckets.get(null)!.rows.push(row); continue }
    for (const token of tokens) {
      let bucket = buckets.get(token)
      if (!bucket) {
        const name = property.type === 'relation' ? (pages?.[token]?.title || '') : labels.get(token) ?? token
        bucket = { option: { id: token, name: name || token, color: 'default' }, rows: [] }
        buckets.set(token, bucket)
      }
      bucket.rows.push(row)
    }
  }
  const groups = [...buckets.values()].map((group) => ({
    key: `${property.id}:${group.option?.id ?? '__none__'}`,
    label: group.option?.name ?? emptyLabel,
    option: group.option,
    rows: group.rows,
  })).filter((group) => (group.rows.length > 0 || (!dynamic && view.hideEmptyGroups === false)) && !view.hiddenGroups?.includes(group.key))
  // Ordem dos grupos (Configurações › Agrupar): manual = ordem das opções; "Sem valor" sempre no fim nas alfabéticas.
  if (dynamic || view.groupSort === 'alphabetical' || view.groupSort === 'reverse') {
    const named = groups.filter((group) => group.option).sort((a, b) => a.label.localeCompare(b.label))
    if (view.groupSort === 'reverse') named.reverse()
    return [...named, ...groups.filter((group) => !group.option)]
  }
  return groups
}

/** Valor inicial de uma propriedade para uma linha criada dentro do grupo `token` (null = "Sem valor"). */
export function groupValue(property: Property, token: string | null, label?: string): PropValue {
  if (token === null) return property.type === 'multiSelect' || property.type === 'relation' ? [] : null
  if (property.type === 'person') return label ?? token
  return property.type === 'multiSelect' || property.type === 'relation' ? [token] : token
}

/**
 * Novo valor da propriedade quando a linha é arrastada do grupo `from` para o grupo `to`.
 * Multi-valor: remove só o valor de origem e acrescenta o de destino, preservando os demais;
 * "Sem valor" como destino apenas remove, como origem apenas acrescenta. Select/status: troca o valor.
 */
export function moveGroupValue(row: Page, property: Property, from: string | null, to: string | null, pages?: Pages, toLabel?: string): PropValue {
  if (!isMultiGroupType(property.type)) return groupValue(property, to)
  if (property.type === 'person') {
    // Mantém a grafia dos nomes que ficam; o destino entra com o rótulo do grupo.
    const raw = typeof row.props?.[property.id] === 'string' ? splitPeople(row.props[property.id] as string) : []
    const kept = raw.filter((name, index) => name.toLocaleLowerCase() !== from && raw.findIndex((other) => other.toLocaleLowerCase() === name.toLocaleLowerCase()) === index)
    if (to !== null && !kept.some((name) => name.toLocaleLowerCase() === to)) kept.push(toLabel ?? to)
    return kept.length ? kept.join(', ') : null
  }
  const next = groupTokens(row, property, pages).filter((token) => token !== from)
  if (to !== null && !next.includes(to)) next.push(to)
  return next
}

export function groupableProperty(schema: DatabaseSchema, id: string | undefined): Property | undefined {
  return schema.properties.find((property) => property.id === id && isGroupableType(property.type))
}
