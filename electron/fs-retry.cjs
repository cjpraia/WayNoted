// Antivirus/indexer handles can transiently block replacement on Windows.
// Retry rename only; never delete a valid destination to make a write succeed.
const fs = require('node:fs/promises')
const { setTimeout: delay } = require('node:timers/promises')
async function rename(source, destination, { platform = process.platform, move = fs.rename, wait = delay } = {}) {
  for (let attempt = 0;; attempt++) {
    try { return await move(source, destination) }
    catch (error) {
      if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error
      await wait(20 * (2 ** attempt))
    }
  }
}
module.exports = { rename }
