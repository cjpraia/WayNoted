import PRODUCT from '../shared/product.json' with { type: 'json' }
// Varredura de licenças das dependências que entram no app (bundle do Vite + processo principal do Electron).
//
// Uso:
//   node scripts/license-scan.mjs            # lista e falha (exit 1) se houver licença incompatível com venda fechada
//   node scripts/license-scan.mjs --notices  # também (re)gera THIRD-PARTY-NOTICES.md na raiz
//   node scripts/license-scan.mjs --json     # saída em JSON (para outros scripts)
//   node scripts/license-scan.mjs --all      # também lista as ferramentas de desenvolvimento (não afetam o exit code)
//
// Como decide o que "vai para o app": lê os imports de src/, electron/ e dos HTML de entrada, resolve cada pacote em
// node_modules e segue `dependencies`/`optionalDependencies` (fecho transitivo). O resto de node_modules
// (vite, typescript, electron-packager, jsdom…) é só ferramenta de build/teste e fica fora do aviso de terceiros.
//
// Falha (exit 1): GPL/AGPL/SSPL, SEE LICENSE IN…, UNLICENSED, PROPRIETARY/comercial ou pacote sem licença declarada.
// Aviso (exit 0): LGPL, MPL/EPL/CDDL (copyleft fraco: manter aviso e fonte dos arquivos modificados), licença não reconhecida.
// Exceções revisadas por pessoa ficam em scripts/license-allowlist.json (nome, versão, licença, motivo).
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, realpathSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))

const PERMISSIVE = new Set(['MIT', 'MIT-0', 'ISC', 'BSD', 'BSD-2-CLAUSE', 'BSD-3-CLAUSE', 'BSD-3-CLAUSE-CLEAR', '0BSD', 'APACHE-2.0', 'APACHE 2.0', 'UNLICENSE', 'CC0-1.0', 'BLUEOAK-1.0.0', 'ZLIB', 'PYTHON-2.0', 'OFL-1.1', 'CC-BY-3.0', 'CC-BY-4.0', 'WTFPL', 'W3C', 'W3C-20150513', 'UNICODE-3.0', 'UNICODE-DFS-2016', 'PUBLIC DOMAIN', 'MIT*', 'AFL-2.1', 'X11', 'BSL-1.0'])
const WEAK = new Set(['MPL-2.0', 'MPL-1.1', 'EPL-1.0', 'EPL-2.0', 'CDDL-1.0', 'CDDL-1.1', 'CPL-1.0'])
/** Pacotes cujas dependências são só do instalador (o app leva o próprio pacote, não elas). */
const LEAF = new Set(['electron'])
const LEVEL = { permissive: 0, weak: 1, unknown: 2, lgpl: 3, forbidden: 4 }

/** Classifica uma expressão SPDX: OR = a melhor alternativa; AND = a pior parte. */
export function classify(expression) {
  const text = String(expression ?? '').trim()
  if (!text) return 'forbidden'
  if (/^SEE LICENSE|UNLICENSED|PROPRIETARY|COMMERCIAL|^CUSTOM/i.test(text) && !/ OR /i.test(text)) return 'forbidden'
  const alternatives = text.replace(/[()]/g, ' ').split(/\s+OR\s+/i)
  let best = 'forbidden'
  for (const alternative of alternatives) {
    let worst = 'permissive'
    for (const part of alternative.split(/\s+AND\s+/i)) {
      const id = part.trim().replace(/\+$/, '').replace(/-or-later$|-only$/i, '').toUpperCase()
      let kind
      if (PERMISSIVE.has(id)) kind = 'permissive'
      else if (WEAK.has(id)) kind = 'weak'
      else if (/^LGPL/.test(id)) kind = 'lgpl'
      else if (/^(A?GPL|SSPL|EUPL|OSL|CC-BY-NC|CC-BY-SA|CC-BY-ND)/.test(id)) kind = 'forbidden'
      else if (/^(UNLICENSED|PROPRIETARY|SEE LICENSE|COMMERCIAL|NONE)/.test(id)) kind = 'forbidden'
      else if (/^BSD|^APACHE|^MIT\b/.test(id)) kind = 'permissive'
      else kind = 'unknown'
      if (LEVEL[kind] > LEVEL[worst]) worst = kind
    }
    if (LEVEL[worst] < LEVEL[best]) best = worst
  }
  return best
}

