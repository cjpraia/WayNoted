// F8m — custo de gravar o meta.json com muitas páginas (decide F8: particionar ou não).
// Uso: node scripts/bench-meta.mjs [--sizes=1000,5000,20000,50000] [--iters=12] [--text=0] [--dir=<pasta>] [--max-rss-mb=1500] [--json]
// Mede, com os módulos reais (electron/storage.cjs e electron/workspace-storage.cjs):
//   raw   = JSON.stringify + atomicWrite (tmp, fsync, rename, fsync do diretório) do meta inteiro;
//   save  = createWorkspaceStorage(dir).saveMeta(proposto, base) com uma alteração de título (caminho real do app:
//           ler meta, mesclar em três vias, checar ciclos, gravar, registrar atividade).
// Para ao passar do limite de RSS (padrão 1,5 GB). Os dados vão para uma pasta temporária própria, apagada ao final.
import { createRequire } from 'node:module'
import { mkdirSync, rmSync, statSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

const require = createRequire(import.meta.url)
const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? 'true'] }))
const sizes = (args.sizes ?? '1000,5000,20000,50000').split(',').map(Number).filter(n => n > 0)
const iters = Math.max(3, Number(args.iters ?? 12))
const textLength = Math.max(0, Number(args.text ?? 0))
const maxRssMb = Number(args['max-rss-mb'] ?? 1500)
const baseDir = args.dir ? path.resolve(args.dir) : tmpdir()
const rssMb = () => process.memoryUsage().rss / 1048576

const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] }
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d

/** Espaço sintético: árvore em largura (≈ 8 filhos por página), 1 em 5 páginas é linha de banco com propriedades. */
function buildMeta(count) {
  const ids = Array.from({ length: count }, () => randomUUID())
  const now = Date.now()
  const words = ['plano', 'reunião', 'projeto', 'ideia', 'tarefa', 'notas', 'estudo', 'viagem']
  const pages = {}
  for (let i = 0; i < count; i++) {
    const links = []
    for (let k = 1; k <= 3 && i + k * 7 < count; k++) links.push(ids[(i + k * 7) % count])
    const text = textLength ? Array.from({ length: Math.ceil(textLength / 8) }, (_, j) => words[(i + j) % words.length]).join(' ').slice(0, textLength) : ''
    pages[ids[i]] = {
      id: ids[i], parentId: i === 0 ? null : ids[Math.floor((i - 1) / 8)], title: `Página sintética ${i} ${words[i % words.length]}`, icon: ['📝', '📚', '✅', '💡'][i % 4], cover: null, coverPosition: 50,
      favorite: i % 50 === 0, trashed: false, trashedAt: null, createdAt: now - i * 1000, updatedAt: now - i * 500, order: i % 8, fullWidth: false, smallText: false, font: 'default', locked: false,
      text, bodyText: text, outboundPageIds: links, bodyOutboundPageIds: links, syncedBlockIds: [],
      ...(i % 5 === 0 ? { props: { status: 'Em andamento', prioridade: (i % 3) + 1, data: '2026-10-08', etiquetas: ['a', 'b'], feito: i % 2 === 0 } } : {}),
    }
  }
  return { pages, settings: { locale: 'pt-BR', theme: 'system', workspaceName: 'Bench', userName: '', sidebarWidth: 240, sidebarCollapsed: false, expanded: {}, recent: [], historyLimit: 0 }, notifications: {}, syncedBlocks: {} }
}

async function timed(fn) { const t0 = performance.now(); await fn(); return performance.now() - t0 }

async function measure(count, root) {
  const dir = path.join(root, `w${count}`)
  mkdirSync(dir, { recursive: true })
  const { atomicWrite, drain } = require('../electron/storage.cjs')
  const { createWorkspaceStorage, drainWorkspaces } = require('../electron/workspace-storage.cjs')
  let meta = buildMeta(count)
  const result = { pages: count, textLength }
  // raw: stringify + gravação atômica
  const stringifyMs = [], rawMs = []
  const rawFile = path.join(dir, 'raw-meta.json')
  for (let i = 0; i < iters; i++) {
    const id = Object.keys(meta.pages)[i]
    meta.pages[id].title = `raw ${i}`
    let json
    stringifyMs.push(await timed(() => { json = JSON.stringify(meta) }))
    rawMs.push(stringifyMs.at(-1) + await timed(() => atomicWrite(rawFile, json)))
  }
  result.fileMB = round(statSync(rawFile).size / 1048576, 2)
  result.raw = { p50: round(percentile(rawMs, 0.5)), p95: round(percentile(rawMs, 0.95)), stringifyP50: round(percentile(stringifyMs, 0.5)) }
  await drain()
  // save: caminho real do app
  const storage = createWorkspaceStorage(dir)
  let base = await storage.saveMeta(meta, null)
  const saveMs = []
  for (let i = 0; i < iters; i++) {
    const proposed = JSON.parse(JSON.stringify(base))
    proposed.pages[Object.keys(proposed.pages)[i + 1]].title = `save ${i}`
    saveMs.push(await timed(async () => { base = await storage.saveMeta(proposed, base) }))
    if (rssMb() > maxRssMb) { result.stoppedByMemory = true; break }
  }
  await drainWorkspaces(); await drain()
  result.save = { p50: round(percentile(saveMs, 0.5)), p95: round(percentile(saveMs, 0.95)), runs: saveMs.length }
  result.metaFileMB = round(statSync(path.join(dir, 'meta.json')).size / 1048576, 2)
  result.rssMB = Math.round(rssMb()); result.heapMB = Math.round(process.memoryUsage().heapUsed / 1048576)
  meta = null; base = null
  rmSync(dir, { recursive: true, force: true })
  return result
}

const root = mkdtempSync(path.join(baseDir, "workspace-bench-meta-"))
const out = []
try {
  for (const count of sizes) {
    if (rssMb() > maxRssMb) { out.push({ pages: count, skipped: `RSS ${Math.round(rssMb())} MB acima do limite` }); continue }
    const row = await measure(count, root)
    out.push(row)
    if (!args.json) console.log(`${String(count).padStart(6)} páginas | arquivo ${String(row.fileMB).padStart(6)} MB | stringify+gravar p50 ${String(row.raw.p50).padStart(7)} ms p95 ${String(row.raw.p95).padStart(7)} ms | saveMeta p50 ${String(row.save.p50).padStart(7)} ms p95 ${String(row.save.p95).padStart(7)} ms | RSS ${row.rssMB} MB${row.stoppedByMemory ? ' (parou por memória)' : ''}`)
    global.gc?.()
  }
} finally { rmSync(root, { recursive: true, force: true }) }
if (args.json) console.log(JSON.stringify(out, null, 2))
