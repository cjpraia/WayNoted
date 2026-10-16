// B5 — abrir .md avulso: validação de arquivo (tipo, 10 MB, UTF-8, binário), salvar de volta só com fileId,
// detecção de alteração externa, BOM preservado e fiação IPC (trustedHandler, sem caminhos vindos do renderer).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const nodefs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createOpenFiles, readTextFile, isOpenablePath, MAX_BYTES } = require('../electron/open-file.cjs')

async function tmp(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-openfile-"))
  try { await fn(dir) } finally { await fs.rm(dir, { recursive: true, force: true }) }
}

test('isOpenablePath: só caminhos absolutos .md/.markdown/.txt', () => {
  for (const ok of ['/a/b.md', '/a/b.MARKDOWN', '/a/b.txt', '/a/b.mdown']) assert.equal(isOpenablePath(ok), true, ok)
  for (const bad of ['b.md', '/a/b.pdf', '/a/b.md\0.png', '', null, undefined, 42, '/a/.md.exe']) assert.equal(isOpenablePath(bad), false, String(bad))
})

test('leitura: UTF-8, BOM removido do texto, hash estável e tamanho', async () => tmp(async dir => {
  const file = path.join(dir, 'nota.md')
  await fs.writeFile(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Olá ação\n', 'utf8')]))
  const read = await readTextFile(file)
  assert.equal(read.text, '# Olá ação\n'); assert.equal(read.bom, true); assert.equal(read.name, 'nota.md')
  assert.match(read.hash, /^[a-f0-9]{64}$/)
}))

test('guardas: tipo, tamanho (10 MB), binário, não-UTF-8, pasta e inexistente', async () => tmp(async dir => {
  const code = async file => readTextFile(file).then(() => 'ok', error => error.code)
  await fs.writeFile(path.join(dir, 'a.pdf'), 'x'); assert.equal(await code(path.join(dir, 'a.pdf')), 'FILE_TYPE')
  await fs.writeFile(path.join(dir, 'big.md'), Buffer.alloc(MAX_BYTES + 1, 97)); assert.equal(await code(path.join(dir, 'big.md')), 'FILE_TOO_LARGE')
  await fs.writeFile(path.join(dir, 'edge.md'), Buffer.alloc(MAX_BYTES, 97)); assert.equal(await code(path.join(dir, 'edge.md')), 'ok', 'exatamente 10 MB passa')
  await fs.writeFile(path.join(dir, 'bin.md'), Buffer.from([65, 0, 66])); assert.equal(await code(path.join(dir, 'bin.md')), 'FILE_BINARY')
  await fs.writeFile(path.join(dir, 'latin.txt'), Buffer.from([0xe7, 0xe3, 0x6f])); assert.equal(await code(path.join(dir, 'latin.txt')), 'FILE_NOT_UTF8')
  await fs.mkdir(path.join(dir, 'pasta.md')); assert.equal(await code(path.join(dir, 'pasta.md')), 'FILE_TYPE')
  assert.equal(await code(path.join(dir, 'nao-existe.md')), 'FILE_UNREADABLE')
  assert.equal(await code('relativo.md'), 'FILE_TYPE')
}))

test('salvar: nada é gravado sem save(); save grava no próprio arquivo e preserva BOM e modo', async () => tmp(async dir => {
  const file = path.join(dir, 'x.md')
  await fs.writeFile(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('um', 'utf8')]), { mode: 0o640 })
  const files = createOpenFiles()
  const view = await files.open(file)
  assert.equal(view.text, 'um'); assert.equal(typeof view.fileId, 'string')
  assert.equal(await fs.readFile(file, 'utf8'), '﻿um', 'abrir não altera o arquivo')
  assert.deepEqual(await files.save(view.fileId, 'dois'), { saved: true })
  const bytes = await fs.readFile(file)
  assert.equal(bytes.toString('utf8'), '﻿dois')
  assert.equal(nodefs.statSync(file).mode & 0o777, 0o640)
  assert.deepEqual((await fs.readdir(dir)).filter(name => name.includes('.tmp')), [], 'sem temporários')
  assert.equal((await files.check(view.fileId)).state, 'same', 'depois de salvar o hash é o novo')
}))

