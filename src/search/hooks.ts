// Ponte sem dependências entre a store e o indexador de busca (evita import circular).
// `documentListeners`: outros índices locais (ex.: tarefas, src/tasks) recebem o mesmo aviso.
export const searchHooks: { documentIndexed: ((id: string, blocks: unknown[]) => void) | null; documentListeners: Set<(id: string, blocks: unknown[]) => void> } = { documentIndexed: null, documentListeners: new Set() }
