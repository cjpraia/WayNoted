import { useEffect, useRef, useState } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import { runAI } from '../../../ai/client.ts'
import { getAIBridge } from '../../../ai/bridge.ts'
import { aiErrorMessage } from '../../../ai/errors.ts'
import { providerFor, useAISettings } from '../../../ai/settingsStore.ts'
import { isCloud } from '../../../ai/types.ts'
import { AIBadge } from '../../ai/AIBadge'
import { useI18n } from '../../../i18n'
import { MermaidPreview } from './MermaidPreview'
import { localHtmlDocument } from './htmlSandbox'
import { Select } from '../../ui/Select'
export { ExternalReferenceBlock } from '../ExternalReferenceBlock'

const MAX_HTML = 80_000

export const HtmlSandboxBlock = createReactBlockSpec(
  { type: 'htmlSandbox', propSchema: { html: { default: '<p>Hello</p>' } }, content: 'none' },
  { render: ({ block, editor }) => {
    const { t } = useI18n()
    return <div className="pg-html-sandbox" contentEditable={false}>
      {editor.isEditable && <textarea aria-label={t('Código HTML local', 'Local HTML code')} value={block.props.html} onChange={(event) => editor.updateBlock(block.id, { props: { html: event.target.value.slice(0, MAX_HTML) } })} />}
      <iframe title={t('Prévia HTML isolada', 'Isolated HTML preview')} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={localHtmlDocument(block.props.html)} />
      <small>{t('Prévia isolada, sem rede nem acesso aos seus arquivos.', 'Isolated preview, without network or access to your files.')}</small>
    </div>
  }, toExternalHTML: ({ block }) => <pre>{block.props.html}</pre> },
)

interface LocalTab { title: string; body: string }
export function parseTabs(value: string): LocalTab[] {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return [{ title: 'Tab 1', body: '' }]
    const tabs = parsed.slice(0, 8).filter((item): item is LocalTab => !!item && typeof item === 'object' && typeof item.title === 'string' && typeof item.body === 'string').map((item) => ({ title: item.title.slice(0, 80), body: item.body.slice(0, 20_000) }))
    return tabs.length ? tabs : [{ title: 'Tab 1', body: '' }]
  } catch { return [{ title: 'Tab 1', body: '' }] }
}
function TabsEditor({ tabsJson, editable, update }: { tabsJson: string; editable: boolean; update: (tabsJson: string) => void }) {
  const { t } = useI18n()
  const tabs = parseTabs(tabsJson)
  const [active, setActive] = useState(0)
  const selected = Math.min(active, tabs.length - 1)
  const save = (next: LocalTab[]) => update(JSON.stringify(next))
  return <div className="pg-tabs" contentEditable={false}>
    <div className="pg-tabs-bar" role="tablist">{tabs.map((tab, index) => <button type="button" role="tab" aria-selected={index === selected} key={index} onClick={() => setActive(index)}>{tab.title || t('Aba {n}', 'Tab {n}', { n: index + 1 })}</button>)}
      {editable && tabs.length < 8 && <button type="button" aria-label={t('Nova aba', 'New tab')} onClick={() => { save([...tabs, { title: t('Nova aba', 'New tab'), body: '' }]); setActive(tabs.length) }}>＋</button>}
    </div>
    {editable ? <><input aria-label={t('Nome da aba', 'Tab name')} value={tabs[selected].title} onChange={(event) => save(tabs.map((tab, index) => index === selected ? { ...tab, title: event.target.value } : tab))} /><textarea aria-label={t('Conteúdo da aba', 'Tab content')} value={tabs[selected].body} onChange={(event) => save(tabs.map((tab, index) => index === selected ? { ...tab, body: event.target.value } : tab))} />{tabs.length > 1 && <button type="button" onClick={() => { save(tabs.filter((_, index) => index !== selected)); setActive(Math.max(0, selected - 1)) }}>{t('Remover aba', 'Remove tab')}</button>}</> : <p role="tabpanel">{tabs[selected].body}</p>}
  </div>
}
export const TabsBlock = createReactBlockSpec(
  { type: 'tabs', propSchema: { tabsJson: { default: '[{"title":"Tab 1","body":""},{"title":"Tab 2","body":""}]' } }, content: 'none' },
  { render: ({ block, editor }) => <TabsEditor tabsJson={block.props.tabsJson} editable={editor.isEditable} update={(tabsJson) => editor.updateBlock(block.id, { props: { tabsJson } })} />, toExternalHTML: ({ block }) => <div>{parseTabs(block.props.tabsJson).map((tab, index) => <section key={index}><h3>{tab.title}</h3><p>{tab.body}</p></section>)}</div> },
)

function MermaidEditor({ id, source, editable, update }: { id: string; source: string; editable: boolean; update: (source: string) => void }) {
  const { t } = useI18n()
  return <div className="pg-mermaid" contentEditable={false}>
    {editable && <textarea aria-label={t('Código do diagrama', 'Diagram code')} value={source} onChange={(event) => update(event.target.value.slice(0, 10_000))} />}
    <MermaidPreview id={id} source={source} />
    <small>{t('Renderização Mermaid local; recursos externos são bloqueados.', 'Local Mermaid rendering; external resources are blocked.')}</small>
  </div>
}
export const MermaidBlock = createReactBlockSpec(
  { type: 'mermaid', propSchema: { source: { default: 'flowchart LR\nA[Start] --> B[Done]' } }, content: 'none' },
  { render: ({ block, editor }) => <MermaidEditor id={block.id} source={block.props.source} editable={editor.isEditable} update={(source) => editor.updateBlock(block.id, { props: { source } })} />, toExternalHTML: ({ block }) => <pre>{block.props.source}</pre> },
)

