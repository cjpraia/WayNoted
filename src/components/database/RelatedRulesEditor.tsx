// Editor compacto de regras sobre páginas de outro banco: filtro do rollup e filtro salvo da
// escolha de páginas de uma relação. Regras combinadas por E/OU.
import { Plus, X } from 'lucide-react'
import { getState } from '../../store'
import { useI18n } from '../../i18n'
import type { Property } from '../../types'
import type { RelatedFilterRule } from '../../database-models'
import './propertyConfig.css'
import { Select } from '../ui/Select'

type Op = RelatedFilterRule['op']

export function opsForRule(property: Property | undefined): Op[] {
  switch (property?.type) {
    case 'checkbox': return ['checked', 'unchecked']
    case 'number': case 'formula': case 'rollup': return ['is', 'isNot', 'gt', 'lt', 'gte', 'lte', 'contains', 'isEmpty', 'isNotEmpty']
    case 'date': case 'createdTime': case 'updatedTime': return ['is', 'before', 'after', 'isEmpty', 'isNotEmpty']
    case 'select': case 'status': return ['is', 'isNot', 'isEmpty', 'isNotEmpty']
    case 'multiSelect': case 'relation': return ['contains', 'notContains', 'isEmpty', 'isNotEmpty']
    default: return ['contains', 'notContains', 'is', 'isNot', 'isEmpty', 'isNotEmpty']
  }
}

