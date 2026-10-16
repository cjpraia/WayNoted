// Automações locais do banco (A4): gatilhos, condições, ações, botão "Testar" com prévia e registro das últimas 50 execuções.
// Tudo é local e as escritas passam pelo store (guardas de bloqueio/senha/lixeira). Estilos: db-settings-* + automations.css.
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { actions, getState, selectors, useStore } from '../../store'
import { t } from '../../i18n'
import type { AutomationAction, AutomationCondition, AutomationTrigger, DatabaseAutomation } from '../../database-models'
import type { DatabaseSchema, Property, PropValue } from '../../types'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { Toggle } from '../ui/Toggle'
import { describeTrigger, previewAutomation, type AutomationPreview, type DescribeContext } from './automations'
import './automations.css'

const nextDay = () => Date.now() + 86_400_000
const SIMPLE = ['text', 'number', 'checkbox', 'select', 'status', 'multiSelect', 'date', 'url', 'email', 'phone', 'person']
const SETTABLE = ['text', 'number', 'checkbox', 'select', 'status', 'url', 'email', 'phone', 'person']
const simpleProps = (schema: DatabaseSchema) => schema.properties.filter(property => SIMPLE.includes(property.type))

const TRIGGERS: { kind: AutomationTrigger['kind']; pt: string; en: string }[] = [
  { kind: 'propertyChange', pt: 'Propriedade alterada', en: 'Property changed' },
  { kind: 'rowCreated', pt: 'Linha/página criada', en: 'Row/page created' },
  { kind: 'typeAdded', pt: 'Tag/tipo adicionado', en: 'Tag/type added' },
  { kind: 'taskCompleted', pt: 'Tarefa concluída', en: 'Task completed' },
  { kind: 'dateArrived', pt: 'Data chegou', en: 'Date arrived' },
  { kind: 'scheduled', pt: 'Agendado', en: 'Scheduled' },
]
const ACTIONS: { kind: AutomationAction['kind']; pt: string; en: string }[] = [
  { kind: 'setProperty', pt: 'Definir propriedade', en: 'Set property' },
  { kind: 'setTitle', pt: 'Definir título', en: 'Set title' },
  { kind: 'createTask', pt: 'Criar tarefa na linha', en: 'Create task on the row' },
  { kind: 'addType', pt: 'Adicionar tag/tipo', en: 'Add tag/type' },
  { kind: 'notify', pt: 'Notificar', en: 'Notify' },
  { kind: 'createRow', pt: 'Criar linha', en: 'Create row' },
  { kind: 'duplicateRow', pt: 'Duplicar linha', en: 'Duplicate row' },
  { kind: 'moveRow', pt: 'Mover para outro banco', en: 'Move to another database' },
  { kind: 'archiveRow', pt: 'Enviar para a lixeira', en: 'Move to trash' },
]
const OPS: { op: AutomationCondition['op']; pt: string; en: string }[] = [
  { op: 'equals', pt: 'é igual a', en: 'equals' }, { op: 'notEquals', pt: 'é diferente de', en: 'is not' }, { op: 'contains', pt: 'contém', en: 'contains' },
  { op: 'notEmpty', pt: 'está preenchido', en: 'is filled in' }, { op: 'empty', pt: 'está vazio', en: 'is empty' },
]

const context = (): DescribeContext => ({
  t, typeName: id => getState().settings.objectTypes?.find(type => type.id === id)?.name, pageTitle: id => getState().pages[id]?.title || undefined,
})

function defaultActionValue(property?: Property): string | number | boolean | null {
  return property?.type === 'number' ? 0 : property?.type === 'checkbox' ? false : property?.type === 'select' || property?.type === 'status' ? property.options?.[0]?.id ?? null : ''
}

