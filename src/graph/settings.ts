import COMPAT from '../../shared/compatibility.ts'
// Preferências do grafo (globais e do grafo local), persistidas localmente neste dispositivo.
import { useSyncExternalStore } from 'react'
import { defaultGraphFilter, type GraphFilter } from './edges.ts'
import { defaultLayoutParams, type LayoutParams } from './layout.ts'
import { normalizeText } from '../search/normalize.ts'
import type { BuiltNode } from './edges.ts'

export interface ColorGroup { id: string; query: string; color: string }

export interface GraphDisplay {
  colorMode: 'type' | 'root' | 'objectType'
  groups: ColorGroup[]
  nodeSize: number
  lineWidth: number
  /** Zoom a partir do qual os rótulos aparecem. */
  labelZoom: number
  arrows: boolean
}

export interface GraphSettings {
  filter: GraphFilter
  display: GraphDisplay
  forces: LayoutParams
  frozen: boolean
  panel: { open: boolean; sections: Record<string, boolean> }
  local: { open: boolean; depth: number; showHierarchy: boolean; showRelations: boolean; showRows: boolean }
}

export const GROUP_PALETTE = ['#e5484d', '#f76b15', '#d6a10c', '#30a46c', '#12a594', '#0090ff', '#6e56cf', '#d6409f', '#8d8d86', '#a18072']

export const defaultGraphSettings: GraphSettings = {
  filter: { ...defaultGraphFilter },
  display: { colorMode: 'type', groups: [], nodeSize: 1, lineWidth: 1, labelZoom: 1.1, arrows: false },
  forces: { ...defaultLayoutParams },
  frozen: false,
  panel: { open: true, sections: { filters: true, groups: false, display: false, forces: false } },
  local: { open: false, depth: 1, showHierarchy: true, showRelations: true, showRows: true },
}

const KEY = COMPAT.record050
const listeners = new Set<() => void>()

function clamp(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

/** Lê e valida o JSON salvo; campos inválidos voltam ao padrão. */
export function parseGraphSettings(raw: unknown): GraphSettings {
  const d = defaultGraphSettings
  if (!raw || typeof raw !== 'object') return structuredClone(d)
  const v = raw as Partial<GraphSettings>
  const bool = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback
  const f = (v.filter ?? {}) as Partial<GraphFilter>
  const s = (v.display ?? {}) as Partial<GraphDisplay>
  const p = (v.forces ?? {}) as Partial<LayoutParams>
  const l = (v.local ?? {}) as Partial<GraphSettings['local']>
  return {
    filter: {
      search: typeof f.search === 'string' ? f.search : '',
      showPages: bool(f.showPages, d.filter.showPages), showDatabases: bool(f.showDatabases, d.filter.showDatabases), showRows: bool(f.showRows, d.filter.showRows),
      showOrphans: bool(f.showOrphans, d.filter.showOrphans), showLinks: bool(f.showLinks, d.filter.showLinks), showHierarchy: bool(f.showHierarchy, d.filter.showHierarchy), showRelations: bool(f.showRelations, d.filter.showRelations),
    },
    display: {
      colorMode: s.colorMode === 'root' || s.colorMode === 'objectType' ? s.colorMode : 'type',
      groups: Array.isArray(s.groups) ? s.groups.filter(g => g && typeof g.id === 'string' && typeof g.query === 'string' && typeof g.color === 'string' && /^#[0-9a-f]{6}$/i.test(g.color)).slice(0, 20) : [],
      nodeSize: clamp(s.nodeSize, 0.2, 4, d.display.nodeSize), lineWidth: clamp(s.lineWidth, 0.1, 5, d.display.lineWidth),
      labelZoom: clamp(s.labelZoom, 0.2, 4, d.display.labelZoom), arrows: bool(s.arrows, d.display.arrows),
    },
    forces: { repel: clamp(p.repel, 0, 20, d.forces.repel), linkDistance: clamp(p.linkDistance, 10, 500, d.forces.linkDistance), linkStrength: clamp(p.linkStrength, 0, 1, d.forces.linkStrength), center: clamp(p.center, 0, 1, d.forces.center) },
    frozen: bool(v.frozen, false),
    panel: { open: bool(v.panel?.open, true), sections: { ...d.panel.sections, ...(v.panel?.sections && typeof v.panel.sections === 'object' ? v.panel.sections : {}) } },
    local: { open: bool(l.open, false), depth: Math.round(clamp(l.depth, 1, 3, 1)), showHierarchy: bool(l.showHierarchy, true), showRelations: bool(l.showRelations, true), showRows: bool(l.showRows, true) },
  }
}

function load(): GraphSettings {
  try { return parseGraphSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null')) } catch { return structuredClone(defaultGraphSettings) }
}

let current: GraphSettings = typeof localStorage === 'undefined' ? structuredClone(defaultGraphSettings) : load()
let saveTimer: ReturnType<typeof setTimeout> | null = null

export function getGraphSettings() { return current }

export function updateGraphSettings(fn: (settings: GraphSettings) => GraphSettings) {
  current = fn(current)
  listeners.forEach(listener => listener())
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* Armazenamento indisponível: mantém em memória. */ } }, 200)
}

export function toggleLocalGraph(open?: boolean) {
  updateGraphSettings(s => ({ ...s, local: { ...s.local, open: open ?? !s.local.open } }))
}

export function useGraphSettings(): GraphSettings {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, getGraphSettings)
}

/**
 * Consulta de grupo de cor: texto livre casa com o título (sem acento/caixa);
 * prefixos `type:pagina|banco|linha|orfa` (ou page/database/row/orphan) casam com o tipo.
 */
export function matchesGroup(node: Pick<BuiltNode, 'title' | 'kind' | 'orphan'>, query: string): boolean {
  const terms = normalizeText(query.trim()).split(/\s+/).filter(Boolean)
  if (!terms.length) return false
  const title = normalizeText(node.title)
  return terms.every(term => {
    if (term.startsWith('type:') || term.startsWith('tipo:')) {
      const kind = term.slice(5)
      if (['orphan', 'orfa', 'orfao'].includes(kind)) return node.orphan
      const map: Record<string, string> = { page: 'page', pagina: 'page', database: 'database', banco: 'database', row: 'row', linha: 'row' }
      return map[kind] === node.kind
    }
    return title.includes(term)
  })
}
