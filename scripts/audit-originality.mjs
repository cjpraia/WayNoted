#!/usr/bin/env node
import COMPAT from '../shared/compatibility.mjs'
// Auditoria de similaridade entre o código/recursos PRÓPRIOS do aplicativo e o acervo de referência do Export Bundle
// (acervo externo: extracted, remote-public e archive). SOMENTE LEITURA: só escreve .artifacts/originality.md
// (preservando o que vier depois do marcador <!-- REVISAO-MANUAL -->). Não prova ausência de cópia: ver "Limites" no relatório.
//
// Uso: node scripts/audit-originality.mjs [--window=12] [--no-write]
// Memória: indexa só o lado próprio (pequeno) e lê o acervo arquivo por arquivo; aborta acima de 1,5 GB de RSS.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, relative, extname, sep, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const REPORT = join(ROOT, ".artifacts/originality.md")
const MARKER = '<!-- REVISAO-MANUAL -->'
const args = process.argv.slice(2)
const WINDOW = Number((args.find(a => a.startsWith('--window=')) ?? '--window=12').split('=')[1]) || 12
const WRITE = !args.includes('--no-write')
const MIN_LINE = 25, MIN_STRING = 40, RSS_LIMIT = 1.5 * 1024 ** 3, MAX_FILE = 120 * 1024 ** 2

const OWN_ROOTS = ['src', 'electron', 'native', 'build', 'index.html']
const OWN_SKIP_DIRS = new Set(['node_modules', 'dist', 'release', 'release-test', 'docs', '.git'])
const OWN_TEXT_EXT = new Set(['.ts', '.tsx', '.mts', '.js', '.cjs', '.mjs', '.css', '.html', '.swift', '.sh', '.plist', '.json'])
const MEDIA_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.icns', '.webp', '.avif', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.wav', '.mp3', '.m4a', '.mp4', '.mov', '.webm', '.pdf', '.pak', '.node', '.wasm'])
// O acervo fica FORA do repositório (retirado do repo e do histórico). Somente leitura; nada dele é copiado para cá.
const ACERVO = (args.find(a => a.startsWith('--acervo=')) ?? '--acervo=' + resolve(ROOT, '..', "reference-source-acervo-privado")).split('=').slice(1).join('=')
const ACERVO_ROOTS = ['extracted', 'remote-public', 'archive']
const ACERVO_TEXT_EXT = new Set(['.js', '.css', '.html', '.json', '.mjs', '.cjs'])
const COMMON_LIB = /(from\s+['"](?:react|react-dom|react\/jsx-runtime|lucide-react|node:[^'"]+|electron|fs|path|os|crypto)['"]|require\(['"](?:react|electron|node:[^'"]+|fs|path|os|crypto)['"]\))/

function* walk(dir, skip = new Set()) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) { if (!skip.has(entry.name)) yield* walk(full, skip) }
    else if (entry.isFile()) yield full
  }
}
const rel = file => relative(ROOT, file).split(sep).join('/')
const guard = () => { if (process.memoryUsage().rss > RSS_LIMIT) { console.error('RSS acima de 1,5 GB: abortando.'); process.exit(2) } }

function fnv(text, seed) {
  let h = seed >>> 0
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return h
}
const lineKey = text => fnv(text, 2166136261) * 2097152 + (fnv(text, 0x9e3779b1) & 0x1fffff) // ~53 bits
function windowKey(keys, start) {
  let a = 2166136261, b = 0x811c9dc5 ^ 0x5bd1e995
  for (let i = start; i < start + WINDOW; i++) {
    const k = keys[i]
    a = Math.imul(a ^ (k % 4294967296), 16777619) >>> 0
    b = Math.imul(b ^ Math.floor(k / 4294967296), 2246822519) >>> 0
  }
  return a * 2097152 + (b & 0x1fffff)
}

/** Linhas normalizadas e não triviais, com o número real da linha. Linhas longas (código minificado) viram fragmentos em ; { }. */
function keptLines(text) {
  const out = []
  const raw = text.split('\n')
  for (let n = 0; n < raw.length; n++) {
    let line = raw[n]
    if (line.length < MIN_LINE) continue
    const parts = line.length > 300 ? line.split(/(?<=[;{}])/) : [line]
    for (const part of parts) {
      const norm = part.replace(/\s+/g, ' ').trim()
      if (norm.length < MIN_LINE) continue
      if (/^(import |export \* from|export \{[^}]*\} from|\} from |\/\/|\/\*|\*|<!--)/.test(norm)) continue
      if (COMMON_LIB.test(norm)) continue
      if (/^[\W_]+$/.test(norm)) continue
      out.push({ n: n + 1, text: norm })
    }
  }
  return out
}

