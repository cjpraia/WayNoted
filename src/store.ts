import PRODUCT from '../shared/product.json' with { type: 'json' }
import COMPAT from '../shared/compatibility.ts'
// Store central do aplicativo. Todos os componentes leem/escrevem por aqui.
import { useSyncExternalStore } from 'react'
import type { DatabaseSchema, DocumentVersion, LocalNotification, Meta, NativeApi, Page, Property, PropValue, Route, Settings, SyncedBlockRecord, View, ViewType, WorkspaceBackup } from './types'
import type { AutomationAction, AutomationRunLog, ButtonAction } from './database-models'
import { translate } from './localization.ts'
import { mergeMeta, pageContentChanged, assignSequences } from '../electron/meta-merge.mjs'
import { advanceSchedule, collectDueReminders } from '../electron/reminders.mjs'
import { reconcileDateReminders } from '../electron/recurrence.mjs'
import { recurringCompletions, type CompletionPlan } from './recurrence.ts'
import { planRelationMirror, templateDefaults, nextSequence, dueAutomations, validActions } from './components/database/engines.ts'
import { MAX_AUTOMATION_DEPTH, appendLog, automationsFor, conditionsPass, dateArrivals, describeAction, fillTemplate, type DescribeContext, type TriggerEvent } from './components/database/automations.ts'
import { defaultSettings, validateMeta, validateBackup, cloneDocument, collectBlockMapping, remapReferences, foldSearch, documentLinks } from './workspace.ts'
import { blocksToText, flushAllDocs, flushDoc, clearDraft, windowDraftId } from './components/page/util.ts'
import { applySuggestionToBlocks } from './components/page/suggestions.ts'
import { pageBlockReferences, ownedPageBlockChanges } from './page-block-ownership.ts'
import { lockedAncestor, protectedAncestor, lockPrompts } from './security/pageLock.ts'
import { searchHooks } from './search/hooks.ts'
import { allChildren, descendantIds, isLiveIndexed, liveChildren, pageIndex } from './perf/pageIndex.ts'
import { sharePages, shareValue } from './perf/shareMeta.ts'
import { applyMetaPatch, diffMeta } from '../electron/meta-patch.mjs'
import { ProductivityClient, browserBackend, nativeBackend } from './activity/client.ts'
import { docStats, type DocStats } from './activity/words.ts'
import { completesTask } from './activity/tasks.ts'
import { applySchemaFn, findType, mergeImportedTypes, mirrorIncorporatedValues, schemaFromType, typeFieldOwner, typeIdFromSchemaId } from './objecttypes/model.ts'
import { setRegisteredTypes } from './objecttypes/registry.ts'
import { resetCacheConnection } from './search/cache.ts'
import { createUndoStack, snapsDiffer, type UndoSnap } from './components/database/dbUndo.ts'
import { changeViewType as viewTypePatch } from './components/database/settings/model.ts'
import { adoptSourceView, relinkedSchema, resolveLinkedRoot } from './components/database/linkedSource.ts'
import { planTypeSchemaChange } from './objecttypes/convert.ts'
import { markStep, type StepId } from './onboarding/model.ts'
import { expandRowTemplate } from './templates/rowTemplate.ts'
import { setPendingCursor } from './templates/cursor.ts'
import { showToast } from './components/ui/toastQueue.ts'
import { setStepTracker, trackStep } from './onboarding/tracker.ts'
import { defaultCardHidden } from './components/database/cardDefaults.ts'

const LS_META = COMPAT.record057
const LS_DOC = COMPAT.record058
const LS_VERSIONS = COMPAT.record059
const message = (pt: string, en: string) => translate(state.settings.locale, pt, en)

function browserVersion(id: string, blocks: unknown[], page?: Page, reason: DocumentVersion['reason'] = 'edit') {
  const versions: DocumentVersion[] = JSON.parse(localStorage.getItem(LS_VERSIONS + id) ?? '[]')
  const now = Date.now(), timestamp = Math.max(now, versions.length ? Number(versions[0].id.slice(0, 13)) + 1 : now)
  versions.unshift({ id: `${timestamp}-${crypto.randomUUID()}`, savedAt: now, blocks, page, reason })
  const limit = state.settings.historyLimit ?? 0
  localStorage.setItem(LS_VERSIONS + id, JSON.stringify(limit > 0 ? versions.slice(0, limit) : versions))
}

// Fallback para rodar no navegador (vite dev) sem o Electron.
const browserApi: NativeApi = {
  async loadMeta() {
    const raw = localStorage.getItem(LS_META)
    return raw ? (JSON.parse(raw) as Meta) : null
  },
  async saveMeta(meta, base) {
    const current: Meta | null = JSON.parse(localStorage.getItem(LS_META) ?? 'null')
    const merged = assignSequences(current, base && current ? mergeMeta(current, base, meta) : meta)
    for (const page of Object.values(current?.pages ?? {})) if (pageContentChanged(page, merged.pages[page.id])) browserVersion(page.id, JSON.parse(localStorage.getItem(LS_DOC + page.id) ?? '[]'), page, 'metadata')
    localStorage.setItem(LS_META, JSON.stringify(merged))
    return merged
  },
  async loadDoc(id) {
    const raw = localStorage.getItem(LS_DOC + id)
    if (!raw) return null
    const doc: unknown = JSON.parse(raw)
    if (!Array.isArray(doc)) throw new Error('O conteúdo desta página está inválido. O original foi preservado.')
    return doc
  },
  async saveDoc(id, blocks, options) {
    const previous = localStorage.getItem(LS_DOC + id)
    const content = JSON.stringify(blocks)
    if (options?.base !== undefined && previous !== options.base && previous !== content) {
      browserVersion(id, blocks, options.page, 'conflict')
      throw new Error('DOC_CONFLICT: ' + message('Outra janela alterou esta página. Seu conteúdo foi preservado no histórico como conflito.', 'Another window changed this page. Your content was preserved in history as a conflict.'))
    }
    if (previous && previous !== content) {
      const meta: Meta | null = JSON.parse(localStorage.getItem(LS_META) ?? 'null')
      browserVersion(id, JSON.parse(previous), meta?.pages[id], options?.checkpoint ? 'checkpoint' : 'edit')
    }
    localStorage.setItem(LS_DOC + id, JSON.stringify(blocks))
  },
  async listDocVersions(id) { return JSON.parse(localStorage.getItem(LS_VERSIONS + id) ?? '[]') as DocumentVersion[] },
  async saveDocVersions(id, versions) { localStorage.setItem(LS_VERSIONS + id, JSON.stringify(versions)) },
  async deleteDoc(id) {
    localStorage.removeItem(LS_DOC + id)
    localStorage.removeItem(LS_VERSIONS + id)
  },
  async exportFile(defaultName, content) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
    a.download = defaultName
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    return true
  },
  async exportBinaryFile(defaultName, data) {
    const a = document.createElement('a'), bytes = new Uint8Array(data)
    a.href = URL.createObjectURL(new Blob([bytes.buffer], { type: 'application/octet-stream' })); a.download = defaultName; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000); return true
  },
  async pickImage() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.oncancel = () => resolve(null)
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return resolve(null)
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'))
        reader.readAsDataURL(file)
      }
      input.click()
    })
  },
  async revealDataFolder() {},
  async pickFiles() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input'); input.type = 'file'; input.multiple = true
      input.oncancel = () => resolve([])
      input.onchange = async () => {
        try { resolve(await Promise.all([...input.files ?? []].map(file => new Promise<import('./types').FileValue>((res, rej) => {
          const reader = new FileReader(); reader.onerror = rej
          reader.onload = () => res({ id: crypto.randomUUID(), name: file.name, mimeType: file.type, data: String(reader.result), size: file.size })
          reader.readAsDataURL(file)
        })))) } catch (error) { reject(error) }
      }
      input.click()
    })
  },
}

const storageApi: NativeApi = window.api ?? browserApi
// Painel de Produtividade (src/activity, docs/USAGE.md): só contadores por dia, por espaço.
export const productivity = new ProductivityClient(nativeBackend(storageApi) ?? browserBackend(), () => state.ready && state.settings.productivity?.enabled !== false)
/** Páginas protegidas por senha (ou dentro de uma) contam nos totais, mas nunca são registradas pelo nome. */
const namedForActivity = (id: string) => !protectedAncestor(state.pages, id)
const lastDocStats = new Map<string, { json: string; stats: DocStats }>()
function recordDocumentSave(id: string, previous: unknown[], previousJson: string | null | undefined, blocks: unknown[], json: string) {
  if (!state.ready || state.settings.productivity?.enabled === false) return
  const cached = lastDocStats.get(id)
  const changed = typeof previousJson === 'string' || previousJson === null ? previousJson !== json : JSON.stringify(previous) !== json
  if (!changed) return
  const before = cached && cached.json === previousJson ? cached.stats : docStats(previous, blocksToText)
  const after = docStats(blocks, blocksToText)
  lastDocStats.set(id, { json, stats: after })
  if (lastDocStats.size > 50) lastDocStats.delete(lastDocStats.keys().next().value!)
  productivity.docSaved(id, before, after, namedForActivity(id))
}
/** Leitura sem efeitos colaterais (sem recuperação/indexação) para o indexador de busca em segundo plano. */
export const loadDocForIndex = (id: string) => storageApi.loadDoc(id)
const documentBases = new Map<string, string | null>()
const checkedPageBlockHistory = new Set<string>()
const pendingPageBlockChanges = new Map<string, unknown[]>()
const initializingDocuments = new Map<string, Promise<void>>()
function initializeTemplateDocument(id: string): Promise<void> {
  const active = initializingDocuments.get(id)
  if (active) return active
  const page = state.pages[id]
  if (!page?.pendingTemplateBlocks) return Promise.resolve()
  const operation = (async () => {
    const existing = await storageApi.loadDoc(id)
    const blocks = existing ?? page.pendingTemplateBlocks!
    if (existing === null) await storageApi.saveDoc(id, blocks, { base: null, page })
    documentBases.set(id, JSON.stringify(blocks))
    if (state.pages[id]?.pendingTemplateBlocks) {
      const updated = { ...state.pages[id] }; delete updated.pendingTemplateBlocks
      set({ pages: { ...state.pages, [id]: updated } })
      indexDocument(id, blocks)
    }
  })()
  initializingDocuments.set(id, operation)
  operation.finally(() => { if (initializingDocuments.get(id) === operation) initializingDocuments.delete(id) }).catch(() => {})
  return operation
}
export const api: NativeApi = {
  ...storageApi,
  async loadDoc(id) {
    await initializeTemplateDocument(id)
    const blocks = await storageApi.loadDoc(id)
    documentBases.set(id, blocks === null ? null : JSON.stringify(blocks))
    if (blocks) indexDocument(id, blocks)
    if (blocks && state.ready && !checkedPageBlockHistory.has(id)) {
      await actions.recoverRemovedDatabaseBlocks(id, blocks)
      checkedPageBlockHistory.add(id)
    }
    return blocks
  },
  async saveDoc(id, blocks, options) {
    await initializeTemplateDocument(id)
    const base = documentBases.has(id) ? documentBases.get(id) : undefined
    const previousJson = options?.base !== undefined ? options.base : base
    const previous = pendingPageBlockChanges.get(id) ?? (previousJson === undefined ? await storageApi.loadDoc(id) ?? [] : previousJson === null ? [] : JSON.parse(previousJson) as unknown[])
    const ownershipAt = options?.ownershipAt ?? Date.now()
    const savedMeta = await storageApi.saveDoc(id, blocks, { base, page: state.pages[id], ...options, ownershipAt })
    if (savedMeta && state.ready) applyRemoteMeta(savedMeta)
    const savedJson = JSON.stringify(blocks)
    documentBases.set(id, savedJson)
    // Só salvamentos do editor (com base de conflito) contam como escrita; importações e modelos, não.
    if (options?.base !== undefined) try { recordDocumentSave(id, previous, previousJson, blocks, savedJson) } catch { /* contagem nunca impede a gravação */ }
    indexDocument(id, blocks)
    pendingPageBlockChanges.set(id, previous)
    await actions.reconcileOwnedPageBlocks(id, previous, blocks, ownershipAt)
    await flushMeta()
    pendingPageBlockChanges.delete(id)
  },
}

function indexDocument(id: string, blocks: unknown[]) {
  const page = state.pages[id]
  // Password-protected pages stay out of the search index (src/security).
  if (!page || page.passwordLock) return
  const syncedBlockIds = new Set<string>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object') return
    const object = value as Record<string, unknown>
    if (typeof object.syncedId === 'string') syncedBlockIds.add(object.syncedId)
    Object.values(object).forEach(visit)
  }
  visit(blocks)
  const bodyText = blocksToText(blocks), text = [bodyText, ...[...syncedBlockIds].map(key => blocksToText(state.syncedBlocks[key]?.blocks ?? []))].filter(Boolean).join('\n')
  const bodyOutboundPageIds = documentLinks(blocks)
  const outboundPageIds = [...new Set([...bodyOutboundPageIds, ...[...syncedBlockIds].flatMap(key => documentLinks(state.syncedBlocks[key]?.blocks ?? []))])].sort()
  if (text !== page.text || page.bodyText !== bodyText || !page.bodyOutboundPageIds || JSON.stringify([...syncedBlockIds]) !== JSON.stringify(page.syncedBlockIds) || JSON.stringify(outboundPageIds) !== JSON.stringify(page.outboundPageIds)) {
    actions.updatePage(id, { text, bodyText, bodyOutboundPageIds, syncedBlockIds: [...syncedBlockIds], outboundPageIds }, false)
  }
  searchHooks.documentIndexed?.(id, blocks)
  for (const listener of searchHooks.documentListeners) listener(id, blocks)
}

