const PRODUCT = require('../shared/product.json')
const COMPAT = require('../shared/compatibility.cjs')
// Espelho Markdown contínuo, somente leitura e opt-in (docs/DEVELOPMENT.md D1).
// ATENÇÃO: grava o conteúdo em TEXTO CLARO numa pasta escolhida pelo usuário, sem criptografia.
// Este módulo é o lado nativo: valida a pasta, grava de forma atômica só o que mudou, move para
// `_removidas/` o que saiu do espaço e guarda o estado (hashes) FORA da pasta espelhada. Nunca lê o
// conteúdo de volta como dado do aplicativo (sem laços). O Markdown em si é gerado no renderer
// (src/mirror, que reaproveita src/export). Sem Electron aqui: tudo testável.
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createHash, randomUUID } = require('node:crypto')
const { safeRelative } = require('./export.cjs')

const SETTINGS_FILE = 'mirror-settings.json'
const STATE_DIR = 'mirror-state'
const MARKER = COMPAT.record012
const README = 'LEIA-ME.md'
const REMOVED = '_removidas'
const REMOVED_KEEP_MS = 30 * 24 * 3600 * 1000
const FOLDER_NAME = `${PRODUCT.name} Espelho`
const MAX_FILES = 100000
const MAX_TOTAL = 2 * 1024 * 1024 * 1024
const WRITE_CONCURRENCY = 16
const RESERVED_TOP = new Set([REMOVED, README, MARKER])

function mirrorError(code, pt, en, cause) {
  const error = new Error(`${code}: ${pt} / ${en}`)
  error.code = code
  if (cause) error.cause = cause
  return error
}
const sha256 = data => createHash('sha256').update(data).digest('hex')
const bytesOf = content => typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content)

/* ------------------------------ configuração ------------------------------ */

function defaultDirectory(documents = path.join(os.homedir(), 'Documents')) { return path.join(documents, FOLDER_NAME) }

function normalizeSettings(value, documents) {
  const v = value && typeof value === 'object' ? value : {}
  return {
    enabled: v.enabled === true && v.acknowledgedAt > 0,
    directory: typeof v.directory === 'string' && path.isAbsolute(v.directory) ? path.normalize(v.directory) : defaultDirectory(documents),
    acknowledgedAt: Number(v.acknowledgedAt) > 0 ? Number(v.acknowledgedAt) : 0,
    vaultAcknowledged: v.vaultAcknowledged === true,
  }
}
async function readSettings(userData, documents) {
  let value = null
  try { value = JSON.parse(await fs.readFile(path.join(userData, SETTINGS_FILE), 'utf8')) } catch { /* padrão: desligado */ }
  return normalizeSettings(value, documents)
}

async function realpathLoose(target) {
  // Resolve links simbólicos do trecho que já existe; o resto é anexado como está.
  const rest = []
  let current = path.resolve(target)
  for (;;) {
    try { return path.join(await fs.realpath(current), ...rest.reverse()) } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
      const parent = path.dirname(current)
      if (parent === current) return path.join(current, ...rest.reverse())
      rest.push(path.basename(current)); current = parent
    }
  }
}
const inside = (parent, child) => { const rel = path.relative(parent, child); return !rel || (!rel.startsWith('..') && !path.isAbsolute(rel)) }

/**
 * A pasta do espelho não pode ficar dentro dos dados do aplicativo (data/, workspaces/, Backups…), dentro da
 * pasta de backups, nem conter qualquer uma delas; também não pode ser a raiz do disco nem a pasta pessoal.
 */
