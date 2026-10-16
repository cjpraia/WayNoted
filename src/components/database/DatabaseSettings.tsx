import { Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { actions, api, getState, selectors } from '../../store'
import { t } from '../../i18n'
import type { DatabaseTemplate } from '../../database-models'
import type { DatabaseSchema, Property, PropValue } from '../../types'
import { DbPopover, type DbAnchor } from './ui/Popover'
import { canAddSource } from './multiSource'
import { RowLayoutSettings } from './RowLayoutSettings'
import { Select } from '../ui/Select'
import { VariablePicker } from '../modals/VariablePicker'
import { AutomationsEditor } from './AutomationsEditor'

const repeatOptions = ['none', 'daily', 'weekly', 'monthly', 'yearly'] as const
const nextDay = () => Date.now() + 86_400_000

function simpleProps(schema: DatabaseSchema) {
  return schema.properties.filter((property) => ['text', 'number', 'checkbox', 'select', 'status', 'multiSelect', 'date', 'url', 'email', 'phone', 'person'].includes(property.type))
}

function defaultInput(value: unknown, property: Property, onChange: (value: PropValue) => void) {
  if (property.type === 'checkbox') return <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
  if (property.type === 'select' || property.type === 'status') return <Select value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value || null)}><option value="">{t('Vazio', 'Empty')}</option>{property.options?.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</Select>
  if (property.type === 'date') return <input type="date" value={value && typeof value === 'object' && 'start' in value ? String(value.start) : ''} onChange={(event) => onChange(event.target.value ? { start: event.target.value } : null)} />
  if (property.type === 'number') return <input type="number" value={typeof value === 'number' ? value : ''} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)} />
  if (property.type === 'multiSelect') return <Select multiple value={Array.isArray(value) ? value as string[] : []} onValuesChange={onChange}>{property.options?.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</Select>
  return <input value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} />
}

export type DatabaseSettingsSection = 'sources' | 'rowLayout' | 'templates' | 'automations'