export interface State {
  ready: boolean
  pages: Record<string, Page>
  settings: Settings
  route: Route
  /** Pilha de navegação (voltar/avançar). */
  history: Route[]
  historyIndex: number
  searchOpen: boolean
  settingsOpen: boolean
  initError: string | null
  saveError: string | null
  saving: boolean
  lastSavedAt: number | null
  peekPageId: string | null
  peekMode: 'side' | 'center'
  peekWidth: number
  peekRowIds: string[] | null
  docRevision: number
  inboxOpen: boolean
  notifications: Record<string, LocalNotification>
  syncedBlocks: Record<string, SyncedBlockRecord>
  conflictMeta: Meta | null
}

let state: State = {
  ready: false,
  pages: {},
  settings: defaultSettings,
  route: { type: 'home' },
  history: [{ type: 'home' }],
  historyIndex: 0,
  searchOpen: false,
  settingsOpen: false,
  initError: null,
  saveError: null,
  saving: false,
  lastSavedAt: null,
  peekPageId: null,
  peekMode: 'side',
  peekWidth: 720,
  peekRowIds: null,
  docRevision: 0,
  inboxOpen: false, notifications: {}, syncedBlocks: {}, conflictMeta: null,
}

const listeners = new Set<() => void>()
let saveTimer: ReturnType<typeof setTimeout> | null = null
let revision = 0
let savedRevision = 0
let metaWrite: Promise<void> | null = null
let initPromise: Promise<void> | null = null
let metaError: string | null = null
let persistedMeta: Meta | null = null
/** `depth`: quantas automações já estão encadeadas (uma regra que dispara outra); passar de MAX_AUTOMATION_DEPTH interrompe o laço. */
interface AutomationRun { remaining: number; seen: Set<string>; depth: number }
const newRun = (): AutomationRun => ({ remaining: 64, seen: new Set(), depth: 0 })
/** Execução em andamento: páginas criadas por uma ação herdam a profundidade (um "linha criada" não pode gerar linhas para sempre). */
let currentRun: AutomationRun | null = null
const localDayOf = (at: number) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
let schedulerRunning = false
function currentMeta(): Meta { return { pages: state.pages, settings: state.settings, notifications: state.notifications, syncedBlocks: state.syncedBlocks } }

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.includes('CONCURRENT_CHANGE')) return message('Outra janela alterou o mesmo campo. As duas cópias foram preservadas; exporte suas alterações ou carregue a versão salva.', 'Another window changed the same field. Both copies were preserved; export your edits or load the saved version.')
  if (error instanceof Error && error.message.includes('DOC_DELETED')) return message('A página foi excluída em outra janela. Recupere suas edições em Configurações → Dados.', 'The page was deleted in another window. Recover your edits in Settings → Data.')
  if (error instanceof Error && error.message.includes('DOC_CONFLICT')) return message('Outra janela alterou esta página. Suas alterações foram preservadas no histórico como conflito.', 'Another window changed this page. Your edits were preserved in version history as a conflict.')
  return error instanceof Error ? error.message : message('Não foi possível gravar os dados locais.', 'Unable to save local data.')
}

/** Base que o processo principal conhece para esta janela (gravação incremental); null = enviar tudo. */
let metaSeq: number | null = null
async function saveMetaIncremental(proposed: Meta): Promise<{ merged: Meta | void; seq: number | null }> {
  if (!api.saveMetaDelta) return { merged: await api.saveMeta(proposed, persistedMeta), seq: null }
  let response = metaSeq !== null && persistedMeta ? await api.saveMetaDelta({ seq: metaSeq, patch: diffMeta(persistedMeta, proposed) }) : { resync: true as const }
  if ('resync' in response) response = await api.saveMetaDelta({ seq: null, meta: proposed, base: persistedMeta })
  if ('resync' in response) return { merged: await api.saveMeta(proposed, persistedMeta), seq: null }
  return { merged: applyMetaPatch(proposed, response.patch), seq: response.seq }
}

async function flushMeta(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  if (metaWrite) { await metaWrite; return flushMeta() }
  if (!state.ready || savedRevision === revision) return
  metaWrite = (async () => {
    set({ saving: true }, false)
    try {
      while (savedRevision !== revision) {
        const writingRevision = revision
        const proposed = currentMeta()
        const { merged, seq } = await saveMetaIncremental(proposed)
        persistedMeta = merged ?? proposed
        if (merged) applyRemoteMeta(merged, proposed)
        // Só agora: applyRemoteMeta zera a base incremental (vale para metas vindos de outras origens).
        metaSeq = seq
        savedRevision = writingRevision
      }
      set({ saveError: state.saveError === metaError ? null : state.saveError, lastSavedAt: Date.now() }, false)
      metaError = null
    } catch (error) {
      if (error instanceof Error && error.message.includes('CONCURRENT_CHANGE')) {
        const conflict = currentMeta()
        try {
          if (window.api) await api.saveMetaConflict?.(conflict)
          else localStorage.setItem(COMPAT.record060 + Date.now(), JSON.stringify(conflict))
        } catch { /* Kept in memory too; never write an unencrypted native fallback. */ }
        set({ conflictMeta: conflict }, false)
      }
      metaError = errorMessage(error)
      set({ saveError: metaError }, false)
      throw error
    } finally {
      set({ saving: false }, false)
    }
  })()
  try { await metaWrite } finally { metaWrite = null }
}

function persist() {
  revision++
  if (saveTimer) clearTimeout(saveTimer)
  // Espaços de trabalho enormes: agrupa mais edições por gravação (até 1 s); o fechamento continua gravando tudo.
  const delay = Math.min(1000, 250 + Math.floor(pageIndex(state.pages).size / 100))
  saveTimer = setTimeout(() => {
    saveTimer = null
    void flushMeta().catch(() => {})
  }, delay)
}

// Grava imediatamente o que estiver pendente ao fechar/recarregar a janela.
window.addEventListener('beforeunload', (event) => {
  if (!state.ready) return
  // localStorage commits synchronously; desktop uses the acknowledged close handshake.
  if (!window.api && revision !== savedRevision) void flushMeta().catch(() => {})
  productivity.flushSync()
  if (state.saveError) { event.preventDefault(); event.returnValue = '' }
})

function set(patch: Partial<State>, save = true) {
  state = { ...state, ...patch }
  if (patch.settings) setRegisteredTypes(state.settings.objectTypes)
  listeners.forEach((l) => l())
  if (save && state.ready) persist()
}

/** Marca um passo de "Primeiros passos" (eventos locais; sem rede). Não grava de novo se já feito. */
setStepTracker((id: StepId) => {
  if (!state.ready || state.settings.onboarding?.done?.[id]) return
  set({ settings: { ...state.settings, onboarding: markStep(state.settings.onboarding, id) } })
})

function applyRemoteMeta(remote: Meta, base: Meta | null = persistedMeta) {
  if (!state.ready) return
  metaSeq = null
  try {
    const local = currentMeta()
    const merged = base ? mergeMeta(remote, base, local) : remote
    // Navigation and tabs are per window, even when the workspace changes elsewhere.
    merged.settings = { ...merged.settings, openTabs: state.settings.openTabs, activeTabId: state.settings.activeTabId, recent: state.settings.recent }
    // Reaproveita objetos iguais: o meta chega clonado e trocaria a identidade de todas as páginas.
    set({ ...merged, pages: sharePages(merged.pages, state.pages), settings: shareValue(merged.settings, state.settings), notifications: shareValue(merged.notifications ?? {}, state.notifications), syncedBlocks: shareValue(merged.syncedBlocks ?? {}, state.syncedBlocks) }, false)
    persistedMeta = remote
    if (state.route.type === 'page' && !isLive(state.route.id)) actions.navigate({ type: 'home' })
  } catch (error) { set({ saveError: errorMessage(error), conflictMeta: currentMeta() }, false) }
}

storageApi.onDataChanged?.(change => {
  if (change.meta) {
    const before = Object.keys(state.pages).length
    applyRemoteMeta(validateMeta(change.meta))
    // Uma página nova vinda de outro processo (janela de captura rápida) conta como "Capture algo".
    if (state.ready && Object.keys(state.pages).length > before) trackStep('capture')
  }
  if (change.documentId) set({ docRevision: state.docRevision + 1 }, false)
  if (change.cacheReset) resetCacheConnection()
})
if (!window.api) window.addEventListener('storage', (event) => {
  if (event.key === LS_META && event.newValue) {
    try { applyRemoteMeta(validateMeta(JSON.parse(event.newValue))) } catch (error) { actions.reportSaveError(error) }
  }
  if (event.key?.startsWith(LS_DOC)) set({ docRevision: state.docRevision + 1 }, false)
})

function sameRoute(a: Route, b: Route) {
  return JSON.stringify(a) === JSON.stringify(b)
}

const closedTabs: NonNullable<Settings['openTabs']> = []
const tabHistory = new Map<string, { history: Route[]; historyIndex: number }>()

function validRoute(route: Route): Route {
  if (route.type === 'objectType') return state.settings.objectTypes?.some(type => type.id === route.id) ? route : { type: 'home' }
  return route.type === 'page' && !isLive(route.id) ? { type: 'home' } : route
}

function settingsForRoute(route: Route): Settings {
  const settings = state.settings
  const tabs = settings.openTabs?.length ? settings.openTabs : [{ id: crypto.randomUUID(), route }]
  const activeTabId = tabs.some(t => t.id === settings.activeTabId) ? settings.activeTabId! : tabs[0].id
  return { ...settings, activeTabId,
    openTabs: tabs.map(t => t.id === activeTabId ? { ...t, route } : t),
    recent: route.type === 'page' ? [route.id, ...settings.recent.filter(id => id !== route.id)].slice(0, 50) : settings.recent,
  }
}

// Proteção por senha (src/security): nada é criado ou movido para dentro de uma página trancada.
function passwordLockedMessage() { return message('Desbloqueie a página para adicionar subpáginas.', 'Unlock the page to add subpages.') }
function assertNotPasswordLocked(parentId: string | null | undefined) {
  if (parentId && lockedAncestor(state.pages, parentId)) throw new Error(passwordLockedMessage())
}
async function protectSubpage(protectedPageId: string, pageId: string) {
  if (typeof window === 'undefined') return
  const security = (window as unknown as { api?: { pageProtectChildren?(pageId: string, ids?: string[]): Promise<{ meta: Meta }> } }).api
  if (!security?.pageProtectChildren) return
  const result = await security.pageProtectChildren(protectedPageId, [pageId])
  if (result?.meta && state.ready) applyRemoteMeta(result.meta)
}

function isLive(id: string | null): boolean {
  // Uma página está "viva" se nem ela nem nenhum ancestral está na lixeira (memoizado por versão de `pages`).
  return isLiveIndexed(state.pages, id)
}

function descendants(id: string): string[] {
  return descendantIds(state.pages, id)
}

function nextOrder(parentId: string | null) {
  const sib = allChildren(state.pages, parentId)
  return sib.length ? sib[sib.length - 1].order + 1 : 0
}

const VIEW_NAMES: Record<ViewType, string> = {
  table: 'Tabela',
  board: 'Quadro',
  calendar: 'Calendário',
  list: 'Lista',
  gallery: 'Galeria',
  timeline: 'Linha do tempo',
  chart: 'Gráfico',
  dashboard: 'Painel', map: 'Mapa', feed: 'Feed', form: 'Formulário',
}
const VIEW_NAMES_EN: Record<ViewType, string> = { table: 'Table', board: 'Board', calendar: 'Calendar', list: 'List', gallery: 'Gallery', timeline: 'Timeline', chart: 'Chart', dashboard: 'Dashboard', map: 'Map', feed: 'Feed', form: 'Form' }

function newView(type: ViewType, init: Partial<View> = {}): View {
  return { id: crypto.randomUUID(), name: message(VIEW_NAMES[type], VIEW_NAMES_EN[type]), type, filters: [], sorts: [], hidden: [], widths: {}, ...init }
}


// ---------- Desfazer de banco de dados (⌘Z fora de campos de texto) ----------
const dbUndoStack = createUndoStack()
const linkedSchemaListeners = new Set<(event: { dbId: string; sourceId: string }) => void>()
let dbUndoBusy = false
const UNDO_FIELDS = ['props', 'title', 'trashed', 'trashedAt', 'database', 'typeProps'] as const
function snapPages(ids: string[]): UndoSnap {
  const out: UndoSnap = {}
  for (const id of ids) {
    const page = state.pages[id]
    out[id] = page ? Object.fromEntries(UNDO_FIELDS.map((k) => [k, (page as unknown as Record<string, unknown>)[k]])) : null
  }
  return out
}
function applySnap(snap: UndoSnap) {
  dbUndoBusy = true
  try {
    for (const [id, fields] of Object.entries(snap)) {
      if (!state.pages[id]) continue
      if (fields === null) actions.updatePage(id, { trashed: true, trashedAt: Date.now() }, false)
      else actions.updatePage(id, fields as Partial<Page>, false)
    }
  } finally { dbUndoBusy = false }
}
/** Campos restaurados por transações estruturais (conversões de páginas ↔ bancos). */
const STRUCT_FIELDS = [...UNDO_FIELDS, 'parentId', 'order', 'blockOwnerId'] as const
function snapStruct(ids: string[]): UndoSnap {
  const out: UndoSnap = {}
  for (const id of ids) {
    const page = state.pages[id]
    out[id] = page ? Object.fromEntries(STRUCT_FIELDS.map((k) => [k, (page as unknown as Record<string, unknown>)[k]])) : null
  }
  return out
}
function trackUndo<T>(label: string, key: string, ids: string[], fn: () => T): T {
  if (dbUndoBusy || !state.ready) return fn()
  const before = snapPages(ids)
  dbUndoBusy = true
  try { return fn() } finally {
    dbUndoBusy = false
    const after = snapPages(ids)
    if (snapsDiffer(before, after)) dbUndoStack.push({ label, key, at: Date.now(), before, after })
  }
}

