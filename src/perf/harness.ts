// Harness de desempenho (só desenvolvimento/diagnóstico). Gera bancos grandes pela store e mede,
// com performance.now(), abrir/rolar/filtrar/ordenar/editar e a barra lateral/busca.
// Uso no console (vite dev): `const p = await import('/src/perf/harness.ts'); await p.runAll(50000)`
// No Electron: localStorage['workspace:perf'] = '1' e recarregue; depois `await __workspacePerf.runAll(50000)`.
import { actions, getState, selectors } from '../store'
import type { DatabaseSchema, Page, Property, View } from '../types'
import { applyView } from '../components/database/lib'

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
const settle = async () => { await nextFrame(); await nextFrame() }

function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

const WORDS = ['alfa', 'bravo', 'charlie', 'delta', 'eco', 'foxtrot', 'golf', 'hotel', 'índigo', 'julieta', 'kilo', 'lima', 'mike', 'novembro', 'oscar', 'papa', 'quebec', 'romeu', 'sierra', 'tango']

/** Esquema com ~10 propriedades representativas. */
export function perfSchema(): DatabaseSchema {
  const opt = (name: string, color: string, group?: string) => ({ id: crypto.randomUUID(), name, color, ...(group ? { group } : {}) })
  const properties = [
    { id: 'p-title', name: 'Nome', type: 'title' },
    { id: 'p-status', name: 'Status', type: 'status', options: [opt('Não iniciado', 'gray', 'todo'), opt('Em andamento', 'blue', 'progress'), opt('Concluído', 'green', 'complete')] },
    { id: 'p-prio', name: 'Prioridade', type: 'select', options: [opt('Baixa', 'gray'), opt('Média', 'yellow'), opt('Alta', 'orange'), opt('Urgente', 'red')] },
    { id: 'p-tags', name: 'Tags', type: 'multiSelect', options: WORDS.slice(0, 8).map((w, i) => opt(w, ['blue', 'green', 'purple', 'pink', 'brown', 'orange', 'yellow', 'red'][i])) },
    { id: 'p-num', name: 'Estimativa', type: 'number' },
    { id: 'p-date', name: 'Prazo', type: 'date' },
    { id: 'p-done', name: 'Revisado', type: 'checkbox' },
    { id: 'p-text', name: 'Notas', type: 'text' },
    { id: 'p-url', name: 'Link', type: 'url' },
    { id: 'p-created', name: 'Criado em', type: 'createdTime' },
  ] as Property[]
  const view: View = { id: crypto.randomUUID(), name: 'Tabela', type: 'table', filters: [], sorts: [], hidden: [], widths: {} }
  return { properties, views: [view], activeViewId: view.id }
}

/** Cria um banco com `count` linhas num único `set`. Devolve o id do banco. */
export function seedDatabase(count: number, seed = 1, title = `Perf ${count}`): string {
  const dbId = actions.createPage(null, { title, database: perfSchema() })
  const schema = getState().pages[dbId].database!
  const [, status, prio, tags] = schema.properties
  const random = rng(seed), now = Date.now()
  const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)]
  const rows: Page[] = []
  for (let i = 0; i < count; i++) {
    const day = 1 + Math.floor(random() * 28), month = 1 + Math.floor(random() * 12)
    rows.push({
      id: crypto.randomUUID(), parentId: dbId, title: `${pick(WORDS)} ${pick(WORDS)} ${i}`, icon: null, cover: null, coverPosition: 50,
      favorite: false, trashed: false, trashedAt: null, createdAt: now - i * 1000, updatedAt: now - i * 500, order: i,
      fullWidth: false, smallText: false, font: 'default', locked: false, text: '', sequence: i + 1,
      props: {
        'p-status': pick(status.options!).id, 'p-prio': random() < 0.1 ? null : pick(prio.options!).id,
        'p-tags': tags.options!.filter(() => random() < 0.2).map((o) => o.id), 'p-num': Math.round(random() * 1000) / 10,
        'p-date': { start: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` }, 'p-done': random() < 0.5,
        'p-text': random() < 0.3 ? `${pick(WORDS)} ${pick(WORDS)} ${pick(WORDS)}` : '', 'p-url': random() < 0.2 ? `https://exemplo.local/${i}` : '',
      },
    } as Page)
  }
  actions.insertPages(rows)
  return dbId
}

