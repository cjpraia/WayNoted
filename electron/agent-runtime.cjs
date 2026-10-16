// Carrega o núcleo de tarefas/consultas/notas diárias (src/agent/runtime.ts). No app empacotado e após
// `npm run build:agent` vem do módulo gerado electron/gen/agent-runtime.mjs; no desenvolvimento e nos testes,
// se o módulo gerado não existir, importa o TypeScript direto (Node com remoção de tipos).
let loading = null
function loadAgentRuntime() {
  loading ??= import('./gen/agent-runtime.mjs').catch(() => import('../src/agent/runtime.ts')).catch(error => {
    loading = null
    throw Object.assign(new Error('AGENT_RUNTIME_UNAVAILABLE: rode `npm run build:agent` (' + (error?.message ?? error) + ')'), { status: 500 })
  })
  return loading
}
module.exports = { loadAgentRuntime }
