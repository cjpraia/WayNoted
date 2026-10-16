// Stable technical identities and OS-specific integration points.
const path = require('node:path')
const os = require('node:os')
const PRODUCT = require('../shared/product.json')
function appDataRoot({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const paths = platform === 'win32' ? path.win32 : path
  if (platform === 'win32') return env.APPDATA || paths.join(home, 'AppData', 'Roaming')
  if (platform === 'darwin') return paths.join(home, 'Library', 'Application Support')
  return env.XDG_CONFIG_HOME || paths.join(home, '.config')
}
function windowChrome(platform = process.platform) {
  return platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 11 } } : { titleBarStyle: 'default', autoHideMenuBar: true }
}
function quickChrome(platform = process.platform) {
  return platform === 'darwin' ? { type: 'panel', transparent: true, backgroundColor: '#00000000', vibrancy: 'popover', visualEffectState: 'active' } : { transparent: false, backgroundColor: '#202020' }
}
function capabilities(platform = process.platform) {
  return { platform, arch: process.arch, calendar: platform === 'darwin', reminders: platform === 'darwin', notesImport: platform === 'darwin', nativeEmbeddings: platform === 'darwin', ocr: ['darwin', 'win32'].includes(platform), dictation: ['darwin', 'win32'].includes(platform), credentialStore: platform === 'win32' ? 'Windows DPAPI' : platform === 'darwin' ? 'macOS Keychain' : 'System credential store', name: PRODUCT.name }
}
module.exports = { appDataRoot, windowChrome, quickChrome, capabilities }