/** Cria `count` páginas comuns (barra lateral/busca): metade na raiz, metade aninhada. */
export function seedPages(count: number, seed = 2): string {
  const random = rng(seed), now = Date.now(), pages: Page[] = []
  const folder = actions.createPage(null, { title: `Pasta com ${count} páginas` })
  for (let i = 0; i < count; i++) {
    const parentId = i % 2 ? folder : pages.length && random() < 0.3 ? pages[Math.floor(random() * pages.length)].id : folder
    pages.push({ id: crypto.randomUUID(), parentId, title: `Página ${WORDS[i % WORDS.length]} ${i}`, icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: now, updatedAt: now - i, order: i, fullWidth: false, smallText: false, font: 'default', locked: false, text: `conteúdo ${WORDS[(i * 7) % WORDS.length]} ${i}` } as Page)
  }
  actions.insertPages(pages)
  return folder
}

function scrollParent(el: Element | null): HTMLElement {
  let cur = el?.parentElement ?? null
  while (cur) {
    const oy = getComputedStyle(cur).overflowY
    if ((oy === 'auto' || oy === 'scroll') && cur.scrollHeight > cur.clientHeight) return cur
    cur = cur.parentElement
  }
  return document.scrollingElement as HTMLElement
}

function longTasks() {
  const entries: number[] = []
  let observer: PerformanceObserver | null = null
  try { observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => entries.push(e.duration))); observer.observe({ type: 'longtask', buffered: false }) } catch { /* sem suporte */ }
  return () => { observer?.disconnect(); return { count: entries.length, max: Math.round(Math.max(0, ...entries)) } }
}

async function timed(fn: () => void | Promise<void>) {
  const stop = longTasks()
  const start = performance.now()
  await fn()
  await settle()
  return { ms: Math.round(performance.now() - start), longTasks: stop() }
}

export async function measureOpen(dbId: string) {
  actions.navigate({ type: 'home' })
  await settle()
  return timed(async () => {
    actions.openPage(dbId)
    for (let i = 0; i < 400 && !document.querySelector('.tb-row, .ls-row, .gl-card, .bd-card'); i++) await new Promise((r) => setTimeout(r, 5))
  })
}

export async function measureScroll(frames = 180, step = 120) {
  const target = scrollParent(document.querySelector('.tb, .ls, .gl, .bd-board'))
  target.scrollTop = 0
  await settle()
  const deltas: number[] = []
  let last = performance.now()
  for (let i = 0; i < frames; i++) {
    target.scrollTop += step
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    const now = performance.now(); deltas.push(now - last); last = now
  }
  const sorted = [...deltas].sort((a, b) => a - b), avg = deltas.reduce((s, d) => s + d, 0) / deltas.length
  return { fps: Math.round(1000 / avg), p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]), maxFrame: Math.round(sorted.at(-1)!), domRows: document.querySelectorAll('.tb-row, .ls-row, .gl-card, .bd-card').length }
}

const viewOf = (dbId: string) => { const s = getState().pages[dbId].database!; return s.views.find((v) => v.id === s.activeViewId)! }

