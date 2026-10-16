import PRODUCT from '../../../shared/product.json' with { type: 'json' }
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Cloud, KeyRound, Laptop, PlugZap, RefreshCw, Trash2, XCircle } from 'lucide-react'
import { useI18n } from '../../i18n'
import { getAIBridge } from '../../ai/bridge.ts'
import { aiErrorMessage } from '../../ai/errors.ts'
import { setAISettings, useAISettings } from '../../ai/settingsStore.ts'
import { PROVIDER_LABEL, isCloud, type AIFeature, type EmbeddingMode, type EmbedStatus, type AIModelInfo, type AIProviderStatus, type AISettings as Settings, type AISettingsPatch, type CloudProviderId, type ProviderId } from '../../ai/types.ts'
import { refreshEmbeddingBackend } from '../../ai/indexRunner.ts'
import { requestAIConsent } from './AIPromptsHost'
import './ai.css'
import { Select } from '../ui/Select'
import { Button } from '../ui/Button'

const PROVIDERS: ProviderId[] = ['ollama', 'openrouter', 'google']

function Status({ status }: { status?: AIProviderStatus }) {
  const { t } = useI18n()
  if (!status) return <span className="ai-status">…</span>
  const map: Record<AIProviderStatus['state'], [string, string, typeof CheckCircle2]> = {
    ready: ['is-ready', t('Pronto', 'Ready'), CheckCircle2],
    'no-model': ['is-warn', t('Sem modelo instalado', 'No model installed'), AlertTriangle],
    offline: ['is-error', t('Offline', 'Offline'), XCircle],
    'no-key': ['is-warn', t('Sem chave', 'No key'), AlertTriangle],
    'no-consent': ['is-warn', t('Aguardando autorização', 'Awaiting authorization'), AlertTriangle],
    blocked: ['is-error', t('Bloqueado', 'Blocked'), XCircle],
  }
  const [className, label, Icon] = map[status.state]
  return <span className={`ai-status ${className}`} data-state={status.state}><Icon size={13} strokeWidth={1.9} aria-hidden />{label}</span>
}

function ModelPicker({ provider, value, onChange, disabled }: { provider: ProviderId; value: string; onChange: (model: string) => void; disabled?: boolean }) {
  const { t } = useI18n()
  const [models, setModels] = useState<AIModelInfo[] | null>(null)
  const [query, setQuery] = useState(value)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setQuery(value); setModels(null); setError('') }, [provider, value])
  const load = async () => {
    const bridge = getAIBridge(); if (!bridge) return
    setLoading(true); setError('')
    try { setModels(await bridge.aiListModels(provider)) } catch (cause) { setError(aiErrorMessage(cause, t)) } finally { setLoading(false) }
  }
  const filtered = useMemo(() => { const q = query.trim().toLowerCase(); return (models ?? []).filter(model => !q || model.id.toLowerCase().includes(q) || model.name.toLowerCase().includes(q)).slice(0, 60) }, [models, query])
  return <div className="ai-field">
    <span>{t('Modelo', 'Model')}</span>
    <div className="ai-inline">
      <input type="text" value={query} disabled={disabled} aria-label={t('Modelo de {name}', '{name} model', { name: PROVIDER_LABEL[provider] })} placeholder={provider === 'ollama' ? 'llama3.2:3b' : provider === 'openrouter' ? 'openai/gpt-4o-mini' : 'gemini-2.5-flash'} onChange={event => setQuery(event.target.value)} onBlur={() => { if (query.trim() !== value) onChange(query.trim()) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onChange(query.trim()) } }} />
      <Button type="button" disabled={disabled || loading} onClick={() => void load()}><RefreshCw size={13} aria-hidden />{loading ? t('Carregando…', 'Loading…') : models ? t('Atualizar lista', 'Refresh list') : t('Ver modelos', 'Show models')}</Button>
    </div>
    {models && <div className="ai-models" role="listbox" aria-label={t('Modelos disponíveis', 'Available models')}>
      {!filtered.length && <small style={{ padding: 6 }}>{models.length ? t('Nenhum modelo com esse nome; o texto digitado será usado.', 'No model with that name; the typed text will be used.') : provider === 'ollama' ? t('Nenhum modelo instalado. No Terminal: ollama pull llama3.2', 'No model installed. In Terminal: ollama pull llama3.2') : t('Nenhum modelo retornado.', 'No models returned.')}</small>}
      {filtered.map(model => <button type="button" role="option" aria-selected={model.id === value} key={model.id} className={model.id === value ? 'is-selected' : ''} onClick={() => { setQuery(model.id); onChange(model.id) }}><span>{model.id}</span>{model.contextLength ? <small>{Math.round(model.contextLength / 1000)}k ctx</small> : null}</button>)}
    </div>}
    {error && <span className="ai-feedback is-error" role="alert">{error}</span>}
  </div>
}

