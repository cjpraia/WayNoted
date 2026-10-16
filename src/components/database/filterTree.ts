import type { FilterTree } from '../../database-models'

/** Avalia grupos aninhados de filtros por ID; ausência de árvore preserva o AND legado. */
export function matchesFilterTree(tree: FilterTree | undefined, legacyFilterIds: string[], matches: (id: string) => boolean): boolean {
  if (!tree) return legacyFilterIds.every(matches)
  const visit = (node: FilterTree, depth: number): boolean => {
    if (depth > 32) return false
    if (node.kind === 'rule') return matches(node.filterId)
    // Grupos sem condições (ex.: todas as regras foram excluídas) são neutros, inclusive em OR.
    const children = node.children.filter((child) => !isEmptyGroup(child))
    if (!children.length) return true
    return node.operator === 'and' ? children.every((child) => visit(child, depth + 1)) : children.some((child) => visit(child, depth + 1))
  }
  return visit(tree, 0)
}

function isEmptyGroup(node: FilterTree): boolean {
  return node.kind === 'group' && node.children.every(isEmptyGroup)
}

export function appendFilterRule(tree: FilterTree | undefined, existingIds: string[], filterId: string): FilterTree {
  if (!tree) return { kind: 'group', operator: 'and', children: [...existingIds.map((id): FilterTree => ({ kind: 'rule', filterId: id })), { kind: 'rule', filterId }] }
  return tree.kind === 'group' ? { ...tree, children: [...tree.children, { kind: 'rule', filterId }] } : { kind: 'group', operator: 'and', children: [tree, { kind: 'rule', filterId }] }
}

export function removeFilterRule(tree: FilterTree | undefined, filterId: string): FilterTree | undefined {
  if (!tree) return undefined
  if (tree.kind === 'rule') return tree.filterId === filterId ? undefined : tree
  return { ...tree, children: tree.children.map((child) => removeFilterRule(child, filterId)).filter((child): child is FilterTree => !!child) }
}

export function filterTreeFromIds(ids: string[]): FilterTree { return { kind: 'group', id: 'root', operator: 'and', children: ids.map((filterId) => ({ kind: 'rule', filterId })) } }

export function setGroupOperator(tree: FilterTree, groupId: string, operator: 'and' | 'or'): FilterTree {
  if (tree.kind === 'rule') return tree
  return { ...tree, operator: (tree.id ?? 'root') === groupId ? operator : tree.operator, children: tree.children.map((child) => setGroupOperator(child, groupId, operator)) }
}

/** Aninha a regra num grupo novo que pode receber outras regras. */
export function nestFilterRule(tree: FilterTree, filterId: string, id: string): FilterTree {
  if (tree.kind === 'rule') return tree.filterId === filterId ? { kind: 'group', id, operator: 'and', children: [tree] } : tree
  return { ...tree, children: tree.children.map((child) => nestFilterRule(child, filterId, id)) }
}

export function filterGroupIds(tree: FilterTree): string[] {
  if (tree.kind === 'rule') return []
  return [tree.id ?? 'root', ...tree.children.flatMap(filterGroupIds)]
}

export function moveFilterRule(tree: FilterTree, filterId: string, groupId: string): FilterTree {
  if (tree.kind === 'rule') return tree
  if (!filterGroupIds(tree).includes(groupId)) return tree
  const without = removeFilterRule(tree, filterId)
  if (!without) return tree
  const add = (node: FilterTree): FilterTree => node.kind === 'rule' ? node : { ...node, children: (node.id ?? 'root') === groupId ? [...node.children, { kind: 'rule', filterId }] : node.children.map(add) }
  return add(without)
}

export function ungroupFilterGroup(tree: FilterTree, groupId: string): FilterTree {
  if (tree.kind === 'rule') return tree
  return { ...tree, children: tree.children.flatMap((child): FilterTree[] => child.kind === 'group' && child.id === groupId ? child.children : [ungroupFilterGroup(child, groupId)]) }
}
