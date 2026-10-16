import PRODUCT from '../../shared/product.json' with { type: 'json' }
import COMPAT from '../../shared/compatibility.ts'
// Espelho Markdown contínuo (D1): observa o store e, com o espelho LIGADO, regrava só as páginas alteradas.
// Texto claro, opt-in, somente leitura: nunca lê os arquivos de volta. A gravação é do processo principal
// (electron/mirror.cjs); aqui só se decide o que mudou e se gera o Markdown (src/mirror/build.ts).
import { actions, api, getState, subscribe } from '../store'
import type { MirrorSettings } from '../types'
import { buildMirrorFiles, docRefs, keepIdsFrom, MIRROR_VERSION, planMirror } from './build.ts'

const DEBOUNCE_MS = 4000
const MAX_WAIT_MS = 30000
const STARTUP_MS = 8000
const BATCH_BYTES = 8 * 1024 * 1024
export const MIRROR_CHANGED = COMPAT.record054

export interface MirrorRunResult { written: number; removed: number; pages: number; updatedAt: number }
type Native = NonNullable<Pick<typeof api, 'mirrorSettings' | 'mirrorSettingsSet' | 'mirrorSyncState' | 'mirrorApply' | 'mirrorChooseFolder' | 'mirrorReveal' | 'mirrorRemove'>>

const native = () => api as typeof api & Native
export const mirrorAvailable = () => !!api.mirrorApply && !!api.mirrorSettings

/** "MIRROR_X: texto pt / text en" (erros do processo principal) → texto no idioma atual. */
export function mirrorMessage(error: unknown, locale: string): string {
  const raw = String((error as { message?: string })?.message ?? error)
  const cleaned = raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').replace(/^[A-Z_]{4,}: /, '')
  const [pt, en] = cleaned.split(' / ')
  return locale === 'en-US' && en ? en : pt
}

let enabled = false
let running: Promise<MirrorRunResult | null> | null = null
let again = false
let timer: ReturnType<typeof setTimeout> | undefined
let maxTimer: ReturnType<typeof setTimeout> | undefined
let lastPages: unknown = null
let lastSynced: unknown = null
// Citações de bloco por página (sem guardar os documentos: podem ter imagens grandes).
const refsCache = new Map<string, { sig: string; ids: string[] }>()
const listeners = new Set<(busy: boolean) => void>()
export function onMirrorBusy(listener: (busy: boolean) => void): () => void { listeners.add(listener); return () => listeners.delete(listener) }
const emit = (busy: boolean) => listeners.forEach((listener) => listener(busy))
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function runOnce(force: boolean): Promise<MirrorRunResult | null> {
  const bridge = native()
  const settings: MirrorSettings = await bridge.mirrorSettings!()
  enabled = settings.enabled
  if (!enabled || settings.vault.locked || (settings.vault.enabled && !settings.vaultAcknowledged)) return null
  const before = getState()
  if (!before.ready) return null
  if (!force && lastPages === before.pages && lastSynced === before.syncedBlocks) return null
  await actions.flushAll()
  const state = getState()
  const locale = state.settings.locale ?? 'pt-BR'
  const workspaceName = state.settings.workspaceName || `${PRODUCT.name}`
  const prev = force ? null : await bridge.mirrorSyncState!()
  const plan = planMirror({
    pages: state.pages, syncedBlocks: state.syncedBlocks, objectTypes: state.settings.objectTypes, locale, workspaceName, force,
    prev: prev ? { version: prev.version, globalSig: prev.globalSig, pages: prev.pages } : null,
  })
  lastPages = state.pages; lastSynced = state.syncedBlocks
  // Documentos: os das páginas sujas (conteúdo novo) e, se faltar, só as citações das demais.
  const documents: Record<string, unknown[]> = {}
  let loaded = 0
  for (const id of Object.keys(plan.pages)) {
    const sig = plan.pages[id].sig
    const cached = refsCache.get(id)
    const isDirty = plan.dirty.has(id)
    if (!isDirty && cached?.sig === sig) continue
    const doc = ((await api.loadDoc(id)) ?? []) as unknown[]
    refsCache.set(id, { sig, ids: docRefs(doc) })
    if (isDirty) documents[id] = doc
    if (++loaded % 20 === 0) await yieldToUi()
  }
  for (const id of [...refsCache.keys()]) if (!plan.pages[id]) refsCache.delete(id)
  const keepIds = keepIdsFrom([...refsCache.values()].map((entry) => entry.ids), plan.mirrorable.pages, state.syncedBlocks)
  const files = plan.dirty.size ? await buildMirrorFiles({ plan, documents, syncedBlocks: state.syncedBlocks, objectTypes: state.settings.objectTypes, workspaceName, locale, keepIds }) : {}
  const pages = Object.fromEntries(Object.entries(plan.pages).map(([id, p]) => [id, { sig: p.sig, files: p.files }]))
  // Envia em lotes de ~8 MB; o último leva o mapa de páginas (limpeza do que saiu e estado).
  let batch: Record<string, string | Uint8Array> = {}
  let size = 0
  const head = { workspaceName, locale, version: MIRROR_VERSION, globalSig: plan.globalSig, force }
  for (const [rel, content] of Object.entries(files)) {
    batch[rel] = content
    size += typeof content === 'string' ? content.length : content.byteLength
    if (size >= BATCH_BYTES) { await bridge.mirrorApply!({ ...head, files: batch, pages: {}, partial: true }); batch = {}; size = 0 }
  }
  return bridge.mirrorApply!({ ...head, files: batch, pages, complete: plan.complete })
}

/** Atualiza agora (botão "Atualizar agora" = regravação completa). Execuções simultâneas são enfileiradas. */
export function mirrorNow(force = false): Promise<MirrorRunResult | null> {
  if (running) { again = true; return running }
  emit(true)
  const run = runOnce(force).catch(async (error) => {
    lastPages = null
    // Falha de montagem no renderer: registra para a interface mostrar; erros do processo principal já são registrados lá.
    if (!/^(Error invoking remote method [^:]+: )?(Error: )?MIRROR_/.test(String((error as Error)?.message ?? error))) {
      await native().mirrorApply?.({ error: String((error as Error)?.message ?? error) }).catch(() => {})
    }
    throw error
  }).finally(() => {
    running = null
    emit(false)
    if (again) { again = false; schedule() }
  })
  running = run
  return run
}

function schedule(delay = DEBOUNCE_MS) {
  if (!enabled) return
  clearTimeout(timer)
  timer = setTimeout(fire, delay)
  maxTimer ??= setTimeout(fire, MAX_WAIT_MS)
}
function fire() {
  clearTimeout(timer); clearTimeout(maxTimer); maxTimer = undefined
  void mirrorNow().catch(() => { /* o estado de erro fica no processo principal; a interface o mostra */ })
}

/** Liga o observador (uma vez por janela). Devolve a função de desligar. */
export function startMirror(): () => void {
  if (!mirrorAvailable()) return () => {}
  const refresh = () => native().mirrorSettings!().then((settings) => { enabled = settings.enabled; if (enabled) schedule(1000) }).catch(() => {})
  const off = subscribe(() => schedule())
  const onChanged = () => { lastPages = null; void refresh() }
  window.addEventListener(MIRROR_CHANGED, onChanged)
  const startup = setTimeout(() => { void refresh() }, STARTUP_MS)
  return () => { off(); window.removeEventListener(MIRROR_CHANGED, onChanged); clearTimeout(startup); clearTimeout(timer); clearTimeout(maxTimer); maxTimer = undefined }
}

export function notifyMirrorChanged() { window.dispatchEvent(new Event(MIRROR_CHANGED)) }
