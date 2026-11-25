import type { Page, Property } from '../../types'
import type { TypeList } from '../../objecttypes/model'
import { useI18n } from '../../i18n'
import { Select } from '../ui/Select'
import { AGGREGATION_GROUPS, AGGREGATION_LABELS } from './aggregations'
import { rollupTargetProperties } from './derived'
import { RelatedRulesEditor } from './RelatedRulesEditor'

type Rollup = NonNullable<Property['rollup']>

export function RollupPropertyConfig({ property, fields, pages, types, defaultAggregation = 'count', onChange }: {
  property: Property
  fields: Property[]
  pages: Record<string, Page>
  types: TypeList
  defaultAggregation?: Rollup['aggregation']
  onChange: (rollup: Rollup) => void
}) {
  const { t } = useI18n()
  const config = property.rollup
  const relations = fields.filter(field => field.type === 'relation').map(field => ({
    field,
    targets: rollupTargetProperties(field, pages, types, t('Nome', 'Name')),
  })).filter(item => item.targets.length)
  const relation = relations.find(item => item.field.id === config?.relationPropertyId)
  const target = relation?.targets.find(field => field.id === config?.targetPropertyId)
  const update = (changes: Partial<Rollup>) => {
    if (config) onChange({ ...config, ...changes })
  }
  const relationId = `rollup-relation-${property.id}`
  const targetId = `rollup-target-${property.id}`
  const calculateId = `rollup-calculate-${property.id}`

  return <div className="db-property-config">
    <small>{t('Agrega os valores das páginas vinculadas por uma relação.', 'Aggregates values from pages linked through a relation.')}</small>
    {!relations.length && <small role="status">{t('Adicione uma propriedade Relação e escolha o tipo ou banco relacionado para configurar este Rollup.', 'Add a Relation property and choose its related type or database to configure this Rollup.')}</small>}
    <label htmlFor={relationId}>{t('Relação', 'Relation')}</label>
    <Select id={relationId} block disabled={!relations.length} value={relation?.field.id ?? ''}
      onChange={event => onChange({ relationPropertyId: event.target.value, targetPropertyId: '', aggregation: defaultAggregation })}>
      <option value="">{t('Escolha uma relação', 'Choose a relation')}</option>
      {relations.map(({ field }) => <option key={field.id} value={field.id}>{field.name}</option>)}
    </Select>
    <label htmlFor={targetId}>{t('Propriedade relacionada', 'Related property')}</label>
    <Select id={targetId} block disabled={!relation} value={target?.id ?? ''}
      onChange={event => update({ targetPropertyId: event.target.value })}>
      <option value="">{t('Escolha uma propriedade', 'Choose a property')}</option>
      {relation?.targets.map(field => <option key={field.id} value={field.id}>{field.name}</option>)}
    </Select>
    <label htmlFor={calculateId}>{t('Calcular', 'Calculate')}</label>
    <Select id={calculateId} block disabled={!target} value={config?.aggregation ?? defaultAggregation}
      onChange={event => update({ aggregation: event.target.value as Rollup['aggregation'] })}>
      {AGGREGATION_GROUPS.map(group => <optgroup key={group.label[0]} label={t(...group.label)}>
        {group.kinds.map(aggregation => <option key={aggregation} value={aggregation}>{t(...AGGREGATION_LABELS[aggregation])}</option>)}
      </optgroup>)}
    </Select>
    {relation && <>
      <label>{t('Filtrar páginas relacionadas', 'Filter related pages')}</label>
      <small>{t('Só as páginas que atendem às regras entram no cálculo.', 'Only pages matching the rules are aggregated.')}</small>
      <RelatedRulesEditor databaseId={relation.field.relationDatabaseId} relatedProperties={relation.targets}
        rules={config?.filter ?? []} operator={config?.filterOperator ?? 'and'}
        onChange={(filter, filterOperator) => update({ filter: filter.length ? filter : undefined, filterOperator })} />
    </>}
  </div>
}
