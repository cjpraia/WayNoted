// Copy the bundled unpacked extension to a stable, browser-readable path.
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { rename } = require('./fs-retry.cjs')

const FOLDER = 'WayNoted Web Clipper'
const MARKER = '.waynoted-clipper.json'
const MANIFEST = 'manifest.json'

async function stat(file) {
  try { return await fs.lstat(file) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}

async function bundledFiles(directory, prefix = '') {
  const files = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const relative = prefix + entry.name
    if (entry.isDirectory()) files.push(...await bundledFiles(path.join(directory, entry.name), relative + '/'))
    else if (entry.isFile()) files.push(relative)
    else throw new Error(`Unsupported Web Clipper resource: ${relative}`)
  }
  return files
}

async function requireDirectory(directory) {
  const current = await stat(directory)
  if (!current?.isDirectory()) throw new Error(`Not a Web Clipper folder: ${directory}`)
}

async function atomicWrite(file, data) {
  const temp = path.join(path.dirname(file), `.waynoted-${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temp, data, { flag: 'wx' })
    await rename(temp, file)
  } finally {
    await fs.rm(temp, { force: true })
  }
}

async function putFiles(source, directory, files) {
  for (const relative of files) {
    const target = path.join(directory, relative)
    const bytes = await fs.readFile(path.join(source, relative))
    if (await stat(target) && bytes.equals(await fs.readFile(target))) continue
    await fs.mkdir(path.dirname(target), { recursive: true })
    await atomicWrite(target, bytes)
  }
}

async function verifyDestination(directory, relative, owned) {
  let current = directory
  const parts = relative.split('/')
  for (const component of parts.slice(0, -1)) {
    current = path.join(current, component)
    const entry = await stat(current)
    if (!entry) return
    if (!entry.isDirectory()) throw new Error(`Web Clipper folder has a conflicting entry: ${relative}`)
  }
  const entry = await stat(path.join(current, parts.at(-1)))
  if (entry && (!entry.isFile() || !owned.has(relative))) {
    throw new Error(`Web Clipper folder has a conflicting file: ${relative}`)
  }
}

async function prepareClipperInstall(source, userData, { onlyPrepared = false } = {}) {
  const directory = path.join(userData, FOLDER)
  const installed = await stat(directory)
  if (onlyPrepared && (!installed?.isDirectory() || !(await stat(path.join(directory, MARKER)))?.isFile())) return null
  const files = await bundledFiles(source)
  if (!files.includes(MANIFEST)) throw new Error('Web Clipper manifest is missing')
  const manifest = JSON.parse(await fs.readFile(path.join(source, MANIFEST), 'utf8'))
  if (manifest.manifest_version !== 3 || typeof manifest.version !== 'string') throw new Error('Invalid Web Clipper manifest')
  // Commit the new manifest only after the assets it refers to have been copied.
  const ordered = [...files.filter(file => file !== MANIFEST).sort(), MANIFEST]
  const marker = files => JSON.stringify({ files })

  if (!installed) {
    const staged = await fs.mkdtemp(path.join(userData, '.waynoted-clipper-'))
    try {
      await putFiles(source, staged, ordered)
      await fs.writeFile(path.join(staged, MARKER), marker(files))
      await rename(staged, directory)
    } finally {
      await fs.rm(staged, { recursive: true, force: true })
    }
  } else {
    await requireDirectory(directory)
    const markerPath = path.join(directory, MARKER)
    if (!(await stat(markerPath))?.isFile()) throw new Error(`Not a managed Web Clipper folder: ${directory}`)
    const previous = JSON.parse(await fs.readFile(markerPath, 'utf8'))
    if (!Array.isArray(previous?.files) || !previous.files.includes(MANIFEST)) throw new Error('Invalid Web Clipper folder marker')
    const owned = new Set(previous.files)
    for (const file of ordered) await verifyDestination(directory, file, owned)
    // Recording ownership first makes a failed update retryable.
    if (files.some(file => !owned.has(file))) {
      await atomicWrite(markerPath, marker([...new Set([...owned, ...files])]))
    }
    await putFiles(source, directory, ordered)
  }

  return { directory, version: manifest.version }
}

module.exports = { prepareClipperInstall }