async function assertMirrorDirectory(directory, { userData, backupDirectory, home = os.homedir() }) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\0')) throw mirrorError('MIRROR_BAD_DIR', 'Escolha uma pasta válida.', 'Choose a valid folder.')
  const target = await realpathLoose(directory)
  const forbidden = [[await realpathLoose(userData), `dados do ${PRODUCT.name}`, `${PRODUCT.name} data`]]
  if (backupDirectory) forbidden.push([await realpathLoose(backupDirectory), 'backups', 'backups'])
  const homeReal = await realpathLoose(home)
  if (target === path.parse(target).root || target === homeReal || target === path.dirname(homeReal)) throw mirrorError('MIRROR_DIR_TOO_BROAD', 'Escolha uma subpasta (não o disco inteiro nem a pasta pessoal).', 'Choose a subfolder (not the whole disk or your home folder).')
  for (const [forbiddenDir] of forbidden) {
    if (inside(forbiddenDir, target) || inside(target, forbiddenDir)) throw mirrorError('MIRROR_DIR_FORBIDDEN', `Escolha uma pasta fora da pasta de dados e da pasta de backups do ${PRODUCT.name}.`, `Choose a folder outside the ${PRODUCT.name} data folder and the backup folder.`)
  }
  return path.normalize(directory)
}

/** Pasta escolhida já tem outras coisas e não é nossa? Então o espelho vai para uma subpasta "aplicativo Espelho". */
async function resolveRoot(directory) {
  let entries
  try { entries = await fs.readdir(directory) } catch (error) { if (error.code === 'ENOENT') return directory; throw error }
  const meaningful = entries.filter(name => name !== '.DS_Store')
  if (!meaningful.length || meaningful.includes(MARKER) || path.basename(directory) === FOLDER_NAME) return directory
  return path.join(directory, FOLDER_NAME)
}

async function writeSettings(userData, patch, { documents, backupDirectory } = {}) {
  const current = await readSettings(userData, documents)
  const next = { ...current }
  if (typeof patch.directory === 'string') {
    await assertMirrorDirectory(patch.directory, { userData, backupDirectory })
    const root = await resolveRoot(path.normalize(patch.directory))
    await assertMirrorDirectory(root, { userData, backupDirectory })
    next.directory = root
  }
  if ('vaultAcknowledged' in patch) next.vaultAcknowledged = patch.vaultAcknowledged === true
  if ('enabled' in patch) {
    if (patch.enabled === true) {
      // Ligar exige a confirmação explícita do aviso de texto claro (em cada ativação).
      if (patch.acknowledged !== true) throw mirrorError('MIRROR_NEEDS_ACK', 'Confirme que entendeu que o conteúdo será gravado em texto claro.', 'Confirm that you understand your content will be written in clear text.')
      await assertMirrorDirectory(next.directory, { userData, backupDirectory })
      next.enabled = true
      next.acknowledgedAt = Date.now()
    } else next.enabled = false
  }
  await writeFileAtomic(path.join(userData, SETTINGS_FILE), JSON.stringify(next, null, 2))
  return next
}

/* ------------------------------ arquivos ------------------------------ */

async function writeFileAtomic(file, content, { mode = 0o600 } = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await fs.writeFile(tmp, content, { mode })
    await fs.rename(tmp, file)
  } catch (error) { await fs.rm(tmp, { force: true }).catch(() => {}); throw error }
}

const safeId = id => { if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(id))) throw mirrorError('MIRROR_BAD_WORKSPACE', 'Espaço inválido.', 'Invalid workspace.'); return String(id) }
const statePath = (userData, workspaceId) => path.join(userData, STATE_DIR, `${safeId(workspaceId)}.json`)
const emptyState = () => ({ version: 0, globalSig: '', files: {}, pages: {}, readme: '', status: { updatedAt: 0, pages: 0, written: 0, removed: 0, error: null } })
async function readState(userData, workspaceId) {
  try {
    const value = JSON.parse(await fs.readFile(statePath(userData, workspaceId), 'utf8'))
    if (value && typeof value === 'object' && value.files && value.pages) return { ...emptyState(), ...value }
  } catch { /* primeiro uso */ }
  return emptyState()
}
const saveState = (userData, workspaceId, state) => writeFileAtomic(statePath(userData, workspaceId), JSON.stringify(state))