function LocalAIEditor({ prompt, context, output, editable, update, meeting }: { prompt: string; context: string; output: string; editable: boolean; update: (props: Partial<{ prompt: string; context: string; output: string }>) => void; meeting: boolean }) {
  const { locale, t } = useI18n()
  const settings = useAISettings()
  const provider = providerFor('blocks', settings)
  const cloud = isCloud(provider)
  const root = useRef<HTMLDivElement>(null)
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Bloco de IA (docs/AI.md §6): provedor do recurso "Blocos de IA" (Ollama local por padrão).
  useEffect(() => {
    let live = true
    const bridge = getAIBridge()
    if (!bridge) return
    if (cloud) { const configured = settings?.models[provider]; setModels(configured ? [configured] : []); setModel(configured ?? ''); return }
    void bridge.aiListModels('ollama').then((list) => { if (live) { const ids = list.map(item => item.id); setModels(ids); setModel((current) => ids.includes(current) ? current : ids[0] || '') } }).catch(() => {})
    return () => { live = false }
  }, [provider, cloud, settings?.models[provider]])
  const generate = async () => {
    if (!model || busy) { setError(cloud ? t('Escolha um modelo em Configurações → IA.', 'Choose a model in Settings → AI.') : t('Instale e selecione um modelo local para gerar.', 'Install and select a local model to generate.')); return }
    setBusy(true); setError('')
    // O contexto pertence à página que contém o bloco: o processo principal recusa páginas protegidas/lixeira.
    const pageId = root.current?.closest<HTMLElement>('[data-page-id]')?.dataset.pageId ?? ''
    try {
      const result = await runAI({ feature: 'blocks', operation: meeting ? 'summarize' : 'write', prompt: prompt || (meeting ? t('Resuma a reunião em decisões e tarefas.', 'Summarize the meeting into decisions and tasks.') : t('Escreva um rascunho.', 'Write a draft.')), sources: context.trim() ? [{ pageId, text: context }] : [], locale: locale === 'en-US' ? 'en-US' : 'pt-BR', ...(cloud ? {} : { model }) }, { onDelta: () => {} })
      setPreview(result.text)
    }
    catch (cause) { setError(aiErrorMessage(cause, t)) }
    finally { setBusy(false) }
  }
  return <div className="pg-ai-block" contentEditable={false} ref={root}>
    <strong>{meeting ? t('Notas de reunião com IA', 'AI Meeting Notes') : t('Bloco de IA', 'AI Block')} <AIBadge provider={provider} /></strong>
    {editable && <><textarea aria-label={t('Contexto ou transcrição', 'Context or transcript')} placeholder={meeting ? t('Cole a transcrição local da reunião.', 'Paste the local meeting transcript.') : t('Contexto opcional', 'Optional context')} value={context} onChange={(event) => update({ context: event.target.value.slice(0, 100_000) })} /><input aria-label={t('Instrução', 'Instruction')} value={prompt} onChange={(event) => update({ prompt: event.target.value.slice(0, 1000) })} /><Select aria-label={cloud ? t('Modelo', 'Model') : t('Modelo local', 'Local model')} value={model} disabled={cloud} onChange={(event) => setModel(event.target.value)}><option value="">{cloud ? t('Configure um modelo', 'Configure a model') : t('Selecione um modelo local', 'Select a local model')}</option>{models.map((item) => <option key={item} value={item}>{item}</option>)}</Select><button type="button" disabled={busy || !model} onClick={() => void generate()}>{busy ? t('Gerando…', 'Generating…') : t('Gerar prévia', 'Generate preview')}</button>{preview && <><textarea aria-label={t('Prévia editável', 'Editable preview')} value={preview} onChange={(event) => setPreview(event.target.value)} /><button type="button" onClick={() => { update({ output: preview }); setPreview('') }}>{t('Aplicar resultado', 'Apply result')}</button></>}</>}
    {error && <div role="alert">{error}</div>}<p>{output || (cloud ? t('Nenhum resultado salvo. A geração é opcional e usa o provedor em nuvem configurado.', 'No saved result. Generation is optional and uses the configured cloud provider.') : t('Nenhum resultado salvo. A geração é opcional e exige modelo no dispositivo.', 'No saved result. Generation is optional and requires a model on this device.'))}</p>
  </div>
}
const aiSpec = (type: 'aiBlock' | 'aiMeetingNotes', meeting: boolean) => createReactBlockSpec(
  { type, propSchema: { prompt: { default: '' }, context: { default: '' }, output: { default: '' } }, content: 'none' },
  { render: ({ block, editor }) => <LocalAIEditor prompt={block.props.prompt} context={block.props.context} output={block.props.output} editable={editor.isEditable} update={(props) => editor.updateBlock(block.id, { props })} meeting={meeting} />, toExternalHTML: ({ block }) => <p>{block.props.output || block.props.context}</p> },
)
export const AIBlock = aiSpec('aiBlock', false)
export const AIMeetingNotesBlock = aiSpec('aiMeetingNotes', true)
