// Painel de controles do grafo global: filtros, grupos de cor, exibição e forças.
import type { ReactNode } from 'react'
import { ChevronRight, Plus, X, RotateCcw } from 'lucide-react'
import { t } from '../../i18n'
import { PanelHeader } from '../ui/PanelHeader'
import { IconButton } from '../ui/Button'
import { defaultGraphSettings, GROUP_PALETTE, updateGraphSettings, type GraphSettings } from '../../graph/settings'
import type { GraphFilter } from '../../graph/edges'
import type { LayoutParams } from '../../graph/layout'
import type { GraphDisplay } from '../../graph/settings'
import { TYPE_COLOR_HEX } from '../../objecttypes/model'
import { registeredTypes } from '../../objecttypes/registry'
import { PageIcon } from '../page/PageIcon'
import { Select } from '../ui/Select'

function Section({ id, title, settings, children }: { id: string; title: string; settings: GraphSettings; children: ReactNode }) {
  const open = !!settings.panel.sections[id]
  return <section className={`gr-section${open ? ' is-open' : ''}`}>
    <button type="button" className="gr-section-head" aria-expanded={open} onClick={() => updateGraphSettings(s => ({ ...s, panel: { ...s.panel, sections: { ...s.panel.sections, [id]: !open } } }))}>
      <ChevronRight size={14} strokeWidth={1.8} aria-hidden /> {title}
    </button>
    {open && <div className="gr-section-body">{children}</div>}
  </section>
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return <label className="gr-toggle">
    <span>{label}</span>
    <input type="checkbox" role="switch" className="np-switch" checked={checked} onChange={event => onChange(event.target.checked)} />
  </label>
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange(value: number): void }) {
  return <label className="gr-slider">
    <span className="gr-slider-label">{label}<output>{Number.isInteger(step) ? value : value.toFixed(step < 0.1 ? 2 : 1)}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} />
  </label>
}