function automationContext(): DescribeContext {
  return {
    t: (pt, en, vars) => translate(state.settings.locale, pt, en, vars),
    typeName: id => state.settings.objectTypes?.find(type => type.id === id)?.name,
    pageTitle: id => state.pages[id]?.title || undefined,
  }
}

/** Uma ação de automação. Devolve true quando a regra deve parar (a linha saiu do banco ou foi para a lixeira). */
async function runAutomationAction(rowId: string, task: AutomationAction, run: AutomationRun): Promise<boolean> {
  const row = state.pages[rowId]
  const schema = row?.parentId ? state.pages[row.parentId]?.database : undefined
  if (!row || !schema) return true
  switch (task.kind) {
    case 'setProperty': if (validActions(schema, [task]).length) actions.setProp(rowId, task.propertyId, task.value, run); return false
    case 'setTitle': actions.updatePage(rowId, { title: fillTemplate(task.value, row) }); return false
    case 'createRow': actions.createRow(row.parentId!, {}, {}, task.templateId); return false
    case 'duplicateRow': await actions.duplicatePage(rowId); return false
    case 'archiveRow': actions.trashPage(rowId); return true
    case 'moveRow': {
      const target = state.pages[task.databaseId]
      if (!target?.database || !isLive(target.id) || target.locked || target.id === row.parentId) throw new Error(message('O banco de destino não está disponível.', 'The destination database is unavailable.'))
      actions.movePage(rowId, target.database.linkedSourceId ?? target.id)
      return true
    }
    case 'createTask': {
      if (row.passwordLock || protectedAncestor(state.pages, rowId)) throw new Error(message('A linha está protegida por senha.', 'The row is password protected.'))
      await actions.flushAll()
      const blocks = structuredClone(await api.loadDoc(rowId) ?? []) as unknown[]
      const text = fillTemplate(task.title, row).trim() || message('Tarefa', 'Task')
      const content: unknown[] = [{ type: 'text', text: task.inDays === undefined ? text : `${text} `, styles: {} }]
      if (task.inDays !== undefined) {
        const now = new Date()
        const due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + Math.max(0, Math.min(3650, Math.trunc(task.inDays))), 12)
        content.push({ type: 'dateMention', props: { id: crypto.randomUUID(), date: due.toISOString(), startDate: '', pageId: rowId, repeat: '', reminderId: '', time: '' } })
      }
      await api.saveDoc(rowId, [...blocks, { id: crypto.randomUUID(), type: 'checkListItem', props: { checked: false }, content, children: [] }], { checkpoint: true })
      await actions.reloadDocument(rowId)
      return false
    }
    case 'addType': {
      if (!state.settings.objectTypes?.some(type => type.id === task.typeId)) throw new Error(message('A tag/tipo não existe mais.', 'The tag/type no longer exists.'))
      if (row.types?.includes(task.typeId)) return false
      const { applyType } = await import('./objecttypes/actions.ts')
      const result = applyType([rowId], task.typeId, { toast: false })
      if (result.skipped.length && !result.applied.length) throw new Error(message('Não foi possível aplicar a tag/tipo a esta linha.', 'Could not apply the tag/type to this row.'))
      return false
    }
    case 'notify': actions.scheduleReminder(rowId, Date.now() + 1000, row.title || message('Automação', 'Automation'), fillTemplate(task.message, row)); return false
    default: return false
  }
}

