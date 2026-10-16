// Host global do diálogo "Aprovar alteração de agente" (A1): toda escrita de um agente (API local, MCP, CLI) fica
// pendente no processo principal até o usuário aprovar ou rejeitar; passado o prazo, é rejeitada com erro claro.
import { useEffect, useMemo, useState } from 'react'
import { api } from '../store'
import { AgentApprovalDialog } from './AgentApprovalDialog'
import type { AgentApproval } from './types'

/** Montado uma vez em App.tsx; mostra o primeiro pedido da fila. */
export function AgentApprovalHost() {
  const [queue, setQueue] = useState<AgentApproval[]>([])
  useEffect(() => {
    if (!api.onAgentEvent) return
    let live = true
    void api.agentPending?.().then(list => { if (live) setQueue(list) }).catch(() => {})
    const off = api.onAgentEvent(event => {
      if (event.type === 'pending') setQueue(current => current.some(item => item.id === event.approval.id) ? current : [...current, event.approval])
      else setQueue(current => current.filter(item => item.id !== event.id))
    })
    return () => { live = false; off() }
  }, [])
  const current = queue[0]
  const decide = useMemo(() => (decision: 'approve' | 'reject', grantHour = false) => {
    if (!current) return
    setQueue(list => list.filter(item => item.id !== current.id))
    void api.agentDecide?.(current.id, decision, { grantHour }).catch(() => {})
  }, [current])
  if (!current) return null
  return <AgentApprovalDialog approval={current} queued={queue.length - 1} onDecide={decide} />
}
