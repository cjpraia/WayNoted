/** Unsaved transient media cannot be flushed like document editors. */
const guards = new Set<() => void>()

export function registerCloseGuard(guard: () => void): () => void {
  guards.add(guard)
  return () => { guards.delete(guard) }
}

/** Throws a user-facing explanation if closing/reloading would discard transient work. */
export function assertCanClose(): void {
  for (const guard of guards) guard()
}
