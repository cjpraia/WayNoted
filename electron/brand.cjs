const PRODUCT = require('../shared/product.json')
const COMPAT = require('../shared/compatibility.cjs')
const path = require('node:path')
const fs = require('node:fs')
function legacyEnv(env = process.env) {
  for (const [key, value] of Object.entries(env)) {
    const prefix = [COMPAT.record001, ...(PRODUCT.previousEnvironmentPrefixes ?? [])].find(value => key.startsWith(value))
    if (prefix) {
      const current = key.replace(prefix, PRODUCT.environmentPrefix)
      if (env[current] === undefined) env[current] = value
    }
  }
  return env
}
function userDataPath(appData, exists = fs.existsSync) {
  const current = path.join(appData, PRODUCT.profileDirectory)
  const previous = path.join(appData, COMPAT.record002)
  return exists(current) || !exists(previous) ? current : previous
}
function resolveProfile(appData, override) {
  const current = override || path.join(appData, PRODUCT.profileDirectory)
  const previous = path.join(appData, COMPAT.record002)
  const marker = 'profile-identity.json'
  if (!override && !fs.existsSync(current) && fs.existsSync(previous)) {
    fs.writeFileSync(path.join(previous, marker), JSON.stringify({ keychainName: COMPAT.record002 }), { mode: 0o600 })
    fs.renameSync(previous, current)
  }
  let keychainName = PRODUCT.keychainIdentity
  try { keychainName = JSON.parse(fs.readFileSync(path.join(current, marker), 'utf8')).keychainName || keychainName } catch (error) {
    if (error.code !== 'ENOENT') throw error
    fs.mkdirSync(current, { recursive: true, mode: 0o700 })
    fs.writeFileSync(path.join(current, marker), JSON.stringify({ keychainName }), { mode: 0o600, flag: 'wx' })
  }
  return { directory: current, keychainName }
}
module.exports = { legacyEnv, userDataPath, resolveProfile }