/** Texto de licença → identificador provável (quando o package.json não declara). */
function sniff(text) {
  const t = text.slice(0, 4000)
  if (/Apache License[\s\S]{0,80}Version 2\.0/i.test(t)) return 'Apache-2.0'
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(t)) return 'AGPL-3.0'
  if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(t)) return 'LGPL-3.0'
  if (/GNU GENERAL PUBLIC LICENSE/i.test(t)) return 'GPL-3.0'
  if (/Mozilla Public License[\s\S]{0,40}2\.0/i.test(t)) return 'MPL-2.0'
  if (/SIL OPEN FONT LICENSE/i.test(t)) return 'OFL-1.1'
  if (/Permission is hereby granted, free of charge/i.test(t)) return 'MIT'
  if (/Permission to use, copy, modify, and\/or distribute this software/i.test(t)) return 'ISC'
  if (/Redistribution and use in source and binary forms/i.test(t)) return /Neither the name|endorse or promote/i.test(t) ? 'BSD-3-Clause' : 'BSD-2-Clause'
  if (/This is free and unencumbered software released into the public domain/i.test(t)) return 'Unlicense'
  return null
}

function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null } }

function declaredLicense(pkg) {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type
  if (Array.isArray(pkg.licenses) && pkg.licenses.length) return pkg.licenses.map((l) => (typeof l === 'string' ? l : l.type)).filter(Boolean).join(' OR ')
  if (pkg.licenses && typeof pkg.licenses.type === 'string') return pkg.licenses.type
  return ''
}

const LICENSE_FILE = /^(licen[sc]e|copying|unlicense)([-._].*)?(\.(md|txt|markdown))?$/i
function licenseFiles(dir) {
  try { return readdirSync(dir).filter((name) => LICENSE_FILE.test(name) && statSync(join(dir, name)).isFile()).sort() } catch { return [] }
}

/** Procura `name` subindo a partir de `from` (algoritmo de resolução do Node). */
function resolvePackageDir(name, from) {
  let dir = from
  for (;;) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

const bareName = (specifier) => {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:') || /^[a-z]+:/i.test(specifier)) return null
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|css|html)$/
function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (SOURCE_EXT.test(entry.name)) out.push(full)
  }
  return out
}

