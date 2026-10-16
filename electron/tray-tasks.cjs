// "Hoje" na barra de menus (C3a): o renderer envia um retrato SOMENTE-LEITURA das tarefas de hoje/atrasadas
// (do índice de tarefas) e o processo principal o guarda por janela. Nada é lido de disco aqui; páginas protegidas
// por senha nunca entram no índice de tarefas do renderer, então nunca chegam à barra de menus.
const MAX_ITEMS = 10
const MAX_TITLE = 80
const MAX_ID = 300

const clean = value => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Valida o retrato vindo do renderer: no máximo 10 itens, textos curtos, contagens finitas. */
function sanitizeSnapshot(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) return null
  const items = []
  const seen = new Set()
  for (const raw of payload.items) {
    if (items.length >= MAX_ITEMS) break
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id || raw.id.length > MAX_ID || seen.has(raw.id)) continue
    seen.add(raw.id)
    items.push({ id: raw.id, title: clean(raw.title).slice(0, MAX_TITLE), overdue: raw.overdue === true })
  }
  const count = value => Number.isFinite(value) && value >= 0 ? Math.min(99999, Math.floor(value)) : 0
  return { items, total: Math.max(count(payload.total), items.length), overdue: count(payload.overdue) }
}

/** Texto do contador no título do ícone: vazio quando desligado ou sem tarefas. */
function badgeTitle(snapshot, enabled) {
  if (!enabled || !snapshot || !snapshot.total) return ''
  return snapshot.total > 99 ? '99+' : String(snapshot.total)
}

function createTrayTasks() {
  const bySender = new Map()
  return {
    set(senderId, workspaceId, payload) {
      const snapshot = sanitizeSnapshot(payload)
      if (!snapshot) throw new Error('Retrato de tarefas inválido')
      bySender.set(senderId, { workspaceId, snapshot, at: Date.now() })
      return snapshot
    },
    drop(senderId) { return bySender.delete(senderId) },
    /** Retrato mais recente de uma janela deste espaço. */
    forWorkspace(workspaceId) {
      let best = null, bestSender = null
      for (const [senderId, entry] of bySender) if (entry.workspaceId === workspaceId && (!best || entry.at >= best.at)) { best = entry; bestSender = senderId }
      return best ? { snapshot: best.snapshot, senderId: bestSender } : null
    },
    /** A janela dona do item (só ids do último retrato são encaminhados ao renderer). */
    ownerOf(workspaceId, itemId) {
      const found = this.forWorkspace(workspaceId)
      return found && found.snapshot.items.some(item => item.id === itemId) ? found.senderId : null
    },
  }
}

module.exports = { createTrayTasks, sanitizeSnapshot, badgeTitle, MAX_ITEMS }