export function GraphControls({ settings, onClose }: { settings: GraphSettings; onClose(): void }) {
  const filter = (patch: Partial<GraphFilter>) => updateGraphSettings(s => ({ ...s, filter: { ...s.filter, ...patch } }))
  const display = (patch: Partial<GraphDisplay>) => updateGraphSettings(s => ({ ...s, display: { ...s.display, ...patch } }))
  const forces = (patch: Partial<LayoutParams>) => updateGraphSettings(s => ({ ...s, forces: { ...s.forces, ...patch } }))
  const f = settings.filter, d = settings.display, p = settings.forces
  return <aside className="gr-panel" aria-label={t('Configurações do grafo', 'Graph settings')}>
    <PanelHeader title={t('Configurações do grafo', 'Graph settings')} onClose={onClose} actions={<IconButton label={t('Restaurar padrões', 'Restore defaults')} onClick={() => updateGraphSettings(s => ({ ...structuredClone(defaultGraphSettings), panel: s.panel, local: s.local }))}><RotateCcw size={14} /></IconButton>} />
    <div className="gr-panel-scroll">
      <Section id="filters" title={t('Filtros', 'Filters')} settings={settings}>
        <input className="gr-input" type="search" value={f.search} placeholder={t('Buscar páginas…', 'Search pages…')} aria-label={t('Filtrar nós por título', 'Filter nodes by title')} onChange={event => filter({ search: event.target.value })} />
        <Toggle label={t('Páginas', 'Pages')} checked={f.showPages} onChange={value => filter({ showPages: value })} />
        <Toggle label={t('Bancos de dados', 'Databases')} checked={f.showDatabases} onChange={value => filter({ showDatabases: value })} />
        <Toggle label={t('Linhas de banco', 'Database rows')} checked={f.showRows} onChange={value => filter({ showRows: value })} />
        <Toggle label={t('Órfãs', 'Orphans')} checked={f.showOrphans} onChange={value => filter({ showOrphans: value })} />
        <div className="gr-subhead">{t('Conexões', 'Connections')}</div>
        <Toggle label={t('Links e menções', 'Links and mentions')} checked={f.showLinks} onChange={value => filter({ showLinks: value })} />
        <Toggle label={t('Pais e filhos', 'Parents and children')} checked={f.showHierarchy} onChange={value => filter({ showHierarchy: value })} />
        <Toggle label={t('Relações de banco', 'Database relations')} checked={f.showRelations} onChange={value => filter({ showRelations: value })} />
      </Section>
      <Section id="groups" title={t('Grupos', 'Groups')} settings={settings}>
        <label className="gr-field">
          <span>{t('Colorir por', 'Color by')}</span>
          <Select block value={d.colorMode} onChange={event => display({ colorMode: event.target.value as GraphDisplay['colorMode'] })}>
            <option value="type">{t('Tipo de página', 'Page kind')}</option>
            <option value="root">{t('Pasta raiz', 'Root folder')}</option>
            <option value="objectType">{t('Tipo', 'Type')}</option>
          </Select>
        </label>
        {d.colorMode === 'objectType' && <ul className="gr-legend">{registeredTypes().map(type => <li key={type.id}><i className="gr-dot" style={{ background: TYPE_COLOR_HEX[type.color] }} />{type.icon && <PageIcon value={type.icon} style={{ width: 14, height: 14 }} />} {type.name}</li>)}{!registeredTypes().length && <li>{t('Nenhum tipo de objeto', 'No object types')}</li>}</ul>}
        {d.colorMode === 'type' && <ul className="gr-legend">
          <li><i className="gr-dot is-page" />{t('Página', 'Page')}</li>
          <li><i className="gr-dot is-database" />{t('Banco de dados', 'Database')}</li>
          <li><i className="gr-dot is-row" />{t('Linha de banco', 'Database row')}</li>
          <li><i className="gr-dot is-orphan" />{t('Órfã', 'Orphan')}</li>
        </ul>}
        {d.groups.map((group, index) => <div className="gr-group" key={group.id}>
          <input type="color" value={group.color} aria-label={t('Cor do grupo', 'Group color')} onChange={event => display({ groups: d.groups.map(g => g.id === group.id ? { ...g, color: event.target.value } : g) })} />
          <input className="gr-input" value={group.query} placeholder={t('Texto ou type:banco', 'Text or type:database')} aria-label={t('Consulta do grupo {n}', 'Group {n} query', { n: index + 1 })} onChange={event => display({ groups: d.groups.map(g => g.id === group.id ? { ...g, query: event.target.value } : g) })} />
          <button type="button" className="np-icon-btn" aria-label={t('Remover grupo', 'Remove group')} onClick={() => display({ groups: d.groups.filter(g => g.id !== group.id) })}><X size={14} /></button>
        </div>)}
        <button type="button" className="gr-add" onClick={() => display({ groups: [...d.groups, { id: crypto.randomUUID(), query: '', color: GROUP_PALETTE[d.groups.length % GROUP_PALETTE.length] }] })}><Plus size={14} /> {t('Novo grupo', 'New group')}</button>
        <p className="gr-hint">{t('O primeiro grupo que corresponder define a cor. Use type:pagina, type:banco, type:linha ou type:orfa.', 'The first matching group sets the color. Use type:page, type:database, type:row, or type:orphan.')}</p>
      </Section>
      <Section id="display" title={t('Exibição', 'Display')} settings={settings}>
        <Slider label={t('Tamanho do nó', 'Node size')} value={d.nodeSize} min={0.2} max={4} step={0.1} onChange={value => display({ nodeSize: value })} />
        <Slider label={t('Espessura da linha', 'Line thickness')} value={d.lineWidth} min={0.1} max={5} step={0.1} onChange={value => display({ lineWidth: value })} />
        <Slider label={t('Rótulos a partir do zoom', 'Labels from zoom')} value={d.labelZoom} min={0.2} max={4} step={0.1} onChange={value => display({ labelZoom: value })} />
        <Toggle label={t('Setas (direção do link)', 'Arrows (link direction)')} checked={d.arrows} onChange={value => display({ arrows: value })} />
      </Section>
      <Section id="forces" title={t('Forças', 'Forces')} settings={settings}>
        <Slider label={t('Força central', 'Center force')} value={p.center} min={0} max={1} step={0.01} onChange={value => forces({ center: value })} />
        <Slider label={t('Repulsão', 'Repel force')} value={p.repel} min={0} max={20} step={0.5} onChange={value => forces({ repel: value })} />
        <Slider label={t('Força do link', 'Link force')} value={p.linkStrength} min={0} max={1} step={0.01} onChange={value => forces({ linkStrength: value })} />
        <Slider label={t('Distância do link', 'Link distance')} value={p.linkDistance} min={10} max={500} step={5} onChange={value => forces({ linkDistance: value })} />
      </Section>
    </div>
  </aside>
}
