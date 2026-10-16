// D3b — executor do Notas (electron/apple-notes.cjs): argumentos validados (nada de injeção), erros classificados
// (permissão negada, timeout, indisponível), cancelamento, só macOS, script JXA somente leitura e fiação IPC.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { createAppleNotes, classifyError, registerAppleNotesIpc, SCRIPT, FOLDER_ID } = require('../electron/apple-notes.cjs')

const ID = 'x-coredata://AAAA-1111/ICFolder/p10'

test('folders/notes: chamam o script com argumentos separados e devolvem a saída aparada', async () => {
  const calls = []
  const notes = createAppleNotes({ platform: 'darwin', run: async (args, options) => { calls.push({ args, options }); return '  {"ok":1}\n' } })
  assert.equal(await notes.folders(), '{"ok":1}')
  assert.equal(await notes.notes(ID, 40, 20), '{"ok":1}')
  assert.deepEqual(calls[0].args, ['folders']); assert.deepEqual(calls[1].args, ['notes', ID, '40', '20'])
  assert.ok(calls[0].options.timeout >= 60_000, 'o 1º acesso espera a resposta ao pedido de permissão')
  assert.ok(calls.every(call => call.options.signal && typeof call.options.timeout === 'number'))
  await notes.notes(ID, -5, 9999); assert.deepEqual(calls[2].args, ['notes', ID, '0', '50'], 'limites aplicados')
})

test('folderId inválido ou com tentativa de injeção é recusado antes de rodar qualquer coisa', async () => {
  let ran = 0
  const notes = createAppleNotes({ platform: 'darwin', run: async () => { ran++; return '{}' } })
  for (const bad of ["x-coredata://a'; do shell script 'rm -rf ~'; '", 'x-coredata://a b', '$(id)', '../../etc/passwd', 'file:///x', '', null, 5, 'x-coredata://' + 'a'.repeat(500)]) {
    assert.throws(() => notes.notes(bad, 0, 10), /APPLE_NOTES_FAILED/, String(bad).slice(0, 30))
  }
  assert.equal(ran, 0)
  assert.ok(FOLDER_ID.test(ID))
})

test('erros do osascript viram códigos estáveis', async () => {
  const mk = (stderr, extra = {}) => createAppleNotes({ platform: 'darwin', run: async () => { throw Object.assign(new Error('Command failed'), { stderr, ...extra }) } })
  await assert.rejects(() => mk('execution error: Not authorized to send Apple events to Notes. (-1743)').folders(), { code: 'APPLE_NOTES_DENIED' })
  await assert.rejects(() => mk('', { killed: true, signal: 'SIGTERM' }).folders(), { code: 'APPLE_NOTES_TIMEOUT' })
  await assert.rejects(() => mk("execution error: Can't get application \"Notes\". (-1728)").folders(), { code: 'APPLE_NOTES_UNAVAILABLE' })
  await assert.rejects(() => mk('algo estranho').folders(), { code: 'APPLE_NOTES_FAILED' })
  await assert.rejects(() => mk('', { name: 'AbortError' }).folders(), { code: 'APPLE_NOTES_ABORTED' })
  assert.equal(classifyError(null, '-1743'), 'APPLE_NOTES_DENIED')
  await assert.rejects(() => createAppleNotes({ platform: 'linux', run: async () => '{}' }).folders(), { code: 'APPLE_NOTES_UNAVAILABLE' })
  await assert.rejects(() => createAppleNotes({ platform: 'darwin', run: async () => 42 }).folders(), { code: 'APPLE_NOTES_FAILED' })
})

test('cancelar aborta a chamada em andamento; uma nova chamada substitui a anterior', async () => {
  let signal
  const notes = createAppleNotes({ platform: 'darwin', run: (args, options) => new Promise((resolve, reject) => { signal = options.signal; options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))) }) })
  const pending = notes.folders()
  const assertion = assert.rejects(pending, { code: 'APPLE_NOTES_ABORTED' })
  notes.cancel(); await assertion
  assert.equal(signal.aborted, true)
})

test('o script JXA só lê: compila, usa os modos folders/notes e não contém escrita nem execução de shell', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8')
  assert.doesNotThrow(() => new vm.Script(source), 'sintaxe válida')
  for (const forbidden of [/\.make\(/, /\.delete\(/, /\.move\(/, /\.show\(/, /doShellScript/, /\bnote\.(body|name)\s*=[^=]/, /\bfolder\.(body|name)\s*=[^=]/, /ObjC\.import/, /\beval\(/, /\.save\(/]) assert.ok(!forbidden.test(source), String(forbidden))
  assert.ok(/passwordProtected/.test(source) && /if \(!locked\)/.test(source), 'corpo de nota protegida nunca é lido')
  assert.ok(/mode === 'folders'/.test(source) && /mode === 'notes'/.test(source))
  // executa o script com um "Notes" falso: o modo notes não chama body() em nota protegida
  const reads = []
  const note = (locked, name) => ({ passwordProtected: () => locked, id: () => 'n-' + name, name: () => name, creationDate: () => new Date(0), modificationDate: () => new Date(0), body: () => { reads.push(name); return '<div>' + name + '</div>' } })
  const list = [note(false, 'aberta'), note(true, 'secreta')]
  const folder = { notes: list }
  const sandbox = { Application: () => ({ folders: { byId: () => folder }, accounts: () => [] }), JSON, Math, parseInt, String }
  const output = vm.runInNewContext(source + "\nrun(['notes','x-coredata://a/ICFolder/p1','0','10'])", sandbox)
  const parsed = JSON.parse(output)
  assert.deepEqual(reads, ['aberta']); assert.equal(parsed.notes[1].locked, true); assert.equal(parsed.notes[1].body, '')
})

test('IPC: np:appleNotes* passam por trustedHandler (sem ipcMain direto) e estão no preload e no main', () => {
  const registered = []
  registerAppleNotesIpc({ trustedHandler: (channel, fn) => registered.push([channel, fn]), notes: { folders: () => 'F', notes: (...a) => a.join(','), cancel: () => true } })
  assert.deepEqual(registered.map(([channel]) => channel), ['np:appleNotesFolders', 'np:appleNotesBatch', 'np:appleNotesCancel'])
  assert.equal(registered[1][1]({}, ID, 1, 2), `${ID},1,2`)
  const preload = fs.readFileSync('electron/preload.cjs', 'utf8'), main = fs.readFileSync('electron/main.cjs', 'utf8'), source = fs.readFileSync('electron/apple-notes.cjs', 'utf8')
  for (const [channel] of registered) assert.ok(preload.includes(`'${channel}'`), channel)
  assert.ok(/registerAppleNotesIpc\(\{ trustedHandler \}\)/.test(main)); assert.ok(!/ipcMain\./.test(source))
  assert.ok(/NSAppleEventsUsageDescription/.test(fs.readFileSync('build/app-info.plist', 'utf8')), 'texto do pedido de Automação')
  assert.ok(/automation\.apple-events/.test(fs.readFileSync('build/entitlements.plist', 'utf8')))
  assert.ok(/Privacy_Automation/.test(fs.readFileSync('electron/native-helper.cjs', 'utf8')), 'atalho para Ajustes → Privacidade → Automação')
})
