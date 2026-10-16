const PRODUCT = require('../shared/product.json')
// Exportação de pacotes (pasta ou ZIP) e PDF de página. Só grava onde o usuário escolheu
// e só revela no Finder caminhos gravados nesta sessão.
const path = require('node:path')
const fsp = require('node:fs/promises')

const MAX_TOTAL = 2 * 1024 * 1024 * 1024
const MAX_FILES = 200000

/** Caminho relativo seguro dentro da pasta de destino. */
function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.includes('\\') || value.includes('\0') || value.startsWith('/')) return null
  const parts = value.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || part.length > 255 || /[<>:\"|?*\u0000-\u001f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) return null
  return parts
}

function cleanName(value, fallback) {
  let name = path.basename(String(value || fallback)).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim()
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name
  return name && name !== '.' && name !== '..' ? name.slice(0, 120) : fallback
}

async function uniqueDirectory(parent, name) {
  for (let n = 1; n < 1000; n++) {
    const candidate = path.join(parent, n === 1 ? name : `${name} ${n}`)
    try { await fsp.mkdir(candidate); return candidate } catch (error) { if (error.code !== 'EEXIST') throw error }
  }
  throw new Error('Não foi possível criar a pasta de exportação.')
}

/** Grava `files` em `target` (pasta já criada). Exportado para testes. */
async function writePackage(target, files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('Pacote inválido.')
  const entries = Object.entries(files)
  if (entries.length > MAX_FILES) throw new Error('Pacote com arquivos demais.')
  let total = 0
  const plan = entries.map(([name, content]) => {
    const parts = safeRelative(name)
    if (!parts) throw new Error(`Caminho inválido no pacote: ${String(name).slice(0, 80)}`)
    if (typeof content !== 'string' && !(content instanceof Uint8Array)) throw new Error('Conteúdo inválido no pacote.')
    total += typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength
    return { file: path.join(target, ...parts), content }
  })
  if (total > MAX_TOTAL) throw new Error('Pacote maior que 2 GB.')
  const root = path.resolve(target) + path.sep
  for (const item of plan) {
    if (!path.resolve(item.file).startsWith(root)) throw new Error('Caminho fora da pasta de destino.')
    await fsp.mkdir(path.dirname(item.file), { recursive: true })
    await fsp.writeFile(item.file, typeof item.content === 'string' ? item.content : Buffer.from(item.content), { flag: 'wx' })
  }
  return target
}

function registerExportIpc({ trustedHandler, context, dialog, app, shell, atomicWrite, nativeT }) {
  const written = new Set()
  trustedHandler('np:saveExport', async (e, input) => {
    const win = context(e).win
    if (!input || typeof input !== 'object') throw new Error('Exportação inválida.')
    const name = cleanName(input.name, `${PRODUCT.name}`)
    if (input.kind === 'zip') {
      if (!(input.data instanceof Uint8Array) || input.data.byteLength > MAX_TOTAL) throw new Error('ZIP inválido ou maior que 2 GB.')
      const result = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), name.endsWith('.zip') ? name : `${name}.zip`), filters: [{ name: 'ZIP', extensions: ['zip'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] })
      if (result.canceled || !result.filePath) return null
      await atomicWrite(result.filePath, Buffer.from(input.data))
      written.add(result.filePath)
      return result.filePath
    }
    if (input.kind === 'folder') {
      const result = await dialog.showOpenDialog(win, { title: nativeT('Escolha onde criar a pasta exportada', 'Choose where to create the exported folder', win), buttonLabel: nativeT('Exportar aqui', 'Export here', win), defaultPath: app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] })
      if (result.canceled || !result.filePaths[0]) return null
      const target = await uniqueDirectory(result.filePaths[0], name)
      await writePackage(target, input.files)
      written.add(target)
      return target
    }
    throw new Error('Formato de exportação inválido.')
  })
  trustedHandler('np:exportPagePDF', async (e, defaultName) => {
    const win = context(e).win
    const name = cleanName(defaultName, `${PRODUCT.name}.pdf`)
    const result = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), name.endsWith('.pdf') ? name : `${name}.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] })
    if (result.canceled || !result.filePath) return null
    const data = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: 'default' }, generateDocumentOutline: true })
    await atomicWrite(result.filePath, data)
    written.add(result.filePath)
    return result.filePath
  })
  trustedHandler('np:revealExport', (_e, target) => {
    if (typeof target !== 'string' || !written.has(target)) throw new Error('Caminho indisponível.')
    shell.showItemInFolder(target)
  })
}

module.exports = { registerExportIpc, writePackage, safeRelative }
