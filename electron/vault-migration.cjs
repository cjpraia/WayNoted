// Atomic, recoverable re-encryption of a whole workspace data folder.
// 1. journal "copying"  2. every file is re-encoded into <dir>.vault-new  3. each new file is
// decrypted again and compared (SHA-256) with the source plaintext  4. journal "swapping",
// rename <dir> -> <dir>.vault-old, rename <dir>.vault-new -> <dir>  5. remove the old copy.
// An interruption at any point is resolved by recover(): before the swap the original folder
// is kept untouched; after the first rename the verified copy is rolled forward.
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

const suffix = { next: '.vault-new', old: '.vault-old', journal: '.vault-journal' }
const paths = dir => ({ dir, next: dir + suffix.next, old: dir + suffix.old, journal: dir + suffix.journal })
const exists = file => fs.access(file).then(() => true, () => false)
const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex')

async function writeDurable(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const handle = await fs.open(file, 'w', 0o600)
  try { await handle.writeFile(content); await handle.sync() } finally { await handle.close() }
}
async function writeJournal(file, value) {
  const tmp = `${file}.${process.pid}.tmp`
  await writeDurable(tmp, JSON.stringify(value))
  await fs.rename(tmp, file)
}
async function walk(root, relative = '') {
  const out = []
  let entries
  try { entries = await fs.readdir(path.join(root, relative), { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return out; throw error }
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) out.push(...await walk(root, rel))
    else if (entry.isFile() && !entry.name.endsWith('.tmp')) out.push(rel)
  }
  return out
}

/** Removes the pre-swap copy, or keeps it as a backup folder when `keep` is set. */
async function retire(old, keep) {
  if (!keep) { await fs.rm(old, { recursive: true, force: true }); return }
  await fs.rm(keep, { recursive: true, force: true })
  await fs.rename(old, keep)
}

/** Finishes or rolls back an interrupted migration. Returns what happened. */
async function recover(dir) {
  const p = paths(dir)
  let journal = null
  try { journal = JSON.parse(await fs.readFile(p.journal, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const [hasDir, hasNext, hasOld] = await Promise.all([exists(p.dir), exists(p.next), exists(p.old)])
  if (!journal && !hasNext && !hasOld) return 'clean'
  let outcome
  if (!journal || journal.state === 'copying') {
    // Nothing was swapped: the original folder is authoritative.
    if (!hasDir && hasOld) await fs.rename(p.old, p.dir)
    await fs.rm(p.next, { recursive: true, force: true })
    outcome = 'rolled-back'
  } else if (hasDir && !hasOld) {
    await fs.rm(p.next, { recursive: true, force: true }); outcome = hasNext ? 'rolled-back' : 'completed'
  } else if (!hasDir && hasOld && hasNext) {
    await fs.rename(p.next, p.dir); await retire(p.old, journal.keep); outcome = 'rolled-forward'
  } else if (!hasDir && hasOld) {
    await fs.rename(p.old, p.dir); outcome = 'rolled-back'
  } else {
    await retire(p.old, journal.keep); outcome = 'completed'
  }
  await fs.rm(p.journal, { force: true })
  return { outcome, mode: journal?.mode }
}

/**
 * Re-encodes every file of `dir`.
 * decode(rel, buffer) -> plaintext of the outer layer; encode(rel, plaintext) -> new bytes;
 * verifyDecode(rel, newBytes) -> plaintext; extra: { rel: bytes } written verbatim;
 * drop: Set of rels not copied; onSwapped runs synchronously right after the swap.
 * `failAt` simulates a crash for tests.
 */
async function transform(dir, { mode, keepOldAs, decode, encode, verifyDecode, extra = {}, drop = new Set(), failAt, onSwapped } = {}) {
  const p = paths(dir)
  await recover(dir)
  const crash = point => { if (failAt === point) { const error = new Error(`SIMULATED_CRASH:${point}`); error.code = 'SIMULATED_CRASH'; throw error } }
  await writeJournal(p.journal, { state: 'copying', mode, keep: keepOldAs, startedAt: Date.now() })
  await fs.rm(p.next, { recursive: true, force: true })
  const hashes = new Map()
  let copied = 0
  for (const rel of await walk(p.dir)) {
    if (drop.has(rel) || Object.hasOwn(extra, rel)) continue
    const plain = decode(rel, await fs.readFile(path.join(p.dir, ...rel.split('/'))))
    hashes.set(rel, sha(plain))
    await writeDurable(path.join(p.next, ...rel.split('/')), encode(rel, plain))
    if (++copied === 1) crash('copy')
  }
  for (const [rel, bytes] of Object.entries(extra)) await writeDurable(path.join(p.next, ...rel.split('/')), bytes)
  crash('verify')
  // Read-back verification: every file must decrypt to exactly the original plaintext.
  const written = new Set(await walk(p.next))
  for (const [rel, hash] of hashes) {
    if (!written.has(rel)) throw new Error(`Verificação falhou: ${rel} ausente`)
    if (sha(verifyDecode(rel, await fs.readFile(path.join(p.next, ...rel.split('/'))))) !== hash) throw new Error(`Verificação falhou: ${rel}`)
  }
  await writeJournal(p.journal, { state: 'swapping', mode, keep: keepOldAs, startedAt: Date.now() })
  crash('swap-before')
  await fs.rename(p.dir, p.old)
  crash('swap-middle')
  await fs.rename(p.next, p.dir)
  onSwapped?.()
  crash('swap-after')
  await retire(p.old, keepOldAs)
  await fs.rm(p.journal, { force: true })
  return { files: hashes.size }
}

async function recoverAll(root) {
  const dirs = [path.join(root, 'data')]
  try { for (const name of await fs.readdir(path.join(root, 'workspaces'))) dirs.push(path.join(root, 'workspaces', name, 'data')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const results = {}
  for (const dir of dirs) { const result = await recover(dir); if (result !== 'clean') results[dir] = result }
  return results
}

module.exports = { transform, recover, recoverAll, paths, walk, suffix }
