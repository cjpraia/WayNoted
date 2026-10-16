// Painel lateral com o grafo local da página atual e seus vizinhos até profundidade 1–3.
import { useDeferredValue, useMemo, useRef } from 'react'
import { Crosshair, Maximize2, X } from 'lucide-react'
import { actions, useStore } from '../../store'
import { t } from '../../i18n'
import { buildLocalGraph, extractGraph } from '../../graph/edges'
import { toggleLocalGraph, updateGraphSettings, useGraphSettings, type GraphSettings } from '../../graph/settings'
import { GraphCanvas, type GraphCanvasHandle } from './GraphCanvas'
import { Toggle } from './GraphControls'
import { openGraphNode } from './GraphView'
import './graph.css'

export { toggleLocalGraph }

export function LocalGraphPanel({ pageId }: { pageId: string }) {
  const { pages } = useStore()
  const settings = useGraphSettings()
  const local = settings.local
  const deferredPages = useDeferredValue(pages)
  const extracted = useMemo(() => extractGraph(deferredPages), [deferredPages])
  const graph = useMemo(() => buildLocalGraph(extracted, pageId, local.depth, { showLinks: true, showHierarchy: local.showHierarchy, showRelations: local.showRelations, showRows: local.showRows }), [extracted, pageId, local.depth, local.showHierarchy, local.showRelations, local.showRows])
  const apiRef = useRef<GraphCanvasHandle | null>(null)
  const patch = (value: Partial<GraphSettings['local']>) => updateGraphSettings(s => ({ ...s, local: { ...s.local, ...value } }))
  const display = useMemo(() => ({ ...settings.display, labelZoom: Math.min(settings.display.labelZoom, 0.6) }), [settings.display])
  return <aside className="gr-local" aria-label={t('Grafo local', 'Local graph')}>
    <div className="gr-local-head">
      <strong>{t('Grafo local', 'Local graph')}</strong>
      <span className="gr-local-count">{graph.nodes.length}</span>
      <button type="button" className="np-icon-btn" title={t('Centralizar', 'Center')} aria-label={t('Centralizar', 'Center')} onClick={() => apiRef.current?.center()}><Crosshair size={16} /></button>
      <button type="button" className="np-icon-btn" title={t('Abrir grafo completo', 'Open full graph')} aria-label={t('Abrir grafo completo', 'Open full graph')} onClick={() => actions.navigate({ type: 'graph' })}><Maximize2 size={14} /></button>
      <button type="button" className="np-icon-btn" title={t('Fechar grafo local', 'Close local graph')} aria-label={t('Fechar grafo local', 'Close local graph')} onClick={() => toggleLocalGraph(false)}><X size={16} /></button>
    </div>
    <div className="gr-local-options">
      <div className="gr-depth" role="radiogroup" aria-label={t('Profundidade', 'Depth')}>
        <span>{t('Profundidade', 'Depth')}</span>
        {[1, 2, 3].map(depth => <button type="button" key={depth} role="radio" aria-checked={local.depth === depth} className={local.depth === depth ? 'is-on' : ''} onClick={() => patch({ depth })}>{depth}</button>)}
      </div>
      <details className="gr-local-more">
        <summary>{t('Conexões', 'Connections')}</summary>
        <Toggle label={t('Pais e filhos', 'Parents and children')} checked={local.showHierarchy} onChange={value => patch({ showHierarchy: value })} />
        <Toggle label={t('Relações de banco', 'Database relations')} checked={local.showRelations} onChange={value => patch({ showRelations: value })} />
        <Toggle label={t('Linhas de banco', 'Database rows')} checked={local.showRows} onChange={value => patch({ showRows: value })} />
      </details>
    </div>
    <div className="gr-root gr-local-canvas">
      <GraphCanvas graph={graph} display={display} forces={settings.forces} frozen={false} focusId={pageId} scope={`local:${pageId}`} onOpen={openGraphNode} apiRef={apiRef}
        label={t('Grafo local com {n} páginas', 'Local graph with {n} pages', { n: graph.nodes.length })} />
      {graph.nodes.length <= 1 && <div className="gr-empty is-small" role="status"><span>{t('Esta página ainda não tem conexões.', 'This page has no connections yet.')}</span></div>}
    </div>
  </aside>
}
