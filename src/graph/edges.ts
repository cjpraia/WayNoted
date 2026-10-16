// Extração pura das conexões entre páginas para o grafo (sem DOM, sem store).
// Entrada: o mapa `pages` do meta. Saída: nós vivos e arestas tipadas (bitmask).
import type { Page } from '../types'
import { normalizeText } from '../search/normalize.ts'

export type GraphNodeKind = 'page' | 'database' | 'row'

/** Tipos de aresta, combináveis numa mesma aresta (par de páginas). */
export const EDGE_LINK = 1      // link ou menção @ no conteúdo (inclui blocos sincronizados e botões)
export const EDGE_BLOCK = 2     // bloco de subpágina / banco embutido na página pai
export const EDGE_PARENT = 4    // hierarquia pai → filho (barra lateral)
export const EDGE_RELATION = 8  // propriedade de relação entre linhas de bancos
export const EDGE_CANVAS = 16   // lousa contém a página como cartão (docs/USAGE.md); filtrada junto com “Links”

export interface GraphEdge { source: string; target: string; kinds: number }
export interface GraphNodeInfo { id: string; title: string; icon: string | null; kind: GraphNodeKind; rootId: string; parentId: string | null; /** Primeiro tipo de objeto da página (src/objecttypes), para colorir por tipo. */ typeId?: string }
export interface ExtractedGraph { nodes: Map<string, GraphNodeInfo>; edges: GraphEdge[] }

export interface GraphFilter {
  search: string
  showPages: boolean
  showDatabases: boolean
  showRows: boolean
  showOrphans: boolean
  showLinks: boolean
  showHierarchy: boolean
  showRelations: boolean
}

export const defaultGraphFilter: GraphFilter = {
  search: '', showPages: true, showDatabases: true, showRows: false, showOrphans: true,
  showLinks: true, showHierarchy: true, showRelations: true,
}

export interface BuiltNode extends GraphNodeInfo { degree: number; orphan: boolean }
export interface BuiltGraph {
  nodes: BuiltNode[]
  /** Pares de índices em `nodes` (source, target) e a bitmask dos tipos. */
  links: { source: number; target: number; kinds: number }[]
  index: Map<string, number>
}

/** Mesma regra de `isLive` da store: a página e todos os ancestrais existem e não estão na lixeira. */
export function livePageIds(pages: Record<string, Page>): Set<string> {
  const memo = new Map<string, boolean>()
  const live = (id: string): boolean => {
    const known = memo.get(id)
    if (known !== undefined) return known
    const chain: string[] = []
    let current: Page | undefined = pages[id]
    let result = true
    const seen = new Set<string>()
    while (true) {
      if (!current || current.trashed || seen.has(current.id)) { result = false; break }
      const cached = memo.get(current.id)
      if (cached !== undefined) { result = cached; break }
      seen.add(current.id); chain.push(current.id)
      if (!current.parentId) break
      current = pages[current.parentId]
    }
    for (const item of chain) memo.set(item, result)
    return result
  }
  const out = new Set<string>()
  for (const id of Object.keys(pages)) if (live(id)) out.add(id)
  return out
}

function resolvedSchema(pages: Record<string, Page>, dbId: string) {
  const seen = new Set<string>()
  let current = pages[dbId]
  while (current?.database?.linkedSourceId && !seen.has(current.id)) {
    seen.add(current.id)
    const source = pages[current.database.linkedSourceId]
    if (!source?.database) break
    current = source
  }
  return current?.database
}

/** Todas as páginas vivas e todas as arestas, com tipos combinados por par. */
export function extractGraph(pages: Record<string, Page>): ExtractedGraph {
  const live = livePageIds(pages)
  const nodes = new Map<string, GraphNodeInfo>()
  const rootOf = (id: string) => {
    let current = pages[id]; const seen = new Set<string>()
    while (current?.parentId && pages[current.parentId] && !seen.has(current.id)) { seen.add(current.id); current = pages[current.parentId] }
    return current?.id ?? id
  }
  for (const id of live) {
    const page = pages[id]
    const parent = page.parentId ? pages[page.parentId] : undefined
    nodes.set(id, { id, title: page.title, icon: page.icon, kind: page.database ? 'database' : parent?.database ? 'row' : 'page', rootId: rootOf(id), parentId: page.parentId, ...(page.types?.length ? { typeId: page.types[0] } : {}) })
  }
  const edges = new Map<string, GraphEdge>()
  const add = (source: string, target: string, kind: number) => {
    if (source === target || !live.has(source) || !live.has(target)) return
    const key = source < target ? `${source}|${target}` : `${target}|${source}`
    const existing = edges.get(key)
    if (existing) existing.kinds |= kind
    else edges.set(key, { source, target, kinds: kind })
  }
  for (const id of live) {
    const page = pages[id]
    for (const target of page.outboundPageIds ?? []) {
      const child = pages[target]
      add(id, target, page.canvas ? EDGE_CANVAS : child?.parentId === id ? EDGE_BLOCK : EDGE_LINK)
    }
    if (page.parentId) add(page.parentId, id, EDGE_PARENT)
    const parent = page.parentId ? pages[page.parentId] : undefined
    if (parent?.database && page.props) {
      const schema = resolvedSchema(pages, parent.id)
      for (const property of schema?.properties ?? []) {
        if (property.type !== 'relation') continue
        const value = page.props[property.id]
        if (Array.isArray(value)) for (const target of value) if (typeof target === 'string') add(id, target, EDGE_RELATION)
      }
    }
  }
  return { nodes, edges: [...edges.values()] }
}