const STRING_RES = [/"((?:[^"\\\n]|\\.){40,}?)"/g, /'((?:[^'\\\n]|\\.){40,}?)'/g, /`((?:[^`\\\n$]|\\.){40,}?)`/g, />([^<>{}\n]{40,})</g]
function* strings(text) {
  for (const re of STRING_RES) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text))) {
      const s = m[1].replace(/\s+/g, ' ').trim()
      if (s.length >= MIN_STRING && /\s\S+\s/.test(s) && !/^[\w./:@#?&=%+,-]+$/.test(s) && !/(^|\s)(function|return|const|var)\s*\(?/.test(s.slice(0, 20))) yield s
    }
  }
}
const CLASS_RES_CSS = /\.(-?[_a-zA-Z][\w-]{4,})(?![\w-]*\()/g
function classTokens(file, text) {
  const set = new Set()
  if (extname(file) === '.css') { for (const m of text.matchAll(CLASS_RES_CSS)) set.add(m[1]) }
  for (const m of text.matchAll(/class(?:Name)?\s*[=:]\s*(?:\{?\s*)?["'`]([^"'`\n]{3,300})["'`]/g)) for (const token of m[1].split(/\s+/)) if (/^-?[_a-zA-Z][\w-]{4,}$/.test(token)) set.add(token)
  return set
}
const VAR_RE = /--[a-zA-Z][\w-]{3,}/g
const SQL_CTX = /(?:CREATE TABLE(?: IF NOT EXISTS)?|INSERT (?:OR \w+ )?INTO|\bFROM|\bJOIN|\bUPDATE)\s+["`\[]?([a-z_][a-z0-9_]*)/gi

// ───────── lado próprio ─────────
const own = { files: [], lineSet: new Set(), windows: new Map(), strings: new Map(), classes: new Map(), vars: new Map(), sqlNames: new Map(), words: new Map(), hashes: new Map(), text: new Map() }
const addTo = (map, key, value) => { const list = map.get(key); if (list) { if (list.length < 5) list.push(value) } else map.set(key, [value]) }
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')

function indexOwn() {
  for (const base of OWN_ROOTS) {
    const full = join(ROOT, base)
    if (!existsSync(full)) continue
    const files = statSync(full).isDirectory() ? [...walk(full, OWN_SKIP_DIRS)] : [full]
    for (const file of files) {
      const name = rel(file), ext = extname(file).toLowerCase()
      if (name === 'package-lock.json') continue
      const size = statSync(file).size
      if (size === 0 || size > MAX_FILE) continue
      const isMedia = MEDIA_EXT.has(ext) || name.startsWith('build/')
      if (isMedia && size >= 64) own.hashes.set(sha256(readFileSync(file)), { file: name, size })
      if (!OWN_TEXT_EXT.has(ext)) continue
      const text = readFileSync(file, 'utf8')
      own.files.push(name)
      const lines = keptLines(text)
      const keys = lines.map(l => lineKey(l.text))
      keys.forEach(k => own.lineSet.add(k))
      for (let i = 0; i + WINDOW <= lines.length; i++) addTo(own.windows, windowKey(keys, i), { file: name, line: lines[i].n, snippet: lines.slice(i, i + 3).map(l => l.text.slice(0, 110)) })
      for (const s of strings(text)) addTo(own.strings, lineKey(s), { file: name, text: s })
      for (const c of classTokens(name, text)) addTo(own.classes, c, name)
      for (const m of text.matchAll(VAR_RE)) addTo(own.vars, m[0], name)
      for (const m of text.matchAll(SQL_CTX)) addTo(own.sqlNames, m[1].toLowerCase(), name)
      for (const m of text.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)) addTo(own.words, m[0], name)
    }
    guard()
  }
}

// ───────── acervo ─────────
function loadSchemaTables() {
  const file = join(ACERVO, 'remote-public/analysis/sqlite-current-schema.json')
  try { return new Set(JSON.parse(readFileSync(file, 'utf8')).tables.map(t => t.name.toLowerCase())) } catch { return new Set() }
}

function scanAcervo() {
  const stats = { acervoFiles: 0, acervoTextFiles: 0, acervoBytes: 0, skippedBig: 0 }
  const acervoHashes = new Map()
  const codeHits = [] // {acervo, aLine, own, oLine, snippet}
  const stringHits = new Map(), classHits = new Map(), varHits = new Map(), wordHits = new Map()
  const seenFiles = new Set() // evita contar o mesmo arquivo duas vezes (cópias idênticas em archive/extracted)
  const tables = loadSchemaTables()
  for (const base of ACERVO_ROOTS) {
    for (const file of walk(join(ACERVO, base))) {
      const name = relative(ACERVO, file).split(sep).join('/'), ext = extname(file).toLowerCase()
      let size
      try { size = statSync(file).size } catch { continue }
      stats.acervoFiles++
      if (size > MAX_FILE) { stats.skippedBig++; continue }
      const isMedia = MEDIA_EXT.has(ext), isText = ACERVO_TEXT_EXT.has(ext)
      if (!isMedia && !isText) continue
      const buffer = readFileSync(file)
      stats.acervoBytes += size
      if (size >= 64) { const h = sha256(buffer); if (own.hashes.has(h)) addTo(acervoHashes, h, name); if (seenFiles.has(h) && isText) continue; seenFiles.add(h) }
      if (!isText) continue
      stats.acervoTextFiles++
      const text = buffer.toString('utf8')
      const lines = keptLines(text)
      const keys = lines.map(l => lineKey(l.text))
      for (let i = 0; i + WINDOW <= lines.length; i++) {
        if (!own.lineSet.has(keys[i])) continue
        const hit = own.windows.get(windowKey(keys, i))
        if (hit) for (const h of hit.slice(0, 2)) codeHits.push({ acervo: name, aLine: lines[i].n, own: h.file, oLine: h.line, snippet: h.snippet })
      }
      for (const s of strings(text)) { const h = own.strings.get(lineKey(s)); if (h && h[0].text === s) addTo(stringHits, s, { own: h[0].file, acervo: name }) }
      for (const c of classTokens(name, text)) if (own.classes.has(c)) addTo(classHits, c, { own: own.classes.get(c)[0], acervo: name })
      for (const m of text.matchAll(VAR_RE)) if (own.vars.has(m[0])) addTo(varHits, m[0], { own: own.vars.get(m[0])[0], acervo: name })
      if (/sqlite|\.sql|schema|migration/i.test(name) || tables.size) for (const word of new Set(text.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? [])) if (tables.has(word) && own.words.has(word)) addTo(wordHits, word, { own: own.words.get(word)[0], acervo: name })
      guard()
    }
  }
  return { stats, acervoHashes, codeHits, stringHits, classHits, varHits, wordHits, tables }
}

// ───────── pós-processamento ─────────
function regions(hits) {
  // junta janelas consecutivas (mesmo par de arquivos, linhas crescentes) em regiões e mede a extensão
  const byPair = new Map()
  for (const h of hits) { const key = `${h.acervo}\u0000${h.own}`; if (!byPair.has(key)) byPair.set(key, []); byPair.get(key).push(h) }
  const out = []
  for (const list of byPair.values()) {
    list.sort((a, b) => a.oLine - b.oLine || a.aLine - b.aLine)
    let cur = null
    for (const h of list) {
      if (cur && h.oLine - cur.oEnd <= 12 && h.oLine >= cur.oEnd - WINDOW) { cur.oEnd = Math.max(cur.oEnd, h.oLine); cur.windows++ }
      else { if (cur) out.push(cur); cur = { ...h, oEnd: h.oLine, windows: 1 } }
    }
    if (cur) out.push(cur)
  }
  return out
}
const LIB_CLASS = /^(ProseMirror|bn-|mantine-|katex|cm-|hljs|react-|tippy|lucide|mermaid|shiki|tiptap|ql-|rdp|emoji-mart|fa-|icon-)/i
const GENERIC_VAR = /^--(bn|mantine|tw|radix|rdp|emoji)-/
const inNodeModules = p => p.includes('/node_modules/')

function classify(report) {
  const { codeHits, stringHits, classHits, varHits, wordHits, acervoHashes } = report
  const regs = regions(codeHits).map(r => ({ ...r, lines: r.oEnd - r.oLine + WINDOW, lib: inNodeModules(r.acervo) })).sort((a, b) => b.lines - a.lines)
  const review = []
  const coincidence = []
  for (const r of regs) (r.lib ? coincidence : review).push(r)
  const strings = [...stringHits].map(([text, v]) => ({ text, own: v[0].own, acervo: v[0].acervo, lib: v.every(x => inNodeModules(x.acervo)) }))
  const classes = [...classHits].map(([name, v]) => ({ name, own: v[0].own, acervo: v[0].acervo, lib: LIB_CLASS.test(name) || v.every(x => inNodeModules(x.acervo)) }))
  const vars = [...varHits].map(([name, v]) => ({ name, own: v[0].own, acervo: v[0].acervo, lib: GENERIC_VAR.test(name) || v.every(x => inNodeModules(x.acervo)) }))
  const words = [...wordHits].map(([name, v]) => ({ name, own: v[0].own, acervo: v[0].acervo }))
  const media = [...acervoHashes].map(([h, v]) => ({ own: own.hashes.get(h).file, size: own.hashes.get(h).size, acervo: v[0], copies: v.length }))
  return { regs, review, coincidence, strings, classes, vars, words, media }
}

const trunc = (text, n = 110) => text.length > n ? `${text.slice(0, n - 1)}…` : text
function table(rows, header) { return rows.length ? `${header}\n${rows.join('\n')}\n` : '_nenhuma_\n' }
const SPECIFIC = name => /_/.test(name) && name.length >= 8

function render(report, c, ownBundle) {
  const { stats } = report
  const date = new Date().toISOString().slice(0, 10)
  const strictStrings = c.strings.filter(s => !s.lib), strictClasses = c.classes.filter(s => !s.lib), strictVars = c.vars.filter(s => !s.lib)
  const specificTables = c.words.filter(w => SPECIFIC(w.name))
  const lines = []
  lines.push(`# Auditoria de similaridade com o acervo do Export Bundle (${date})`)
  lines.push('')
  lines.push(COMPAT.record021)
  lines.push('')
  lines.push('## Método')
  lines.push('')
  lines.push(`- **Lado próprio:** \`${OWN_ROOTS.join('`, `')}\` (sem \`node_modules\`, \`dist\`, \`release\`, \`docs\`) — ${own.files.length} arquivos de texto, ${own.hashes.size} arquivos de mídia/binários com hash.`)
  lines.push(`- **Acervo (fora do repositório, somente leitura):** pastas \`${ACERVO_ROOTS.join('`, `')}\` do acervo externo (padrão \`../reference-source-acervo-privado\`, parâmetro \`--acervo=\`); os caminhos do acervo abaixo são relativos a ele. Leitura do acervo externo: ${stats.acervoFiles} arquivos, ${stats.acervoTextFiles} de texto lidos (.js/.css/.html/.json), ${(stats.acervoBytes / 1048576).toFixed(0)} MB lidos; ${stats.skippedBig} acima de 120 MB ignorados. Cópias byte a byte do mesmo arquivo de texto (por exemplo \`archive\` e \`extracted\`) são lidas uma vez.`)
  lines.push(`- **(a) Mídia:** SHA-256 de cada ícone, imagem, fonte, áudio, PDF, \`.node\`/\`.wasm\` e de tudo em \`build/\` do lado próprio contra todo arquivo de mídia do acervo (≥ 64 bytes).`)
  lines.push(`- **(b) Código:** janelas de **${WINDOW} linhas não triviais consecutivas** (espaços normalizados; descartadas linhas com menos de ${MIN_LINE} caracteres, comentários, \`import\`/\`export … from\` e linhas que citam bibliotecas comuns como react, lucide, electron e módulos \`node:\`). Cada janela vira um hash; o índice é o do lado próprio, e o acervo é lido em fluxo, arquivo por arquivo. Código minificado (linhas > 300 caracteres) é fatiado em \`;\`, \`{\` e \`}\`. Janelas adjacentes viram uma "região".`)
  lines.push(`- **(c) Identificadores e textos:** nomes de classes CSS (arquivos .css e atributos class/className), variáveis CSS \`--*\`, nomes de tabelas do esquema SQLite extraído (\`remote-public/analysis/sqlite-current-schema.json\` do acervo: ${report.tables.size} tabelas) que aparecem como palavra no nosso código, e textos de interface com ≥ ${MIN_STRING} caracteres idênticos nos dois lados.`)
  lines.push('')
  lines.push('## Limites')
  lines.push('')
  lines.push('- **O scan não prova ausência de cópia.** Só encontra trechos **idênticos depois de normalizar espaços**. Código renomeado, reordenado, reformatado em outra estrutura, traduzido (TypeScript x JavaScript compilado/minificado) ou reescrito a partir do comportamento não aparece. O código próprio é TypeScript/JSX; o acervo é JavaScript compilado e minificado, o que reduz muito a chance de coincidência literal mesmo havendo cópia conceitual.')
  lines.push('- Não analisa binários além do hash (imagens parecidas mas não idênticas, ou o mesmo desenho reexportado, passam).')
  lines.push('- Textos curtos, termos de interface comuns e nomes de classes genéricos geram coincidências legítimas; por isso há a separação entre "provável coincidência" e "merece revisão".')
  lines.push('- Cobertura limitada às extensões e pastas citadas acima. A parte de fluxo, aparência e estrutura de produto (trade dress) é tratada no item 2 do parecer e não é medida aqui.')
  lines.push('')
  lines.push('## Contagens')
  lines.push('')
  lines.push('| Verificação | Resultado |')
  lines.push('|---|---|')
  lines.push(`| (a) Arquivos de mídia próprios idênticos (SHA-256) a um do acervo | **${c.media.length}** |`)
  lines.push(`| (b) Regiões de código idênticas (≥ ${WINDOW} linhas) — no total | **${c.regs.length}** (${report.codeHits.length} janelas) |`)
  lines.push(`| (b) …em arquivos de \`node_modules\` do acervo (bibliotecas de terceiros) | ${c.coincidence.length} |`)
  lines.push(`| (b) …em código do próprio Export Bundle (fora de \`node_modules\`) | **${c.review.length}** |`)
  lines.push(`| (c) Textos de interface ≥ ${MIN_STRING} caracteres idênticos | ${c.strings.length} (fora de bibliotecas: **${strictStrings.length}**) |`)
  lines.push(`| (c) Classes CSS em comum | ${c.classes.length} (fora de prefixos de bibliotecas: **${strictClasses.length}**) |`)
  lines.push(`| (c) Variáveis CSS \`--*\` em comum | ${c.vars.length} (fora de prefixos de bibliotecas: **${strictVars.length}**) |`)
  lines.push(`| (c) Nomes de tabela do esquema SQLite do Export Bundle que aparecem no nosso código | ${c.words.length} (com \`_\` e ≥ 8 caracteres: **${specificTables.length}**) |`)
  lines.push(`| (c) Identificadores \`bundle-*\`/\`--bundle-*\` no código próprio | **${ownBundle.length}** |`)
  lines.push('')
  lines.push('## Ocorrências')
  lines.push('')
  lines.push('### (a) Mídia idêntica')
  lines.push('')
  lines.push(table(c.media.slice(0, 30).map(m => `| \`${m.own}\` | ${m.size} B | \`${m.acervo}\` (${m.copies} cópia(s)) |`), '| Nosso arquivo | Tamanho | Acervo |\n|---|---|---|'))
  lines.push('### (b) Código idêntico — merece revisão (fora de `node_modules` do acervo)')
  lines.push('')
  lines.push(table(c.review.slice(0, 40).map(r => `| \`${r.own}:${r.oLine}\` (${r.lines} linhas) | \`${r.acervo}:${r.aLine}\` | \`${trunc(r.snippet.join(' ⏎ '), 200).replace(/\|/g, '\\|')}\` |`), '| Nosso trecho | Acervo | Início do trecho (nosso, ≤ 3 linhas) |\n|---|---|---|'))
  lines.push('### (b) Código idêntico — provável coincidência (biblioteca de terceiros no acervo)')
  lines.push('')
  lines.push(table(c.coincidence.slice(0, 25).map(r => `| \`${r.own}:${r.oLine}\` (${r.lines} linhas) | \`${r.acervo}:${r.aLine}\` | \`${trunc(r.snippet[0], 100).replace(/\|/g, '\\|')}\` |`), '| Nosso trecho | Acervo | Primeira linha |\n|---|---|---|') + (c.coincidence.length > 25 ? `\n_(mostradas 25 de ${c.coincidence.length})_\n` : ''))
  lines.push('### (c) Textos de interface idênticos (≥ 40 caracteres)')
  lines.push('')
  lines.push(table(strictStrings.slice(0, 40).map(s => `| \`${s.own}\` | \`${s.acervo}\` | “${trunc(s.text, 90).replace(/\|/g, '\\|')}” |`), '| Nosso arquivo | Acervo | Texto (truncado) |\n|---|---|---|') + (strictStrings.length > 40 ? `\n_(mostrados 40 de ${strictStrings.length})_\n` : ''))
  lines.push('### (c) Classes CSS e variáveis em comum (fora de prefixos de bibliotecas)')
  lines.push('')
  lines.push(table([...strictClasses.slice(0, 50).map(s => `| classe | \`${s.name}\` | \`${s.own}\` | \`${s.acervo}\` |`), ...strictVars.slice(0, 50).map(s => `| variável | \`${s.name}\` | \`${s.own}\` | \`${s.acervo}\` |`)], '| Tipo | Nome | Nosso arquivo | Acervo |\n|---|---|---|---|'))
  lines.push("### (c) Tabelas do esquema SQLite do Export Bundle citadas no nosso código")
  lines.push('')
  lines.push(`Nomes com \`_\` e ≥ 8 caracteres (mais distintivos): ${specificTables.length ? specificTables.slice(0, 40).map(w => `\`${w.name}\` (${w.own})`).join(', ') : '_nenhum_'}.`)
  lines.push('')
  lines.push(`Demais nomes (genéricos): ${c.words.filter(w => !SPECIFIC(w.name)).slice(0, 40).map(w => `\`${w.name}\``).join(', ') || '_nenhum_'}.`)
  lines.push('')
  lines.push(COMPAT.record022)
  lines.push('')
  lines.push(ownBundle.length ? ownBundle.slice(0, 40).map(o => `- \`${o.token}\` em \`${o.file}\``).join('\n') : '_nenhum_')
  lines.push('')
  lines.push(MARKER)
  return lines.join('\n') + '\n'
}

function ownBundleTokens() {
  const found = new Map()
  for (const name of own.files) {
    const text = readFileSync(join(ROOT, name), 'utf8')
    for (const m of text.matchAll(/(?:--)?bundle-[\w-]+/gi)) if (!found.has(m[0].toLowerCase())) found.set(m[0].toLowerCase(), name)
  }
  return [...found].map(([token, file]) => ({ token, file }))
}

const started = Date.now()
indexOwn()
if (!existsSync(ACERVO)) { console.error(`Acervo não encontrado: ${ACERVO}`); process.exit(1) }
const report = scanAcervo()
const classified = classify(report)
const ownBundle = ownBundleTokens()
let body = render(report, classified, ownBundle)
if (WRITE) {
  let manual = ''
  if (existsSync(REPORT)) { const old = readFileSync(REPORT, 'utf8'), at = old.indexOf(MARKER); if (at >= 0) manual = old.slice(at + MARKER.length) }
  mkdirSync(join(ROOT, '.artifacts'), { recursive: true })
  writeFileSync(REPORT, body + manual.replace(/^\n/, ''))
}
console.log(JSON.stringify({
  seconds: Math.round((Date.now() - started) / 1000), rssMB: Math.round(process.memoryUsage().rss / 1048576), ownFiles: own.files.length, ...report.stats,
  media: classified.media.length, codeRegions: classified.regs.length, codeReview: classified.review.length, codeLib: classified.coincidence.length,
  strings: classified.strings.length, stringsStrict: classified.strings.filter(s => !s.lib).length, classes: classified.classes.length, classesStrict: classified.classes.filter(s => !s.lib).length,
  vars: classified.vars.length, varsStrict: classified.vars.filter(s => !s.lib).length, tableWords: classified.words.length, ownBundle: ownBundle.length,
}, null, 1))
