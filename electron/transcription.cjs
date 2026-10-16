const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const runFile = promisify(execFile)
const formats = { 'audio/webm': 'matroska', 'audio/mp4': 'mov', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/flac': 'flac' }
async function executable(name) {
  for (const directory of ['/opt/homebrew/bin', '/usr/local/bin']) {
    const file = path.join(directory, name)
    try { await fs.access(file, require('node:fs').constants.X_OK); return file } catch { /* Try next installation. */ }
  }
  throw new Error(`LOCAL_TRANSCRIPTION_RUNTIME:${name}`)
}
function createTranscriber({ run = runFile, findExecutable = executable, tempRoot = os.tmpdir() } = {}) {
  return async function transcribe({ data, mimeType, modelPath, language }, signal) {
    if (!(data instanceof Uint8Array) || !data.byteLength || data.byteLength > 100 * 1024 * 1024 || !formats[String(mimeType).split(';')[0]] || !['auto', 'pt', 'en'].includes(language)) throw new Error('LOCAL_TRANSCRIPTION_INVALID_INPUT')
    const model = await fs.stat(modelPath)
    if (!model.isFile() || path.extname(modelPath).toLowerCase() !== '.bin') throw new Error('LOCAL_TRANSCRIPTION_INVALID_MODEL')
    const ffmpeg = await findExecutable('ffmpeg'), whisper = await findExecutable('whisper-cli')
    const directory = await fs.mkdtemp(path.join(tempRoot, "workspace-transcription-"))
    try {
      const input = path.join(directory, 'audio'), wav = path.join(directory, 'audio.wav'), output = path.join(directory, 'transcript')
      await fs.writeFile(input, data, { mode: 0o600 })
      const options = { signal, timeout: 900000, maxBuffer: 1024 * 1024, windowsHide: true, shell: false }
      await run(ffmpeg, ['-nostdin', '-y', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', '-f', formats[String(mimeType).split(';')[0]], '-i', input, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], options)
      await run(whisper, ['-m', modelPath, '-f', wav, '-l', language, '-otxt', '-of', output, '-np'], options)
      return (await fs.readFile(output + '.txt', 'utf8')).trim()
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  }
}
module.exports = { createTranscriber }