/** Sem `anchor`, renderiza em linha (telas do painel de configurações); `only` limita a uma seção. */
export function DatabaseSettings({ dbId, schema, anchor, onClose, only }: { dbId: string; schema: DatabaseSchema; anchor?: DbAnchor; onClose?: () => void; only?: DatabaseSettingsSection }) {
  const show = (section: DatabaseSettingsSection) => !only || only === section
  const [templateStatus, setTemplateStatus] = useState('')
  const patch = (changes: Partial<DatabaseSchema>) => actions.updateSchema(dbId, (current) => ({ ...current, ...changes }))
  const patchTemplate = (id: string, changes: Partial<DatabaseTemplate>) => patch({ templates: (schema.templates ?? []).map((item) => item.id === id ? { ...item, ...changes } : item) })
  const captureTemplateBody = async (templateId: string, pageId: string) => {
    if (!pageId) return
    try {
      const page = selectors.page(pageId)
      if (!page || !selectors.isLive(pageId) || page.parentId !== dbId) throw new Error(t('Linha de origem indisponível.', 'Source row unavailable.'))
      const blocks = await api.loadDoc(pageId)
      if (!Array.isArray(blocks)) throw new Error(t('Corpo da página indisponível.', 'Page body unavailable.'))
      if (JSON.stringify(blocks).length > 1_000_000) throw new Error(t('Corpo do modelo excede 1 MB.', 'Template body exceeds 1 MB.'))
      actions.updateSchema(dbId, (current) => ({ ...current, templates: (current.templates ?? []).map((item) => item.id === templateId ? { ...item, bodyBlocks: structuredClone(blocks) } : item) }))
      setTemplateStatus(t('{count} blocos copiados para o modelo.', '{count} blocks copied into the template.', { count: blocks.length }))
    } catch (error) { setTemplateStatus(error instanceof Error ? error.message : t('Falha ao copiar corpo.', 'Could not copy body.')) }
  }
  const titleInputs = useRef(new Map<string, HTMLInputElement>())
  const insertInTitle = (id: string, current: string, token: string) => {
    const input = titleInputs.current.get(id)
    const start = input?.selectionStart ?? current.length
    const end = input?.selectionEnd ?? current.length
    patchTemplate(id, { title: current.slice(0, start) + token + current.slice(end) })
  }
  const addTemplate = () => patch({ templates: [...(schema.templates ?? []), { id: crypto.randomUUID(), name: t('Novo modelo', 'New template'), title: '', props: {} }] })
  const possibleSources = Object.values(getState().pages).filter((page) => page.database && !page.trashed && canAddSource(dbId, page.id, getState().pages))
  const body = <div className={`db-settings${only ? ' db-settings--inline' : ''}`}>
      {show('sources') && <section><header><strong>{t('Fontes locais', 'Local sources')}</strong></header><p>{t('Combine bancos deste workspace em uma visualização somente leitura. As linhas são editadas nas fontes.', 'Combine databases in this workspace in a read-only view. Edit rows at their sources.')}</p><details className="db-settings-layout"><summary>{t('Escolher fontes', 'Choose sources')}</summary>{possibleSources.map((source) => <label key={source.id} className="db-settings-check"><input type="checkbox" checked={schema.sourceDatabaseIds?.includes(source.id) ?? false} onChange={(event) => patch({ sourceDatabaseIds: event.target.checked ? [...(schema.sourceDatabaseIds ?? []), source.id] : (schema.sourceDatabaseIds ?? []).filter((id) => id !== source.id) })} />{source.title || t('Sem título', 'Untitled')}</label>)}</details></section>}
      {show('rowLayout') && <RowLayoutSettings dbId={dbId} schema={schema} patch={rowLayout => patch({ rowLayout })} />}
      {show('templates') && <section><header><strong>{t('Modelos', 'Templates')}</strong><button type="button" onClick={addTemplate}><Plus size={14} />{t('Adicionar', 'Add')}</button></header>
        <p>{t('Aplique valores e corpo iniciais; crie linhas repetidas enquanto o aplicativo estiver ativo. Edite uma linha-modelo e copie seu corpo aqui.', 'Apply default values and page body; create recurring rows while the app is active. Edit a sample row, then copy its body here.')}</p>
        {templateStatus && <div role="status" className="dbv-csv-status">{templateStatus}</div>}
        {(schema.templates ?? []).map((template) => <div className="db-settings-item" key={template.id}>
          <div className="db-settings-line"><input aria-label={t('Nome do modelo', 'Template name')} value={template.name} onChange={(event) => patchTemplate(template.id, { name: event.target.value })} /><button type="button" aria-label={t('Excluir modelo', 'Delete template')} onClick={() => patch({ templates: schema.templates?.filter((item) => item.id !== template.id), defaultTemplateId: schema.defaultTemplateId === template.id ? undefined : schema.defaultTemplateId })}><Trash2 size={14} /></button></div>
          <label>{t('Título inicial', 'Initial title')}<input ref={(element) => { if (element) titleInputs.current.set(template.id, element); else titleInputs.current.delete(template.id) }} value={template.title} onChange={(event) => patchTemplate(template.id, { title: event.target.value })} /></label>
          <div className="db-settings-line"><VariablePicker scope="row" onPick={(token) => insertInTitle(template.id, template.title, token)} /><small>{t('Variáveis também valem no corpo e em valores de texto.', 'Variables also work in the body and in text values.')}</small></div>
          <label className="db-settings-check"><input type="checkbox" checked={schema.defaultTemplateId === template.id} onChange={(event) => patch({ defaultTemplateId: event.target.checked ? template.id : undefined })} />{t('Modelo padrão', 'Default template')}</label>
          <label>{t('Repetição', 'Repeat')}<Select value={template.repeat ?? 'none'} onChange={(event) => patchTemplate(template.id, { repeat: event.target.value as DatabaseTemplate['repeat'], nextRunAt: event.target.value === 'none' ? undefined : nextDay() })}>{repeatOptions.map((repeat) => <option key={repeat} value={repeat}>{repeat === 'none' ? t('Nunca', 'Never') : repeat === 'daily' ? t('Diária', 'Daily') : repeat === 'weekly' ? t('Semanal', 'Weekly') : repeat === 'monthly' ? t('Mensal', 'Monthly') : t('Anual', 'Yearly')}</option>)}</Select></label>
          <details><summary>{t('Valores iniciais', 'Initial values')}</summary>{simpleProps(schema).map((property) => <label key={property.id}>{property.name}{defaultInput(template.props[property.id], property, (value) => patchTemplate(template.id, { props: { ...template.props, [property.id]: value } }))}</label>)}</details>
          <label>{t('Corpo da página', 'Page body')} <Select value="" aria-label={t('Copiar corpo de linha', 'Copy body from row')} onChange={(event) => void captureTemplateBody(template.id, event.target.value)}><option value="">{t('Copiar de uma linha…', 'Copy from a row…')}</option>{selectors.rows(dbId).filter((row) => selectors.isLive(row.id)).map((row) => <option key={row.id} value={row.id}>{row.title || t('Sem título', 'Untitled')}</option>)}</Select></label>
          <div className="db-settings-line"><small>{template.bodyBlocks ? t('{count} blocos salvos', '{count} saved blocks', { count: template.bodyBlocks.length }) : t('Sem corpo salvo', 'No saved body')}</small>{template.bodyBlocks && <button type="button" onClick={() => patchTemplate(template.id, { bodyBlocks: undefined })}>{t('Limpar corpo', 'Clear body')}</button>}</div>
          <button type="button" className="db-settings-create" onClick={() => { const id = actions.createRow(dbId, {}, {}, template.id); actions.openPeek(id) }}>{t('Criar linha com modelo', 'Create row from template')}</button>
        </div>)}
      </section>}
      {show('automations') && <AutomationsEditor dbId={dbId} schema={schema} />}
    </div>
  if (!anchor) return body
  return <DbPopover anchor={anchor} onClose={onClose ?? (() => {})} label={t('Configurações do banco', 'Database settings')} className="db-settings-pop">{body}</DbPopover>
}
