// Localiza e executa o helper nativo (build/native/workspace-native em desenvolvimento,
// Contents/Resources/workspace-native no .app empacotado). Sem shell; entrada JSON pelo stdin.
const path = require('node:path')
const fs = require('node:fs')
const { spawn } = require('node:child_process')

const HELPER_NAME = "workspace-native"

function runtimeInfo() {
  try {
    const { app } = require('electron')
    return { isPackaged: !!app?.isPackaged, resourcesPath: process.resourcesPath }
  } catch { return { isPackaged: false, resourcesPath: process.resourcesPath } }
}

function helperPath({ isPackaged, resourcesPath } = runtimeInfo()) {
  if (process.env.WORKSPACE_NATIVE_HELPER) return process.env.WORKSPACE_NATIVE_HELPER
  return isPackaged && resourcesPath ? path.join(resourcesPath, HELPER_NAME) : path.join(__dirname, '..', 'build', 'native', HELPER_NAME)
}

function nativeError(code, message) {
  const error = new Error(`${code}: ${message || code}`)
  error.code = code
  return error
}

function helperAvailable(file = helperPath(), platform = process.platform) {
  if (platform !== 'darwin') return { available: false, reason: 'NATIVE_UNSUPPORTED' }
  try { fs.accessSync(file, fs.constants.X_OK); return { available: true } } catch { return { available: false, reason: 'NATIVE_HELPER_MISSING' } }
}

/** Executa um comando curto do helper e resolve com o último objeto JSON impresso. */
function runHelper(args, input, { file = helperPath(), timeout = 20000, spawnImpl = spawn, platform = process.platform, niceness } = {}) {
  return new Promise((resolve, reject) => {
    const availability = helperAvailable(file, platform)
    if (!availability.available) { reject(nativeError(availability.reason, availability.reason === 'NATIVE_UNSUPPORTED' ? 'Requires macOS.' : 'Native helper not built. Run npm run build:native.')); return }
    let child
    try { child = spawnImpl(file, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true }) }
    catch (error) { reject(nativeError('NATIVE_HELPER_FAILED', error.message)); return }
    // Prioridade baixa para trabalho em segundo plano (ex.: indexação de embeddings).
    if (niceness && child.pid) { try { require('node:os').setPriority(child.pid, niceness) } catch { /* sem permissão: segue normal */ } }
    let stdout = '', stderr = '', done = false
    const timer = setTimeout(() => { if (!done) { child.kill('SIGKILL'); finish(nativeError('NATIVE_HELPER_TIMEOUT', 'Native helper timed out.')) } }, timeout)
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(value) }
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 8 * 1024 * 1024) { child.kill('SIGKILL'); finish(nativeError('NATIVE_HELPER_FAILED', 'Output too large.')) } })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000) })
    child.on('error', error => finish(nativeError('NATIVE_HELPER_FAILED', error.message)))
    child.on('close', code => {
      const line = stdout.trim().split('\n').filter(Boolean).at(-1)
      let parsed
      try { parsed = line ? JSON.parse(line) : null } catch { parsed = null }
      if (parsed?.error) finish(nativeError(String(parsed.error.code || 'NATIVE_HELPER_FAILED'), String(parsed.error.message || '')))
      else if (parsed && code === 0) finish(null, parsed)
      else finish(nativeError('NATIVE_HELPER_FAILED', stderr.trim() || `exit ${code}`))
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input === undefined ? '' : JSON.stringify(input))
  })
}

const PRIVACY_PANES = {
  calendars: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars',
  reminders: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  speech: 'x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition',
  dictation: 'x-apple.systempreferences:com.apple.Keyboard-Settings.extension',
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
}

/** Abre um painel conhecido dos Ajustes do Sistema (lista fechada); `allowed` restringe ainda mais (janela rápida). */
function openPrivacyPane(pane, open = url => require('electron').shell.openExternal(url), allowed) {
  const url = Object.hasOwn(PRIVACY_PANES, pane) && (!allowed || allowed.includes(pane)) ? PRIVACY_PANES[pane] : null
  if (!url) throw new Error('Painel inválido')
  return open(url)
}

function registerPrivacySettingsIpc(trustedHandler, open = url => require('electron').shell.openExternal(url)) {
  trustedHandler('np:openPrivacySettings', (_event, pane) => openPrivacyPane(pane, open))
}

module.exports = { helperPath, helperAvailable, runHelper, nativeError, registerPrivacySettingsIpc, openPrivacyPane, PRIVACY_PANES, HELPER_NAME }