export async function measureSort(dbId: string, propertyId = 'p-title') {
  return timed(() => actions.updateView(dbId, viewOf(dbId).id, { sorts: [{ propertyId, direction: 'asc' }] } as Partial<View>))
}
export async function measureFilter(dbId: string) {
  const status = getState().pages[dbId].database!.properties.find((p) => p.id === 'p-status')!
  return timed(() => actions.updateView(dbId, viewOf(dbId).id, { filters: [{ id: 'f1', propertyId: status.id, op: 'is', value: status.options![1].id }] } as Partial<View>))
}
export async function measureClear(dbId: string) {
  return timed(() => actions.updateView(dbId, viewOf(dbId).id, { filters: [], sorts: [] }))
}
/** Edita uma célula (commit do editor) e mede até o próximo quadro pintado; média de `times`. */
export async function measureEdit(dbId: string, times = 10) {
  const rows = selectors.rows(dbId), results: number[] = []
  for (let i = 0; i < times; i++) {
    const r = await timed(() => actions.setProp(rows[i].id, 'p-text', `editado ${i} ${Date.now()}`))
    results.push(r.ms)
  }
  return { avg: Math.round(results.reduce((s, n) => s + n, 0) / times), max: Math.max(...results) }
}
/** Edita e espera a gravação automática (debounce): maior bloqueio da UI no período. */
export async function measureEditWithSave(dbId: string) {
  const row = selectors.rows(dbId)[3], probe = blockProbe(), stop = longTasks()
  actions.setProp(row.id, 'p-text', `gravação ${Date.now()}`)
  const t0 = performance.now()
  while (performance.now() - t0 < 4000 && !getState().saving) await new Promise((r) => setTimeout(r, 10))
  while (performance.now() - t0 < 15000 && getState().saving) await new Promise((r) => setTimeout(r, 10))
  await settle()
  return { untilSavedMs: Math.round(performance.now() - t0), blockedMs: probe(), longTasks: stop() }
}
/** Importação de `count` páginas pelo caminho real (actions.importPageTree, em lotes no Electron). */
export async function measureImport(count: number, legacyLoop = false) {
  const now = Date.now(), pages: Page[] = [], documents: Record<string, unknown[]> = {}
  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID()
    pages.push({ id, parentId: i && i % 10 ? pages[i - (i % 10)].id : null, title: `Importada ${i}`, icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: now, updatedAt: now, order: i, fullWidth: false, smallText: false, font: 'default', locked: false, text: '' } as Page)
    documents[id] = [{ id: crypto.randomUUID(), type: 'paragraph', content: `Parágrafo ${i} ${WORDS[i % WORDS.length]}`, props: {}, children: [] }]
  }
  const t0 = performance.now()
  if (legacyLoop) {
    // Caminho antigo (referência "antes"): um saveDoc por página.
    const native = (window as unknown as { api?: { saveDoc: (id: string, b: unknown[], o: unknown) => Promise<unknown> } }).api
    for (const page of pages) await native!.saveDoc(page.id, documents[page.id], { base: null })
    return { count, legacyLoopMs: Math.round(performance.now() - t0) }
  }
  await actions.importPageTree(pages, documents)
  return { count, importMs: Math.round(performance.now() - t0) }
}
/** Tempo puro de applyView (sem React) com filtro+ordenação. */
export function measureApplyView(dbId: string) {
  const schema = selectors.database(dbId)!, rows = selectors.rows(dbId)
  const status = schema.properties.find((p) => p.id === 'p-status')!
  const view = { ...viewOf(dbId), filters: [{ id: 'f', propertyId: status.id, op: 'isNot', value: status.options![2].id }], sorts: [{ propertyId: 'p-title', direction: 'asc' }] } as View
  const t0 = performance.now(); applyView(rows, schema, view); const cold = performance.now() - t0
  const t1 = performance.now(); applyView(rows, schema, view); const warm = performance.now() - t1
  return { rows: rows.length, coldMs: Math.round(cold), warmMs: Math.round(warm) }
}
export function measureSelectors(query = 'tango') {
  const t0 = performance.now(); const found = selectors.search(query).length; const search = performance.now() - t0
  const t1 = performance.now(); selectors.children(null); const children = performance.now() - t1
  return { pages: Object.keys(getState().pages).length, searchMs: Math.round(search), found, childrenMs: Math.round(children * 10) / 10 }
}
/** Tempo de uma gravação do meta (debounce ignorado). */
export async function measureSave() {
  actions.updateSettings({ sidebarWidth: getState().settings.sidebarWidth })
  // `ms` é o tempo total até o disco (inclui o processo principal); `blockedMs` é o que travou esta janela.
  const stop = longTasks(), probe = blockProbe()
  const t0 = performance.now(); await actions.flushMeta().catch((e) => console.warn(e)); const ms = Math.round(performance.now() - t0)
  await settle()
  return { ms, blockedMs: probe(), longTasks: stop() }
}

