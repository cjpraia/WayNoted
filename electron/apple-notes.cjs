// D3b — importar Apple Notes por Automação (osascript/JXA). Este módulo só EXECUTA o script de leitura
// (electron/apple-notes.js) com timeout e cancelamento, valida os argumentos e classifica os erros. A
// conversão HTML → blocos acontece no renderer (src/importers/appleNotes). Nada é gravado no Notas.
const { execFile } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const SCRIPT = path.join(__dirname, 'apple-notes.js')
const MAX_OUTPUT = 256 * 1024 * 1024
const FOLDER_ID = /^x-coredata:\/\/[A-Za-z0-9\-/._:]{1,400}$/
const TIMEOUT = { folders: 120_000, notes: 90_000 } // o 1º acesso espera o usuário responder ao pedido de permissão

class AppleNotesError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.code = code }
}

/** stderr/erro do osascript → código estável. -1743 = Automação negada pelo usuário. */
function classifyError(error, stderr = '') {
  const text = `${stderr} ${error?.message ?? ''}`
  if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return 'APPLE_NOTES_ABORTED'
  if (/-1743|not authori[sz]ed to send apple events|erro de autoriza/i.test(text)) return 'APPLE_NOTES_DENIED'
  if (error?.killed || error?.signal === 'SIGTERM' || /timed? ?out/i.test(text)) return 'APPLE_NOTES_TIMEOUT'
  if (/-1728|-10810|-600|can.t get application|application isn.t running|unable to find application|-1712/i.test(text)) return 'APPLE_NOTES_UNAVAILABLE'
  return 'APPLE_NOTES_FAILED'
}
const MESSAGES = {
  APPLE_NOTES_DENIED: 'O macOS negou o acesso ao app Notas (Automação).',
  APPLE_NOTES_TIMEOUT: 'O Notas não respondeu a tempo.',
  APPLE_NOTES_UNAVAILABLE: 'Não foi possível abrir o app Notas.',
  APPLE_NOTES_ABORTED: 'Importação cancelada.',
  APPLE_NOTES_FAILED: 'Falha ao ler as notas.',
}

/** No app empacotado o script fica dentro do app.asar, que o osascript (processo externo) não lê: usa uma cópia temporária (uma por processo, privada). */
let runnableScript = null
function scriptPath() {
  if (runnableScript) return runnableScript
  if (!/\.asar([\\/]|$)/.test(SCRIPT)) return (runnableScript = SCRIPT)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-jxa-"))
  const copy = path.join(dir, path.basename(SCRIPT))
  fs.writeFileSync(copy, fs.readFileSync(SCRIPT), { mode: 0o600 })
  return (runnableScript = copy)
}

function defaultRun(args, { timeout, signal }) {
  return new Promise((resolve, reject) => {
    const child = execFile('osascript', ['-l', 'JavaScript', scriptPath(), ...args], { timeout, maxBuffer: MAX_OUTPUT, encoding: 'utf8', signal }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stderr })) : resolve(stdout))
    child.stdin?.end()
  })
}

function createAppleNotes({ run = defaultRun, platform = process.platform } = {}) {
  let controller = null
  const available = () => platform === 'darwin'
  async function call(args, kind) {
    if (!available()) throw new AppleNotesError('APPLE_NOTES_UNAVAILABLE', 'Disponível apenas no macOS.')
    controller?.abort()
    const mine = controller = new AbortController()
    try {
      const stdout = await run(args, { timeout: TIMEOUT[kind], signal: mine.signal })
      if (typeof stdout !== 'string' || stdout.length > MAX_OUTPUT) throw new AppleNotesError('APPLE_NOTES_FAILED', 'Resposta inválida do Notas.')
      return stdout.trim()
    } catch (error) {
      if (error instanceof AppleNotesError) throw error
      const code = classifyError(error, error?.stderr)
      throw new AppleNotesError(code, MESSAGES[code])
    } finally { if (controller === mine) controller = null }
  }
  return {
    available,
    /** Contas e pastas (JSON). A primeira chamada dispara o pedido de Automação do macOS. */
    folders: () => call(['folders'], 'folders'),
    /** Lote de notas de uma pasta (JSON). `folderId` é validado: vai como argumento, nunca como código. */
    notes(folderId, offset = 0, limit = 20) {
      if (typeof folderId !== 'string' || !FOLDER_ID.test(folderId)) throw new AppleNotesError('APPLE_NOTES_FAILED', 'Pasta inválida.')
      const from = Math.max(0, Math.min(10_000_000, Math.floor(Number(offset)) || 0)), count = Math.max(1, Math.min(50, Math.floor(Number(limit)) || 20))
      return call(['notes', folderId, String(from), String(count)], 'notes')
    },
    cancel() { controller?.abort(); controller = null; return true },
  }
}

function registerAppleNotesIpc({ trustedHandler, notes = createAppleNotes() }) {
  trustedHandler('np:appleNotesFolders', () => notes.folders())
  trustedHandler('np:appleNotesBatch', (_event, folderId, offset, limit) => notes.notes(folderId, offset, limit))
  trustedHandler('np:appleNotesCancel', () => notes.cancel())
  return notes
}

module.exports = { createAppleNotes, registerAppleNotesIpc, classifyError, AppleNotesError, FOLDER_ID, SCRIPT }
