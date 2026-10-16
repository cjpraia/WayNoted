import PRODUCT from '../../../shared/product.json' with { type: 'json' }
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Cloud, ShieldCheck, Send, X } from 'lucide-react'
import { useI18n } from '../../i18n'
import { registerAIPrompts } from '../../ai/client.ts'
import { PROVIDER_LABEL, type AIPreview, type CloudProviderId } from '../../ai/types.ts'
import './ai.css'
import { Button } from '../ui/Button'

type Pending = { kind: 'consent'; provider: CloudProviderId; resolve: (ok: boolean) => void } | { kind: 'preview'; preview: AIPreview; resolve: (ok: boolean) => void }
let show: ((value: Pending) => void) | null = null

/** Consentimento explícito por provedor (também usado em Configurações → IA). */
export function requestAIConsent(provider: CloudProviderId): Promise<boolean> {
  return new Promise(resolve => { if (!show) resolve(false); else show({ kind: 'consent', provider, resolve }) })
}

/** Texto exigido no consentimento (docs/AI.md §5). */
export function consentStatement(name: string, t: (pt: string, en: string, vars?: Record<string, string | number>) => string) {
  return t(`O texto selecionado/trechos das suas notas e sua pergunta serão enviados a {name}; a política dele se aplica; o ${PRODUCT.name} não envia nada mais.`, `The selected text/excerpts from your notes and your question will be sent to {name}; its policy applies; ${PRODUCT.name} sends nothing else.`, { name })
}

function Dialog({ label, children, onCancel }: { label: string; children: ReactNode; onCancel: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; box.current?.focus(); return () => { if (previous?.isConnected) previous.focus() } }, [])
  return <div className="ai-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onCancel() }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel() }
    if (event.key === 'Tab') { const items = [...(box.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,pre[tabindex]') ?? [])]; if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus() } else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus() } }
  }}><div className="ai-dialog" ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label}>{children}</div></div>
}

export function AIPromptsHost() {
  const { t, locale } = useI18n()
  const [pending, setPending] = useState<Pending | null>(null)
  const queue = useRef<Pending[]>([])
  useEffect(() => {
    show = value => setPending(current => { if (current) { queue.current.push(value); return current } return value })
    registerAIPrompts({
      consent: provider => requestAIConsent(provider),
      preview: preview => new Promise(resolve => show?.({ kind: 'preview', preview, resolve })),
    })
    return () => { show = null; registerAIPrompts(null); queue.current.forEach(item => item.resolve(false)); queue.current = [] }
  }, [])
  if (!pending) return null
  const finish = (ok: boolean) => { pending.resolve(ok); setPending(queue.current.shift() ?? null) }
  if (pending.kind === 'consent') {
    const name = PROVIDER_LABEL[pending.provider]
    return <Dialog label={t('Autorizar envio para {name}', 'Authorize sending to {name}', { name })} onCancel={() => finish(false)}>
      <header><ShieldCheck size={18} aria-hidden /><h2>{t('Usar {name}?', 'Use {name}?', { name })}</h2><button className="np-icon-btn" onClick={() => finish(false)} aria-label={t('Fechar', 'Close')}><X size={16} /></button></header>
      <p className="ai-statement">{consentStatement(name, t)}</p>
      <ul>
        <li>{t('Só quando você pedir: nada é enviado em segundo plano.', 'Only when you ask: nothing is sent in the background.')}</li>
        <li>{t('Nunca são enviadas páginas protegidas por senha, a lixeira ou um espaço bloqueado.', 'Password-protected pages, the trash and a locked workspace are never sent.')}</li>
        <li>{t('Por padrão, você vê uma prévia do que será enviado antes de cada envio.', 'By default, you see a preview of what will be sent before each send.')}</li>
        <li>{t('A busca nas suas notas continua local; a chave não vai para backups nem exportações.', 'Searching your notes stays local; the key never goes to backups or exports.')}</li>
      </ul>
      <p className="ai-note">{t('Você pode revogar esta autorização a qualquer momento em Configurações → IA.', 'You can revoke this authorization at any time in Settings → AI.')}</p>
      <div className="ai-actions"><Button onClick={() => finish(false)}>{t('Cancelar', 'Cancel')}</Button><Button variant="primary" onClick={() => finish(true)}>{t('Autorizar {name}', 'Authorize {name}', { name })}</Button></div>
    </Dialog>
  }
  const { preview } = pending
  const name = PROVIDER_LABEL[preview.provider]
  return <Dialog label={t('Prévia do envio para {name}', 'Preview of what is sent to {name}', { name })} onCancel={() => finish(false)}>
    <header><Cloud size={18} aria-hidden /><h2>{t('Enviar para {name}?', 'Send to {name}?', { name })}</h2><button className="np-icon-btn" onClick={() => finish(false)} aria-label={t('Fechar', 'Close')}><X size={16} /></button></header>
    <div className="ai-preview-meta">
      <span>{t('Modelo', 'Model')}: <b>{preview.model}</b></span>
      <span data-testid="ai-preview-tokens">≈ {preview.tokens.toLocaleString(locale)} tokens</span>
      {preview.sources > 0 && <span>{t('{n} trecho(s) das suas notas', '{n} excerpt(s) from your notes', { n: preview.sources })}</span>}
      {preview.excluded > 0 && <span>{t('{n} trecho(s) excluído(s): páginas protegidas/lixeira', '{n} excerpt(s) excluded: protected/trashed pages', { n: preview.excluded })}</span>}
      {preview.redacted && <span>{t('E-mails, telefones e números longos ocultados', 'E-mails, phones and long numbers hidden')}</span>}
    </div>
    <p>{t('Isto é exatamente o que sai do seu Mac:', 'This is exactly what leaves your Mac:')}</p>
    <div className="ai-preview-body">{preview.messages.map((message, index) => <div key={index} className="ai-preview-msg"><b>{message.role === 'system' ? t('Instruções do app', 'App instructions') : message.role === 'user' ? t('Pedido e trechos', 'Request and excerpts') : t('Resposta anterior', 'Previous answer')}</b><pre tabIndex={0}>{message.content}</pre></div>)}</div>
    <div className="ai-actions"><Button onClick={() => finish(false)}>{t('Cancelar', 'Cancel')}</Button><Button variant="primary" onClick={() => finish(true)}><Send size={14} aria-hidden />{t('Enviar', 'Send')}</Button></div>
  </Dialog>
}