/** Maior intervalo sem o laço de eventos responder (amostragem a cada 4 ms). */
function blockProbe() {
  let last = performance.now(), worst = 0
  const timer = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last - 4); last = now }, 4)
  return () => { clearInterval(timer); return Math.round(Math.max(worst, performance.now() - last - 4)) }
}

/**
 * Orçamento de latência (docs/DEVELOPMENT.md): tempo até o próximo quadro pintado depois de abrir
 * cada tela, abrir/fechar a busca ⌘K e a prévia. Meta: ≤ 100 ms de feedback, ≤ 400 ms de resposta.
 */
export async function measureRoutes(pageId?: string, dbId?: string) {
  const all = Object.values(getState().pages)
  pageId ??= all.find((page) => !page.database && !page.trashed && page.title.startsWith('Página'))?.id
  dbId ??= all.find((page) => page.database && page.title.startsWith('Perf'))?.id
  const out: Record<string, number> = {}
  const paint = async (name: string, fn: () => void) => {
    await settle()
    const t0 = performance.now()
    fn()
    await nextFrame(); await nextFrame()
    out[name] = Math.round(performance.now() - t0)
  }
  await paint('home', () => actions.navigate({ type: 'home' }))
  if (pageId) await paint('página', () => actions.openPage(pageId))
  if (dbId) await paint('banco', () => actions.openPage(dbId))
  await paint('tarefas', () => actions.navigate({ type: 'tasks' }))
  await paint('grafo', () => actions.navigate({ type: 'graph' }))
  await paint('produtividade', () => actions.navigate({ type: 'productivity' }))
  await paint('⌘K abrir', () => actions.setSearchOpen(true))
  await paint('⌘K fechar', () => actions.setSearchOpen(false))
  if (pageId) await paint('prévia', () => actions.openPeek(pageId))
  actions.navigate({ type: 'home' })
  console.table(out)
  return out
}

/** ⌘K: abrir/fechar a busca `times` vezes; devolve ms até o próximo quadro pintado (inclui renderizar a lista). */
export async function measureSearchOpen(times = 3) {
  const out: number[] = []
  for (let i = 0; i < times; i++) {
    await settle()
    const t0 = performance.now()
    actions.setSearchOpen(true)
    await nextFrame(); await nextFrame()
    out.push(Math.round(performance.now() - t0))
    actions.setSearchOpen(false)
  }
  return out
}

export async function runAll(count = 50000) {
  const out: Record<string, unknown> = { count, ua: navigator.userAgent.includes('Electron') ? 'electron' : 'browser' }
  const t0 = performance.now(); const dbId = seedDatabase(count); out.seedMs = Math.round(performance.now() - t0)
  await settle()
  out.open = await measureOpen(dbId)
  out.scroll = await measureScroll()
  out.sort = await measureSort(dbId)
  out.scrollSorted = await measureScroll(90)
  out.filter = await measureFilter(dbId)
  out.clear = await measureClear(dbId)
  out.edit = await measureEdit(dbId)
  out.applyView = measureApplyView(dbId)
  out.selectors = measureSelectors()
  console.table(out)
  return { dbId, ...out }
}

export function install() { (window as unknown as { __workspacePerf: unknown }).__workspacePerf = { measureRoutes, measureSearchOpen, seedDatabase, seedPages, measureOpen, measureScroll, measureSort, measureFilter, measureClear, measureEdit, measureApplyView, measureSelectors, measureSave, measureEditWithSave, measureImport, runAll, getState, actions, selectors } }
install()
