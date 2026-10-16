// Diálogo "Aprovar alteração de agente" (A1): diff antes/depois, contagem regressiva do prazo e três saídas
// (Rejeitar, Aprovar tudo deste cliente por 1 h, Aprovar). Sem store: recebe o pedido por props.
import { useEffect, useRef, useState } from 'react'
import { t, useI18n } from '../i18n'
import { useModalFocus } from '../a11y/useModalFocus'
import { Button } from '../components/ui/Button'
import type { AgentApproval, AgentChange } from './types'
import './agent.css'

export const changeKindLabel = (kind: string): string => ({
  'page.create': t('Criar página', 'Create page'), 'page.update': t('Alterar página', 'Change page'), 'blocks.replace': t('Reescrever o conteúdo da página', 'Rewrite the page content'),
  'blocks.append': t('Acrescentar à página', 'Append to page'), 'daily.append': t('Acrescentar à nota diária', 'Append to the daily note'), 'daily.create': t('Criar a nota diária', 'Create the daily note'),
  'task.add': t('Adicionar tarefa', 'Add task'), 'row.update': t('Alterar propriedades de uma linha', 'Change row properties'),
} as Record<string, string>)[kind] ?? kind

export function DiffView({ change }: { change: AgentChange }) {
  if (!change.diff.ops.length) return <p className="ag-sub">{t('Sem diferenças de texto para mostrar.', 'No text differences to show.')}</p>
  return <ol className="ag-diff" aria-label={t('Alterações propostas', 'Proposed changes')}>
    {change.diff.ops.map((op, index) => <li key={index} className={`ag-line is-${op.t}`}>
      <span className="ag-mark" aria-hidden>{op.t === 'add' ? '+' : op.t === 'del' ? '−' : ''}</span>
      <span>{op.t === 'gap' ? t('… {count} linhas sem mudança …', '… {count} unchanged lines …', { count: op.count ?? 0 }) : <>{op.t === 'add' && <span className="np-sr-only">{t('Adicionado: ', 'Added: ')}</span>}{op.t === 'del' && <span className="np-sr-only">{t('Removido: ', 'Removed: ')}</span>}{op.text || ' '}</>}</span>
    </li>)}
  </ol>
}

function Countdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(id) }, [])
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  return <span className="ag-count" role="timer" aria-live="off">{t('Rejeita sozinho em', 'Auto-rejects in')} <strong>{seconds} s</strong></span>
}

export function AgentApprovalDialog({ approval, queued, onDecide }: { approval: AgentApproval; queued: number; onDecide: (decision: 'approve' | 'reject', grantHour?: boolean) => void }) {
  useI18n()
  const ref = useRef<HTMLDivElement>(null)
  // Foco inicial em "Rejeitar" (o seguro): Enter por engano nunca grava uma alteração de agente.
  const reject = useRef<HTMLButtonElement>(null)
  useModalFocus(ref, { initial: () => reject.current })
  const { change } = approval
  return <div className="ag-overlay">
    <div ref={ref} className="ag-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ag-title" aria-describedby="ag-desc" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onDecide('reject') } }}>
      <h3 id="ag-title">{t('Aprovar alteração de agente', 'Approve agent change')}</h3>
      <p id="ag-desc" className="ag-sub">{t('“{client}” quer: {action}{target}. Nada é gravado até você aprovar.', '“{client}” wants to: {action}{target}. Nothing is saved until you approve.', { client: approval.clientName, action: changeKindLabel(change.kind).toLowerCase(), target: change.title ? ` — ${change.title}` : '' })}</p>
      <div className="ag-meta"><span>{t('+{n} linhas', '+{n} lines', { n: change.diff.added })}</span><span>{t('−{n} linhas', '−{n} lines', { n: change.diff.removed })}</span>{change.parentTitle && <span>{t('Dentro de: {title}', 'Inside: {title}', { title: change.parentTitle })}</span>}{change.diff.truncated && <span>{t('Diferença truncada', 'Diff truncated')}</span>}</div>
      <DiffView change={change} />
      <div className="ag-count"><Countdown expiresAt={approval.expiresAt} />{queued > 0 && <span className="ag-queue">{t('+{n} na fila', '+{n} queued', { n: queued })}</span>}</div>
      <div className="ag-actions">
        <Button ref={reject} onClick={() => onDecide('reject')}>{t('Rejeitar', 'Reject')}</Button>
        <span className="ag-spacer" />
        <Button onClick={() => onDecide('approve', true)} title={t('Aprova esta e as próximas escritas deste cliente por 1 hora', 'Approves this and the next writes from this client for 1 hour')}>{t('Aprovar tudo deste cliente por 1 h', 'Approve all from this client for 1 h')}</Button>
        <Button variant="primary" onClick={() => onDecide('approve')}>{t('Aprovar', 'Approve')}</Button>
      </div>
    </div>
  </div>
}