function KeyField({ provider, settings, onSettings, onFeedback }: { provider: CloudProviderId; settings: Settings; onSettings: (s: Settings) => void; onFeedback: (text: string, error?: boolean) => void }) {
  const { t } = useI18n()
  const [key, setKey] = useState('')
  const [sessionOnly, setSessionOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const info = settings.keys[provider]
  const bridge = getAIBridge()
  const run = async (operation: () => Promise<string | void>) => { setBusy(true); try { const message = await operation(); if (message) onFeedback(message) } catch (cause) { onFeedback(aiErrorMessage(cause, t), true) } finally { setBusy(false) } }
  return <div className="ai-field">
    <span>{t('Chave de API', 'API key')} {info.configured && <b>· {t('salva', 'saved')} ••••{info.last4}</b>}</span>
    <div className="ai-inline">
      <input type="password" autoComplete="off" spellCheck={false} value={key} onChange={event => setKey(event.target.value)} placeholder={info.configured ? t('Substituir a chave salva', 'Replace the saved key') : provider === 'openrouter' ? 'sk-or-…' : 'AIza…'} aria-label={t('Chave de API de {name}', '{name} API key', { name: PROVIDER_LABEL[provider] })} />
      <Button type="button" disabled={busy || !key.trim() || !bridge} onClick={() => void run(async () => { const next = await bridge!.aiSetKey(provider, key, { storage: sessionOnly ? 'session' : 'auto' }); setKey(''); onSettings(next); const where = next.keys[provider]?.storage; return where === 'session' ? t('Chave usada só nesta sessão (não foi gravada).', 'Key used for this session only (not saved).') : where === 'file' ? t('Chave salva no arquivo cifrado do espaço.', 'Key saved in the workspace’s encrypted file.') : t('Chave protegida pelo sistema operacional.', 'Key protected by the operating system.') })}><KeyRound size={13} aria-hidden />{t('Salvar chave', 'Save key')}</Button>
      <Button type="button" disabled={busy || !info.configured || settings.blockCloud || !bridge} onClick={() => void run(async () => { await bridge!.aiTest(provider); return t('Conexão com {name} OK.', 'Connection to {name} OK.', { name: PROVIDER_LABEL[provider] }) })}><PlugZap size={13} aria-hidden />{t('Testar conexão', 'Test connection')}</Button>
      <Button variant="danger-quiet" type="button" disabled={busy || !info.configured || !bridge} onClick={() => void run(async () => { onSettings(await bridge!.aiRemoveKey(provider)); return t('Chave removida.', 'Key removed.') })}><Trash2 size={13} aria-hidden />{t('Remover chave', 'Remove key')}</Button>
    </div>
    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={sessionOnly} onChange={event => setSessionOnly(event.target.checked)} /> {t('Não guardar a chave (pedir a cada sessão)', 'Don’t store the key (ask every session)')}</label>
    <span>{window.api?.platform === 'win32' ? t(`Com senha do espaço, a chave fica no arquivo cifrado do espaço. Sem ela, a proteção usa o Windows DPAPI do seu usuário. Não exige confirmação pelo Windows Hello e não protege contra outros programas executados pelo mesmo usuário. A chave só é enviada a {host} e nunca vai para backups, exportações ou a API local.`, `With a workspace password, the key stays in the workspace’s encrypted file. Otherwise, Windows DPAPI protects it under your user account. This does not require Windows Hello verification or protect against other programs running as the same user. The key is only sent to {host} and never goes to backups, exports, or the local API.`, { host: provider === 'openrouter' ? 'openrouter.ai' : 'generativelanguage.googleapis.com' }) : t(`Com senha do espaço, a chave fica no arquivo cifrado do espaço. Sem ela, fica no Keychain do macOS — que poderá pedir a senha do chaveiro na primeira chamada de IA de cada sessão (o ${PRODUCT.name} nunca o consulta ao abrir). Marque a opção acima para não guardar. A chave só é enviada a {host} e nunca vai para backups, exportações ou a API local.`, `With a workspace password, the key stays in the workspace’s encrypted file. Without one, it goes to the macOS Keychain — which may ask for the keychain password on the first AI call of each session (${PRODUCT.name} never reads it on launch). Tick the option above to not store it. The key is only sent to {host} and never goes to backups, exports or the local API.`, { host: provider === 'openrouter' ? 'openrouter.ai' : 'generativelanguage.googleapis.com' })}</span>
  </div>
}

export function AISettingsSection() {
  const { t, locale } = useI18n()
  const settings = useAISettings()
  const bridge = getAIBridge()
  const [status, setStatus] = useState<Record<ProviderId, AIProviderStatus> | null>(null)
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null)
  const [endpoint, setEndpoint] = useState('')
  const [embed, setEmbed] = useState<EmbedStatus | null>(null)
  const [embedBusy, setEmbedBusy] = useState(false)
  const refreshEmbed = (download = false) => { if (bridge?.aiEmbedStatus) void bridge.aiEmbedStatus(download ? { download: true } : undefined).then(setEmbed).catch(() => setEmbed(null)) }
  const refreshStatus = () => { if (bridge) void bridge.aiStatus().then(setStatus).catch(() => {}) }
  useEffect(() => { if (bridge) void bridge.aiGetSettings().then(setAISettings).catch(cause => setFeedback({ text: aiErrorMessage(cause, t), error: true })); refreshStatus(); refreshEmbed() }, [])
  useEffect(() => { if (settings) setEndpoint(settings.ollamaEndpoint) }, [settings?.ollamaEndpoint])
  if (!bridge) return <div className="ai-settings"><h2 className="st-h">{t('IA', 'AI')}</h2><p className="st-p">{t(`A IA requer o aplicativo desktop do ${PRODUCT.name}.`, `AI requires the ${PRODUCT.name} desktop app.`)}</p></div>
  if (!settings) return <div className="ai-settings"><h2 className="st-h">{t('IA', 'AI')}</h2><p className="st-p">{t('Carregando…', 'Loading…')}</p>{feedback && <p className="ai-feedback is-error" role="alert">{feedback.text}</p>}</div>
  const apply = (next: Settings) => { setAISettings(next); refreshStatus() }
  const update = async (patch: AISettingsPatch) => { try { apply(await bridge.aiUpdateSettings(patch)) } catch (cause) { setFeedback({ text: aiErrorMessage(cause, t), error: true }) } }
  const note = (text: string, error?: boolean) => { setFeedback({ text, error }); refreshStatus() }
  const choose = async (provider: ProviderId) => {
    // Escolher um provedor em nuvem já pede o consentimento explícito desse provedor.
    if (isCloud(provider) && !settings.consent[provider]) {
      if (!(await requestAIConsent(provider))) return
      apply(await bridge.aiConsent(provider, true))
    }
    await update({ activeProvider: provider })
  }
  const month = new Date().toISOString().slice(0, 7)
  const usage = settings.usage[month] ?? {}
  const features: [AIFeature, string][] = [['assistant', t('Assistente (resumir, traduzir, escrever, preencher)', 'Assistant (summarize, translate, write, fill)')], ['ask', t('Perguntar às suas notas', 'Ask your notes')], ['blocks', t('Blocos de IA na página', 'AI blocks in pages')]]
  return <div className="ai-settings">
    <h2 className="st-h">{t('IA', 'AI')}</h2>
    <p className="ai-hint">{t('Por padrão a IA roda no Ollama deste computador e nada sai do computador. Provedores em nuvem são opcionais: só funcionam com a sua chave e depois da sua autorização, e você vê o que será enviado.', 'By default AI runs on Ollama on this computer and nothing leaves the computer. Cloud providers are optional: they only work with your key and after your authorization, and you see what will be sent.')}</p>
    {feedback && <p className={`ai-feedback${feedback.error ? ' is-error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}

    <label className="ai-switch-row"><div><b>{t('Bloquear provedores em nuvem', 'Block cloud providers')}</b><span className="ai-hint">{t('Ligado: nenhuma chamada a OpenRouter ou Google sai deste computador, mesmo com chave salva.', 'On: no call to OpenRouter or Google leaves this computer, even with a saved key.')}</span></div>
      <input type="checkbox" className="np-switch" checked={settings.blockCloud} onChange={event => void update({ blockCloud: event.target.checked })} /></label>

    <section>
      <h3>{t('Provedor ativo', 'Active provider')}</h3>
      <div className="ai-providers" role="radiogroup" aria-label={t('Provedor ativo', 'Active provider')}>
        {PROVIDERS.map(provider => {
          const active = settings.activeProvider === provider
          const cloud = isCloud(provider)
          return <div key={provider} className={`ai-provider${active ? ' is-active' : ''}`}>
            <div className="ai-provider-head">
              <label><input type="radio" name="ai-provider" checked={active} disabled={cloud && settings.blockCloud} onChange={() => void choose(provider)} />{cloud ? <Cloud size={15} strokeWidth={1.7} aria-hidden /> : <Laptop size={15} strokeWidth={1.7} aria-hidden />}{PROVIDER_LABEL[provider]} <small className="ai-hint">{cloud ? t('nuvem', 'cloud') : t('local, padrão', 'local, default')}</small></label>
              <Status status={status?.[provider]} />
            </div>
            {provider === 'ollama' ? <>
              <div className="ai-inline"><label className="ai-field"><span>{t('Endereço do Ollama (só neste computador)', 'Ollama address (this computer only)')}</span><input type="text" value={endpoint} onChange={event => setEndpoint(event.target.value)} onBlur={() => { if (endpoint !== settings.ollamaEndpoint) void update({ ollamaEndpoint: endpoint }) }} aria-label={t('Endereço do Ollama', 'Ollama address')} /></label>
                <Button type="button" style={{ alignSelf: 'flex-end' }} onClick={() => void bridge.aiTest('ollama').then(result => note(t('Ollama respondeu: {n} modelo(s) local(is).', 'Ollama responded: {n} local model(s).', { n: result.models ?? 0 }))).catch(cause => note(aiErrorMessage(cause, t), true))}><PlugZap size={13} aria-hidden />{t('Testar conexão', 'Test connection')}</Button></div>
              {status?.ollama && status.ollama.state !== 'ready' && <p className="ai-hint">{status.ollama.state === 'offline' ? t(`Ollama não encontrado. Instale-o em ollama.com e abra o app; depois baixe um modelo no Terminal: ollama pull llama3.2 (e, para a busca semântica, ollama pull nomic-embed-text). O ${PRODUCT.name} não baixa nada sozinho.`, `Ollama not found. Install it from ollama.com and open the app; then download a model in Terminal: ollama pull llama3.2 (and, for semantic search, ollama pull nomic-embed-text). ${PRODUCT.name} never downloads anything by itself.`) : t('Nenhum modelo instalado. No Terminal: ollama pull llama3.2', 'No model installed. In Terminal: ollama pull llama3.2')}</p>}
              <ModelPicker provider="ollama" value={settings.models.ollama} onChange={model => void update({ models: { ollama: model } })} />
              <label className="ai-field"><span>{t('Modelo de embeddings (busca semântica local)', 'Embedding model (local semantic search)')}</span><input type="text" defaultValue={settings.embeddingModel} key={settings.embeddingModel} onBlur={event => { if (event.target.value.trim() !== settings.embeddingModel) void update({ embeddingModel: event.target.value.trim() }) }} aria-label={t('Modelo de embeddings do Ollama', 'Ollama embedding model')} /></label>
            </> : <>
              <KeyField provider={provider as CloudProviderId} settings={settings} onSettings={apply} onFeedback={note} />
              <ModelPicker provider={provider} value={settings.models[provider]} disabled={settings.blockCloud || !settings.keys[provider as CloudProviderId].configured} onChange={model => void update({ models: { [provider]: model } })} />
              <div className="ai-switch-row"><div><span>{t('Perguntar antes de cada envio', 'Ask before each send')}</span><span className="ai-hint">{t('Mostra a prévia exata (pedido + trechos, com tokens) com Enviar/Cancelar.', 'Shows the exact preview (request + excerpts, with tokens) with Send/Cancel.')}</span></div>
                <input type="checkbox" className="np-switch" aria-label={t('Perguntar antes de cada envio para {name}', 'Ask before each send to {name}', { name: PROVIDER_LABEL[provider] })} checked={settings.confirmEachSend[provider as CloudProviderId]} onChange={event => void update({ confirmEachSend: { [provider]: event.target.checked } })} /></div>
              <div className="ai-inline"><span className="ai-hint" style={{ flex: 1 }}>{settings.consent[provider as CloudProviderId] ? t('Autorizado em {date}.', 'Authorized on {date}.', { date: new Date(settings.consent[provider as CloudProviderId]!.grantedAt).toLocaleDateString(locale) }) : t('Ainda não autorizado.', 'Not authorized yet.')}</span>
                {settings.consent[provider as CloudProviderId] ? <Button type="button" onClick={() => void bridge.aiConsent(provider as CloudProviderId, false).then(apply)}>{t('Revogar autorização', 'Revoke authorization')}</Button>
                  : <Button type="button" disabled={settings.blockCloud} onClick={() => void requestAIConsent(provider as CloudProviderId).then(ok => { if (ok) void bridge.aiConsent(provider as CloudProviderId, true).then(apply) })}>{t('Autorizar…', 'Authorize…')}</Button>}</div>
              {provider === 'openrouter' && <label className="ai-switch-row"><div><span>{t('Identificar o app no OpenRouter', 'Identify the app on OpenRouter')}</span><span className="ai-hint">{t(`Envia os cabeçalhos HTTP-Referer e X-Title com o nome "${PRODUCT.name}". Desligado por padrão.`, `Sends the HTTP-Referer and X-Title headers with the name "${PRODUCT.name}". Off by default.`)}</span></div><input type="checkbox" className="np-switch" checked={settings.openrouterAttribution} onChange={event => void update({ openrouterAttribution: event.target.checked })} /></label>}
            </>}
          </div>
        })}
      </div>
    </section>

    <section>
      <h3>{t('Provedor por recurso', 'Provider per feature')}</h3>
      <p className="ai-hint">{t('Opcional. Ex.: resumos no Ollama e perguntas na nuvem.', 'Optional. E.g. summaries on Ollama and questions in the cloud.')}</p>
      <div className="ai-grid">{features.map(([feature, label]) => <label key={feature} className="ai-field"><span>{label}</span><Select value={settings.featureProviders[feature]} onChange={async event => {
        const value = event.target.value as ProviderId | ''
        if (value && isCloud(value) && !settings.consent[value]) { if (!(await requestAIConsent(value))) return; apply(await bridge.aiConsent(value, true)) }
        void update({ featureProviders: { [feature]: value } })
      }}><option value="">{t('Usar o provedor ativo', 'Use the active provider')}</option>{PROVIDERS.map(provider => <option key={provider} value={provider} disabled={isCloud(provider) && settings.blockCloud}>{PROVIDER_LABEL[provider]}</option>)}</Select></label>)}</div>
    </section>

    <section data-testid="ai-embeddings">
      <h3>{t('Embeddings (busca semântica local)', 'Embeddings (local semantic search)')}</h3>
      <p className="ai-hint">{t('Servem à busca de "Perguntar às suas notas". Tudo roda neste computador e nenhum texto sai dele. Automático: Ollama com modelo de embeddings; senão, os embeddings da Apple (macOS 14+); senão, só palavras.', 'They power the search behind "Ask your notes". Everything runs on this computer and no text leaves it. Automatic: Ollama with an embedding model; otherwise Apple embeddings (macOS 14+); otherwise words only.')}</p>
      <div className="ai-inline">
        <label className="ai-field" style={{ flex: 1 }}><span>{t('Embeddings', 'Embeddings')}</span>
          <Select value={settings.embeddingBackend ?? 'auto'} aria-label={t('Mecanismo de embeddings', 'Embedding engine')} onChange={event => { void update({ embeddingBackend: event.target.value as EmbeddingMode }).then(() => { refreshEmbed(); void refreshEmbeddingBackend() }) }}>
            <option value="auto">{t('Automático', 'Automatic')}</option><option value="ollama">Ollama</option>{window.api?.platform !== 'win32' && <option value="apple">Apple</option>}<option value="off">{t('Desligado', 'Off')}</option>
          </Select></label>
        {embed?.mode !== 'off' && embed?.apple.reason === 'ASSETS_MISSING' && embed.mode !== 'ollama' && <Button type="button" style={{ alignSelf: 'flex-end' }} disabled={embedBusy} onClick={() => { setEmbedBusy(true); void bridge.aiEmbedStatus?.({ download: true }).then(next => { setEmbed(next); void refreshEmbeddingBackend() }).catch(() => {}).finally(() => setEmbedBusy(false)) }}>{embedBusy ? t('Baixando…', 'Downloading…') : t('Baixar recursos da Apple', 'Download Apple resources')}</Button>}
      </div>
      <p className="ai-hint" role="status" data-testid="ai-embed-state">{!embed ? '…' : embed.backend === 'ollama' ? t('Em uso: Ollama ({model}).', 'In use: Ollama ({model}).', { model: embed.model }) : embed.backend === 'apple' ? t('Em uso: embeddings da Apple (no sistema, sem rede).', 'In use: Apple embeddings (on-device, no network).') : embed.mode === 'off' ? t('Desligado: a busca usa só palavras.', 'Off: search uses words only.') : t('Nenhum disponível: a busca usa só palavras. {why}', 'None available: search uses words only. {why}', { why: embed.apple.reason === 'UNSUPPORTED_OS' || embed.apple.reason === 'NATIVE_UNSUPPORTED' ? t('Os embeddings da Apple pedem macOS 14 ou mais novo.', 'Apple embeddings need macOS 14 or newer.') : embed.apple.reason === 'ASSETS_MISSING' ? t('Os recursos de idioma da Apple ainda não foram baixados.', 'Apple language resources are not downloaded yet.') : embed.apple.reason === 'NATIVE_HELPER_MISSING' ? t('O helper nativo não foi compilado (npm run build:native).', 'The native helper is not built (npm run build:native).') : embed.mode === 'ollama' ? t('O Ollama não tem o modelo de embeddings (ollama pull nomic-embed-text).', 'Ollama lacks the embedding model (ollama pull nomic-embed-text).') : '' })}</p>
    </section>

    <section>
      <h3>{t('Parâmetros', 'Parameters')}</h3>
      <div className="ai-grid">
        <label className="ai-field"><span>{t('Temperatura: {v}', 'Temperature: {v}', { v: settings.temperature.toFixed(1) })}</span><input type="range" min={0} max={2} step={0.1} value={settings.temperature} onChange={event => void update({ temperature: Number(event.target.value) })} /></label>
        <label className="ai-field"><span>{t('Máximo de tokens na resposta', 'Max response tokens')}</span><input type="number" min={16} max={32000} step={64} defaultValue={settings.maxTokens} key={settings.maxTokens} onBlur={event => void update({ maxTokens: Number(event.target.value) })} /></label>
      </div>
      <label className="ai-switch-row" style={{ marginTop: 10 }}><div><span>{t('Ocultar e-mails, telefones e números longos', 'Hide e-mails, phones and long numbers')}</span><span className="ai-hint">{t('Redação simples aplicada antes de enviar a qualquer provedor.', 'Simple redaction applied before sending to any provider.')}</span></div><input type="checkbox" className="np-switch" checked={settings.redact} onChange={event => void update({ redact: event.target.checked })} /></label>
    </section>

    <section>
      <h3>{t('Uso neste mês (estimado, contado neste computador)', 'Usage this month (estimated, counted on this computer)')}</h3>
      <table className="ai-usage"><thead><tr><th>{t('Provedor', 'Provider')}</th><th>{t('Pedidos', 'Requests')}</th><th>{t('Tokens enviados', 'Tokens sent')}</th><th>{t('Tokens recebidos', 'Tokens received')}</th></tr></thead>
        <tbody>{PROVIDERS.map(provider => { const item = usage[provider]; return <tr key={provider}><td>{PROVIDER_LABEL[provider]}</td><td>{item?.requests ?? 0}</td><td>{item ? `${item.estimated ? '≈ ' : ''}${item.promptTokens.toLocaleString(locale)}` : 0}</td><td>{item ? `${item.estimated ? '≈ ' : ''}${item.completionTokens.toLocaleString(locale)}` : 0}</td></tr> })}</tbody></table>
      <p className="ai-hint">{t('Sem preços: confira os valores no painel do provedor. Pedidos em nuvem também aparecem em Configurações → Dados → Atividade local (sem conteúdo).', 'No prices: check the amounts in the provider dashboard. Cloud requests also appear in Settings → Data → Local activity (without content).')}</p>
    </section>

    <section>
      <h3>{t('O que nunca é enviado', 'What is never sent')}</h3>
      <p className="ai-hint">{t('Páginas protegidas por senha (mesmo desbloqueadas), a lixeira, um espaço bloqueado e a sua chave fora do host do provedor. A busca em "Perguntar às suas notas" roda neste computador; só os trechos escolhidos e a pergunta vão ao provedor.', 'Password-protected pages (even unlocked), the trash, a locked workspace and your key outside the provider host. The search in "Ask your notes" runs on this computer; only the chosen excerpts and the question go to the provider.')}</p>
    </section>
  </div>
}