test('alteração externa: check/save detectam, save recusa sem force, reload e force resolvem', async () => tmp(async dir => {
  const file = path.join(dir, 'y.md'); await fs.writeFile(file, 'original')
  const files = createOpenFiles(), { fileId } = await files.open(file)
  await fs.writeFile(file, 'editado por outro app')
  assert.equal((await files.check(fileId)).state, 'changed')
  assert.deepEqual(await files.save(fileId, 'minha versão'), { saved: false, conflict: 'changed' })
  assert.equal(await fs.readFile(file, 'utf8'), 'editado por outro app', 'o conflito não sobrescreve')
  const reloaded = await files.reload(fileId); assert.equal(reloaded.text, 'editado por outro app')
  assert.equal((await files.check(fileId)).state, 'same')
  await fs.writeFile(file, 'mudou de novo')
  assert.deepEqual(await files.save(fileId, 'forçado', { force: true }), { saved: true })
  assert.equal(await fs.readFile(file, 'utf8'), 'forçado')
  await fs.rm(file)
  assert.equal((await files.check(fileId)).state, 'missing')
  assert.deepEqual(await files.save(fileId, 'recriar'), { saved: false, conflict: 'missing' })
  assert.deepEqual(await files.save(fileId, 'recriar', { force: true }), { saved: true })
}))

test('fileId desconhecido ou liberado é recusado; reabrir o mesmo caminho reaproveita o id; a lista é limitada', async () => tmp(async dir => {
  const files = createOpenFiles(); const file = path.join(dir, 'z.md'); await fs.writeFile(file, 'a')
  const first = await files.open(file), again = await files.open(file)
  assert.equal(first.fileId, again.fileId); assert.equal(files.size(), 1)
  await assert.rejects(() => files.save('../../etc/passwd', 'x'), /FILE_UNKNOWN/)
  await assert.rejects(() => files.save('inventado', 'x'), /FILE_UNKNOWN/)
  files.release(first.fileId)
  await assert.rejects(() => files.check(first.fileId), /FILE_UNKNOWN/)
  for (let i = 0; i < 40; i++) { const p = path.join(dir, `n${i}.md`); await fs.writeFile(p, String(i)); await files.open(p) }
  assert.ok(files.size() <= 30)
}))

test('fiação: canais np:openMarkdownFile/np:externalFile* passam por trustedHandler; main só abre caminhos validados', () => {
  const main = nodefs.readFileSync('electron/main.cjs', 'utf8'), preload = nodefs.readFileSync('electron/preload.cjs', 'utf8'), ipc = nodefs.readFileSync('electron/open-file.cjs', 'utf8')
  for (const channel of ['np:openMarkdownFile', 'np:externalFileCheck', 'np:externalFileReload', 'np:externalFileSave', 'np:externalFileRelease']) {
    assert.ok(preload.includes(`'${channel}'`), `preload ${channel}`)
    assert.ok(ipc.includes(`trustedHandler('${channel}'`), `trustedHandler ${channel}`)
  }
  assert.ok(!/ipcMain\./.test(ipc), 'open-file.cjs só usa trustedHandler')
  assert.ok(/app\.on\('open-file'/.test(main) && /second-instance[\s\S]{0,400}isOpenablePath/.test(main), 'open-file do macOS e second-instance')
  assert.ok(/CFBundleDocumentTypes/.test(nodefs.readFileSync('build/app-info.plist', 'utf8')), 'tipos de documento declarados')
  assert.ok(!/externalFileSave[^\n]*path/i.test(preload), 'o renderer não envia caminhos')
})