function newAction(kind: AutomationAction['kind'], schema: DatabaseSchema): AutomationAction {
  const settable = simpleProps(schema).filter(property => SETTABLE.includes(property.type))
  switch (kind) {
    case 'setProperty': return { kind, propertyId: settable[0]?.id ?? '', value: defaultActionValue(settable[0]) }
    case 'setTitle': return { kind, value: '' }
    case 'createTask': return { kind, title: t('Revisar: {titulo}', 'Review: {titulo}'), inDays: 1 }
    case 'addType': return { kind, typeId: getState().settings.objectTypes?.[0]?.id ?? '' }
    case 'notify': return { kind, message: t('Automação: {titulo}', 'Automation: {titulo}') }
    case 'moveRow': return { kind, databaseId: '' }
    case 'createRow': return { kind }
    case 'duplicateRow': return { kind }
    default: return { kind: 'archiveRow' }
  }
}

function newTrigger(kind: AutomationTrigger['kind'], schema: DatabaseSchema): AutomationTrigger {
  const dateProp = schema.properties.find(property => property.type === 'date')
  switch (kind) {
    case 'propertyChange': return { kind, propertyId: simpleProps(schema)[0]?.id ?? '' }
    case 'typeAdded': return { kind, typeId: '' }
    case 'dateArrived': return { kind, propertyId: dateProp?.id ?? '', offsetDays: 0 }
    case 'scheduled': return { kind, every: 'daily', nextRunAt: nextDay() }
    default: return { kind } as AutomationTrigger
  }
}

function ValueInput({ property, value, onChange, label }: { property?: Property; value: unknown; onChange: (value: string | number | boolean | null) => void; label: string }) {
  if (property?.type === 'checkbox') return <label className="db-settings-check"><input type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} />{t('Marcado', 'Checked')}</label>
  if (property && (property.type === 'select' || property.type === 'status' || property.type === 'multiSelect')) return <Select aria-label={label} value={String(value ?? '')} onChange={event => onChange(event.target.value || null)}><option value="">{t('Vazio', 'Empty')}</option>{property.options?.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</Select>
  return <input aria-label={label} type={property?.type === 'number' ? 'number' : 'text'} value={String(value ?? '')} onChange={event => onChange(property?.type === 'number' ? (event.target.value ? Number(event.target.value) : null) : event.target.value)} />
}

