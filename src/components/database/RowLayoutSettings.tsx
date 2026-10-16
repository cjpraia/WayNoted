import { Plus, Trash2 } from 'lucide-react'
import { getState, selectors } from '../../store'
import type { DatabaseSchema, Page } from '../../types'
import { t } from '../../i18n'
import { Select } from '../ui/Select'

type Layout = NonNullable<DatabaseSchema['rowLayout']>
type Tab = NonNullable<Layout['tabs']>[number]

/**
 * Aba nova de "bancos relacionados": nunca uma aba genérica. Prefere um banco que tem relação com este (já filtrado
 * pela página aberta), depois qualquer outro banco; o nome é o do banco. docs/USAGE.md ("Ajustes pós-teste").
 */
export function newTab(dbId: string, databases: Page[]): Tab {
  const relationTo = (page: Page) => page.database?.properties.find(property => property.type === 'relation' && property.relationDatabaseId === dbId)
  const source = databases.find(page => page.id !== dbId && relationTo(page)) ?? databases.find(page => page.id !== dbId) ?? databases.find(page => page.id === dbId)
  return { id: crypto.randomUUID(), name: source?.title || t('Aba', 'Tab'), databaseId: source?.id ?? '', ...(source && relationTo(source) ? { relationPropertyId: relationTo(source)!.id } : {}) }
}
export function RowLayoutSettings({ dbId, schema, patch }: { dbId: string; schema: DatabaseSchema; patch: (layout: Layout) => void }) {
  const layout = schema.rowLayout ?? {}
  const update = (value: Partial<Layout>) => patch({ ...layout, ...value })
  const databases = Object.values(getState().pages).filter(page => page.database && selectors.isLive(page.id))
  return <section><header><strong>{t('Layout das páginas', 'Page layout')}</strong><button type="button" onClick={() => patch({})}>{t('Redefinir', 'Reset')}</button></header>
    <p>{t('As alterações se aplicam a todas as páginas deste banco.', 'Changes apply to all pages in this database.')}</p>
    <label className="db-settings-check"><input type="checkbox" checked={layout.showPropertyIcons !== false} onChange={event => update({ showPropertyIcons: event.target.checked })} />{t('Ícones das propriedades', 'Property icons')}</label>
    <label className="db-settings-check"><input type="checkbox" checked={layout.fullWidth ?? false} onChange={event => update({ fullWidth: event.target.checked })} />{t('Largura total', 'Full width')}</label>
    <header><strong>{t('Seções', 'Sections')}</strong><button type="button" aria-label={t('Nova seção', 'New section')} onClick={() => update({ sections: [...layout.sections ?? [], { id: crypto.randomUUID(), name: t('Nova seção', 'New section'), propertyIds: [] }] })}><Plus size={14} /></button></header>
    {layout.sections?.map(section => <div key={section.id} className="db-settings-line"><input aria-label={t('Nome da seção', 'Section name')} value={section.name} onChange={event => update({ sections: layout.sections?.map(item => item.id === section.id ? { ...item, name: event.target.value } : item) })} /><button aria-label={t('Remover seção', 'Remove section')} onClick={() => update({ sections: layout.sections?.filter(item => item.id !== section.id) })}><Trash2 size={14} /></button></div>)}
    <details className="db-settings-layout"><summary>{t('Posição das propriedades', 'Property placement')}</summary>{schema.properties.filter(property => property.type !== 'title').map(property => <div key={property.id}><span>{property.name}</span>
      <Select aria-label={t('Posição de {name}', '{name} placement', { name: property.name })} value={layout.hidden?.includes(property.id) ? 'hidden' : layout.pinnedPropertyIds?.includes(property.id) ? 'pinned' : layout.detailsPropertyIds?.includes(property.id) ? 'details' : 'main'} onChange={event => update({ hidden: [...(layout.hidden ?? []).filter(id => id !== property.id), ...event.target.value === 'hidden' ? [property.id] : []], pinnedPropertyIds: [...(layout.pinnedPropertyIds ?? []).filter(id => id !== property.id), ...event.target.value === 'pinned' ? [property.id] : []], detailsPropertyIds: [...(layout.detailsPropertyIds ?? []).filter(id => id !== property.id), ...event.target.value === 'details' ? [property.id] : []] })}>
        <option value="main">{t('Página', 'Page')}</option><option value="pinned">{t('Cabeçalho', 'Heading')}</option><option value="details">{t('Painel de detalhes', 'Details panel')}</option><option value="hidden">{t('Oculta', 'Hidden')}</option>
      </Select>
      <Select aria-label={t('Seção de {name}', '{name} section', { name: property.name })} value={layout.sections?.find(section => section.propertyIds.includes(property.id))?.id ?? ''} onChange={event => update({ sections: layout.sections?.map(section => ({ ...section, propertyIds: [...section.propertyIds.filter(id => id !== property.id), ...event.target.value === section.id ? [property.id] : []] })) })}><option value="">{t('Sem seção', 'No section')}</option>{layout.sections?.map(section => <option value={section.id} key={section.id}>{section.name}</option>)}</Select>
    </div>)}</details>
    <header><strong>{t('Abas de bancos relacionados', 'Related database tabs')}</strong><button type="button" aria-label={t('Adicionar aba', 'Add tab')} title={t('Adicionar aba de um banco relacionado', 'Add a tab for a related database')} onClick={() => update({ tabs: [...layout.tabs ?? [], newTab(dbId, databases)] })}><Plus size={14} /></button></header>
    {!layout.tabs?.length && <p>{t('Sem abas: as páginas mostram só o conteúdo. Use + para mostrar, numa aba, as linhas de outro banco que se relacionam com a página.', 'No tabs: pages only show their content. Use + to show, in a tab, the rows of another database that relate to the page.')}</p>}
    {layout.tabs?.map(tab => { const source = selectors.database(tab.databaseId); return <div className="db-settings-item" key={tab.id}>
      <div className="db-settings-line"><input aria-label={t('Nome da aba', 'Tab name')} value={tab.name} onChange={event => update({ tabs: layout.tabs?.map(item => item.id === tab.id ? { ...item, name: event.target.value } : item) })} /><button aria-label={t('Remover aba', 'Remove tab')} onClick={() => update({ tabs: layout.tabs?.filter(item => item.id !== tab.id) })}><Trash2 size={14} /></button></div>
      <Select aria-label={t('Banco da aba', 'Tab database')} value={tab.databaseId} onChange={event => update({ tabs: layout.tabs?.map(item => item.id === tab.id ? { ...item, databaseId: event.target.value, viewId: undefined, relationPropertyId: undefined } : item) })}>{databases.map(page => <option key={page.id} value={page.id}>{page.title || t('Sem título', 'Untitled')}</option>)}</Select>
      <Select aria-label={t('Visualização da aba', 'Tab view')} value={tab.viewId ?? ''} onChange={event => update({ tabs: layout.tabs?.map(item => item.id === tab.id ? { ...item, viewId: event.target.value || undefined } : item) })}><option value="">{t('Visualização ativa', 'Active view')}</option>{source?.views.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}</Select>
      <Select aria-label={t('Filtrar pela página atual', 'Filter by current page')} value={tab.relationPropertyId ?? ''} onChange={event => update({ tabs: layout.tabs?.map(item => item.id === tab.id ? { ...item, relationPropertyId: event.target.value || undefined } : item) })}><option value="">{t('Todas as linhas', 'All rows')}</option>{source?.properties.filter(property => property.type === 'relation' && property.relationDatabaseId === dbId).map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</Select>
    </div> })}
  </section>
}