/** Nome da pasta do espaço dentro do espelho: nome legível + id curto (estável mesmo se o espaço for renomeado). */
function workspaceFolder(workspaceId, name) {
  const clean = String(name || `${PRODUCT.name}`).replace(/[\u0000-\u001f\u007f\\/:*?"<>|#%[\]^`{}]+/g, '-').replace(/\s+/g, ' ').replace(/^[.\s-]+|[.\s]+$/g, '').slice(0, 60).trim() || `${PRODUCT.name}`
  return `${clean}--${safeId(workspaceId).slice(0, 8)}`
}

function readmeText(locale) {
  if (locale === 'en-US') return `# ${PRODUCT.name} mirror (read-only)

This folder is a **read-only, automatically generated copy** of your ${PRODUCT.name} pages as Markdown files.

- Do not edit these files: **changes made here never go back to ${PRODUCT.name}** and are overwritten the next time the page changes.
- The files are stored in **clear text, without encryption**. Anyone with access to this folder can read them. Password-protected pages and pages marked "Do not mirror" are never written here.
- Each workspace has its own folder. Pages are folders and \`.md\` files named \`title--id\`; databases come with a \`.csv\` and a \`schema.json\`; images and attachments are in \`assets/\`.
- Pages deleted or moved in ${PRODUCT.name} are moved to \`${REMOVED}/\` (kept for 30 days).
- To stop, turn off Settings > Data > Markdown mirror in ${PRODUCT.name}. The files stay here until you remove them.
`
  return `# Espelho do ${PRODUCT.name} (somente leitura)

Esta pasta é uma **cópia somente leitura, gerada automaticamente**, das suas páginas do ${PRODUCT.name} em arquivos Markdown.

- Não edite estes arquivos: **alterações feitas aqui nunca voltam para o ${PRODUCT.name}** e são sobrescritas na próxima vez que a página mudar.
- Os arquivos ficam em **texto claro, sem criptografia**. Quem tiver acesso a esta pasta consegue ler tudo. Páginas protegidas por senha e páginas marcadas como "Não espelhar" nunca são gravadas aqui.
- Cada espaço tem a sua pasta. Páginas viram pastas e arquivos \`.md\` com nome \`título--id\`; bancos de dados vêm com um \`.csv\` e um \`schema.json\`; imagens e anexos ficam em \`assets/\`.
- Páginas excluídas ou movidas no ${PRODUCT.name} vão para \`${REMOVED}/\` (guardadas por 30 dias).
- Para parar, desligue Configurações > Dados > Espelho Markdown no ${PRODUCT.name}. Os arquivos continuam aqui até você removê-los.
`
}

const stampOf = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const parseStamp = text => { const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(text); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN }

async function exists(file) { try { await fs.access(file); return true } catch { return false } }

async function pruneEmptyDirs(start, stop) {
  let dir = start
  while (dir !== stop && inside(stop, dir)) {
    try { await fs.rmdir(dir) } catch { return } // não vazia ou inexistente
    dir = path.dirname(dir)
  }
}

async function pool(items, size, task) {
  let next = 0, failure = null
  // Ao primeiro erro ninguém começa arquivo novo; quem já está gravando termina (rename atômico) antes de propagar o erro.
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length && !failure) { const item = items[next++]; try { await task(item) } catch (error) { failure ??= error } }
  })
  await Promise.all(workers)
  if (failure) throw failure
}

/**
 * Aplica um lote do renderer.
 * payload: { files: {rel: string|Uint8Array} (só o que mudou), pages: {id:{sig,files:[rel]}} (TODAS as páginas do espelho),
 *            version, globalSig, complete: boolean (todas as páginas foram regeradas), force: boolean, locale }
 * Retorna { written, removed, pages }.
 */
