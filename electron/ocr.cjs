// OCR local de imagens anexadas via Vision framework (macOS 10.15+), sem dependências:
// o script JXA roda em `osascript`, a imagem vai para um arquivo temporário e é apagada em seguida.
const { execFile } = require('node:child_process')
const path = require('node:path')
const os = require('node:os')
const fsp = require('node:fs/promises')

const MAX_BYTES = 25 * 1024 * 1024
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic', 'image/tiff': 'tiff', 'image/bmp': 'bmp' }

function decodeImage(dataUrl) {
  const match = typeof dataUrl === 'string' && /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl)
  if (!match) throw new Error('Imagem inválida para OCR')
  const extension = EXTENSIONS[match[1].toLowerCase()]
  if (!extension) throw new Error('Formato de imagem sem suporte para OCR')
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Imagem grande demais para OCR')
  return { bytes, extension }
}

function createOcr({ platform = process.platform, run = execFile, nativeRun = require('./native-helper.cjs').runHelper, script = path.join(__dirname, 'ocr-vision.js') } = {}) {
  let queue = Promise.resolve()
  const available = () => ['darwin', 'win32'].includes(platform)
  async function recognize(dataUrl) {
    if (!available()) return { ok: false, reason: 'unsupported', text: '' }
    const { bytes, extension } = decodeImage(dataUrl)
    const task = queue.then(async () => {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "workspace-ocr-"))
      const file = path.join(dir, `image.${extension}`)
      try {
        await fsp.writeFile(file, bytes, { mode: 0o600 })
        if (platform === 'win32') {
          const result = await nativeRun(['ocr'], { file }, { timeout: 30000 })
          return { ok: true, text: String(result.text ?? '').trimEnd() }
        }
        // No app empacotado o script fica dentro do app.asar, que o osascript (processo externo) não enxerga:
        // copia-o (leitura com suporte a asar) para a pasta temporária, que é apagada junto com a imagem.
        let scriptPath = script
        if (/\.asar([\\/]|$)/.test(script)) { scriptPath = path.join(dir, 'ocr-vision.js'); await fsp.writeFile(scriptPath, await fsp.readFile(script), { mode: 0o600 }) }
        const text = await new Promise((resolve, reject) => run('osascript', ['-l', 'JavaScript', scriptPath, file], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(String(stdout))))
        return { ok: true, text: text.replace(/\s+$/, '') }
      } catch (error) {
        return { ok: false, reason: error?.killed ? 'timeout' : 'failed', text: '' }
      } finally { await fsp.rm(dir, { recursive: true, force: true }) }
    })
    queue = task.catch(() => {})
    return task
  }
  return { available, recognize }
}

module.exports = { createOcr, decodeImage }
