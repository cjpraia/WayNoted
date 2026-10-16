// B5 — abrir um .md/.markdown/.txt avulso ("Abrir com…", Arquivo → Abrir arquivo Markdown…) sem importar.
// O arquivo é lido aqui (limite de 10 MB, UTF-8 estrito, sem binários) e entregue ao renderer com um `fileId`
// opaco. O renderer NUNCA informa caminhos: salvar/verificar usam só o `fileId` que este módulo registrou.
// Nada é gravado no arquivo sem ação explícita ("Salvar no arquivo"), e uma alteração externa é detectada
// comparando o hash do conteúdo lido com o do disco antes de sobrescrever.
const { createHash, randomUUID } = require('node:crypto')
const path = require('node:path')
const fsp = require('node:fs/promises')

const MAX_BYTES = 10 * 1024 * 1024
const MAX_OPEN = 30
const EXTENSION = /\.(md|markdown|mdown|mkd|txt)$/i
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

class OpenFileError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.code = code }
}

const isOpenablePath = value => typeof value === 'string' && value.length > 0 && value.length < 4096 && !value.includes('\0') && path.isAbsolute(value) && EXTENSION.test(value)

/** Lê e valida um arquivo de texto. Lança OpenFileError com `code` estável (FILE_TYPE, FILE_TOO_LARGE, FILE_BINARY, FILE_NOT_UTF8, FILE_UNREADABLE). */
async function readTextFile(file) {
  if (!isOpenablePath(file)) throw new OpenFileError('FILE_TYPE', 'Só arquivos .md, .markdown ou .txt podem ser abertos.')
  let real, stat
  try { real = await fsp.realpath(file); stat = await fsp.stat(real) } catch { throw new OpenFileError('FILE_UNREADABLE', 'Não foi possível ler o arquivo.') }
  if (!stat.isFile() || !EXTENSION.test(real)) throw new OpenFileError('FILE_TYPE', 'Só arquivos .md, .markdown ou .txt podem ser abertos.')
  if (stat.size > MAX_BYTES) throw new OpenFileError('FILE_TOO_LARGE', 'O arquivo passa de 10 MB.')
  let bytes
  try { bytes = await fsp.readFile(real) } catch { throw new OpenFileError('FILE_UNREADABLE', 'Não foi possível ler o arquivo.') }
  if (bytes.length > MAX_BYTES) throw new OpenFileError('FILE_TOO_LARGE', 'O arquivo passa de 10 MB.')
  if (bytes.includes(0)) throw new OpenFileError('FILE_BINARY', 'O arquivo não parece ser texto.')
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bom ? bytes.subarray(3) : bytes) } catch { throw new OpenFileError('FILE_NOT_UTF8', 'O arquivo não está em UTF-8.') }
  return { path: real, name: path.basename(real), text, hash: sha(bytes), bom, size: bytes.length, mtimeMs: stat.mtimeMs }
}

/** Grava com tmp + rename na mesma pasta (sem o codec de cifra dos dados do app: é um arquivo do usuário). */
async function writeTextAtomic(file, text, bom) {
  const bytes = Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(text, 'utf8')])
  if (bytes.length > MAX_BYTES) throw new OpenFileError('FILE_TOO_LARGE', 'O texto passa de 10 MB.')
  let mode = 0o644
  try { mode = (await fsp.stat(file)).mode & 0o777 } catch { /* arquivo removido: recria com modo padrão */ }
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    const handle = await fsp.open(tmp, 'wx', mode)
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    await fsp.rename(tmp, file)
  } catch (error) { await fsp.rm(tmp, { force: true }).catch(() => {}); throw error }
  return sha(bytes)
}

function createOpenFiles({ read = readTextFile, write = writeTextAtomic } = {}) {
  const files = new Map() // fileId -> { path, hash, bom }
  const publicView = (id, file) => ({ fileId: id, name: file.name, path: file.path, text: file.text, size: file.size })

  async function open(file) {
    const loaded = await read(file)
    // Mesmo caminho já aberto: reaproveita o registro (nova leitura do disco).
    let id = [...files].find(([, entry]) => entry.path === loaded.path)?.[0]
    if (!id) {
      if (files.size >= MAX_OPEN) files.delete(files.keys().next().value)
      id = randomUUID()
    }
    files.set(id, { path: loaded.path, hash: loaded.hash, bom: loaded.bom })
    return publicView(id, loaded)
  }
  const entry = id => { const found = files.get(String(id)); if (!found) throw new OpenFileError('FILE_UNKNOWN', 'Arquivo não está mais aberto.'); return found }

  /** O disco ainda tem o conteúdo lido? */
  async function check(id) {
    const current = entry(id)
    try { const now = await read(current.path); return { state: now.hash === current.hash ? 'same' : 'changed', size: now.size } }
    catch (error) { return { state: error.code === 'FILE_UNREADABLE' ? 'missing' : 'invalid' } }
  }
  /** Recarrega do disco, descartando as edições do renderer (ação explícita dele). */
  async function reload(id) {
    const current = entry(id), loaded = await read(current.path)
    files.set(String(id), { path: loaded.path, hash: loaded.hash, bom: loaded.bom })
    return publicView(String(id), loaded)
  }
  /** Grava o texto. Sem `force`, recusa se o arquivo mudou (ou sumiu) desde a leitura. */
  async function save(id, text, { force = false } = {}) {
    const current = entry(id)
    if (typeof text !== 'string') throw new OpenFileError('FILE_TYPE', 'Texto inválido.')
    if (!force) {
      try { const now = await read(current.path); if (now.hash !== current.hash) return { saved: false, conflict: 'changed' } }
      catch (error) { return { saved: false, conflict: error.code === 'FILE_UNREADABLE' ? 'missing' : 'invalid' } }
    }
    current.hash = await write(current.path, text, current.bom)
    return { saved: true }
  }
  const release = id => files.delete(String(id))
  return { open, check, reload, save, release, size: () => files.size }
}

/** IPC confiável: o renderer só conhece `fileId`; caminhos nunca cruzam do renderer para o main. */
function registerOpenFileIpc({ trustedHandler, context, dialog, nativeT, openFiles }) {
  trustedHandler('np:openMarkdownFile', async event => {
    const win = context(event).win
    const result = await dialog.showOpenDialog(win, {
      title: nativeT('Abrir arquivo Markdown', 'Open Markdown file', win), properties: ['openFile'],
      filters: [{ name: 'Markdown / texto', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return openFiles.open(result.filePaths[0])
  })
  trustedHandler('np:externalFileCheck', (_e, id) => openFiles.check(id))
  trustedHandler('np:externalFileReload', (_e, id) => openFiles.reload(id))
  trustedHandler('np:externalFileSave', (_e, id, text, options) => openFiles.save(id, text, { force: options?.force === true }))
  trustedHandler('np:externalFileRelease', (_e, id) => openFiles.release(id))
}

module.exports = { registerOpenFileIpc, createOpenFiles, readTextFile, writeTextAtomic, isOpenablePath, OpenFileError, MAX_BYTES }