async function applyBatch(o) {
  const { root, userData, workspaceId, workspaceName, payload, now = Date.now(), failAt } = o
  let state = await readState(userData, workspaceId)
  if (state.root && state.root !== root) state = emptyState() // pasta trocada: recomeça (os arquivos da pasta antiga ficam onde estão)
  state.root = root
  // O nome da pasta é fixado na primeira gravação: renomear o espaço não desloca arquivos.
  const wsFolder = state.folder || workspaceFolder(workspaceId, workspaceName)
  const wsDir = path.join(root, wsFolder)
  const files = payload.files && typeof payload.files === 'object' && !Array.isArray(payload.files) ? payload.files : {}
  const pages = payload.pages && typeof payload.pages === 'object' && !Array.isArray(payload.pages) ? payload.pages : null
  if (!pages) throw mirrorError('MIRROR_BAD_PAYLOAD', 'Lote inválido.', 'Invalid batch.')
  const entries = Object.entries(files)
  if (entries.length > MAX_FILES || Object.keys(pages).length > MAX_FILES) throw mirrorError('MIRROR_TOO_MANY', 'Arquivos demais.', 'Too many files.')

  // Valida tudo ANTES de tocar no disco.
  let total = 0
  const plan = entries.map(([rel, content]) => {
    const parts = safeRelative(rel)
    if (!parts || RESERVED_TOP.has(parts[0])) throw mirrorError('MIRROR_BAD_PATH', `Caminho inválido: ${String(rel).slice(0, 80)}`, `Invalid path: ${String(rel).slice(0, 80)}`)
    if (typeof content !== 'string' && !(content instanceof Uint8Array)) throw mirrorError('MIRROR_BAD_PAYLOAD', 'Conteúdo inválido.', 'Invalid content.')
    const data = bytesOf(content)
    total += data.length
    const file = path.join(wsDir, ...parts)
    if (!inside(wsDir, file) || file === wsDir) throw mirrorError('MIRROR_BAD_PATH', 'Caminho fora da pasta do espelho.', 'Path outside the mirror folder.')
    return { rel, file, data, hash: sha256(data) }
  })
  if (total > MAX_TOTAL) throw mirrorError('MIRROR_TOO_BIG', 'Lote maior que 2 GB.', 'Batch larger than 2 GB.')
  const claimed = new Set(entries.map(([rel]) => rel))
  const cleanPages = {}
  for (const [id, info] of Object.entries(pages)) {
    if (!info || typeof info.sig !== 'string' || !Array.isArray(info.files)) throw mirrorError('MIRROR_BAD_PAYLOAD', 'Lote inválido.', 'Invalid batch.')
    for (const rel of info.files) { const parts = safeRelative(rel); if (!parts || RESERVED_TOP.has(parts[0])) throw mirrorError('MIRROR_BAD_PATH', 'Caminho inválido.', 'Invalid path.'); claimed.add(rel) }
    cleanPages[id] = { sig: info.sig, files: info.files.slice() }
  }

  await fs.mkdir(wsDir, { recursive: true })
  // Marca a pasta como nossa e deixa o LEIA-ME.
  const markerFile = path.join(root, MARKER)
  if (!(await exists(markerFile))) await writeFileAtomic(markerFile, JSON.stringify({ format: "workspace-mirror", createdAt: now }), { mode: 0o644 })
  const readme = readmeText(payload.locale)
  if (state.readme !== sha256(readme) || !(await exists(path.join(root, README)))) { await writeFileAtomic(path.join(root, README), readme, { mode: 0o644 }); state.readme = sha256(readme) }

  // 1) Grava só o que mudou (hash igual e arquivo presente = nada a fazer).
  let written = 0, step = 0
  await pool(plan, WRITE_CONCURRENCY, async item => {
    failAt?.('write', step++)
    if (!payload.force && state.files[item.rel] === item.hash && await exists(item.file)) return
    await writeFileAtomic(item.file, item.data, { mode: 0o644 })
    state.files[item.rel] = item.hash
    written++
  })

  // Lote parcial (arquivos grandes enviados em partes): só grava; a limpeza e o estado das páginas vêm no lote final.
  if (payload.partial === true) {
    await saveState(userData, workspaceId, state)
    return { written, removed: 0, pages: Object.keys(state.pages).length, updatedAt: now, folder: wsDir, partial: true }
  }

  // 2) O que saiu do espaço (excluído, movido, protegido depois, "não espelhar") vai para _removidas/.
  const stale = new Set()
  for (const [id, info] of Object.entries(state.pages)) {
    const now_ = cleanPages[id]
    for (const rel of info.files ?? []) if (!now_ || !now_.files.includes(rel)) stale.add(rel)
  }
  if (payload.complete === true) for (const rel of Object.keys(state.files)) if (!claimed.has(rel)) stale.add(rel)
  let removed = 0
  const bin = path.join(wsDir, REMOVED, stampOf(now))
  for (const rel of stale) {
    if (claimed.has(rel)) continue
    failAt?.('remove', removed)
    const source = path.join(wsDir, ...rel.split('/'))
    if (await exists(source)) {
      const target = path.join(bin, ...rel.split('/'))
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.rename(source, target)
      await pruneEmptyDirs(path.dirname(source), wsDir)
      removed++
    }
    delete state.files[rel]
  }
  await purgeRemoved(wsDir, now)

  state.version = Number(payload.version) || 0
  state.globalSig = String(payload.globalSig ?? '')
  state.pages = cleanPages
  state.folder = wsFolder
  state.status = { updatedAt: now, pages: Object.keys(cleanPages).length, written, removed, error: null }
  await saveState(userData, workspaceId, state)
  return { written, removed, pages: state.status.pages, updatedAt: now, folder: wsDir }
}

