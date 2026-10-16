// Mini barramento de eventos entre componentes do banco (ex.: o menu da coluna pede à
// barra de filtros que abra o popover de um filtro recém-criado).
type Payload = { dbId: string; filterId?: string }
type Listener = (p: Payload) => void

const listeners: Record<string, Set<Listener>> = {}

export const dbEvents = {
  on(name: 'openFilter' | 'openSort', fn: Listener) {
    ;(listeners[name] ??= new Set()).add(fn)
    return () => {
      listeners[name]?.delete(fn)
    }
  },
  emit(name: 'openFilter' | 'openSort', p: Payload) {
    listeners[name]?.forEach((fn) => fn(p))
  },
}