export const actions = {
  async init() {
    if (state.ready) return
    if (initPromise) return initPromise
    initPromise = (async () => {
      set({ initError: null }, false)
      try {
        const raw = await api.loadMeta()
        if (api.saveMetaConflict && typeof localStorage.length === 'number') {
          for (const key of Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((key): key is string => !!key?.startsWith(COMPAT.record060))) {
            const content = localStorage.getItem(key)
            if (content) { await api.saveMetaConflict(validateMeta(JSON.parse(content))); localStorage.removeItem(key) }
          }
        }
        if (raw) {
          const meta = validateMeta(raw)
          persistedMeta = raw
          metaSeq = -1 // o processo principal guardou esta mesma base no loadMeta
          set({ ...meta, ready: true }, false)
        } else {
          const id = crypto.randomUUID(), now = Date.now()
          const page: Page = { id, parentId: null, title: 'Getting started', icon: '👋', cover: null, coverPosition: 50,
            favorite: false, trashed: false, trashedAt: null, createdAt: now, updatedAt: now, order: 0, fullWidth: false,
            smallText: false, font: 'default', locked: false, text: blocksToText(welcomeDoc) }
          await api.saveDoc(id, welcomeDoc)
          persistedMeta = { pages: { [id]: page }, settings: defaultSettings, notifications: {}, syncedBlocks: {} }
          await api.saveMeta(persistedMeta)
          set({ pages: { [id]: page }, ready: true }, false)
        }
        const tabs = (state.settings.openTabs ?? []).filter(t => t.route.type !== 'page' || isLive(t.route.id))
        if (!tabs.length) tabs.push({ id: crypto.randomUUID(), route: { type: 'home' } })
        const active = tabs.find(t => t.id === state.settings.activeTabId) ?? tabs[0]
        set({ settings: { ...state.settings, openTabs: tabs, activeTabId: active.id }, route: active.route,
          history: [active.route], historyIndex: 0 }, false)
        // Tipos nativos (Pessoa, Projeto…): todo espaço, novo ou antigo, ganha os que faltam uma única vez. docs/USAGE.md
        { const { ensureNativeTypes } = await import('./objecttypes/actions.ts'); ensureNativeTypes() }
        // Migração única: versões antigas agrupavam tabelas/listas/galerias pelo primeiro Status/Seleção sem o usuário pedir.
        if (!state.settings.autoGroupingCleaned) {
          const GROUPABLE_VIEWS = ['table', 'list', 'gallery', 'feed']
          for (const page of Object.values(state.pages)) {
            const schema = page.database
            if (!schema || page.locked) continue
            const auto = schema.properties.find(p => p.type === 'status' || p.type === 'select')?.id
            if (!auto || !schema.views.some(v => GROUPABLE_VIEWS.includes(v.type) && v.groupBy === auto && !v.subgroupBy)) continue
            actions.updatePage(page.id, { database: { ...schema, views: schema.views.map(v => GROUPABLE_VIEWS.includes(v.type) && v.groupBy === auto && !v.subgroupBy ? { ...v, groupBy: undefined, hiddenGroups: [] } : v) } }, false)
          }
          actions.updateSettings({ autoGroupingCleaned: true })
        }
        // One-time index migration of older notes; corrupt documents remain untouched.
        // Páginas sem documento recebem o índice vazio num único `set` (antes: um `set` por página,
        // O(n²) — dezenas de milhares de linhas de banco travavam a abertura do app).
        const withoutDoc: string[] = []
        for (const page of Object.values(state.pages).filter(p => !p.passwordLock && (!p.outboundPageIds || !p.syncedBlockIds || !p.bodyOutboundPageIds))) {
          try { const blocks = await api.loadDoc(page.id); if (!blocks) withoutDoc.push(page.id) }
          catch (error) { actions.reportSaveError(error) }
        }
        if (withoutDoc.length) {
          const pages = { ...state.pages }
          for (const id of withoutDoc) {
            const page = pages[id]
            if (page && (!page.outboundPageIds || !page.syncedBlockIds || !page.bodyOutboundPageIds)) pages[id] = { ...page, text: page.text ?? '', bodyText: page.bodyText ?? '', outboundPageIds: page.outboundPageIds ?? [], bodyOutboundPageIds: page.bodyOutboundPageIds ?? [], syncedBlockIds: page.syncedBlockIds ?? [] }
          }
          set({ pages })
        }
        // Earlier builds deleted inline database blocks without updating their child pages.
        // Only history-proven owned databases are recovered; ordinary sidebar children stay live.
        const owners = new Set(Object.values(state.pages).filter(page => page.database && !page.trashed && page.parentId).map(page => page.parentId!))
        for (const id of owners) if (isLive(id) && !state.pages[id]?.passwordLock && !checkedPageBlockHistory.has(id)) {
          try { await api.loadDoc(id) } catch (error) { actions.reportSaveError(error) }
        }
      } catch (error) {
        set({ ready: false, initError: errorMessage(error) }, false)
      }
    })()
    try { await initPromise } finally { initPromise = null }
  },

  flushMeta,
  async flushAll() { await Promise.all(Object.values(state.pages).filter(page => page.pendingTemplateBlocks).map(page => initializeTemplateDocument(page.id))); await flushAllDocs(); await flushMeta(); await productivity.flush(); set({ saveError: null }, false) },
  reportSaveError(error: unknown) { set({ saveError: errorMessage(error) }, false) },

  async exportConflict() {
    return api.exportFile(`${PRODUCT.name}-conflict.json`, JSON.stringify(state.conflictMeta ?? currentMeta(), null, 2))
  },
  async loadSavedMeta() {
    const remote = await api.loadMeta()
    if (!remote) return
    const validated = validateMeta(remote)
    // Preserve the local candidate for recovery before accepting the other window's edits.
    if (state.conflictMeta) {
      if (window.api) await api.saveMetaConflict?.(state.conflictMeta)
      else localStorage.setItem(COMPAT.record060 + Date.now(), JSON.stringify(state.conflictMeta))
    }
    persistedMeta = validated; savedRevision = revision; metaSeq = -1
    set({ ...validated, notifications: validated.notifications ?? {}, syncedBlocks: validated.syncedBlocks ?? {}, saveError: null, conflictMeta: null }, false)
  },

  setInboxOpen(open: boolean) { set({ inboxOpen: open }, false) },
  scheduleReminder(pageId: string, dueAt: number, title?: string, body = '', repeat: LocalNotification['repeat'] = 'none') {
    if (!isLive(pageId) || !Number.isFinite(dueAt)) throw new Error(message('Página ou data inválida.', 'Invalid page or date.'))
    const id = crypto.randomUUID()
    const item: LocalNotification = { id, pageId, dueAt, title: title ?? (state.pages[pageId].title || message('Lembrete', 'Reminder')), body, repeat, createdAt: Date.now(), firedAt: null, readAt: null }
    set({ notifications: { ...state.notifications, [id]: item } }); return id
  },
  updateNotification(id: string, patch: Partial<LocalNotification>) {
    const item = state.notifications[id]
    if (item) set({ notifications: { ...state.notifications, [id]: { ...item, ...patch, id } } })
  },
  removeNotification(id: string) {
    // Lembrete de data: vira marcador para a mesma ocorrência não ser recriada (ver reconcileDateReminders).
    const sourced = state.notifications[id]
    if (sourced?.source?.kind === 'date') { const now = Date.now(); set({ notifications: { ...state.notifications, [id]: { ...sourced, firedAt: sourced.firedAt ?? now, readAt: sourced.readAt ?? now, dismissedAt: now } } }); return }
    const notifications = { ...state.notifications }; delete notifications[id]; set({ notifications })
  },
  createSyncedBlock(sourcePageId: string, blocks: unknown[]) {
    const id = crypto.randomUUID()
    set({ syncedBlocks: { ...state.syncedBlocks, [id]: { id, sourcePageId, blocks: structuredClone(blocks), updatedAt: Date.now() } } }); return id
  },
  updateSyncedBlock(id: string, blocks: unknown[]) {
    const record = state.syncedBlocks[id]
    if (record && !state.pages[record.sourcePageId]?.locked) {
      const syncedBlocks = { ...state.syncedBlocks, [id]: { ...record, blocks: structuredClone(blocks), updatedAt: Date.now() } }
      const pages = { ...state.pages }
      for (const page of Object.values(pages)) if (page.syncedBlockIds?.includes(id)) {
        const outboundPageIds = [...new Set([...(page.bodyOutboundPageIds ?? []), ...page.syncedBlockIds.flatMap(key => documentLinks(syncedBlocks[key]?.blocks ?? []))])].sort()
        pages[page.id] = { ...page, text: [page.bodyText ?? page.text, ...page.syncedBlockIds.map(key => blocksToText(syncedBlocks[key]?.blocks ?? []))].filter(Boolean).join('\n'), outboundPageIds, updatedAt: Date.now() }
      }
      set({ syncedBlocks, pages })
    }
  },

  createPage(parentId: string | null, init: Partial<Page> = {}): string {
    if (parentId && (!isLive(parentId) || (state.pages[parentId].locked && !state.pages[parentId].database))) throw new Error(message('Esta página está bloqueada ou indisponível.', 'This page is locked or unavailable.'))
    assertNotPasswordLocked(parentId)
    const id = crypto.randomUUID()
    const now = Date.now()
    const page: Page = {
      title: '',
      icon: null,
      cover: null,
      coverPosition: 50,
      favorite: false,
      trashed: false,
      trashedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: state.settings.userName || message('Você', 'You'),
      updatedBy: state.settings.userName || message('Você', 'You'),
      order: nextOrder(parentId),
      fullWidth: false,
      smallText: false,
      font: 'default',
      locked: false,
      text: '',
      // Página nova não tem documento: já nasce indexada (evita a migração de índice na abertura).
      bodyText: '', outboundPageIds: [], bodyOutboundPageIds: [], syncedBlockIds: [],
      ...init,
      id,
      parentId,
    }
    const expanded = parentId ? { ...state.settings.expanded, [parentId]: true } : state.settings.expanded
    set({ pages: { ...state.pages, [id]: page }, settings: { ...state.settings, expanded } })
    productivity.created(id, namedForActivity(id))
    if (!init.database && !(parentId && state.pages[parentId]?.database)) trackStep('page')
    // Automação "linha criada": a profundidade da execução que criou a página vale para a nova (corta laços).
    if (parentId && state.pages[parentId]?.database?.automations?.some(automation => automation.enabled && automation.trigger.kind === 'rowCreated')) {
      const inherited = currentRun
      const run: AutomationRun = { remaining: inherited?.remaining ?? 64, seen: new Set(inherited?.seen), depth: inherited?.depth ?? 0 }
      queueMicrotask(() => actions.fireAutomations(id, { kind: 'rowCreated' }, run))
    }
    // Under an unlocked protected page: an inheriting lock adopts it when saved (main process);
    // otherwise ask once whether the new subpage should use the same password.
    const guard = parentId ? protectedAncestor(state.pages, parentId) : null
    if (guard?.passwordLock && !guard.passwordLock.inherit && lockPrompts.confirm(message('Proteger também esta subpágina com a senha da página?', 'Also protect this subpage with the page password?'))) void flushMeta().then(() => protectSubpage(guard.id, id)).catch(actions.reportSaveError)
    return id
  },

  /** `touch: false` evita atualizar `updatedAt` (ex.: favoritar). */
  updatePage(id: string, patch: Partial<Page>, touch = true) {
    const page = state.pages[id]
    if (!page) return
    const { id: _id, ...safePatch } = patch
    if (page.locked && patch.locked !== false) {
      const forbidden = ['title', 'icon', 'cover', 'coverPosition', 'fullWidth', 'smallText', 'font', 'props', 'types', 'typeProps']
      if (Object.keys(safePatch).some(key => forbidden.includes(key))) return
      if (safePatch.database && JSON.stringify({ ...safePatch.database, activeViewId: page.database?.activeViewId }) !== JSON.stringify(page.database)) return
    }
    set({ pages: { ...state.pages, [id]: { ...page, ...safePatch, ...(touch ? { updatedAt: Date.now(), updatedBy: state.settings.userName || message('Você', 'You') } : {}) } } })
    // Automação "tag/tipo adicionado".
    if (safePatch.types && page.parentId && state.pages[page.parentId]?.database?.automations?.some(automation => automation.enabled && automation.trigger.kind === 'typeAdded')) {
      const added = safePatch.types.filter(typeId => !(page.types ?? []).includes(typeId))
      if (added.length) {
        const inherited = currentRun
        const run: AutomationRun = { remaining: inherited?.remaining ?? 64, seen: new Set(inherited?.seen), depth: inherited?.depth ?? 0 }
        queueMicrotask(() => { for (const typeId of added) actions.fireAutomations(id, { kind: 'typeAdded', typeId }, run) })
      }
    }
    if (touch && ('title' in safePatch || 'icon' in safePatch || 'cover' in safePatch || 'props' in safePatch)) productivity.edited(id, namedForActivity(id))
  },

  /** Altera vários campos de várias páginas num único `set`, sem tocar em `updatedAt` (migração de propriedades). */
  patchPages(patches: Record<string, Partial<Page>>) {
    const pages = { ...state.pages }
    let changed = false
    for (const [id, patch] of Object.entries(patches)) {
      if (!pages[id] || !Object.keys(patch).length) continue
      const { id: _id, ...safe } = patch
      pages[id] = { ...pages[id], ...safe }; changed = true
    }
    if (changed) set({ pages })
  },

  /** Inserção em lote com um único `set` (importações grandes e o harness de desempenho em src/perf). */
  insertPages(pages: Page[]) {
    if (!pages.length) return
    const next = { ...state.pages }
    for (const page of pages) next[page.id] = page
    set({ pages: next })
  },

  toggleFavorite(id: string) {
    const page = state.pages[id]
    if (page) actions.updatePage(id, { favorite: !page.favorite }, false)
  },

  async reconcileOwnedPageBlocks(ownerId: string, before: unknown[], after: unknown[], at = Date.now()) {
    if (!state.pages[ownerId] || !isLive(ownerId)) return
    const changes = ownedPageBlockChanges(ownerId, before, after, state.pages, at)
    if (!Object.keys(changes).length) return
    const pages = { ...state.pages }
    for (const [id, patch] of Object.entries(changes)) pages[id] = { ...pages[id], ...patch }
    set({ pages })
    if (state.peekPageId && !isLive(state.peekPageId)) actions.closePeek()
    if (state.route.type === 'page' && !isLive(state.route.id)) actions.navigate({ type: 'home' })
    await flushMeta()
  },

  async recoverRemovedDatabaseBlocks(ownerId: string, current: unknown[]) {
    const candidates = new Set(Object.values(state.pages).filter(page => page.parentId === ownerId && page.database && !page.trashed && page.blockOwnerId !== null).map(page => page.id))
    const references = pageBlockReferences(current)
    for (const id of references.keys()) candidates.delete(id)
    if (!candidates.size) return
    const versions = await storageApi.listDocVersions(ownerId)
    const historical: unknown[] = []
    for (const version of versions) {
      if (version.reason === 'conflict') continue
      for (const [id, reference] of pageBlockReferences(version.blocks)) if (reference.owned && candidates.has(id)) {
        historical.push({ id: reference.blockId, type: 'page', props: { pageId: id, ownership: 'owned' } })
        candidates.delete(id)
      }
      if (!candidates.size) break
    }
    if (historical.length) await actions.reconcileOwnedPageBlocks(ownerId, historical, current)
  },

  async reparentOwnedPageBlocks(sourceId: string, targetId: string, blocks: unknown[]) {
    if (sourceId === targetId || !isLive(targetId) || state.pages[targetId]?.locked) throw new Error(message('Destino bloqueado ou indisponível.', 'Destination is locked or unavailable.'))
    const ids = [...pageBlockReferences(blocks)].filter(([id, ref]) => {
      const page = state.pages[id]
      return ref.owned && page?.parentId === sourceId && page.blockOwnerId !== null && isLive(id) && !(ref.ownership === 'auto' && !page.database && page.blockOwnerId !== sourceId)
    }).map(([id]) => id)
    if (ids.some(id => id === targetId || descendants(id).includes(targetId))) throw new Error(message('Não é possível mover uma página para dentro dela mesma.', 'A page cannot be moved into itself.'))
    for (const id of ids) { actions.movePage(id, targetId); actions.updatePage(id, { blockOwnerId: targetId }, false) }
    if (ids.length) await flushMeta()
    return ids
  },

  trashPage(id: string): void {
    const parent = state.pages[id]?.parentId
    if (parent && state.pages[parent]?.database) return trackUndo(message('Excluir linha', 'Delete row'), `trash:${id}`, [id], () => actions.trashPageNow(id))
    actions.trashPageNow(id)
  },

  trashPageNow(id: string) {
    actions.updatePage(id, { trashed: true, trashedAt: Date.now(), favorite: false, removedByBlock: undefined }, false)
    if (state.peekPageId && !isLive(state.peekPageId)) actions.closePeek()
    if (state.route.type === 'page' && !isLive(state.route.id)) actions.navigate({ type: 'home' })
  },

  restorePage(id: string) {
    const page = state.pages[id]
    if (!page) return
    const parentOk = page.parentId !== null && isLive(page.parentId)
    actions.updatePage(id, { trashed: false, trashedAt: null, parentId: parentOk ? page.parentId : null, removedByBlock: undefined, blockOwnerId: null }, false)
  },

  async deletePageForever(id: string) {
    const ids = [id, ...descendants(id)]
    await Promise.all(ids.map(flushDoc))
    const pages = { ...state.pages }
    for (const pid of ids) {
      delete pages[pid]
    }
    set({ pages, settings: { ...state.settings, recent: state.settings.recent.filter((r) => !ids.includes(r)) } })
    if (state.route.type === 'page' && ids.includes(state.route.id)) actions.navigate({ type: 'home' })
    await flushMeta()
    try { await Promise.all(ids.map(pid => api.deleteDoc(pid))) }
    catch (error) { actions.reportSaveError(error); throw error }
  },

  async duplicatePage(id: string, parentId?: string | null): Promise<string | null> {
    const src = state.pages[id]
    if (!src) return null
    assertNotPasswordLocked(parentId === undefined ? src.parentId : parentId)
    const sourceIds = [id, ...descendants(id).filter(isLive)]
    await Promise.all(sourceIds.map(flushDoc))
    const mapping = Object.fromEntries(sourceIds.map(pid => [pid, crypto.randomUUID()]))
    const documents: Record<string, unknown[]> = {}
    for (const pid of sourceIds) { documents[pid] = await api.loadDoc(pid) ?? []; Object.assign(mapping, collectBlockMapping(documents[pid])) }
    const copies: Record<string, Page> = {}
    // Save every document first: a failed read/write cannot leave an empty visible copy.
    for (const pid of sourceIds) {
      const original = state.pages[pid], copyId = mapping[pid]
      const copiedDoc = cloneDocument(documents[pid], mapping)
      await api.saveDoc(copyId, copiedDoc)
      copies[copyId] = { ...remapReferences(original, mapping), id: copyId,
        ...(pid === id ? { blockOwnerId: null, removedByBlock: undefined } : {}),
        parentId: pid === id ? (parentId === undefined ? src.parentId : parentId) : mapping[original.parentId!] ?? original.parentId,
        title: pid === id ? `${src.title || 'Sem título'} (1)` : original.title,
        favorite: false, trashed: false, trashedAt: null, createdAt: Date.now(), updatedAt: Date.now(),
        order: pid === id ? src.order + 0.5 : original.order,
        text: blocksToText(copiedDoc), outboundPageIds: documentLinks(copiedDoc) }
    }
    set({ pages: { ...state.pages, ...copies } })
    await flushMeta()
    return mapping[id]
  },

  async duplicateOwnedPageBlocks(ownerId: string, blocks: unknown[]): Promise<unknown[]> {
    const mapping: Record<string, string> = {}
    for (const [id, ref] of pageBlockReferences(blocks)) {
      const page = state.pages[id]
      if (!ref.owned || !page || page.parentId !== ownerId || page.blockOwnerId === null || !isLive(id) || (ref.ownership === 'auto' && !page.database && page.blockOwnerId !== ownerId)) continue
      const copy = await actions.duplicatePage(id, ownerId)
      if (copy) { mapping[id] = copy; actions.updatePage(copy, { blockOwnerId: ownerId }, false) }
    }
    return cloneDocument(blocks, mapping)
  },

  /** Move `id` para `parentId`, na posição `index` entre os irmãos (fim se omitido). */
  movePage(id: string, parentId: string | null, index?: number) {
    const page = state.pages[id]
    if (!page) return
    if (parentId && (!isLive(parentId) || (state.pages[parentId].locked && !state.pages[parentId].database))) return
    if (parentId === id || (parentId && descendants(id).includes(parentId))) return
    if (parentId && lockedAncestor(state.pages, parentId)) { actions.reportSaveError(new Error(passwordLockedMessage())); return }
    // Moving into a protected page: the page takes its protection (asked first).
    const target = parentId && page.parentId !== parentId && !page.passwordLock ? protectedAncestor(state.pages, parentId) : null
    let adopt = false
    if (target?.passwordLock) {
      if (target.passwordLock.inherit) { if (!lockPrompts.confirm(message('Esta página passará a ser protegida pela senha de “{title}”. Continuar?', 'This page will be protected by the password of “{title}”. Continue?').replace('{title}', target.title || message('página protegida', 'protected page')))) return }
      else adopt = lockPrompts.confirm(message('Proteger também esta subpágina com a senha da página?', 'Also protect this subpage with the page password?'))
    }
    const siblings = selectors.children(parentId).filter((p) => p.id !== id)
    const at = index === undefined ? siblings.length : Math.max(0, Math.min(index, siblings.length))
    siblings.splice(at, 0, page)
    const pages = { ...state.pages }
    // Saindo de um banco: o valor dos campos de tipo incorporados passa a valer também em `typeProps` (docs/USAGE.md).
    const leavingSchema = page.parentId && page.parentId !== parentId ? state.pages[page.parentId]?.database : undefined
    const mirrored = leavingSchema ? mirrorIncorporatedValues(state.settings.objectTypes ?? [], page, leavingSchema) : null
    siblings.forEach((p, i) => {
      // Só recria as páginas cuja ordem muda (50 mil irmãos: mover uma linha não regrava todas).
      if (p.id !== id && pages[p.id].order === i) return
      pages[p.id] = { ...pages[p.id], order: i, ...(p.id === id ? { parentId, blockOwnerId: null, ...(mirrored ? { typeProps: mirrored } : {}) } : {}) }
    })
    const expanded = parentId ? { ...state.settings.expanded, [parentId]: true } : state.settings.expanded
    set({ pages, settings: { ...state.settings, expanded } })
    if (adopt && target) void flushMeta().then(() => protectSubpage(target.id, id)).catch(actions.reportSaveError)
  },

  // ---------- Bancos de dados ----------

  /** Cria uma página-banco de dados com esquema padrão e uma visualização do tipo pedido. */
  createDatabase(parentId: string | null, viewType: ViewType = 'table', init: Partial<Page> = {}): string {
    const uid = () => crypto.randomUUID()
    // Padrão (como no Export Bundle): banco novo = Nome + Tags. Status só nasce junto do quadro e Data junto do
    // calendário/linha do tempo (a visualização escolhida precisa deles); nos demais tipos o usuário adiciona o que quiser.
    const properties: Property[] = [
      { id: uid(), name: message('Nome', 'Name'), type: 'title' },
      { id: uid(), name: 'Tags', type: 'multiSelect', options: [] },
    ]
    let groupBy: string | undefined, dateProp: string | undefined
    if (viewType === 'board') {
      const status: Property = { id: uid(), name: 'Status', type: 'status', options: [
        { id: uid(), name: message('Não iniciado', 'Not started'), color: 'gray', group: 'todo' },
        { id: uid(), name: message('Em andamento', 'In progress'), color: 'blue', group: 'progress' },
        { id: uid(), name: message('Concluído', 'Done'), color: 'green', group: 'complete' },
      ] }
      properties.splice(1, 0, status)
      groupBy = status.id
    }
    if (viewType === 'calendar' || viewType === 'timeline') {
      const date: Property = { id: uid(), name: message('Data', 'Date'), type: 'date' }
      properties.push(date)
      dateProp = date.id
    }
    const view = newView(viewType, { groupBy, dateProp })
    const database: DatabaseSchema = { properties, views: [view], activeViewId: view.id }
    const created = actions.createPage(parentId, { database, ...init })
    trackStep('database')
    return created
  },

  /** Altera o esquema de forma imutável: `fn` recebe o esquema atual e devolve o novo. */
  updateSchema(dbId: string, fn: (schema: DatabaseSchema) => DatabaseSchema) {
    // Esquema virtual de um tipo de objeto (coleção, opções criadas no editor): volta para o tipo.
    const typeId = typeIdFromSchemaId(dbId)
    if (typeId) {
      const before = state.settings.objectTypes ?? []
      const next = state.ready ? applySchemaFn(before, typeId, fn) : null
      if (!next) return
      // Campo que mudou de tipo: converte os valores das páginas (mesmas regras dos bancos).
      const { types, patches } = planTypeSchemaChange(before, next, state.pages)
      const apply = () => {
        for (const [pageId, typeProps] of Object.entries(patches)) if (!state.pages[pageId]?.locked) actions.updatePage(pageId, { typeProps }, false)
        actions.updateSettings({ objectTypes: types })
      }
      // Só visões mudaram (filtros, ordem, agrupamento da coleção): entra no desfazer dos tipos (⌘Z).
      const viewsOnly = types.length === before.length && types.every((type, i) => JSON.stringify(type.properties) === JSON.stringify(before[i].properties))
      if (viewsOnly && typeSchemaRecorder) typeSchemaRecorder(typeId, apply); else apply()
      return
    }
    const db = state.pages[dbId]
    if (!db?.database || db.locked) return
    const rootId = db.database.linkedSourceId ? resolveLinkedRoot(state.pages, dbId) : dbId
    const root = state.pages[rootId]
    if (rootId === dbId || !root?.database) {
      trackUndo(message('Alterar o banco', 'Change database'), `schema:${dbId}`, [dbId], () => actions.updatePage(dbId, { database: fn(db.database!) }))
      return
    }
    // Visualização vinculada: as propriedades (e modelos) são da fonte e compartilhadas por todas as
    // visões dela; o resto (visualizações, filtros, layout) é desta visão. docs/USAGE.md
    const merged = selectors.database(dbId)!
    const next = fn(merged)
    const shared = JSON.stringify([next.properties, next.templates, next.defaultTemplateId]) !== JSON.stringify([merged.properties, merged.templates, merged.defaultTemplateId])
    const own = { ...next, properties: db.database.properties, templates: db.database.templates, defaultTemplateId: db.database.defaultTemplateId }
    if (!shared) {
      trackUndo(message('Alterar o banco', 'Change database'), `schema:${dbId}`, [dbId], () => actions.updatePage(dbId, { database: own }))
      return
    }
    if (root.locked) return
    // A mesma transformação vale para a fonte e para as outras visões dela (limpa filtros e agrupamentos
    // de uma propriedade excluída em todas), num único passo de ⌘Z.
    const siblings = Object.values(state.pages).filter((page) => page.id !== dbId && page.id !== rootId && page.database?.linkedSourceId && !page.locked && resolveLinkedRoot(state.pages, page.id) === rootId).map((page) => page.id)
    trackUndo(message('Alterar o banco', 'Change database'), `schema:${rootId}:${dbId}`, [rootId, dbId, ...siblings], () => {
      const sourceNext = fn(root.database!)
      actions.updatePage(rootId, { database: sourceNext })
      actions.updatePage(dbId, { database: own })
      for (const id of siblings) {
        const sibling = state.pages[id].database!
        const viewsNext = fn({ ...sibling, properties: root.database!.properties, templates: root.database!.templates })
        actions.updatePage(id, { database: { ...sibling, views: viewsNext.views, activeViewId: viewsNext.activeViewId } }, false)
      }
    })
    linkedSchemaListeners.forEach((listener) => listener({ dbId, sourceId: rootId }))
  },

  /** Avisa quando uma visão vinculada altera as propriedades da fonte (aviso da primeira vez). */
  onLinkedSchemaEdit(listener: (event: { dbId: string; sourceId: string }) => void): () => void {
    linkedSchemaListeners.add(listener)
    return () => { linkedSchemaListeners.delete(listener) }
  },

  /** Visualização vinculada: troca a fonte (recomeça com uma tabela limpa). ⌘Z devolve a fonte e as visões anteriores. */
  relinkDatabase(dbId: string, sourceId: string): boolean {
    const db = state.pages[dbId], source = state.pages[sourceId]
    if (!db?.database?.linkedSourceId || db.locked || !source?.database || source.database.linkedSourceId || !isLive(sourceId) || resolveLinkedRoot(state.pages, sourceId) === dbId) return false
    if (db.database.linkedSourceId === sourceId) return true
    trackUndo(message('Trocar fonte', 'Change source'), `relink:${dbId}:${Date.now()}`, [dbId], () => actions.updatePage(dbId, { database: relinkedSchema(db.database!, sourceId, message('Tabela', 'Table')) }))
    return true
  },

  /** "Visualizações em <fonte>": mostra aqui uma visão da fonte (copia a configuração; não duplica). */
  adoptSourceView(dbId: string, sourceViewId: string): string | null {
    const db = state.pages[dbId]
    const sourceId = db?.database?.linkedSourceId ? resolveLinkedRoot(state.pages, dbId) : undefined
    const sourceView = sourceId ? state.pages[sourceId]?.database?.views.find((view) => view.id === sourceViewId) : undefined
    if (!db?.database || db.locked || !sourceView) return null
    const result = adoptSourceView(db.database, sourceView)
    if (!result.added) { actions.activateView(dbId, result.viewId); return result.viewId }
    trackUndo(message('Adicionar visualização', 'Add view'), `adopt:${dbId}:${result.viewId}`, [dbId], () => actions.updatePage(dbId, { database: result.schema }))
    return result.viewId
  },

  /**
   * Desvincula: a visualização vinculada vira um banco independente com uma cópia das propriedades e das
   * linhas da fonte (a fonte não muda). As visões desta visualização são mantidas. ⌘Z volta a vincular
   * e manda a cópia para a lixeira.
   */
  async convertLinkedToIndependent(dbId: string): Promise<boolean> {
    const db = state.pages[dbId]
    if (!db?.database?.linkedSourceId || db.locked) return false
    const sourceId = resolveLinkedRoot(state.pages, dbId)
    if (!state.pages[sourceId]?.database || !isLive(sourceId)) return false
    const copyId = await actions.duplicatePage(sourceId, db.parentId)
    const copy = copyId ? state.pages[copyId] : undefined
    if (!copyId || !copy?.database) return false
    const rowIds = Object.values(state.pages).filter((page) => page.parentId === copyId).map((page) => page.id)
    const own = state.pages[dbId].database!
    actions.transact(message('Converter em banco independente', 'Convert to independent database'), [dbId], () => {
      actions.updatePage(dbId, { database: { ...copy.database!, views: own.views, activeViewId: own.activeViewId, linkedSourceId: undefined, sourceDatabaseIds: undefined } })
      actions.reparentPages(rowIds, dbId)
      actions.trashPageNow(copyId)
    }, { created: () => [copyId, ...rowIds] })
    await flushMeta()
    return true
  },

  /** Agrupa numa única transação de desfazer uma operação que altera o esquema e os valores das linhas. */
  trackDbUndo<T>(label: string, dbId: string, fn: () => T): T {
    // Visão vinculada: as linhas são da fonte (e a fonte guarda as propriedades).
    const rootId = state.pages[dbId]?.database?.linkedSourceId ? resolveLinkedRoot(state.pages, dbId) : dbId
    const siblings = rootId === dbId ? [] : Object.values(state.pages).filter((p) => p.database?.linkedSourceId && resolveLinkedRoot(state.pages, p.id) === rootId).map((p) => p.id)
    const ids = [...new Set([dbId, rootId, ...siblings, ...Object.values(state.pages).filter((p) => p.parentId === rootId).map((p) => p.id)])]
    return trackUndo(label, `ops:${dbId}:${label}`, ids, fn)
  },

  /** Agrupa num único passo de desfazer a edição de várias linhas (colar em intervalo, limpar). Cada chamada é um passo próprio. */
  trackRowsUndo<T>(label: string, rowIds: string[], fn: () => T): T {
    return trackUndo(label, `rows:${Date.now()}:${Math.random()}`, rowIds, fn)
  },

  /** ⌘Z de banco de dados: devolve true se desfez algo. */
  undoDatabase(): boolean {
    const entry = dbUndoStack.popUndo()
    if (!entry) return false
    applySnap(entry.before)
    entry.onUndo?.()
    return true
  },

  redoDatabase(): boolean {
    const entry = dbUndoStack.popRedo()
    if (!entry) return false
    applySnap(entry.after)
    entry.onRedo?.()
    return true
  },

  /** O próximo ⌘Z é uma transação estrutural (conversão de páginas/bancos)? Usado pelo ⌘Z global fora de bancos. */
  nextUndoIsStructural(): boolean { return !!dbUndoStack.peekUndo()?.structural },
  nextRedoIsStructural(): boolean { return !!dbUndoStack.peekRedo()?.structural },
  /** Instante do próximo passo estrutural a desfazer/refazer (o ⌘Z dos tipos compara com o seu). */
  nextStructuralAt(redo = false): number | null { const entry = redo ? dbUndoStack.peekRedo() : dbUndoStack.peekUndo(); return entry?.structural ? entry.at ?? null : null },

  /**
   * Transação estrutural com ⌘Z: `fn` altera páginas existentes (`ids`) e pode criar outras (`hooks.created`);
   * restaura `parentId`, `order`, `props`, `typeProps`, `database`… e move para a lixeira o que foi criado.
   * `hooks.undo/redo` cobrem o que está fora das páginas (ex.: o bloco do banco no corpo).
   */
  transact<T>(label: string, ids: string[], fn: () => T, hooks: { created?: () => string[]; undo?: () => void; redo?: () => void } = {}): T {
    if (dbUndoBusy || !state.ready) return fn()
    const before = snapStruct(ids)
    dbUndoBusy = true
    let result: T
    try { result = fn() } finally { dbUndoBusy = false }
    const created = hooks.created?.() ?? []
    const after = snapStruct([...ids, ...created])
    for (const id of created) before[id] = null
    dbUndoStack.push({ label, key: `structure:${Date.now()}:${Math.random()}`, at: Date.now(), before, after, structural: true, onUndo: hooks.undo, onRedo: hooks.redo })
    return result
  },

  /**
   * Muda o pai de várias páginas de uma vez (um único `set`), preservando a ordem recebida a partir de `index`
   * (fim por padrão). `patches` aplica campos extras por página (props, typeProps…) sem alterar `updatedAt`.
   * Devolve os ids movidos. Não pergunta nada: recusa destinos dentro de páginas protegidas.
   */
  reparentPages(ids: string[], parentId: string | null, patches: Record<string, Partial<Page>> = {}, index?: number): string[] {
    const parent = parentId ? state.pages[parentId] : null
    if (parentId && (!parent || !isLive(parentId) || (parent.locked && !parent.database))) return []
    if (parentId && lockedAncestor(state.pages, parentId)) { actions.reportSaveError(new Error(passwordLockedMessage())); return [] }
    const guard = parentId ? protectedAncestor(state.pages, parentId) : null
    const moving = [...new Set(ids)].filter((id) => {
      const page = state.pages[id]
      if (!page || id === parentId || (parentId && descendants(id).includes(parentId))) return false
      return !guard || protectedAncestor(state.pages, id)?.id === guard.id
    })
    if (!moving.length) return []
    const siblings = selectors.children(parentId).filter((p) => !moving.includes(p.id))
    const at = index === undefined ? siblings.length : Math.max(0, Math.min(index, siblings.length))
    siblings.splice(at, 0, ...moving.map((id) => state.pages[id]))
    const pages = { ...state.pages }
    const types = state.settings.objectTypes ?? []
    siblings.forEach((p, i) => {
      const move = moving.includes(p.id)
      if (!move && pages[p.id].order === i) return
      // Saindo de um banco: espelha os campos de tipo incorporados em `typeProps` (a menos que o chamador já defina `typeProps`).
      const leaving = move && p.parentId && p.parentId !== parentId && !patches[p.id]?.typeProps ? state.pages[p.parentId]?.database : undefined
      const mirrored = leaving ? mirrorIncorporatedValues(types, { ...p, props: patches[p.id]?.props ?? p.props }, leaving) : null
      pages[p.id] = { ...pages[p.id], order: i, ...(move ? { ...(mirrored ? { typeProps: mirrored } : {}), ...patches[p.id], parentId, blockOwnerId: null } : {}) }
    })
    const expanded = parentId ? { ...state.settings.expanded, [parentId]: true } : state.settings.expanded
    set({ pages, settings: { ...state.settings, expanded } })
    return moving
  },

  /** Adiciona uma visualização (groupBy padrão só no quadro; dateProp padrão) e a torna ativa. */
  /**
   * Converte a visualização para outro tipo no lugar (mesmo id, filtros, ordenação, ocultas…), com
   * ⌘Z. Calendário/linha do tempo sem Data ganham a propriedade, como em `addView` (não em vinculados).
   */
  changeViewType(dbId: string, viewId: string, type: ViewType): boolean {
    const page = state.pages[dbId], schema = page?.database ? selectors.database(dbId) : undefined
    const view = schema?.views.find((v) => v.id === viewId)
    if (!schema || !view || page.locked || view.type === type) return false
    // Visão vinculada: a propriedade Data que falta vai para a fonte, se a fonte puder ser editada.
    const sourceLocked = !!schema.linkedSourceId && !!state.pages[resolveLinkedRoot(state.pages, dbId)]?.locked
    return actions.trackDbUndo(message('Trocar tipo da visualização', 'Change view type'), dbId, () => {
      const needsDate = (type === 'calendar' || type === 'timeline') && !sourceLocked && !schema.properties.some((p) => p.type === 'date')
      const extra: Property[] = needsDate ? [{ id: crypto.randomUUID(), name: message('Data', 'Date'), type: 'date' }] : []
      const patch = viewTypePatch({ ...schema, properties: [...schema.properties, ...extra] }, view, type)
      actions.updateSchema(dbId, (s) => ({ ...s, properties: [...s.properties, ...extra], views: s.views.map((v) => v.id === viewId ? { ...v, ...patch } : v) }))
      return true
    })
  },

  addView(dbId: string, type: ViewType): string | null {
    const schema = state.pages[dbId]?.database ? selectors.database(dbId) : undefined
    if (!schema) return null
    const sourceLocked = !!schema.linkedSourceId && !!state.pages[resolveLinkedRoot(state.pages, dbId)]?.locked
    // Como no Export Bundle, só o quadro nasce agrupado; tabela, lista etc. começam sem agrupamento.
    // Quadro sem Status/Seleção e calendário/linha do tempo sem Data ganham a propriedade que a visualização exige.
    const uid = () => crypto.randomUUID()
    const extra: Property[] = []
    let groupBy = type === 'board' ? schema.properties.find((p) => p.type === 'status' || p.type === 'select')?.id : undefined
    let dateProp = schema.properties.find((p) => p.type === 'date')?.id
    if (type === 'board' && !groupBy && !sourceLocked) {
      const status: Property = { id: uid(), name: 'Status', type: 'status', options: [
        { id: uid(), name: message('Não iniciado', 'Not started'), color: 'gray', group: 'todo' },
        { id: uid(), name: message('Em andamento', 'In progress'), color: 'blue', group: 'progress' },
        { id: uid(), name: message('Concluído', 'Done'), color: 'green', group: 'complete' },
      ] }
      extra.push(status); groupBy = status.id
    }
    if ((type === 'calendar' || type === 'timeline') && !dateProp && !sourceLocked) {
      const date: Property = { id: uid(), name: message('Data', 'Date'), type: 'date' }
      extra.push(date); dateProp = date.id
    }
    const hidden = defaultCardHidden(type, [...schema.properties, ...extra], [type === 'board' ? groupBy : undefined, type === 'calendar' ? dateProp : undefined])
    const view = newView(type, { groupBy, dateProp, hidden })
    actions.updateSchema(dbId, (s) => ({ ...s, properties: [...s.properties, ...extra.filter((e) => !s.properties.some((p) => p.id === e.id))], views: [...s.views, view], activeViewId: view.id }))
    return view.id
  },

  updateView(dbId: string, viewId: string, patch: Partial<View>) {
    actions.updateSchema(dbId, (s) => ({ ...s, views: s.views.map((v) => (v.id === viewId ? { ...v, ...patch } : v)) }))
  },

  activateView(dbId: string, viewId: string) {
    const db = state.pages[dbId]
    if (db?.database?.views.some(view => view.id === viewId)) {
      actions.updatePage(dbId, { database: { ...db.database, activeViewId: viewId } }, false)
    }
  },

  /** Cria uma linha (página filha do banco). Não navega. */
  createRow(dbId: string, props: Record<string, PropValue> = {}, init: Partial<Page> = {}, templateId?: string, templateAnswers?: Record<string, string>): string {
    if (typeIdFromSchemaId(dbId) && virtualRowFactory) return virtualRowFactory(dbId, props, init)
    const schema = state.pages[dbId]?.database
    if (!schema) throw new Error(message('Banco de dados indisponível.', 'Database unavailable.'))
    if (schema.linkedSourceId) return actions.createRow(schema.linkedSourceId, props, init, templateId, templateAnswers)
    const defaults = templateDefaults(schema, templateId)
    const template = schema.templates?.find(template => template.id === (templateId ?? schema.defaultTemplateId))
    const sequence = Math.max(schema.nextSequence ?? 1, nextSequence(selectors.rows(dbId)))
    // Variáveis {{…}} do modelo (título, valores de texto e corpo) expandidas na criação; o modelo guardado fica cru.
    const expanded = template ? expandRowTemplate({ title: defaults.title, bodyBlocks: template.bodyBlocks }, { ...defaults.props, ...props, ...init.props }, { schema, pages: state.pages, locale: state.settings.locale ?? 'pt-BR', userName: state.settings.userName, answers: templateAnswers }) : null
    if (expanded?.unknown.length) showToast({ message: translate(state.settings.locale ?? 'pt-BR', 'Variável desconhecida mantida como texto: {names}', 'Unknown variable kept as text: {names}', { names: expanded.unknown.slice(0, 3).join(' ') }), duration: 7000 })
    const id = actions.createPage(dbId, { ...defaults, ...(expanded ? { title: expanded.title } : {}), ...init, props: { ...(expanded ? expanded.props : { ...defaults.props, ...props, ...init.props }) }, sequence,
      ...(expanded?.blocks?.length ? { pendingTemplateBlocks: cloneDocument(expanded.blocks, {}) } : {}) })
    if (expanded?.cursor) setPendingCursor(id, expanded.cursor)
    const db = state.pages[dbId]
    set({ pages: { ...state.pages, [dbId]: { ...db, database: { ...db.database!, nextSequence: sequence + 1 } } } })
    if (state.pages[id].pendingTemplateBlocks) void initializeTemplateDocument(id).catch(actions.reportSaveError)
    if (!dbUndoBusy) dbUndoStack.push({ label: message('Nova linha', 'New row'), key: `new:${id}`, at: Date.now(), before: { [id]: null }, after: snapPages([id]) })
    if (!init.types) newRowHook?.(dbId, id)
    return id
  },

  /** Define o valor de uma propriedade numa linha. Para o título use `updatePage(id, { title })`. */
  setProp(rowId: string, propId: string, value: PropValue, run: AutomationRun = newRun()): void {
    if (arguments.length < 4 && !dbUndoBusy && state.pages[rowId]?.parentId) {
      const related = [...(Array.isArray(value) ? value : []), ...(Array.isArray(state.pages[rowId].props?.[propId]) ? state.pages[rowId].props![propId] as unknown[] : [])].filter((v): v is string => typeof v === 'string' && !!state.pages[v])
      return trackUndo(message('Editar célula', 'Edit cell'), `prop:${rowId}:${propId}`, [rowId, ...related], () => actions.setProp(rowId, propId, value, newRun()))
    }
    const row = state.pages[rowId]
    // Campo de tipo de objeto (src/objecttypes): grava em `typeProps`, separado das propriedades do banco.
    if (row?.types?.length && !(row.parentId && state.pages[row.parentId]?.database?.properties.some(p => p.id === propId)) && typeFieldOwner(state.settings.objectTypes, row, propId)) {
      if (row.locked || JSON.stringify(row.typeProps?.[propId] ?? null) === JSON.stringify(value)) return
      actions.updatePage(rowId, { typeProps: { ...row.typeProps, [propId]: value } })
      return
    }
    if (!row || row.locked || JSON.stringify(row.props?.[propId]) === JSON.stringify(value)) return
    const schema = row.parentId ? state.pages[row.parentId]?.database : undefined
    const mirror = Array.isArray(value) && value.every(v => typeof v === 'string') ? planRelationMirror(state.pages, rowId, propId, value as string[]) : []
    if (mirror.some(patch => state.pages[patch.rowId]?.locked)) throw new Error(message('Uma página relacionada está bloqueada. Desbloqueie-a antes de alterar esta relação.', 'A related page is locked. Unlock it before changing this relation.'))
    actions.updatePage(rowId, { props: { ...row.props, [propId]: value } })
    if (completesTask(schema, propId, row.props?.[propId], value)) productivity.taskCompleted(rowId, namedForActivity(rowId))
    if (schema) for (const plan of recurringCompletions(schema, state.pages[rowId], propId, row.props?.[propId], value)) void actions.completeRecurring(rowId, plan).catch(actions.reportSaveError)
    for (const patch of mirror) actions.updatePage(patch.rowId, { props: { ...state.pages[patch.rowId].props, [patch.propertyId]: patch.value } })
    if (schema && run.remaining > 0) {
      if (completesTask(schema, propId, row.props?.[propId], value)) actions.fireAutomations(rowId, { kind: 'taskCompleted' }, run)
      actions.fireAutomations(rowId, { kind: 'propertyChange', propertyId: propId }, run)
    }
  },

  /** Tarefa recorrente concluída: move a data para a próxima ocorrência ou cria a próxima como nova linha. */
  async completeRecurring(rowId: string, plan: CompletionPlan) {
    const row = state.pages[rowId]
    if (!row) return
    const { dateProperty, doneProperty } = plan
    if (plan.mode === 'advance' || !plan.nextDate) {
      // Avançar: a mesma linha volta a "a fazer" com a nova data (série terminada: fica concluída).
      const props = { ...row.props, [dateProperty.id]: plan.nextDate ?? plan.currentDate, ...(plan.nextDate ? { [doneProperty.id]: plan.resetValue } : {}) }
      actions.updatePage(rowId, { props })
      return
    }
    actions.updatePage(rowId, { props: { ...row.props, [dateProperty.id]: plan.currentDate } })
    const copyId = await actions.duplicatePage(rowId)
    if (!copyId || !state.pages[copyId]) return
    const copy = state.pages[copyId]
    actions.updatePage(copyId, { title: row.title, order: row.order + 0.5, props: { ...copy.props, [dateProperty.id]: plan.nextDate, [doneProperty.id]: plan.resetValue } })
  },

  async runDatabaseActions(rowId: string, tasks: ButtonAction[], run: AutomationRun = newRun()) {
    const row = state.pages[rowId], schema = row?.parentId ? state.pages[row.parentId]?.database : undefined
    if (!row || row.locked || !schema) return
    for (const task of validActions(schema, tasks).slice(0, 64)) {
      if (run.remaining-- <= 0) break
      if (task.kind === 'setProperty') actions.setProp(rowId, task.propertyId, task.value, run)
      if (task.kind === 'setTitle') actions.updatePage(rowId, { title: task.value })
      if (task.kind === 'createRow') actions.createRow(row.parentId!, {}, {}, task.templateId)
      if (task.kind === 'duplicateRow') await actions.duplicatePage(rowId)
      if (task.kind === 'archiveRow') actions.trashPage(rowId)
    }
  },

  // ---------- Automações (A4) ----------

  /** Dispara as regras ligadas deste banco que respondem ao evento; condições e laços são verificados aqui. */
  fireAutomations(rowId: string, event: TriggerEvent, run: AutomationRun = newRun()) {
    const row = state.pages[rowId], dbId = row?.parentId, schema = dbId ? state.pages[dbId]?.database : undefined
    if (!row || !dbId || !schema?.automations?.length || row.trashed) return
    for (const automation of automationsFor(schema, event)) {
      const key = rowId + ':' + automation.id
      if (run.seen.has(key) || !conditionsPass(automation.conditions, row).pass) continue
      if (run.depth >= MAX_AUTOMATION_DEPTH || run.remaining <= 0) {
        actions.logAutomation(dbId, { automationId: automation.id, name: automation.name, rowId, rowTitle: row.title, status: 'skipped', detail: message('Interrompida: limite de encadeamento de automações (proteção contra laços).', 'Stopped: automation chaining limit reached (loop protection).') })
        continue
      }
      run.seen.add(key)
      void actions.runAutomation(dbId, automation.id, rowId, run).catch(actions.reportSaveError)
    }
  },

  /** Registro das últimas 50 execuções de automações do banco. */
  logAutomation(dbId: string, entry: Omit<AutomationRunLog, 'at'> & { at?: number }) {
    const page = state.pages[dbId]
    if (!page?.database) return
    set({ pages: { ...state.pages, [dbId]: { ...page, database: { ...page.database, automationLog: appendLog(page.database.automationLog, { at: Date.now(), ...entry }) } } } })
  },

  /** Executa as ações de uma regra numa linha (as escritas passam pelas mesmas guardas de qualquer edição: linha/página bloqueada, protegida ou na lixeira não é alterada). */
  async runAutomation(dbId: string, automationId: string, rowId: string, run: AutomationRun = newRun(), options: { actions?: AutomationAction[]; log?: boolean } = {}) {
    const automation = state.pages[dbId]?.database?.automations?.find(candidate => candidate.id === automationId)
    if (!automation || !state.pages[rowId]) return
    const steps: string[] = []
    const previous = currentRun
    currentRun = run; run.depth++
    let status: 'done' | 'error' = 'done', detail = ''
    try {
      for (const action of (options.actions ?? automation.actions).slice(0, 32)) {
        if (run.remaining-- <= 0) { detail = message('Limite de ações por execução atingido.', 'Per-run action limit reached.'); break }
        const row = state.pages[rowId]
        if (!row || row.locked || row.trashed) { detail = message('A linha ficou bloqueada ou indisponível; o restante foi ignorado.', 'The row became locked or unavailable; the rest was skipped.'); break }
        const schema = row.parentId ? state.pages[row.parentId]?.database : undefined
        if (!schema) break
        const text = describeAction(schema, action, row, automationContext())
        const stop = await runAutomationAction(rowId, action, run)
        steps.push(text)
        if (stop) break
      }
    } catch (error) { status = 'error'; detail = error instanceof Error ? error.message : String(error) }
    finally { run.depth--; currentRun = previous }
    if (options.log !== false) actions.logAutomation(dbId, { automationId, name: automation.name, rowId, rowTitle: state.pages[rowId]?.title ?? '', status, detail: [steps.join(' · '), detail].filter(Boolean).join(' — ') })
  },

  async tickScheduledTasks(now = Date.now()) {
    if (!state.ready || schedulerRunning) return
    schedulerRunning = true
    try {
      if (!window.api) {
        const result = collectDueReminders(state.notifications, state.pages, now, () => crypto.randomUUID())
        if (result.due.length) set({ notifications: result.notifications })
        // No Electron o processo principal agenda os lembretes de datas (também sem janela aberta).
        const dated = reconcileDateReminders(state.notifications, state.pages, now, { locale: state.settings.locale })
        if (dated.changed) set({ notifications: dated.notifications })
      }
      for (const page of Object.values(state.pages).filter(p => p.database && isLive(p.id))) {
        const schema = page.database!
        for (const template of schema.templates ?? []) if (template.repeat && template.repeat !== 'none' && template.nextRunAt && template.nextRunAt <= now) {
          actions.createRow(page.id, {}, {}, template.id)
          const current = state.pages[page.id]
          set({ pages: { ...state.pages, [page.id]: { ...current, database: { ...current.database!, templates: current.database!.templates!.map(t => t.id === template.id ? { ...t, nextRunAt: advanceSchedule(template.nextRunAt!, template.repeat!, now) } : t) } } } })
        }
        for (const automation of dueAutomations(schema, now)) {
          if (automation.trigger.kind !== 'scheduled') continue
          const trigger = automation.trigger
          const current = state.pages[page.id]
          set({ pages: { ...state.pages, [page.id]: { ...current, database: { ...current.database!, automations: current.database!.automations!.map(a => a.id === automation.id ? { ...a, trigger: { ...trigger, nextRunAt: advanceSchedule(trigger.nextRunAt, trigger.every, now) } } : a) } } } })
          for (const task of automation.actions) if (task.kind === 'createRow') actions.createRow(page.id, {}, {}, task.templateId)
          const rest = automation.actions.filter(a => a.kind !== 'createRow')
          let applied = 0
          if (rest.length) for (const row of selectors.rows(page.id)) {
            if (!conditionsPass(automation.conditions, row).pass) continue
            await actions.runAutomation(page.id, automation.id, row.id, newRun(), { actions: rest, log: false })
            applied++
          }
          actions.logAutomation(page.id, { automationId: automation.id, name: automation.name, rowId: '', rowTitle: '', status: 'done', detail: message('Execução agendada: {n} linha(s) atendida(s).', 'Scheduled run: {n} row(s) matched.').replace('{n}', String(applied)) })
        }
        // "Data chegou": dispara uma vez por linha e data; a primeira avaliação só marca o passado (sem rodar nada).
        for (const automation of (schema.automations ?? []).filter(a => a.enabled && a.trigger.kind === 'dateArrived')) {
          const arrivals = dateArrivals(state.pages[page.id].database!, selectors.rows(page.id), automation, localDayOf(now))
          if (!arrivals) continue
          if (arrivals.seeded || JSON.stringify(arrivals.fired) !== JSON.stringify(automation.fired ?? {})) {
            const current = state.pages[page.id]
            set({ pages: { ...state.pages, [page.id]: { ...current, database: { ...current.database!, automations: current.database!.automations!.map(a => a.id === automation.id ? { ...a, fired: arrivals.fired } : a) } } } })
          }
          if (arrivals.seeded) actions.logAutomation(page.id, { automationId: automation.id, name: automation.name, rowId: '', rowTitle: '', status: 'skipped', detail: message('Primeira verificação: {n} linha(s) com data já passada foram ignoradas.', 'First check: {n} row(s) with an already-passed date were ignored.').replace('{n}', String(Object.keys(arrivals.fired).length)) })
          for (const rowId of arrivals.fire) {
            const row = state.pages[rowId]
            if (!row || !conditionsPass(automation.conditions, row).pass) continue
            const run = newRun()
            run.seen.add(rowId + ':' + automation.id)
            await actions.runAutomation(page.id, automation.id, rowId, run)
          }
        }
      }
    } finally { schedulerRunning = false }
  },

  toggleExpanded(id: string, value?: boolean) {
    const expanded = { ...state.settings.expanded, [id]: value ?? !state.settings.expanded[id] }
    set({ settings: { ...state.settings, expanded } })
  },

  updateSettings(patch: Partial<Settings>) {
    set({ settings: { ...state.settings, ...patch } })
  },

  navigate(route: Route) {
    route = validRoute(route)
    if (sameRoute(route, state.route)) { set({ searchOpen: false, peekPageId: null }, false); return }
    const history = [...state.history.slice(0, state.historyIndex + 1), route].slice(-100)
    const settings = settingsForRoute(route)
    set({ route, history, historyIndex: history.length - 1, settings, searchOpen: false, peekPageId: null })
  },

  openInNewTab(route: Route) {
    route = validRoute(route)
    if (state.settings.activeTabId) tabHistory.set(state.settings.activeTabId, { history: state.history, historyIndex: state.historyIndex })
    const id = crypto.randomUUID()
    const settings = { ...state.settings, openTabs: [...(state.settings.openTabs ?? []), { id, route }], activeTabId: id }
    if (route.type === 'page') settings.recent = [route.id, ...settings.recent.filter(r => r !== route.id)].slice(0, 50)
    set({ route, settings, history: [route], historyIndex: 0, searchOpen: false, peekPageId: null })
  },

  activateTab(id: string) {
    const tab = state.settings.openTabs?.find(t => t.id === id)
    if (!tab || id === state.settings.activeTabId) return
    if (state.settings.activeTabId) tabHistory.set(state.settings.activeTabId, { history: state.history, historyIndex: state.historyIndex })
    const route = validRoute(tab.route)
    const stored = tabHistory.get(id)
    const history = stored?.history.map(validRoute) ?? [route]
    const historyIndex = stored?.historyIndex ?? 0
    set({ route, history, historyIndex, settings: { ...state.settings, activeTabId: id }, searchOpen: false, peekPageId: null })
  },

  closeTab(id: string) {
    const tabs = state.settings.openTabs ?? []
    const index = tabs.findIndex(t => t.id === id)
    if (index < 0) return
    closedTabs.push(structuredClone(tabs[index]))
    if (closedTabs.length > 30) closedTabs.shift()
    const remaining = tabs.filter(t => t.id !== id)
    tabHistory.delete(id)
    if (!remaining.length) remaining.push({ id: crypto.randomUUID(), route: { type: 'home' } })
    if (id !== state.settings.activeTabId) { actions.updateSettings({ openTabs: remaining }); return }
    const active = remaining[Math.min(index, remaining.length - 1)]
    const route = validRoute(active.route)
    const stored = tabHistory.get(active.id)
    set({ settings: { ...state.settings, openTabs: remaining, activeTabId: active.id }, route,
      history: stored?.history.map(validRoute) ?? [route], historyIndex: stored?.historyIndex ?? 0 })
  },

  canReopenTab() { return closedTabs.length > 0 },

  reopenTab() {
    const tab = closedTabs.pop()
    if (!tab) return
    actions.openInNewTab(validRoute(tab.route))
    const id = state.settings.activeTabId!
    const restored = (state.settings.openTabs ?? []).map(item => item.id === id ? { ...item, pinned: tab.pinned, group: tab.group } : item)
    actions.updateSettings({ openTabs: [...restored.filter(item => item.pinned), ...restored.filter(item => !item.pinned)] })
  },

  pinTab(id: string) {
    const tabs = (state.settings.openTabs ?? []).map(tab => tab.id === id ? { ...tab, pinned: !tab.pinned, group: undefined } : tab)
    actions.updateSettings({ openTabs: [...tabs.filter(tab => tab.pinned), ...tabs.filter(tab => !tab.pinned)] })
  },

  groupTab(id: string, group?: { id: string; name: string }) {
    const tabs = (state.settings.openTabs ?? []).map(tab => tab.id === id ? { ...tab, group, pinned: false } : tab)
    const target = tabs.find(tab => tab.id === id)
    if (target && group) {
      const others = tabs.filter(tab => tab.id !== id)
      const last = others.findLastIndex(tab => tab.group?.id === group.id)
      if (last >= 0) others.splice(last + 1, 0, target)
      else others.push(target)
      actions.updateSettings({ openTabs: others })
    } else actions.updateSettings({ openTabs: tabs })
  },

  closeTabs(id: string, scope: 'other' | 'left' | 'right') {
    const tabs = state.settings.openTabs ?? []
    const index = tabs.findIndex(tab => tab.id === id)
    if (index < 0) return
    const targets = tabs.filter((tab, i) => !tab.pinned && (scope === 'other' ? tab.id !== id : scope === 'left' ? i < index : i > index))
    actions.activateTab(id)
    for (const tab of targets) actions.closeTab(tab.id)
  },

  openPage(id: string, options: { blockId?: string; viewId?: string; commentId?: string } = {}) {
    if (options.viewId) actions.activateView(id, options.viewId)
    actions.navigate({ type: 'page', id, ...options })
  },

  openPeek(id: string, mode: 'side' | 'center' = state.peekMode, rowIds?: string[]) {
    if (!isLive(id)) return
    if (state.route.type === 'page' && state.route.id === id) { actions.closePeek(); return }
    set({ peekPageId: id, peekMode: mode, peekRowIds: rowIds ?? (state.peekRowIds?.includes(id) ? state.peekRowIds : null) }, false)
  },

  closePeek() { set({ peekPageId: null, peekRowIds: null }, false) },

  setPeekWidth(width: number) { if (Number.isFinite(width)) set({ peekWidth: Math.round(width) }, false) },

  async reloadDocument(id: string) {
    await api.loadDoc(id)
    set({ docRevision: state.docRevision + 1 }, false)
  },

  async restoreDocVersion(id: string, version: DocumentVersion) {
    if (!state.pages[id] || !Array.isArray(version.blocks)) throw new Error(message('Esta versão não está disponível.', 'This version is unavailable.'))
    if (state.pages[id].locked) throw new Error(message('Desbloqueie a página para restaurar o conteúdo.', 'Unlock the page to restore its content.'))
    const restored = version.page ? validateMeta({ ...currentMeta(), pages: { ...state.pages, [id]: { ...version.page, id, parentId: state.pages[id].parentId, locked: false } } }).pages[id] : undefined
    await actions.flushAll()
    await api.loadDoc(id)
    try { await api.saveDoc(id, structuredClone(version.blocks), { checkpoint: true }) }
    catch (error) {
      // Lousa / bloco sincronizado: a restauração só prossegue com escolha explícita do usuário.
      const protectedChange = /CANVAS_PROTECTED|SYNCED_BLOCK_PROTECTED/.test(error instanceof Error ? error.message : String(error))
      if (!protectedChange || typeof window === 'undefined' || !window.confirm(message('Esta versão remove ou altera uma lousa ou bloco sincronizado desta página. Restaurar mesmo assim?', 'This version removes or changes a whiteboard or synced block on this page. Restore anyway?'))) throw error
      await api.saveDoc(id, structuredClone(version.blocks), { checkpoint: true, userEdit: true })
    }
    if (restored) actions.updatePage(id, restored)
    actions.updatePage(id, { text: blocksToText(version.blocks), outboundPageIds: documentLinks(version.blocks) })
    await flushMeta()
    clearDraft(id)
    await api.draftDelete?.(id, windowDraftId())
    set({ docRevision: state.docRevision + 1 }, false)
  },

  async applyPageSuggestion(pageId: string, commentId: string, accept: boolean) {
    await actions.flushAll()
    const page = state.pages[pageId], comment = page?.comments?.find(c => c.id === commentId)
    if (!comment?.suggestion || comment.suggestion.status !== 'open') return
    if (page.locked && accept) throw new Error(message('Desbloqueie a página para aceitar a sugestão.', 'Unlock the page to accept this suggestion.'))
    if (accept) {
      const blocks = await api.loadDoc(pageId) ?? []
      const next = applySuggestionToBlocks(blocks, comment.suggestion.originalText, comment.suggestion.replacementText, comment.blockId, comment.textAnchor)
      await api.saveDoc(pageId, next, { checkpoint: true })
      clearDraft(pageId)
      await api.draftDelete?.(pageId, windowDraftId())
    }
    actions.updatePage(pageId, { comments: page.comments!.map(c => c.id === commentId ? { ...c, resolved: true, updatedAt: Date.now(), suggestion: { ...c.suggestion!, status: accept ? 'accepted' : 'rejected' } } : c) })
    await flushMeta()
    if (accept) set({ docRevision: state.docRevision + 1 }, false)
  },

  async appendPageBlocks(pageId: string, blocks: unknown[]) {
    if (!isLive(pageId) || state.pages[pageId].locked) throw new Error(message('A página está bloqueada ou indisponível.', 'The page is locked or unavailable.'))
    // Lousa: o documento é o envelope do quadro, não uma lista de blocos de texto.
    if (state.pages[pageId].canvas) throw new Error(message('Lousas não recebem blocos de texto; adicione a página à lousa como cartão.', 'Whiteboards do not take text blocks; add the page to the whiteboard as a card.'))
    await actions.flushAll()
    const current = await api.loadDoc(pageId) ?? []
    const byId = new Map(current.flatMap(block => block && typeof block === 'object' && 'id' in block ? [[block.id, block] as const] : []))
    const append = blocks.filter(block => {
      if (!block || typeof block !== 'object' || !('id' in block) || !byId.has(block.id)) return true
      if (JSON.stringify(byId.get(block.id)) !== JSON.stringify(block)) throw new Error(message('O bloco já existe com conteúdo diferente.', 'The block already exists with different content.'))
      return false
    })
    if (append.length) await api.saveDoc(pageId, [...current, ...structuredClone(append)], { checkpoint: true })
    set({ docRevision: state.docRevision + 1 }, false)
    await flushMeta()
    clearDraft(pageId)
    await api.draftDelete?.(pageId, windowDraftId())
  },

  goBack() {
    if (state.historyIndex > 0) {
      const i = state.historyIndex - 1
      const route = validRoute(state.history[i])
      set({ historyIndex: i, route, settings: settingsForRoute(route) })
    }
  },

  goForward() {
    if (state.historyIndex < state.history.length - 1) {
      const i = state.historyIndex + 1
      const route = validRoute(state.history[i])
      set({ historyIndex: i, route, settings: settingsForRoute(route) })
    }
  },

  setSearchOpen(open: boolean) {
    if (open) trackStep('search')
    set({ searchOpen: open }, false)
  },

  setSettingsOpen(open: boolean) {
    set({ settingsOpen: open }, false)
  },

  async backupSnapshot(): Promise<WorkspaceBackup> {
    await actions.flushAll()
    if (api.snapshotBackup) {
      const backup = await api.snapshotBackup()
      if (backup) return backup
    }
    const meta: Meta = structuredClone(currentMeta())
    const documents: Record<string, unknown[]> = {}
    const versions: Record<string, DocumentVersion[]> = {}
    for (const id of Object.keys(meta.pages)) {
      documents[id] = await api.loadDoc(id) ?? []
      versions[id] = await api.listDocVersions(id)
    }
    const backup: WorkspaceBackup = { format: COMPAT.record011, version: 1, exportedAt: new Date().toISOString(), meta, documents, versions, activity: await api.listActivity?.() }
    return backup
  },

  async exportBackup(): Promise<boolean> {
    return api.exportFile(`${PRODUCT.name}-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await actions.backupSnapshot(), null, 2))
  },

  /** Grava uma árvore de páginas já montada (ex.: importação do Export Bundle) sem alterar as existentes; cancelável até gravar os metadados. */
  async importPageTree(pages: Page[], documents: Record<string, unknown[]>, options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<void> {
    if (pages.some(page => state.pages[page.id])) throw new Error(message('Conflito de identificadores na importação.', 'Identifier conflict during import.'))
    await actions.flushAll()
    const saved: string[] = []
    try {
      // Electron: lotes numa transação só (antes, cada saveDoc relia e devolvia o meta inteiro pelo IPC).
      const batch = storageApi.saveDocs ? 200 : 1
      for (let index = 0; index < pages.length; index += batch) {
        if (options.signal?.aborted) throw Object.assign(new Error(message('Importação cancelada.', 'Import canceled.')), { name: 'AbortError' })
        const chunk = pages.slice(index, index + batch)
        if (storageApi.saveDocs) await storageApi.saveDocs(chunk.map(page => ({ id: page.id, blocks: documents[page.id] ?? [], options: { base: null } })))
        else await storageApi.saveDoc(chunk[0].id, documents[chunk[0].id] ?? [], { base: null })
        saved.push(...chunk.map(page => page.id))
        if (batch > 1 || index % 20 === 0) { options.onProgress?.(index, pages.length); await new Promise(resolve => setTimeout(resolve, 0)) }
      }
    } catch (error) {
      for (const id of saved) await storageApi.deleteDoc(id).catch(() => {})
      throw error
    }
    const offset = nextOrder(null), imported: Record<string, Page> = {}
    for (const page of pages) {
      const blocks = documents[page.id] ?? [], bodyText = blocksToText(blocks), links = documentLinks(blocks)
      imported[page.id] = { ...page, order: page.parentId === null ? offset + page.order : page.order, text: bodyText, bodyText, bodyOutboundPageIds: links, outboundPageIds: links, syncedBlockIds: [] }
    }
    set({ pages: { ...state.pages, ...imported } })
    await flushMeta()
    options.onProgress?.(pages.length, pages.length)
  },

  /** Import as additional pages with fresh IDs, preserving the current workspace. */
  async importBackup(value: unknown, parentId?: string): Promise<number> {
    const backup = validateBackup(value)
    if (parentId && (!isLive(parentId) || state.pages[parentId].locked)) throw new Error(message('A página de destino está bloqueada ou indisponível.', 'The destination page is locked or unavailable.'))
    await actions.flushAll()
    const mapping = Object.fromEntries(Object.keys(backup.meta.pages).map(id => [id, crypto.randomUUID()]))
    for (const blocks of Object.values(backup.documents)) Object.assign(mapping, collectBlockMapping(blocks))
    for (const block of Object.values(backup.meta.syncedBlocks ?? {})) { mapping[block.id] = crypto.randomUUID(); Object.assign(mapping, collectBlockMapping(block.blocks)) }
    const imported: Record<string, Page> = {}
    const offset = nextOrder(null)
    for (const page of Object.values(backup.meta.pages)) {
      const id = mapping[page.id]
      await api.saveDoc(id, cloneDocument(backup.documents[page.id], mapping))
      if (backup.versions?.[page.id]?.length) await api.saveDocVersions(id, backup.versions[page.id].map(version => ({ ...version, page: version.page ? remapReferences(version.page, mapping) : undefined, blocks: cloneDocument(version.blocks, mapping) })))
      imported[id] = { ...remapReferences(page, mapping), id, order: page.parentId === null ? offset + page.order : page.order,
        ...(page.parentId === null && parentId ? { parentId } : {}),
        text: blocksToText(backup.documents[page.id]), outboundPageIds: documentLinks(remapReferences(backup.documents[page.id], mapping)) }
    }
    const syncedBlocks = Object.fromEntries(Object.values(backup.meta.syncedBlocks ?? {}).map(block => [mapping[block.id], { ...remapReferences(block, mapping), id: mapping[block.id] }]))
    const notifications = Object.fromEntries(Object.values(backup.meta.notifications ?? {}).map(notification => { const id = crypto.randomUUID(); return [id, { ...remapReferences(notification, mapping), id }] }))
    const templates = (backup.meta.settings.personalTemplates ?? []).map(template => ({ ...remapReferences(template, mapping), id: crypto.randomUUID(), blocks: cloneDocument(template.blocks, mapping) }))
    const objectTypes = backup.meta.settings.objectTypes?.length ? { objectTypes: mergeImportedTypes(state.settings.objectTypes ?? [], remapReferences(backup.meta.settings.objectTypes, mapping)) } : {}
    set({ pages: { ...state.pages, ...imported }, notifications: { ...state.notifications, ...notifications }, syncedBlocks: { ...state.syncedBlocks, ...syncedBlocks }, settings: { ...state.settings, ...objectTypes, personalTemplates: [...state.settings.personalTemplates ?? [], ...templates] } })
    await flushMeta()
    return Object.keys(imported).length
  },
}

const foldedPages = new WeakMap<Page, { title: string; text: string }>()
let favoritesCache: { pages: Record<string, Page>; list: Page[] } | null = null

export const selectors = {
  syncedBlock: (id: string) => state.syncedBlocks[id],
  page: (id: string): Page | undefined => state.pages[id],
  isLive,
  /** Filhos não excluídos de `parentId`, em ordem. */
  children(parentId: string | null): Page[] {
    // Índice incremental por pai (src/perf/pageIndex.ts); devolve uma cópia para quem quiser mutar.
    return liveChildren(state.pages, parentId).slice()
  },
  /** Como `children`, mas o array é compartilhado e estável entre versões que não mexem nesse pai. Não mutar. */
  childrenShared(parentId: string | null): readonly Page[] {
    return liveChildren(state.pages, parentId)
  },
  /** Ancestrais da raiz até o pai imediato (sem a própria página). */
  ancestors(id: string): Page[] {
    const out: Page[] = []
    let cur = state.pages[id]
    const seen = new Set([id])
    while (cur?.parentId && state.pages[cur.parentId]) {
      if (seen.has(cur.parentId)) break
      cur = state.pages[cur.parentId]
      seen.add(cur.id)
      out.unshift(cur)
    }
    return out
  },
  favorites(): Page[] {
    // Memoizado por versão de `pages` (a barra lateral chama a cada render; 50 mil páginas = ~20 ms).
    if (favoritesCache?.pages !== state.pages) favoritesCache = { pages: state.pages, list: Object.values(state.pages)
      .filter((p) => p.favorite && isLive(p.id))
      .sort((a, b) => a.title.localeCompare(b.title)) }
    return favoritesCache.list.slice()
  },
  /** Páginas marcadas como excluídas (raízes de exclusão), mais recentes primeiro. */
  trash(): Page[] {
    return Object.values(state.pages)
      .filter((p) => p.trashed)
      .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))
  },
  recent(limit = 12): Page[] {
    return state.settings.recent
      .map((id) => state.pages[id])
      .filter((p): p is Page => !!p && isLive(p.id))
      .slice(0, limit)
  },
  /** Busca por título e conteúdo; títulos primeiro. Query vazia devolve as recentes. */
  search(query: string): Page[] {
    const q = foldSearch(query.trim())
    if (!q) return selectors.recent(10)
    const live = Object.values(state.pages).filter((p) => isLive(p.id))
    // Texto normalizado em cache por objeto de página (imutável): só páginas alteradas são renormalizadas.
    const folded = (p: Page) => { let f = foldedPages.get(p); if (!f) foldedPages.set(p, (f = { title: foldSearch(p.title), text: foldSearch(p.text) })); return f }
    const byTitle = live.filter((p) => folded(p).title.includes(q))
    const titleSet = new Set(byTitle)
    const byText = live.filter((p) => !titleSet.has(p) && folded(p).text.includes(q))
    const recentFirst = (a: Page, b: Page) => b.updatedAt - a.updatedAt
    return [...byTitle.sort(recentFirst), ...byText.sort(recentFirst)].slice(0, 50)
  },
  /** Esquema do banco de dados, se `id` for um banco. */
  database(id: string): DatabaseSchema | undefined {
    const typeId = typeIdFromSchemaId(id)
    if (typeId) { const type = findType(state.settings.objectTypes ?? [], typeId); return type ? schemaFromType(state.settings.objectTypes!, type) : undefined }
    const seen = new Set<string>()
    const resolve = (key: string): DatabaseSchema | undefined => {
      if (seen.has(key)) return undefined
      seen.add(key)
      const schema = state.pages[key]?.database
      if (!schema?.linkedSourceId) return schema
      const source = resolve(schema.linkedSourceId)
      return source ? { ...schema, properties: source.properties, templates: source.templates, defaultTemplateId: source.defaultTemplateId } : schema
    }
    return resolve(id)
  },
  /** Linhas (páginas filhas não excluídas) de um banco, na ordem manual. */
  rows(dbId: string): Page[] {
    const own = state.pages[dbId]?.database
    // Caso comum (banco simples): direto do índice, sem deduplicar 50 mil linhas num Map.
    if (!own?.linkedSourceId && !own?.sourceDatabaseIds?.length) return liveChildren(state.pages, dbId).slice()
    const seen = new Set<string>()
    const collect = (id: string): Page[] => {
      if (seen.has(id)) return []
      seen.add(id)
      const schema = state.pages[id]?.database
      if (schema?.linkedSourceId) return collect(schema.linkedSourceId)
      return [...selectors.children(id), ...(schema?.sourceDatabaseIds ?? []).flatMap(collect)]
    }
    return [...new Map(collect(dbId).map(row => [row.id, row])).values()]
  },
  /** O banco de dados do qual `pageId` é linha, se for o caso. */
  parentDatabase(pageId: string): Page | undefined {
    const parentId = state.pages[pageId]?.parentId
    const parent = parentId ? state.pages[parentId] : undefined
    return parent?.database ? parent : undefined
  },
  backlinks(id: string): Page[] {
    return Object.values(state.pages).filter(p => p.id !== id && isLive(p.id) && p.outboundPageIds?.includes(id))
      .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
  },
  canGoBack: () => state.historyIndex > 0,
  canGoForward: () => state.historyIndex < state.history.length - 1,
}

/** Criação de linhas em esquemas virtuais (coleções de tipos de objeto, src/objecttypes/actions.ts). */
let typeSchemaRecorder: ((typeId: string, run: () => void) => void) | null = null
/** Registra quem envolve mudanças de visão da coleção de um tipo num passo desfazível (src/objecttypes/actions.ts). */
export function registerTypeSchemaRecorder(recorder: typeof typeSchemaRecorder) { typeSchemaRecorder = recorder }
let virtualRowFactory: ((dbId: string, props: Record<string, PropValue>, init: Partial<Page>) => string) | null = null
export function registerVirtualRows(factory: typeof virtualRowFactory) { virtualRowFactory = factory }
/** Gancho de linha nova de banco (tipo das novas linhas, src/objecttypes): chamado depois que `createRow` cria a linha. */
let newRowHook: ((dbId: string, rowId: string) => void) | undefined
export function registerNewRowHook(hook: typeof newRowHook) { newRowHook = hook }

export function getState(): State {
  return state
}

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Hook: re-renderiza quando o state muda. Use os `selectors` depois de chamá-lo. */
export function useStore(): State {
  return useSyncExternalStore(subscribe, getState)
}

const welcomeDoc: unknown[] = [
  { type: 'paragraph', content: `Welcome to ${PRODUCT.name} — your notes, stored locally on this Mac. Get started in five minutes: check off each step as you go. The “Getting started” card in My day also tracks your progress automatically.` },
  { type: 'heading', props: { level: 2 }, content: 'Start here' },
  { type: 'checkListItem', content: 'Create a page (⌘N) and give it a title' },
  { type: 'checkListItem', content: 'On an empty line, press / to see the available block types' },
  { type: 'checkListItem', content: 'Open search (⌘K) and find this page' },
  { type: 'checkListItem', content: 'Create a database and press N for a new row' },
  { type: 'checkListItem', content: 'Try today’s note (⌘⇧D) and write a task with “@tomorrow”' },
  { type: 'checkListItem', content: 'Capture a thought without leaving your current work (⌥⌘N)' },
  { type: 'heading', props: { level: 2 }, content: 'Good to know' },
  { type: 'bulletListItem', content: 'Hover over a block and drag its ⋮⋮ handle to reorder it' },
  { type: 'bulletListItem', content: 'Click + beside a page in the sidebar to create a subpage' },
  { type: 'bulletListItem', content: 'Person, Project, Meeting, Task, Book, Idea, Resource, and Company are ready in the sidebar’s Types section: open one and click + New' },
  { type: 'bulletListItem', content: 'Hide or reopen Getting started in Settings → Help' },
  { type: 'paragraph' },
]