async function purgeRemoved(wsDir, now) {
  const dir = path.join(wsDir, REMOVED)
  let names
  try { names = await fs.readdir(dir) } catch { return }
  for (const name of names) {
    const at = parseStamp(name)
    if (Number.isFinite(at) && now - at > REMOVED_KEEP_MS) await fs.rm(path.join(dir, name), { recursive: true, force: true }).catch(() => {})
  }
  await fs.rmdir(dir).catch(() => {})
}

/** Estado para o renderer decidir o que mudou; vazio se a pasta do espelho foi trocada. */
async function syncState(userData, workspaceId, root) {
  const state = await readState(userData, workspaceId)
  if (state.root !== root) return { version: 0, globalSig: '', pages: {}, status: state.status }
  return { version: state.version, globalSig: state.globalSig, pages: state.pages, status: state.status }
}

async function recordError(userData, workspaceId, message, now = Date.now()) {
  const state = await readState(userData, workspaceId)
  state.status = { ...state.status, error: { message: String(message).slice(0, 300), at: now } }
  await saveState(userData, workspaceId, state)
}

/** Apaga SÓ os arquivos que o espelho gerou (não vão para a Lixeira). Preserva `_removidas/` e qualquer coisa que não seja nossa. */
async function removeMirrorFiles({ root, userData, workspaceId }) {
  const state = await readState(userData, workspaceId)
  const wsDir = state.folder ? path.join(root, state.folder) : null
  let removed = 0
  if (wsDir && inside(root, wsDir)) {
    for (const rel of Object.keys(state.files)) {
      const file = path.join(wsDir, ...rel.split('/'))
      if (!inside(wsDir, file)) continue
      try { await fs.rm(file); removed++ } catch { /* já não existe */ }
      await pruneEmptyDirs(path.dirname(file), wsDir)
    }
    await fs.rmdir(wsDir).catch(() => {})
  }
  const left = await fs.readdir(root).catch(() => [])
  if (left.every(name => name === README || name === MARKER || name === '.DS_Store')) {
    for (const name of left) await fs.rm(path.join(root, name), { force: true }).catch(() => {})
    await fs.rmdir(root).catch(() => {})
  }
  await saveState(userData, workspaceId, emptyState())
  return { removed }
}

module.exports = {
  README, REMOVED, MARKER, FOLDER_NAME, MAX_FILES,
  mirrorError, defaultDirectory, normalizeSettings, readSettings, writeSettings, assertMirrorDirectory, resolveRoot,
  readState, syncState, workspaceFolder, readmeText, applyBatch, recordError, removeMirrorFiles, sha256,
}