const IMPORT_RE = [
  /\bfrom\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  /@import\s+(?:url\()?['"]([^'"\n]+)['"]/g,
]

function importedPackages() {
  const names = new Set()
  const roots = [join(ROOT, 'src'), join(ROOT, 'electron'), ...['index.html', 'quick.html'].map((f) => join(ROOT, f))]
  for (const root of roots) {
    const files = existsSync(root) && statSync(root).isDirectory() ? walk(root) : existsSync(root) ? [root] : []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const re of IMPORT_RE) for (const match of source.matchAll(re)) { const name = bareName(match[1]); if (name) names.add(name) }
      // Arquivos referenciados por caminho (ex.: fontes em url('../../node_modules/<pacote>/files/…')).
      for (const match of source.matchAll(/node_modules\/((?:@[\w.-]+\/)?[\w.-]+)\//g)) names.add(match[1])
    }
  }
  return names
}

function describe(dir) {
  const pkg = readJson(join(dir, 'package.json'))
  if (!pkg) return null
  let license = declaredLicense(pkg)
  let source = 'package.json'
  const files = licenseFiles(dir)
  if (!license || /^SEE LICENSE/i.test(license)) {
    for (const file of files) {
      const guess = sniff(readFileSync(join(dir, file), 'utf8'))
      if (guess) { license = license ? `${guess} (${license})` : guess; source = file; break }
    }
  }
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? pkg.homepage ?? ''
  return { name: pkg.name, version: pkg.version ?? '', license: license || '', source, dir, files, repository: String(repo).replace(/^git\+/, '').replace(/\.git$/, ''), deps: { ...pkg.dependencies, ...pkg.optionalDependencies }, private: !!pkg.private }
}

export function scan() {
  const rootPkg = readJson(join(ROOT, 'package.json'))
  const allowlist = readJson(join(ROOT, 'scripts/license-allowlist.json')) ?? []
  const direct = new Set(Object.keys({ ...rootPkg.dependencies, ...rootPkg.devDependencies }))
  const imported = importedPackages()
  const seeds = [...imported].filter((name) => direct.has(name) || resolvePackageDir(name, ROOT))
  const bundle = new Map()
  const queue = seeds.map((name) => ({ name, from: ROOT }))
  while (queue.length) {
    const { name, from } = queue.pop()
    const dir = resolvePackageDir(name, from)
    if (!dir) continue
    const info = describe(dir)
    if (!info) continue
    const key = `${info.name}@${info.version}`
    if (bundle.has(key)) continue
    bundle.set(key, info)
    if (!LEAF.has(info.name)) for (const dep of Object.keys(info.deps)) queue.push({ name: dep, from: dir })
  }
  // Todo o resto de node_modules: ferramentas de build e de teste.
  const tools = new Map()
  const nm = join(ROOT, 'node_modules')
  const topLevel = []
  for (const entry of readdirSync(nm)) {
    if (entry.startsWith('.')) continue
    if (entry.startsWith('@')) for (const sub of readdirSync(join(nm, entry))) topLevel.push(`${entry}/${sub}`)
    else topLevel.push(entry)
  }
  for (const name of topLevel) {
    const info = describe(join(nm, name))
    if (info && !bundle.has(`${info.name}@${info.version}`)) tools.set(`${info.name}@${info.version}`, info)
  }
  const judge = (info) => {
    const exception = allowlist.find((item) => item.name === info.name && (!item.version || item.version === info.version))
    const kind = exception ? classify(exception.license) : classify(info.license)
    return { ...info, kind, exception: exception ?? null }
  }
  return { bundle: [...bundle.values()].map(judge).sort((a, b) => a.name.localeCompare(b.name)), tools: [...tools.values()].map(judge).sort((a, b) => a.name.localeCompare(b.name)), imported: [...imported].sort() }
}

function noticesMarkdown(bundle) {
  const lines = [
    '# Third-party notices', '',
    'This file is **generated** by `node scripts/license-scan.mjs --notices`; do not edit it by hand.', '',
    `The ${PRODUCT.name} app bundles the open-source components listed below, each under its own license and copyright.`,
    'MPL-2.0 components (BlockNote) are used unmodified; their source code is available from the repositories listed.', '',
    `Packages: ${bundle.length}`, '', '| Package | Version | License | Source |', '| --- | --- | --- | --- |',
  ]
  for (const info of bundle) lines.push(`| ${info.name} | ${info.version} | ${(info.exception?.license ?? info.license).replace(/\|/g, '/')} | ${info.repository || '-'} |`)
  lines.push('', '## License texts', '')
  for (const info of bundle) {
    const file = info.files[0]
    lines.push(`### ${info.name} ${info.version} — ${info.exception?.license ?? info.license}`, '')
    if (file) lines.push('```text', readFileSync(join(info.dir, file), 'utf8').replace(/\r\n/g, '\n').trim(), '```', '')
    else lines.push(`(no license file in package; declared license: ${info.license || 'none'})`, '')
  }
  return lines.join('\n') + '\n'
}

function main() {
  const { bundle, tools, imported } = scan()
  const failures = bundle.filter((info) => info.kind === 'forbidden')
  const warnings = bundle.filter((info) => ['lgpl', 'unknown', 'weak'].includes(info.kind))
  if (args.has('--json')) {
    console.log(JSON.stringify({ bundle: bundle.map(({ name, version, license, kind, exception }) => ({ name, version, license, kind, exception })), failures: failures.map((i) => `${i.name}@${i.version}`), warnings: warnings.map((i) => `${i.name}@${i.version}`) }, null, 2))
  } else {
    const byLicense = new Map()
    for (const info of bundle) byLicense.set(info.license || '(nenhuma)', (byLicense.get(info.license || '(nenhuma)') ?? 0) + 1)
    console.log(`Pacotes que entram no app: ${bundle.length} (a partir de ${imported.length} imports diretos); ferramentas de build/teste: ${tools.length}`)
    console.log('\nLicenças no app:')
    for (const [license, count] of [...byLicense].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(4)}  ${license}`)
    const show = (title, list) => { if (!list.length) return; console.log(`\n${title}`); for (const info of list) console.log(`  - ${info.name}@${info.version}: ${info.license || '(sem licença)'}${info.exception ? ` [exceção revisada: ${info.exception.license} — ${info.exception.reason}]` : ''}`) }
    show('AVISO — copyleft fraco / LGPL / licença não reconhecida (revisar):', warnings)
    show('FALHA — licença incompatível com distribuição fechada:', failures)
    if (args.has('--all')) {
      const toolIssues = tools.filter((info) => info.kind !== 'permissive')
      show('Ferramentas de build/teste fora do app com licença não permissiva (informativo):', toolIssues)
    }
  }
  if (args.has('--notices')) {
    writeFileSync(join(ROOT, 'THIRD-PARTY-NOTICES.md'), noticesMarkdown(bundle))
    if (!args.has('--json')) console.log(`\nTHIRD-PARTY-NOTICES.md atualizado (${bundle.length} pacotes).`)
  }
  if (failures.length) { if (!args.has('--json')) console.error(`\n${failures.length} pacote(s) com licença incompatível.`); process.exitCode = 1 }
  else if (!args.has('--json')) console.log('\nOK: nenhuma licença incompatível entre os pacotes que entram no app.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