export function AutomationsEditor({ dbId, schema }: { dbId: string; schema: DatabaseSchema }) {
  useStore()
  const [previews, setPreviews] = useState<Record<string, AutomationPreview & { row: string }>>({})
  const [testRow, setTestRow] = useState<Record<string, string>>({})
  const automations = schema.automations ?? []
  const patch = (changes: Partial<DatabaseSchema>) => actions.updateSchema(dbId, current => ({ ...current, ...changes }))
  const update = (id: string, changes: Partial<DatabaseAutomation>) => patch({ automations: automations.map(item => item.id === id ? { ...item, ...changes } : item) })
  const add = () => patch({ automations: [...automations, { id: crypto.randomUUID(), name: t('Nova automação', 'New automation'), enabled: false, trigger: newTrigger('propertyChange', schema), actions: [] }] })
  const props = simpleProps(schema)
  const settable = props.filter(property => SETTABLE.includes(property.type))
  const types = getState().settings.objectTypes ?? []
  const otherDatabases = Object.values(getState().pages).filter(page => page.database && page.id !== dbId && !page.trashed && selectors.isLive(page.id) && !page.locked)
  const rows = selectors.rows(dbId).filter(row => selectors.isLive(row.id)).slice(0, 50)

  const setEnabled = (automation: DatabaseAutomation, enabled: boolean) => {
    // "Data chegou" recomeça do zero ao ligar: as datas que passaram enquanto estava desligada não disparam de uma vez.
    update(automation.id, { enabled, ...(enabled && automation.trigger.kind === 'dateArrived' ? { fired: undefined } : {}) })
  }
  const test = (automation: DatabaseAutomation) => {
    const rowId = testRow[automation.id] || rows[0]?.id
    const row = rowId ? getState().pages[rowId] : undefined
    if (!row) return
    const preview = previewAutomation(schema, automation, row, context())
    setPreviews(current => ({ ...current, [automation.id]: { ...preview, row: row.title || t('Sem título', 'Untitled') } }))
    actions.logAutomation(dbId, { automationId: automation.id, name: automation.name, rowId, rowTitle: row.title, status: 'test', detail: `${preview.wouldRun ? t('Rodaria', 'Would run') : t('Não rodaria (condição)', 'Would not run (condition)')}: ${preview.steps.join(' · ')}` })
  }

  return <section className="am-root">
    <header><strong>{t('Automações locais', 'Local automations')}</strong><button type="button" onClick={add}><Plus size={14} />{t('Adicionar', 'Add')}</button></header>
    <p>{t('Quando algo acontece numa linha, a regra confere as condições e faz as ações. Tudo acontece neste Mac, sem rede. Use “Testar” para ver o que ela faria, sem alterar nada. Regras que disparam outras param depois de {n} níveis.', 'When something happens to a row, the rule checks its conditions and runs its actions. Everything happens on this Mac, with no network. Use “Test” to see what it would do without changing anything. Rules that trigger others stop after {n} levels.', { n: 3 })}</p>
    {automations.map(automation => {
      const trigger = automation.trigger
      const preview = previews[automation.id]
      return <div className="db-settings-item am-item" key={automation.id}>
        <div className="db-settings-line"><input aria-label={t('Nome da automação', 'Automation name')} value={automation.name} onChange={event => update(automation.id, { name: event.target.value })} /><button type="button" aria-label={t('Excluir automação', 'Delete automation')} onClick={() => patch({ automations: automations.filter(item => item.id !== automation.id) })}><Trash2 size={14} /></button></div>
        <Toggle label={t('Ativa', 'Enabled')} checked={automation.enabled} onChange={value => setEnabled(automation, value)} />
        <p className="am-summary">{describeTrigger(schema, trigger, context())}</p>

        <label>{t('Gatilho', 'Trigger')}<Select value={trigger.kind} onChange={event => update(automation.id, { trigger: newTrigger(event.target.value as AutomationTrigger['kind'], schema), ...(event.target.value === 'dateArrived' ? { fired: undefined } : {}) })}>
          {TRIGGERS.map(item => <option key={item.kind} value={item.kind}>{t(item.pt, item.en)}</option>)}
        </Select></label>
        {trigger.kind === 'propertyChange' && <label>{t('Propriedade', 'Property')}<Select value={trigger.propertyId} onChange={event => update(automation.id, { trigger: { kind: 'propertyChange', propertyId: event.target.value } })}>{props.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</Select></label>}
        {trigger.kind === 'typeAdded' && <label>{t('Tag/tipo', 'Tag/type')}<Select value={trigger.typeId ?? ''} onChange={event => update(automation.id, { trigger: { kind: 'typeAdded', typeId: event.target.value } })}><option value="">{t('Qualquer', 'Any')}</option>{types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</Select></label>}
        {trigger.kind === 'dateArrived' && <div className="db-settings-action">
          <Select aria-label={t('Propriedade de data', 'Date property')} value={trigger.propertyId} onChange={event => update(automation.id, { trigger: { ...trigger, propertyId: event.target.value }, fired: undefined })}>{schema.properties.filter(property => property.type === 'date').map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</Select>
          <input aria-label={t('Dias antes (−) ou depois (+) da data', 'Days before (−) or after (+) the date')} type="number" value={trigger.offsetDays ?? 0} onChange={event => update(automation.id, { trigger: { ...trigger, offsetDays: Number(event.target.value) || 0 }, fired: undefined })} />
          <small>{t('dias (− antes, + depois)', 'days (− before, + after)')}</small>
        </div>}
        {trigger.kind === 'scheduled' && <label>{t('Frequência', 'Frequency')}<Select value={trigger.every} onChange={event => update(automation.id, { trigger: { kind: 'scheduled', every: event.target.value as 'daily' | 'weekly' | 'monthly', nextRunAt: nextDay() } })}><option value="daily">{t('Diária', 'Daily')}</option><option value="weekly">{t('Semanal', 'Weekly')}</option><option value="monthly">{t('Mensal', 'Monthly')}</option></Select></label>}

        <div className="am-block">
          <strong>{t('Condições (todas precisam valer)', 'Conditions (all must hold)')}</strong>
          {(automation.conditions ?? []).map((condition, index) => {
            const property = condition.propertyId === '@title' ? undefined : props.find(item => item.id === condition.propertyId)
            const setCondition = (next: AutomationCondition) => update(automation.id, { conditions: (automation.conditions ?? []).map((item, at) => at === index ? next : item) })
            return <div className="db-settings-action" key={index}>
              <Select aria-label={t('Propriedade da condição', 'Condition property')} value={condition.propertyId} onChange={event => setCondition({ propertyId: event.target.value, op: 'equals', value: '' })}>
                <option value="@title">{t('Título', 'Title')}</option>{props.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
              <Select aria-label={t('Operador', 'Operator')} value={condition.op} onChange={event => setCondition({ ...condition, op: event.target.value as AutomationCondition['op'] })}>{OPS.map(item => <option key={item.op} value={item.op}>{t(item.pt, item.en)}</option>)}</Select>
              {condition.op !== 'empty' && condition.op !== 'notEmpty' && <ValueInput property={property} value={condition.value} label={t('Valor da condição', 'Condition value')} onChange={value => setCondition({ ...condition, value })} />}
              <button type="button" aria-label={t('Remover condição', 'Remove condition')} onClick={() => update(automation.id, { conditions: (automation.conditions ?? []).filter((_, at) => at !== index) })}><Trash2 size={14} /></button>
            </div>
          })}
          <button type="button" className="db-settings-create" onClick={() => update(automation.id, { conditions: [...(automation.conditions ?? []), { propertyId: '@title', op: 'notEmpty' }] })}>{t('Adicionar condição', 'Add condition')}</button>
        </div>

        <div className="am-block">
          <strong>{t('Ações', 'Actions')}</strong>
          {automation.actions.map((action, index) => {
            const setAction = (next: AutomationAction) => update(automation.id, { actions: automation.actions.map((item, at) => at === index ? next : item) })
            const selected = action.kind === 'setProperty' ? settable.find(property => property.id === action.propertyId) : undefined
            return <div className="db-settings-action" key={index}>
              <Select aria-label={t('Tipo da ação', 'Action type')} value={action.kind} onChange={event => setAction(newAction(event.target.value as AutomationAction['kind'], schema))}>
                {ACTIONS.map(item => <option key={item.kind} value={item.kind}>{t(item.pt, item.en)}</option>)}
              </Select>
              {action.kind === 'setProperty' && <>
                <Select aria-label={t('Propriedade', 'Property')} value={action.propertyId} onChange={event => { const property = settable.find(item => item.id === event.target.value); setAction({ ...action, propertyId: event.target.value, value: defaultActionValue(property) }) }}>{settable.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</Select>
                <ValueInput property={selected} value={action.value} label={t('Valor da ação', 'Action value')} onChange={value => setAction({ ...action, value: value as PropValue as string | number | boolean | null })} />
              </>}
              {action.kind === 'setTitle' && <input aria-label={t('Novo título', 'New title')} value={action.value} onChange={event => setAction({ ...action, value: event.target.value })} />}
              {action.kind === 'createRow' && <Select aria-label={t('Modelo', 'Template')} value={action.templateId ?? ''} onChange={event => setAction({ ...action, templateId: event.target.value || undefined })}><option value="">{t('Sem modelo', 'No template')}</option>{schema.templates?.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</Select>}
              {action.kind === 'createTask' && <>
                <input aria-label={t('Título da tarefa', 'Task title')} value={action.title} onChange={event => setAction({ ...action, title: event.target.value })} />
                <input aria-label={t('Prazo em dias (vazio = sem prazo)', 'Due in days (empty = no due date)')} type="number" min={0} value={action.inDays ?? ''} onChange={event => setAction({ ...action, inDays: event.target.value === '' ? undefined : Number(event.target.value) })} />
                <small>{t('dias (vazio = sem prazo)', 'days (empty = no due date)')}</small>
              </>}
              {action.kind === 'addType' && <Select aria-label={t('Tag/tipo', 'Tag/type')} value={action.typeId} onChange={event => setAction({ ...action, typeId: event.target.value })}>{!types.length && <option value="">{t('Nenhum tipo criado', 'No types yet')}</option>}{types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</Select>}
              {action.kind === 'notify' && <input aria-label={t('Mensagem', 'Message')} value={action.message} onChange={event => setAction({ ...action, message: event.target.value })} />}
              {action.kind === 'moveRow' && <Select aria-label={t('Banco de destino', 'Destination database')} value={action.databaseId} onChange={event => setAction({ ...action, databaseId: event.target.value })}><option value="">{t('Escolher banco…', 'Choose database…')}</option>{otherDatabases.map(page => <option key={page.id} value={page.id}>{page.title || t('Sem título', 'Untitled')}</option>)}</Select>}
              <button type="button" aria-label={t('Remover ação', 'Remove action')} onClick={() => update(automation.id, { actions: automation.actions.filter((_, at) => at !== index) })}><Trash2 size={14} /></button>
            </div>
          })}
          <button type="button" className="db-settings-create" onClick={() => update(automation.id, { actions: [...automation.actions, newAction('notify', schema)] })}>{t('Adicionar ação', 'Add action')}</button>
        </div>

        <div className="am-test">
          <Select aria-label={t('Linha para testar', 'Row to test with')} value={testRow[automation.id] || rows[0]?.id || ''} onChange={event => setTestRow(current => ({ ...current, [automation.id]: event.target.value }))}>
            {!rows.length && <option value="">{t('Nenhuma linha', 'No rows')}</option>}
            {rows.map(row => <option key={row.id} value={row.id}>{row.title || t('Sem título', 'Untitled')}</option>)}
          </Select>
          <Button disabled={!rows.length} onClick={() => test(automation)}>{t('Testar', 'Test')}</Button>
        </div>
        {preview && <div className="am-preview" role="status" aria-label={t('Prévia do teste', 'Test preview')}>
          <strong>{t('Teste com “{row}” — nada foi alterado', 'Test with “{row}” — nothing was changed', { row: preview.row })}</strong>
          <span>{preview.trigger}</span>
          {preview.conditions.map((entry, index) => <span key={index} className={entry.pass ? 'is-pass' : 'is-fail'}>{entry.pass ? '✓' : '✗'} {entry.text}</span>)}
          <span className={preview.wouldRun ? 'is-pass' : 'is-fail'}>{preview.wouldRun ? t('A regra rodaria e faria:', 'The rule would run and do:') : t('A regra não rodaria para esta linha (condição não atendida).', 'The rule would not run for this row (condition not met).')}</span>
          {preview.wouldRun && <ol>{preview.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}
          {preview.ignored > 0 && <span className="is-fail">{t('{n} ação(ões) seriam ignoradas por apontarem algo que não existe mais.', '{n} action(s) would be ignored because they point to something that no longer exists.', { n: preview.ignored })}</span>}
        </div>}
      </div>
    })}
    <details className="am-log">
      <summary>{t('Registro de execuções ({n})', 'Run log ({n})', { n: schema.automationLog?.length ?? 0 })}</summary>
      {schema.automationLog?.length ? <ul>{schema.automationLog.map((entry, index) => <li key={index} className={`am-log-${entry.status}`}>
        <time>{new Date(entry.at).toLocaleString(getState().settings.locale, { dateStyle: 'short', timeStyle: 'short' })}</time> <strong>{entry.name}</strong> {entry.rowTitle && <span>“{entry.rowTitle}”</span>} <em>{entry.status === 'done' ? t('feito', 'done') : entry.status === 'error' ? t('erro', 'error') : entry.status === 'test' ? t('teste', 'test') : t('ignorada', 'skipped')}</em> <span className="am-detail">{entry.detail}</span>
      </li>)}</ul> : <p>{t('Nenhuma execução ainda.', 'No runs yet.')}</p>}
    </details>
  </section>
}