export function edgeMask(filter: Pick<GraphFilter, 'showLinks' | 'showHierarchy' | 'showRelations'>): number {
  return (filter.showLinks ? EDGE_LINK | EDGE_BLOCK | EDGE_CANVAS : 0) | (filter.showHierarchy ? EDGE_PARENT : 0) | (filter.showRelations ? EDGE_RELATION : 0)
}

function kindVisible(kind: GraphNodeKind, filter: GraphFilter) {
  return kind === 'page' ? filter.showPages : kind === 'database' ? filter.showDatabases : filter.showRows
}

function finish(nodeIds: string[], extracted: ExtractedGraph, mask: number, keepOrphans: boolean, keep?: Set<string>): BuiltGraph {
  const allowed = new Set(nodeIds)
  const degree = new Map<string, number>()
  const kept: GraphEdge[] = []
  for (const edge of extracted.edges) {
    const kinds = edge.kinds & mask
    if (!kinds || !allowed.has(edge.source) || !allowed.has(edge.target)) continue
    kept.push({ ...edge, kinds })
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }
  const nodes: BuiltNode[] = []
  const index = new Map<string, number>()
  for (const id of nodeIds) {
    const d = degree.get(id) ?? 0
    if (!d && !keepOrphans && !keep?.has(id)) continue
    index.set(id, nodes.length)
    nodes.push({ ...extracted.nodes.get(id)!, degree: d, orphan: d === 0 })
  }
  const links = kept.map(edge => ({ source: index.get(edge.source)!, target: index.get(edge.target)!, kinds: edge.kinds }))
  return { nodes, links, index }
}

/** Grafo global aplicando filtros de tipo, texto, órfãs e tipos de aresta. */
export function buildGraph(extracted: ExtractedGraph, filter: GraphFilter): BuiltGraph {
  const query = normalizeText(filter.search.trim())
  const ids: string[] = []
  for (const node of extracted.nodes.values()) {
    if (!kindVisible(node.kind, filter)) continue
    if (query && !normalizeText(node.title).includes(query)) continue
    ids.push(node.id)
  }
  ids.sort()
  return finish(ids, extracted, edgeMask(filter), filter.showOrphans)
}

/** Vizinhança da página até `depth` saltos (1–3), seguindo as arestas permitidas. */
export function buildLocalGraph(extracted: ExtractedGraph, centerId: string, depth: number, filter: Pick<GraphFilter, 'showLinks' | 'showHierarchy' | 'showRelations' | 'showRows'>): BuiltGraph {
  if (!extracted.nodes.has(centerId)) return { nodes: [], links: [], index: new Map() }
  const mask = edgeMask(filter)
  const adjacency = new Map<string, string[]>()
  for (const edge of extracted.edges) {
    if (!(edge.kinds & mask)) continue
    const a = extracted.nodes.get(edge.source)!, b = extracted.nodes.get(edge.target)!
    if (!filter.showRows && ((a.kind === 'row' && a.id !== centerId) || (b.kind === 'row' && b.id !== centerId))) continue
    ;(adjacency.get(edge.source) ?? adjacency.set(edge.source, []).get(edge.source)!).push(edge.target)
    ;(adjacency.get(edge.target) ?? adjacency.set(edge.target, []).get(edge.target)!).push(edge.source)
  }
  const seen = new Set([centerId])
  let frontier = [centerId]
  for (let level = 0; level < Math.max(1, Math.min(3, depth)); level++) {
    const next: string[] = []
    for (const id of frontier) for (const neighbor of adjacency.get(id) ?? []) if (!seen.has(neighbor)) { seen.add(neighbor); next.push(neighbor) }
    frontier = next
  }
  const ids = [...seen].sort()
  return finish(ids, extracted, mask, true, new Set([centerId]))
}

/** Vizinhos (por índice) de cada nó, para destaque ao passar o mouse. */
export function neighborLists(graph: Pick<BuiltGraph, 'nodes' | 'links'>): number[][] {
  const out: number[][] = graph.nodes.map(() => [])
  for (const link of graph.links) { out[link.source].push(link.target); out[link.target].push(link.source) }
  return out
}
