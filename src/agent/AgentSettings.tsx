// Configurações → Dados → Agentes (A1/A2): clientes com escopos, aprovação de escritas, conector MCP, comando
// `workspace` no PATH e registro de chamadas. Os cartões usam o SettingsCard recebido de SettingsModal.
import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { api } from '../store'
import { t, useI18n } from '../i18n'
import { Button } from '../components/ui/Button'
import { Select } from '../components/ui/Select'
import { Toggle } from '../components/ui/Toggle'
import type { AgentClientView, AgentLogEntry, AgentOverview, AgentSnippets } from './types'
import './agent.css'

type Card = ComponentType<{ title: string; subtitle: string; children: ReactNode }>
const clean = (error: unknown) => String((error as { message?: string })?.message ?? error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export const resultLabel = (result: AgentLogEntry['result']) => ({
  ok: t('ok', 'ok'), auto: t('automática', 'automatic'), granted: t('liberada por 1 h', 'allowed for 1 h'), approved: t('aprovada', 'approved'),
  rejected: t('rejeitada', 'rejected'), timeout: t('sem resposta', 'no answer'), denied: t('negada', 'denied'), error: t('erro', 'error'),
} as Record<string, string>)[result] ?? result
const actionLabel = (action: string) => ({
  search: t('busca', 'search'), 'page.read': t('leitura de página', 'page read'), 'blocks.read': t('leitura de blocos', 'blocks read'), 'row.read': t('leitura de linha', 'row read'),
  'tasks.read': t('leitura de tarefas', 'tasks read'), 'daily.read': t('leitura da nota diária', 'daily note read'), query: t('consulta', 'query'), 'types.read': t('leitura de tipos', 'types read'),
  'page.create': t('criar página', 'create page'), 'page.update': t('alterar página', 'change page'), 'page.append': t('acrescentar à página', 'append to page'), 'blocks.write': t('reescrever página', 'rewrite page'),
  'row.write': t('alterar linha', 'change row'), 'tasks.add': t('adicionar tarefa', 'add task'), 'daily.append': t('acrescentar à nota diária', 'append to daily note'), 'clip.create': t('recorte da web', 'web clip'), 'clip.pair': t('pareamento do clipper', 'clipper pairing'),
} as Record<string, string>)[action] ?? action

function CopyButton({ value, label, onCopied }: { value: string; label: string; onCopied: (text: string) => void }) {
  return <Button onClick={() => void (api.copyText ? api.copyText(value) : navigator.clipboard.writeText(value)).then(() => onCopied(t('Copiado.', 'Copied.')), () => onCopied(t('Não foi possível copiar.', 'Could not copy.')))}>{label}</Button>
}

export function AgentSettingsCards({ Card }: { Card: Card }) {
  const { locale } = useI18n()
  const [overview, setOverview] = useState<AgentOverview | null>(null)
  const [log, setLog] = useState<AgentLogEntry[]>([])
  const [connector, setConnector] = useState<(AgentSnippets & { command: string; packaged: boolean }) | null>(null)
  const [created, setCreated] = useState<{ name: string; token: string; snippets: AgentSnippets } | null>(null)
  const [name, setName] = useState('')
  const [canWrite, setCanWrite] = useState(true)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const [confirmAuto, setConfirmAuto] = useState<string | null>(null)
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number; url: string } | null>(null)
  const refresh = useCallback(async () => {
    const [next, entries] = await Promise.all([api.agentOverview!(), api.agentLog!(100)])
    setOverview(next); setLog(entries)
  }, [])
  useEffect(() => { void refresh().catch(error => setMessage({ text: clean(error), error: true })); void api.agentConnector?.().then(setConnector).catch(() => {}) }, [refresh])
  // O registro e a fila mudam sozinhos enquanto o painel está aberto.
  useEffect(() => { const id = setInterval(() => void refresh().catch(() => {}), 5000); return () => clearInterval(id) }, [refresh])
  const act = async (operation: () => Promise<unknown>, success?: string) => {
    try { setMessage(null); await operation(); await refresh(); if (success) setMessage({ text: success }) }
    catch (error) { setMessage({ text: clean(error), error: true }) }
  }
  if (!api.agentOverview || !overview) return null
  const clients = overview.clients.filter(client => client.kind !== 'clipper')
  const clippers = overview.clients.filter(client => client.kind === 'clipper')
  const shownPairing = pairing ?? (overview.pairing ? { ...overview.pairing, url: overview.url ?? '' } : null)
  const when = (value: number | null) => value ? new Date(value).toLocaleString(locale) : t('nunca', 'never')
  const timeout = overview.settings.timeoutSec
  const timeouts = [...new Set([30, 60, 120, 300, timeout])].sort((a, b) => a - b).filter(v => v >= overview.settings.minTimeoutSec && v <= overview.settings.maxTimeoutSec)

  return <>
    <Card title={t('Agentes e permissões', 'Agents and permissions')} subtitle={t("Quem pode ler e escrever nas suas páginas pela API local, pelo MCP e pelo comando workspace.", "Who can read and write your pages through the local API, MCP and the workspace command.")}>
      {!overview.apiEnabled && <p className="ag-note">{t('A API local está desligada: nenhum agente consegue se conectar. Ative “API local para integrações” acima.', 'The local API is off, so no agent can connect. Turn on “Local API for integrations” above.')}</p>}
      {overview.settings.legacyNotice && <div className="st-row st-row-col">
        <span className="st-label">{t('Mudança nas permissões', 'Permissions changed')}</span>
        <span className="st-hint">{t('O token que você já usava continua funcionando, mas agora só lê livremente; toda escrita pede a sua aprovação. Ajuste abaixo, se quiser.', 'The token you already used keeps working, but now it only reads freely; every write asks for your approval. Adjust below if you like.')}</span>
        <Button onClick={() => void act(() => api.agentUpdateSettings!({ legacyNoticeShown: true }))}>{t('Entendi', 'Got it')}</Button>
      </div>}
      <ul className="ag-clients">
        {clients.map((client: AgentClientView) => <li key={client.id} className="ag-client">
          <div className="ag-client-head">
            <span className="ag-client-name">{client.legacy ? t('Token padrão (CLI e integrações existentes)', 'Default token (CLI and existing integrations)') : client.name}</span>
            <Button variant="danger-quiet" onClick={() => void act(() => api.agentRevokeClient!(client.id), t('Acesso revogado.', 'Access revoked.'))}>{t('Revogar', 'Revoke')}</Button>
          </div>
          <span className="st-hint">{t('Último uso: {when}', 'Last used: {when}', { when: when(client.lastUsedAt) })} · <span className="ag-chip">{t('ler', 'read')}</span> {client.scopes.includes('write') && <span className="ag-chip">{client.autoWrite ? t('escreve sozinho', 'writes on its own') : t('escreve com aprovação', 'writes with approval')}</span>}</span>
          <Toggle label={t('Pode escrever (com aprovação)', 'Can write (with approval)')} checked={client.scopes.includes('write')} onChange={value => void act(() => api.agentUpdateClient!(client.id, { scopes: value ? ['read', 'write'] : ['read'] }))} />
          {client.scopes.includes('write') && <Toggle label={t('Escrita automática', 'Automatic writing')} hint={t('Sem pedir aprovação. Só ative para um agente em que você confia totalmente.', 'No approval requested. Only for an agent you fully trust.')} checked={client.autoWrite} onChange={value => { if (value) setConfirmAuto(client.id); else void act(() => api.agentUpdateClient!(client.id, { autoWrite: false })) }} />}
          {confirmAuto === client.id && <div className="ag-token" role="alertdialog" aria-label={t('Confirmar escrita automática', 'Confirm automatic writing')}>
            <p className="ag-warn">{t('Este agente poderá criar e alterar páginas sem você ver antes. Alterações podem ser desfeitas pelo histórico da página, mas não há aviso. Continuar?', 'This agent will be able to create and change pages without you seeing them first. Changes can be undone from the page history, but there is no warning. Continue?')}</p>
            <div className="ag-form"><Button onClick={() => setConfirmAuto(null)}>{t('Cancelar', 'Cancel')}</Button><Button variant="danger" onClick={() => { setConfirmAuto(null); void act(() => api.agentUpdateClient!(client.id, { autoWrite: true })) }}>{t('Ativar escrita automática', 'Turn on automatic writing')}</Button></div>
          </div>}
          {client.grantedUntil && <span className="st-hint">{t('Aprovações liberadas até {when}.', 'Approvals allowed until {when}.', { when: new Date(client.grantedUntil).toLocaleTimeString(locale) })} <Button variant="ghost" onClick={() => void act(() => api.agentRevokeGrant!(client.id))}>{t('Voltar a pedir', 'Ask again')}</Button></span>}
        </li>)}
        {!clients.length && <li className="st-hint">{t('Nenhum cliente. Crie um para conectar um agente com permissões próprias.', 'No clients. Create one to connect an agent with its own permissions.')}</li>}
      </ul>
      <div className="st-row st-row-col">
        <span className="st-label">{t('Novo cliente', 'New client')}</span>
        <div className="ag-form">
          <input className="st-input" value={name} maxLength={60} onChange={event => setName(event.target.value)} placeholder={t('Nome (ex.: Claude Desktop)', 'Name (e.g. Claude Desktop)')} aria-label={t('Nome do cliente', 'Client name')} />
          <Toggle label={t('Pode escrever', 'Can write')} checked={canWrite} onChange={setCanWrite} />
          <Button variant="primary" disabled={!name.trim()} onClick={() => void act(async () => { const result = await api.agentCreateClient!({ name, scopes: canWrite ? ['read', 'write'] : ['read'] }); setCreated({ name: result.client.name, token: result.token, snippets: result.snippets }); setName('') })}>{t('Criar cliente', 'Create client')}</Button>
        </div>
        <span className="st-hint">{t('Leitura é livre. Escrita sempre pede a sua aprovação, a menos que você ative a escrita automática.', 'Reading is free. Writing always asks for your approval unless you turn on automatic writing.')}</span>
      </div>
      {created && <div className="ag-token" role="status">
        <span className="st-label">{t('Token de “{name}” — aparece só agora', 'Token for “{name}” — shown only now', { name: created.name })}</span>
        <code>{created.token}</code>
        <div className="ag-form"><CopyButton value={created.token} label={t('Copiar token', 'Copy token')} onCopied={text => setMessage({ text })} /><CopyButton value={created.snippets.json} label={t('Copiar configuração MCP', 'Copy MCP configuration')} onCopied={text => setMessage({ text })} /><Button onClick={() => setCreated(null)}>{t('Fechar', 'Close')}</Button></div>
        <p className="ag-note">{t('Guarde o token agora; depois ele não pode ser mostrado de novo (só revogado e recriado).', 'Save the token now; it cannot be shown again (only revoked and recreated).')}</p>
      </div>}
      <div className="st-row st-row-col">
        <label className="st-label" htmlFor="ag-timeout">{t('Tempo para aprovar', 'Time to approve')}</label>
        <Select id="ag-timeout" value={String(timeout)} onChange={event => void act(() => api.agentUpdateSettings!({ timeoutSec: Number(event.target.value) }))}>{timeouts.map(value => <option key={value} value={String(value)}>{value} s</option>)}</Select>
        <span className="st-hint">{t('Se você não responder nesse prazo, a alteração é rejeitada e o agente recebe um erro claro.', 'If you do not answer in time, the change is rejected and the agent gets a clear error.')}</span>
      </div>
      {message && <p className={message.error ? 'ag-warn' : 'ag-note'} role="status">{message.text}</p>}
    </Card>
    <Card title={t('Web clipper (navegador)', 'Web clipper (browser)')} subtitle={t('A extensão em clipper/ envia a página atual só para este Mac e cria páginas na tabela “Recortes da web”. Ela nunca lê nem edita o resto.', 'The extension in clipper/ sends the current page only to this computer and creates pages in the “Web clips” table. It never reads or edits anything else.')}>
      <div className="st-row st-row-col">
        <span className="st-label">{t('Parear a extensão', 'Pair the extension')}</span>
        <span className="st-hint">{t('Gerar o código é a sua aprovação: depois dele, a extensão pareada cria recortes sem perguntar de novo, e só isso. O código vale 5 minutos e funciona uma vez.', 'Generating the code is your approval: afterwards the paired extension creates clips without asking again, and nothing else. The code lasts 5 minutes and works once.')}</span>
        {!overview.apiEnabled && <p className="ag-note">{t('Ative “API local para integrações” acima para parear.', 'Turn on “Local API for integrations” above to pair.')}</p>}
        <div className="ag-form">
          <Button variant="primary" disabled={!overview.apiEnabled} onClick={() => void act(async () => { const view = await api.clipperPairStart!(); setPairing({ code: view.code, expiresAt: view.expiresAt, url: view.url }) })}>{shownPairing ? t('Gerar outro código', 'Generate another code') : t('Gerar código de pareamento', 'Generate pairing code')}</Button>
          {shownPairing && <Button onClick={() => void act(async () => { await api.clipperPairCancel!(); setPairing(null) })}>{t('Cancelar', 'Cancel')}</Button>}
        </div>
        {shownPairing && shownPairing.expiresAt > Date.now() && <div className="ag-token" role="status">
          <span className="st-label">{t('Código — digite nas opções da extensão', 'Code — type it in the extension options')}</span>
          <code className="ag-pair-code">{shownPairing.code}</code>
          <span className="st-hint">{t('Endereço da API: {url}. Expira às {when}.', 'API address: {url}. Expires at {when}.', { url: shownPairing.url, when: new Date(shownPairing.expiresAt).toLocaleTimeString(locale) })}</span>
        </div>}
      </div>
      <ul className="ag-clients">
        {clippers.map((client: AgentClientView) => <li key={client.id} className="ag-client">
          <div className="ag-client-head">
            <span className="ag-client-name">{t('Clipper pareado', 'Paired clipper')}</span>
            <Button variant="danger-quiet" onClick={() => void act(() => api.agentRevokeClient!(client.id), t('Clipper desconectado.', 'Clipper disconnected.'))}>{t('Desconectar', 'Disconnect')}</Button>
          </div>
          <span className="st-hint">{t('Último uso: {when}', 'Last used: {when}', { when: when(client.lastUsedAt) })} · <span className="ag-chip">{t('só criar recortes', 'create clips only')}</span></span>
        </li>)}
        {!clippers.length && <li className="st-hint">{t('Nenhuma extensão pareada.', 'No extension paired.')}</li>}
      </ul>
    </Card>
    <Card title={t('Conectar ao Claude (MCP) e ao terminal', 'Connect to Claude (MCP) and the terminal')} subtitle={t("O servidor MCP e o comando workspace já vêm dentro do app. Nada é instalado ou editado sozinho.", "The MCP server and the workspace command ship inside the app. Nothing is installed or edited automatically.")}>
      {connector && <div className="st-row st-row-col">
        <span className="st-label">{t('Conector do Claude / MCP', 'Claude / MCP connector')}</span>
        <span className="st-hint">{t('Cole este trecho na configuração de servidores MCP do Claude Desktop ou do Cursor. Ele usa o token padrão e abre a API local do app aberto.', 'Paste this into the MCP servers configuration of Claude Desktop or Cursor. It uses the default token and talks to the running app.')}</span>
        <code className="ag-code">{connector.json}</code>
        <div className="ag-form"><CopyButton value={connector.json} label={t('Copiar configuração', 'Copy configuration')} onCopied={text => setMessage({ text })} /><CopyButton value={connector.claudeCode} label={t('Copiar comando do Claude Code', 'Copy Claude Code command')} onCopied={text => setMessage({ text })} /></div>
        {!connector.packaged && <span className="ag-note">{t('Você está em modo de desenvolvimento: o caminho acima aponta para o repositório.', 'You are in development mode: the path above points to the repository.')}</span>}
      </div>}
      {overview.cli.available && <div className="st-row st-row-col">
        <span className="st-label">{t("Comando workspace no terminal", "workspace command in the terminal")}</span>
        <span className="st-hint">{overview.cli.state === 'linked' ? t('Instalado em {path}.', 'Installed at {path}.', { path: overview.cli.path ?? '' }) : overview.cli.state === 'file' ? t('Já existe um arquivo em {path}; ele não será tocado.', 'A file already exists at {path}; it will not be touched.', { path: overview.cli.path ?? '' }) : t("Cria o link ~/.local/bin/workspace, só depois da sua confirmação.", "Creates the ~/.local/bin/workspace link, only after your confirmation.")}</span>
        <div className="ag-form">
          {overview.cli.state === 'linked'
            ? <Button onClick={() => void act(() => api.agentUninstallCli!(), t('Comando removido.', 'Command removed.'))}>{t('Remover do PATH', 'Remove from PATH')}</Button>
            : <Button disabled={overview.cli.state === 'file'} onClick={() => void act(async () => { const result = await api.agentInstallCli!(); if (!result.cancelled) setMessage({ text: t('Pronto. Se o terminal não achar o comando, inclua ~/.local/bin no PATH: export PATH="$HOME/.local/bin:$PATH"', 'Done. If the terminal cannot find it, add ~/.local/bin to your PATH: export PATH="$HOME/.local/bin:$PATH"') }) })}>{t("Instalar comando workspace no PATH…", "Install the workspace command in PATH…")}</Button>}
        </div>
      </div>}
    </Card>
    <Card title={t('Registro de chamadas', 'Call log')} subtitle={t('O que cada agente fez, quando e com que resultado.', 'What each agent did, when, and the result.')}>
      <div className="st-row st-row-col">
        {log.length ? <ol className="ag-log">{log.slice(0, 100).map(entry => <li key={entry.id}>
          <span className="ag-log-main">{entry.client} · {actionLabel(entry.action)}{entry.target ? ` · ${entry.target}` : ''} · <span className={`ag-result${['rejected', 'timeout', 'denied', 'error'].includes(entry.result) ? ' is-bad' : ' is-ok'}`}>{resultLabel(entry.result)}</span></span>
          <span className="ag-log-when">{new Date(entry.at).toLocaleString(locale)}</span>
        </li>)}</ol> : <span className="st-hint">{t('Nenhuma chamada ainda.', 'No calls yet.')}</span>}
        <div className="ag-form"><Button disabled={!log.length} onClick={() => void act(() => api.agentLogClear!(), t('Registro limpo.', 'Log cleared.'))}>{t('Limpar registro', 'Clear log')}</Button></div>
      </div>
    </Card>
  </>
}