export function RelatedRulesEditor({ databaseId, rules, operator, onChange, disabled }: {
  databaseId: string | undefined
  rules: RelatedFilterRule[]
  operator: 'and' | 'or'
  onChange: (rules: RelatedFilterRule[], operator: 'and' | 'or') => void
  disabled?: boolean
}) {
  const { t } = useI18n()
  const properties = databaseId ? getState().pages[databaseId]?.database?.properties.filter((p) => p.type !== 'button') ?? [] : []
  const opLabel = (op: Op) => ({
    is: t('é', 'is'), isNot: t('não é', 'is not'), contains: t('contém', 'contains'), notContains: t('não contém', 'does not contain'),
    gt: '>', lt: '<', gte: '≥', lte: '≤', before: t('antes de', 'before'), after: t('depois de', 'after'),
    isEmpty: t('está vazio', 'is empty'), isNotEmpty: t('não está vazio', 'is not empty'), checked: t('marcado', 'checked'), unchecked: t('desmarcado', 'unchecked'),
  })[op]
  const patch = (index: number, next: Partial<RelatedFilterRule>) => onChange(rules.map((rule, at) => at === index ? { ...rule, ...next } : rule), operator)
  if (!databaseId) return null
  return <div className="db-rules">
    {rules.map((rule, index) => {
      const property = properties.find((p) => p.id === rule.propertyId)
      const ops = opsForRule(property)
      const needsValue = !['isEmpty', 'isNotEmpty', 'checked', 'unchecked'].includes(rule.op)
      return <div className="db-rule" key={rule.id}>
        {index === 0 ? <span className="db-rule-join">{t('Onde', 'Where')}</span> : index === 1 ? <Select className="dbv-input db-rule-join" disabled={disabled} aria-label={t('Combinar regras', 'Combine rules')} value={operator} onChange={(event) => onChange(rules, event.target.value as 'and' | 'or')}><option value="and">{t('E', 'And')}</option><option value="or">{t('Ou', 'Or')}</option></Select> : <span className="db-rule-join">{operator === 'and' ? t('E', 'And') : t('Ou', 'Or')}</span>}
        <Select className="dbv-input" disabled={disabled} aria-label={t('Propriedade', 'Property')} value={rule.propertyId} onChange={(event) => { const next = properties.find((p) => p.id === event.target.value); patch(index, { propertyId: event.target.value, op: opsForRule(next)[0], value: null }) }}>
          {!property && <option value="">{t('Propriedade', 'Property')}</option>}
          {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select className="dbv-input" disabled={disabled} aria-label={t('Condição', 'Condition')} value={rule.op} onChange={(event) => patch(index, { op: event.target.value as Op })}>
          {ops.map((op) => <option key={op} value={op}>{opLabel(op)}</option>)}
        </Select>
        {needsValue && (property?.options && ['select', 'status', 'multiSelect'].includes(property.type)
          ? <Select className="dbv-input" disabled={disabled} aria-label={t('Valor', 'Value')} value={String(rule.value ?? '')} onChange={(event) => patch(index, { value: event.target.value || null })}><option value="">{t('Escolha…', 'Choose…')}</option>{property.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</Select>
          : <input className="dbv-input" disabled={disabled} aria-label={t('Valor', 'Value')} type={['date', 'createdTime', 'updatedTime'].includes(property?.type ?? '') ? 'date' : ['gt', 'lt', 'gte', 'lte'].includes(rule.op) ? 'number' : 'text'} value={String(rule.value ?? '')} onChange={(event) => patch(index, { value: ['gt', 'lt', 'gte', 'lte'].includes(rule.op) && event.target.value !== '' ? Number(event.target.value) : event.target.value })} />)}
        <button type="button" className="dbv-icon-btn" disabled={disabled} aria-label={t('Remover regra', 'Remove rule')} onClick={() => onChange(rules.filter((_, at) => at !== index), operator)}><X size={14} /></button>
      </div>
    })}
    <button type="button" className="dbv-link db-rule-add" disabled={disabled || !properties.length} onClick={() => { const first = properties.find((p) => p.type !== 'title') ?? properties[0]; onChange([...rules, { id: crypto.randomUUID(), propertyId: first.id, op: opsForRule(first)[0], value: null }], operator) }}><Plus size={14} /> {t('Adicionar filtro', 'Add filter')}</button>
  </div>
}

/** Escolha de páginas da relação: filtro salvo, ordenação e propriedades exibidas dos candidatos. */
export function RelationPickerConfig({ property, onPatch }: { property: Property; onPatch: (patch: Partial<Property>) => void }) {
  const { t } = useI18n()
  const target = property.relationDatabaseId ? getState().pages[property.relationDatabaseId]?.database : undefined
  const picker = property.relationPicker ?? {}
  const set = (patch: Partial<NonNullable<Property['relationPicker']>>) => {
    const next = { ...picker, ...patch }
    const empty = !next.filters?.length && !next.sortPropertyId && !next.shownPropertyIds?.length
    onPatch({ relationPicker: empty ? undefined : next })
  }
  if (!target) return null
  const shown = picker.shownPropertyIds ?? []
  return <>
    <label>{t('Páginas oferecidas ao escolher', 'Pages offered when choosing')}</label>
    <RelatedRulesEditor databaseId={property.relationDatabaseId} rules={picker.filters ?? []} operator={picker.filterOperator ?? 'and'} onChange={(filters, filterOperator) => set({ filters: filters.length ? filters : undefined, filterOperator })} />
    <label htmlFor={`relation-sort-${property.id}`}>{t('Ordenar candidatos por', 'Sort candidates by')}</label>
    <div className="db-rule">
      <Select id={`relation-sort-${property.id}`} className="dbv-input" value={picker.sortPropertyId ?? ''} onChange={(event) => set({ sortPropertyId: event.target.value || undefined })}>
        <option value="">{t('Ordem manual', 'Manual order')}</option>
        {target.properties.filter((p) => p.type !== 'button').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      <Select className="dbv-input" aria-label={t('Direção', 'Direction')} disabled={!picker.sortPropertyId} value={picker.sortDirection ?? 'asc'} onChange={(event) => set({ sortDirection: event.target.value as 'asc' | 'desc' })}>
        <option value="asc">{t('Crescente', 'Ascending')}</option>
        <option value="desc">{t('Decrescente', 'Descending')}</option>
      </Select>
    </div>
    <label>{t('Mostrar nos candidatos', 'Show on candidates')}</label>
    <div className="db-dependent-parents">
      {target.properties.filter((p) => p.type !== 'title' && p.type !== 'button').map((p) => {
        const on = shown.includes(p.id)
        return <button type="button" key={p.id} aria-pressed={on} className={`db-dependent-toggle${on ? ' is-on' : ''}`} onClick={() => set({ shownPropertyIds: on ? shown.filter((id) => id !== p.id) : [...shown, p.id] })}>{p.name}</button>
      })}
    </div>
  </>
}
