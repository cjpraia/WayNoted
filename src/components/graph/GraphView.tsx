// Tela "Grafo": todas as páginas como nós e suas conexões (links, subpáginas, hierarquia, relações).
import { useDeferredValue, useMemo, useRef } from 'react'
import { Crosshair, Play, Snowflake, SlidersHorizontal } from 'lucide-react'
import { actions, useStore } from '../../store'
import { t, formatNumber } from '../../i18n'
import { buildGraph, extractGraph } from '../../graph/edges'
import { updateGraphSettings, useGraphSettings } from '../../graph/settings'
import { GraphCanvas, type GraphCanvasHandle } from './GraphCanvas'
import { GraphControls } from './GraphControls'
import { Button } from '../ui/Button'
import './graph.css'

export function openGraphNode(id: string, newTab: boolean) {
  if (newTab) actions.openInNewTab({ type: 'page', id })
  else actions.openPage(id)
}

export function GraphView() {
  const { pages } = useStore()
  const settings = useGraphSettings()
  const deferredPages = useDeferredValue(pages)
  const extracted = useMemo(() => extractGraph(deferredPages), [deferredPages])
  const graph = useMemo(() => buildGraph(extracted, settings.filter), [extracted, settings.filter])
  const apiRef = useRef<GraphCanvasHandle | null>(null)
  const frozen = settings.frozen
  const label = t('Grafo com {nodes} páginas e {links} conexões', 'Graph with {nodes} pages and {links} connections', { nodes: graph.nodes.length, links: graph.links.length })
  return <div className="gr-root gr-global">
    <GraphCanvas graph={graph} display={settings.display} forces={settings.forces} frozen={frozen} scope="global" onOpen={openGraphNode} apiRef={apiRef} label={label} />
    <div className="gr-toolbar" role="toolbar" aria-label={t('Ações do grafo', 'Graph actions')}>
      <span className="gr-stats">{t('{nodes} nós · {links} conexões', '{nodes} nodes · {links} links', { nodes: formatNumber(graph.nodes.length), links: formatNumber(graph.links.length) })}</span>
      <Button className="gr-tool" onClick={() => apiRef.current?.center()} title={t('Centralizar (0)', 'Center (0)')}><Crosshair size={16} /> {t('Centralizar', 'Center')}</Button>
      <Button className="gr-tool" disabled={frozen} onClick={() => apiRef.current?.animate()} title={t('Refazer o layout animado', 'Replay the layout animation')}><Play size={16} /> {t('Animar', 'Animate')}</Button>
      <Button className="gr-tool" aria-pressed={frozen} onClick={() => updateGraphSettings(s => ({ ...s, frozen: !s.frozen }))} title={t('Pausar a simulação', 'Pause the simulation')}><Snowflake size={16} /> {frozen ? t('Descongelar', 'Unfreeze') : t('Congelar', 'Freeze')}</Button>
      {!settings.panel.open && <Button className="gr-tool" onClick={() => updateGraphSettings(s => ({ ...s, panel: { ...s.panel, open: true } }))}><SlidersHorizontal size={16} /> {t('Configurações', 'Settings')}</Button>}
    </div>
    {settings.panel.open && <GraphControls settings={settings} onClose={() => updateGraphSettings(s => ({ ...s, panel: { ...s.panel, open: false } }))} />}
    {graph.nodes.length === 0 && <div className="gr-empty" role="status">
      <strong>{t('Nenhuma página para mostrar', 'No pages to show')}</strong>
      <span>{t('Ajuste os filtros ou crie páginas e links entre elas.', 'Adjust the filters or create pages and links between them.')}</span>
    </div>}
  </div>
}
