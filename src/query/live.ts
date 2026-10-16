// Ponte das consultas com a store: ambiente atual, cache por bloco, reexecução só quando dados
// relevantes mudam (tokens de dependência), adiamento curto para fontes amplas (digitar em outra
// página não recalcula a cada tecla) e avaliação em fatias ociosas para conjuntos grandes.
import { useEffect, useMemo, useRef, useState } from 'react'
import { getState, useStore } from '../store'
import { currentTasks, startTaskIndex, useTaskIndexVersion } from '../tasks/taskIndex'
import { weekStartFor } from '../daily/dailyCore'
import { liveChildren } from '../perf/pageIndex'
import { createQueryCache, queryDependencies, runQuery, runQuerySliced, sameDependencies, type QueryCache, type QueryEnv, type QueryResult } from './engine'
import type { Query } from './model'

const caches = new Map<string, QueryCache>()
const NO_TYPES: never[] = []
/** Cache por bloco (sobrevive a remontagens: recolher toggle, rolar, trocar de aba). */
export function cacheFor(blockId: string): QueryCache {
  let cache = caches.get(blockId)
  if (!cache) {
    cache = createQueryCache()
    caches.set(blockId, cache)
    if (caches.size > 200) caches.delete(caches.keys().next().value!)
  }
  return cache
}

export function queryEnv(thisPageId: string | undefined, query: Query): QueryEnv {
  const state = getState()
  const locale = state.settings.locale ?? 'pt-BR'
  const weekStart = weekStartFor(locale, state.settings.dailyFlow?.weekStart ?? 'auto')
  // Espaço bloqueado / ainda carregando: nenhuma página é lida.
  const pages = state.ready ? state.pages : {}
  return { pages, locale, now: Date.now(), thisPageId, weekStart, types: state.settings.objectTypes ?? NO_TYPES, ...(query.source.kind === 'tasks' ? { tasks: currentTasks(!!query.source.includeDone) } : {}) }
}

/** Acima disto a avaliação roda em fatias ociosas (não bloqueia digitação/rolagem). */
export const SLICE_THRESHOLD = 8000
const BROAD_DELAY = 250

const idle = () => new Promise<void>((resolve) => {
  const w = globalThis as typeof globalThis & { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }
  if (w.requestIdleCallback) w.requestIdleCallback(() => resolve(), { timeout: 50 }); else setTimeout(resolve, 0)
})

/** Tamanho estimado do conjunto de candidatos (decide entre síncrono e fatiado). */
export function estimateCandidates(env: QueryEnv, query: Query): number {
  if (query.source.kind === 'database' || query.source.kind === 'databases') return (query.source.databaseIds ?? []).reduce((sum, id) => sum + liveChildren(env.pages, id).length, 0)
  if (query.source.kind === 'children' && !query.source.deep) return liveChildren(env.pages, query.source.pageId && query.source.pageId !== '@thisPage' ? query.source.pageId : env.thisPageId ?? null).length
  if (query.source.kind === 'tasks') return env.tasks?.length ?? 0
  return Object.keys(env.pages).length
}

export interface LiveQuery { result: QueryResult | null; pending: boolean; error: string | null }

/** Resultado vivo de uma consulta num bloco. */
export function useQueryResult(query: Query | null, blockId: string, thisPageId: string | undefined): LiveQuery {
  const state = useStore()
  const taskVersion = useTaskIndexVersion()
  useEffect(() => { if (query?.source.kind === 'tasks') startTaskIndex() }, [query?.source.kind])
  const cache = cacheFor(blockId)
  const [, force] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const running = useRef<{ cancelled: boolean } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queryKey = useMemo(() => JSON.stringify(query), [query])
  // Relógio: datas relativas ("hoje") viram ao passar da meia-noite (o token do dia entra nas dependências).
  const [, setMinute] = useState(0)
  useEffect(() => { const id = setInterval(() => setMinute((n) => n + 1), 60_000); return () => clearInterval(id) }, [])

  let deps: unknown[] | null = null
  let env: QueryEnv | null = null
  let big = false
  if (query) {
    env = queryEnv(thisPageId, query)
    deps = queryDependencies(query, env, [queryKey, state.ready, query.source.kind === 'tasks' ? taskVersion : 0])
    big = estimateCandidates(env, query) > SLICE_THRESHOLD
    // Primeira execução ou consulta alterada, conjunto pequeno: calcula já (sem piscar "carregando").
    if (!big && !sameDependencies(cache.deps, deps) && cache.queryKey !== queryKey) {
      try { cache.result = runQuery(query, env, cache); cache.deps = deps; cache.queryKey = queryKey } catch (cause) { if (!error) queueMicrotask(() => setError(cause instanceof Error ? cause.message : String(cause))) }
    }
  }
  const fresh = !!deps && sameDependencies(cache.deps, deps)

  useEffect(() => {
    if (!query || !env || !deps || fresh) return
    const runEnv = env, runDeps = deps
    const execute = () => {
      if (running.current) running.current.cancelled = true
      try {
        if (!big) {
          cache.result = runQuery(query, runEnv, cache); cache.deps = runDeps; cache.queryKey = queryKey
          setError(null); force((n) => n + 1)
          return
        }
        const signal = { cancelled: false }
        running.current = signal
        void runQuerySliced(query, runEnv, cache, idle, signal).then((result) => {
          if (!result || signal.cancelled) return
          cache.result = result; cache.deps = runDeps; cache.queryKey = queryKey
          setError(null); force((n) => n + 1)
        }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    }
    if (timer.current) clearTimeout(timer.current)
    // Só os dados mudaram numa fonte ampla: espera a digitação assentar antes de recalcular.
    if (cache.queryKey === queryKey && runDeps.includes(runEnv.pages)) timer.current = setTimeout(() => { timer.current = null; execute() }, BROAD_DELAY)
    else execute()
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  })
  useEffect(() => () => { if (running.current) running.current.cancelled = true }, [])
  return { result: query ? cache.result ?? null : null, pending: !!query && !fresh, error }
}
