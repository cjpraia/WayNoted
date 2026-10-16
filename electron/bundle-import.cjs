// Importação do Export Bundle (lado nativo): escolhe o ZIP ou a pasta exportada e lê os arquivos localmente.
// A conversão acontece no renderer (src/importers/bundle); aqui só há leitura de disco com limites.
const path = require('node:path')
const fsp = require('node:fs/promises')

const LIMITS = { files: 250000, totalBytes: 4 * 1024 * 1024 * 1024, depth: 64, enexBytes: 512 * 1024 * 1024 }

/** Lê recursivamente uma pasta; caminhos relativos com '/', sem seguir links simbólicos. */
async function readFolder(root, limits = LIMITS) {
  const files = []
  let total = 0
  async function walk(dir, rel, depth) {
    if (depth > limits.depth) return
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.name === '.DS_Store' || entry.name === '__MACOSX' || entry.name === '.git' || entry.name === '.trash') continue
      const full = path.join(dir, entry.name)
      const relative = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) { await walk(full, relative, depth + 1); continue }
      if (!entry.isFile()) continue
      if (files.length >= limits.files) throw new Error("BUNDLE_IMPORT_TOO_MANY_FILES")
      const data = await fsp.readFile(full)
      total += data.byteLength
      if (total > limits.totalBytes) throw new Error("BUNDLE_IMPORT_TOO_LARGE")
      files.push({ path: relative.normalize('NFC'), data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) })
    }
  }
  await walk(root, '', 0)
  return files
}

async function readZip(file, limits = LIMITS) {
  const stat = await fsp.stat(file)
  if (stat.size > limits.totalBytes) throw new Error("BUNDLE_IMPORT_TOO_LARGE")
  const data = await fsp.readFile(file)
  return [{ path: path.basename(file).normalize('NFC'), data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }]
}

/** Lê arquivos .enex escolhidos (cada um até `enexBytes`; o conteúdo só é interpretado no renderer). */
async function readEnex(filePaths, limits = LIMITS) {
  const files = []
  let total = 0
  for (const file of filePaths.slice(0, 200)) {
    const stat = await fsp.stat(file)
    if (!stat.isFile() || !/\.enex$/i.test(file)) continue
    if (stat.size > limits.enexBytes) throw new Error('ENEX_IMPORT_TOO_LARGE')
    total += stat.size
    if (total > limits.totalBytes) throw new Error("BUNDLE_IMPORT_TOO_LARGE")
    const data = await fsp.readFile(file)
    files.push({ path: path.basename(file).normalize('NFC'), data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) })
  }
  return files
}

/** Registra o IPC `np:pickExport BundleExport` usando o registrador confiável do main. */
function registerBundleImport({ handle, dialog, windowFor, translate }) {
  handle("np:pickExport BundleExport", async (event, kind) => {
    const win = windowFor(event)
    if (kind === 'enex') {
      const options = { title: translate("Escolha os arquivos .enex do ENEX Archive", "Choose the ENEX Archive .enex files", win), properties: ['openFile', 'multiSelections'], filters: [{ name: "ENEX Archive (.enex)", extensions: ['enex'] }] }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      if (result.canceled || !result.filePaths.length) return null
      const files = await readEnex(result.filePaths)
      return { name: files.length === 1 ? files[0].path : `${files.length} .enex`, kind: 'enex', files }
    }
    const folder = kind === 'folder'
    const options = folder
      ? { title: translate("Escolha a pasta exportada do Export Bundle", "Choose the exported Export Bundle folder", win), properties: ['openDirectory'] }
      : { title: translate("Escolha o ZIP exportado do Export Bundle", "Choose the exported Export Bundle ZIP", win), properties: ['openFile'], filters: [{ name: 'ZIP', extensions: ['zip'] }] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const target = result.filePaths[0]
    const files = folder ? await readFolder(target) : await readZip(target)
    return { name: path.basename(target), kind: folder ? 'folder' : 'zip', files }
  })
}

module.exports = { registerBundleImport, readFolder, readZip, readEnex, LIMITS }
