// User presence must be verified before releasing a device-bound vault key.
const { helperAvailable, runHelper } = require('./native-helper.cjs')
function createBiometric({ platform = process.platform, preferences, run = runHelper, available = helperAvailable } = {}) {
  return {
    async available() {
      if (platform === 'darwin') { try { return !!preferences?.canPromptTouchID?.() } catch { return false } }
      if (platform !== 'win32' || !available().available) return false
      try { return (await run(['biometric', 'status'])).available === true } catch { return false }
    },
    async verify(window, message) {
      if (platform === 'darwin') return preferences.promptTouchID(message)
      if (platform !== 'win32') throw new Error('BIOMETRIC_UNAVAILABLE')
      const handle = window.getNativeWindowHandle()
      const hwnd = handle.length >= 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())
      if (hwnd > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('INVALID_WINDOW_HANDLE')
      const result = await run(['biometric', 'verify'], { window: Number(hwnd), message }, { timeout: 120000 })
      if (result.verified !== true) throw new Error('BIOMETRIC_REJECTED')
    },
  }
}
module.exports = { createBiometric }
