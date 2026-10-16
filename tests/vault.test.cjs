const COMPAT = require('../shared/compatibility.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { initializeSecureStorage } = require('../electron/secure-storage.cjs')
const { setStorageCodec, readJson, atomicWrite, drain } = require('../electron/storage.cjs')
const { createWorkspaceStorage, drainWorkspaces } = require('../electron/workspace-storage.cjs')
const vault = require('../electron/vault.cjs')
const vaultWorkspace = require('../electron/vault-workspace.cjs')
const migration = require('../electron/vault-migration.cjs')
const pageLocks = require('../electron/vault-pages.cjs')
const { isPageEncrypted } = require('../electron/encryption.cjs')

const KDF = { N: 2 ** 14, r: 8, p: 1 }
const SECRET = 'SEGREDO-ULTRA-7Q'
const keychain = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(`kc:${text}`), decryptString: bytes => bytes.toString().replace('kc:', '') }
const ROOT_ID = '11111111-1111-4111-8111-111111111111', CHILD_ID = '22222222-2222-4222-8222-222222222222', OTHER_ID = '33333333-3333-4333-8333-333333333333'

function page(id, title, parentId = null) { const body = id === OTHER_ID ? 'público' : SECRET; return { id, parentId, title, icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: 1, updatedAt: 1, order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, text: `${title} ${body}`, bodyText: body } }
const blocks = text => [{ id: 'b1', type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] }]

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), COMPAT.record065))
  await initializeSecureStorage(root, keychain, { deviceCipher: 'keychain' })
  const dir = path.join(root, 'data'), store = createWorkspaceStorage(dir)
  await store.saveMeta({ pages: { [ROOT_ID]: page(ROOT_ID, `Diário ${SECRET}`), [CHILD_ID]: page(CHILD_ID, 'Filha', ROOT_ID), [OTHER_ID]: page(OTHER_ID, 'Pública') }, settings: { locale: 'pt-BR', historyLimit: 0 }, notifications: {}, syncedBlocks: {} })
  await store.saveDoc(ROOT_ID, blocks(`primeira ${SECRET}`))
  await store.saveDoc(ROOT_ID, blocks(`segunda ${SECRET}`))
  await store.saveDoc(CHILD_ID, blocks(`filha ${SECRET}`))
  await store.saveDoc(OTHER_ID, blocks('texto público'))
  await atomicWrite(path.join(dir, 'backups', '1700000000000.json'), JSON.stringify({ format: COMPAT.record011, note: SECRET }))
  return { root, dir, store }
}
async function teardown(root) { await drainWorkspaces(); await drain(); setStorageCodec(null); for (const dir of [...vault.unlockedDirs()]) vault.lock(dir); await fs.rm(root, { recursive: true, force: true }) }
async function files(dir) { return (await migration.walk(dir)).map(rel => path.join(dir, ...rel.split('/'))) }
async function assertNoPlaintext(dir, needle = SECRET) {
  for (const file of await files(dir)) assert.equal((await fs.readFile(file)).includes(Buffer.from(needle)), false, `${path.relative(dir, file)} contains clear text`)
}
function restart(dir) { vault.lock(dir); vault.setEnabled(dir, undefined); vault.state(dir).header = null; pageLocks.forget(dir) }

test('key wrapping: wrong password, recovery key, password change', async () => {
  const { header, dek, recoveryKey } = await vault.createVault('senha-forte-1', { kdf: KDF })
  assert.match(recoveryKey, /^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/)
  assert.equal(header.password.kdf.name, 'scrypt'); assert.equal(Buffer.from(header.password.kdf.salt, 'base64').length, 16)
  assert.ok((await vault.unwrapWithPassword(header, 'senha-forte-1')).equals(dek))
  await assert.rejects(vault.unwrapWithPassword(header, 'senha-errada'), /WRONG_PASSWORD/)
  assert.ok(vault.unwrapWithRecovery(header, recoveryKey.toLowerCase()).equals(dek))
  assert.throws(() => vault.unwrapWithRecovery(header, recoveryKey.replace(/^./, c => c === 'A' ? 'B' : 'A')), /WRONG_RECOVERY/)
  const changed = await vault.rewrapPassword(header, dek, 'outra-senha-2')
  assert.notEqual(changed.password.kdf.salt, header.password.kdf.salt)
  await assert.rejects(vault.unwrapWithPassword(changed, 'senha-forte-1'), /WRONG_PASSWORD/)
  assert.ok((await vault.unwrapWithPassword(changed, 'outra-senha-2')).equals(dek))
  assert.ok(vault.unwrapWithRecovery(changed, recoveryKey).equals(dek), 'recovery key survives a password change')
  assert.throws(() => vault.validatePassword('curta'), /WEAK_PASSWORD/)
  assert.ok(vault.decodeRecovery(vault.encodeRecovery(dek)).equals(dek))
  assert.equal(vault.DEFAULT_KDF.N >= 2 ** 17, true)
})

test('workspace vault encrypts everything, locks, unlocks, changes password, recovers and disables', async () => {
  const { root, dir, store } = await setup()
  try {
    const { recoveryKey } = await vaultWorkspace.enable(dir, 'senha-do-espaco', { kdf: KDF })
    assert.equal(vault.isEnabled(dir), true)
    await assertNoPlaintext(dir)
    for (const file of await files(dir)) {
      const head = (await fs.readFile(file)).subarray(0, 8).toString()
      assert.equal(head, vault.EXEMPT.has(path.relative(dir, file)) ? 'NPENC01\n' : 'NPVLT01\n', path.relative(dir, file))
    }
    assert.equal((await store.loadMeta()).pages[ROOT_ID].title, `Diário ${SECRET}`)
    assert.equal((await store.listVersions(ROOT_ID)).length, 1)
    await store.saveDoc(OTHER_ID, blocks(`novo ${SECRET}`)); await assertNoPlaintext(dir)

    vault.lock(dir)
    await assert.rejects(store.loadMeta(), /VAULT_LOCKED/)
    await assert.rejects(atomicWrite(path.join(dir, 'docs', `${OTHER_ID}.json`), '[]'), /VAULT_LOCKED/)
    await assert.rejects(vaultWorkspace.unlock(dir, 'errada-123'), /WRONG_PASSWORD/)
    await vaultWorkspace.unlock(dir, 'senha-do-espaco')
    assert.equal((await store.loadDoc(OTHER_ID))[0].content[0].text, `novo ${SECRET}`)

    await vaultWorkspace.changePassword(dir, 'senha-do-espaco', 'nova-senha-123', { kdf: KDF })
    restart(dir)
    await assert.rejects(vaultWorkspace.unlock(dir, 'senha-do-espaco'), /WRONG_PASSWORD/)
    await vaultWorkspace.unlock(dir, 'nova-senha-123')
    restart(dir)
    await vaultWorkspace.unlockWithRecovery(dir, recoveryKey, 'pos-recuperacao', { kdf: KDF })
    assert.equal((await store.loadMeta()).pages[OTHER_ID].title, 'Pública')
    restart(dir); await vaultWorkspace.unlock(dir, 'pos-recuperacao')

    await vaultWorkspace.setOptions(dir, { autoLockMinutes: 3, lockOnSleep: false })
    assert.equal((await vaultWorkspace.status(dir)).settings.autoLockMinutes, 3)
    await vaultWorkspace.enableTouchId(dir, keychain)
    restart(dir); await vaultWorkspace.unlockWithKeychain(dir, keychain)
    assert.equal((await store.loadMeta()).pages[OTHER_ID].title, 'Pública')

    await assert.rejects(vaultWorkspace.disable(dir, 'errada-123'), /WRONG_PASSWORD/)
    vaultWorkspace.failures.clear()
    await vaultWorkspace.disable(dir, 'pos-recuperacao')
    assert.equal(vault.isEnabled(dir), false)
    await assert.rejects(fs.access(path.join(dir, vault.HEADER_FILE)))
    await assert.rejects(fs.access(path.join(dir, vault.TOUCH_FILE)))
    await assertNoPlaintext(dir)
    for (const file of await files(dir)) assert.equal((await fs.readFile(file)).subarray(0, 8).toString(), 'NPENC01\n')
    restart(dir)
    assert.equal((await store.loadDoc(ROOT_ID))[0].content[0].text, `segunda ${SECRET}`)
    assert.equal(JSON.parse(JSON.stringify(await readJson(path.join(dir, 'backups', '1700000000000.json')))).note, SECRET)
  } finally { await teardown(root) }
})

test('password guessing is throttled after repeated failures', async () => {
  const { root, dir } = await setup()
  try {
    await vaultWorkspace.enable(dir, 'senha-do-espaco', { kdf: KDF }); vault.lock(dir)
    for (let i = 0; i < 5; i++) await assert.rejects(vaultWorkspace.unlock(dir, `errada-${i}xx`), /WRONG_PASSWORD/)
    await assert.rejects(vaultWorkspace.unlock(dir, 'senha-do-espaco'), /TOO_MANY_ATTEMPTS/)
  } finally { vaultWorkspace.failures.clear(); await teardown(root) }
})

for (const failAt of ['copy', 'verify', 'swap-before', 'swap-middle', 'swap-after']) {
  test(`interrupted migration (${failAt}) never loses data`, async () => {
    const { root, dir, store } = await setup()
    try {
      const before = JSON.stringify(await store.backup())
      await assert.rejects(vaultWorkspace.enable(dir, 'senha-do-espaco', { kdf: KDF, failAt }), /SIMULATED_CRASH/)
      restart(dir)
      // Next launch: initializeSecureStorage recovers the folder before anything else.
      setStorageCodec(null); await initializeSecureStorage(root, keychain, { deviceCipher: 'keychain' })
      await assert.rejects(fs.access(dir + '.vault-new')); await assert.rejects(fs.access(dir + '.vault-old')); await assert.rejects(fs.access(dir + '.vault-journal'))
      const rolledForward = failAt === 'swap-middle' || failAt === 'swap-after'
      assert.equal(vault.isEnabled(dir), rolledForward)
      if (rolledForward) { await assertNoPlaintext(dir); await vaultWorkspace.unlock(dir, 'senha-do-espaco') }
      const after = JSON.parse(JSON.stringify(await store.backup()))
      assert.deepEqual({ ...after, exportedAt: 0 }, { ...JSON.parse(before), exportedAt: 0 })
      if (rolledForward) {
        await assert.rejects(vaultWorkspace.disable(dir, 'senha-do-espaco', { failAt: 'swap-middle' }), /SIMULATED_CRASH/)
        restart(dir); setStorageCodec(null); await initializeSecureStorage(root, keychain, { deviceCipher: 'keychain' })
        assert.equal(vault.isEnabled(dir), false)
        assert.equal((await store.loadDoc(CHILD_ID))[0].content[0].text, `filha ${SECRET}`)
      }
    } finally { await teardown(root) }
  })
}

test('password-protected pages: sealed on disk, out of meta index, backups and the local API', async () => {
  const { root, dir, store } = await setup()
  try {
    await store.protectPages(ROOT_ID, 'senha-da-pagina', { includeChildren: true, hideTitle: true, kdf: KDF })
    const rel = file => path.relative(dir, file).split(path.sep).join('/')
    for (const id of [ROOT_ID, CHILD_ID]) for (const file of await store.pageFiles(id)) assert.equal(isPageEncrypted(vault.decodeOuter(dir, rel(file), await fs.readFile(file))), true, rel(file))
    const disk = await readJson(path.join(dir, 'meta.json'))
    assert.equal(disk.pages[ROOT_ID].title, ''); assert.equal(disk.pages[ROOT_ID].text, ''); assert.equal(disk.pages[CHILD_ID].bodyText, '')
    assert.equal(JSON.stringify([disk.pages[ROOT_ID], disk.pages[CHILD_ID]]).includes(SECRET), false, 'meta index has no protected text')
    assert.equal((await store.loadMeta()).pages[ROOT_ID].title, `Diário ${SECRET}`, 'unlocked session reveals the title')

    pageLocks.relock(dir, ROOT_ID)
    await assert.rejects(store.loadDoc(ROOT_ID), /PAGE_LOCKED/)
    await assert.rejects(store.listVersions(ROOT_ID), /PAGE_LOCKED/); await assert.rejects(store.loadDoc(CHILD_ID), /PAGE_LOCKED/)
    const meta = await store.loadMeta()
    assert.equal(meta.pages[ROOT_ID].title, ''); assert.deepEqual(meta.pages[ROOT_ID].passwordLock, { rootId: ROOT_ID, hideTitle: true, inherit: true, unlocked: false })
    // Ordinary edits elsewhere keep working while the page is locked.
    await store.saveMeta({ ...meta, pages: { ...meta.pages, [OTHER_ID]: { ...meta.pages[OTHER_ID], title: 'Pública 2' } } }, meta)
    assert.equal((await readJson(path.join(dir, 'meta.json'))).pages[ROOT_ID].passwordLock.sealedTitle.length > 10, true)
    await assert.rejects(store.saveDoc(ROOT_ID, blocks('x')), /PAGE_LOCKED/)
    const backup = JSON.stringify(await store.backup())
    assert.equal(backup.includes(SECRET), false, 'backups never carry protected clear text')
    assert.equal(Object.keys(JSON.parse(backup).sealedPages).length, 2)
    assert.equal(JSON.stringify(await store.listActivity()).includes(SECRET), false)

    const api = pageLocks.guardForApi(store)
    const apiMeta = await api.loadMeta()
    assert.equal(apiMeta.pages[ROOT_ID].trashed, true); assert.equal(apiMeta.pages[CHILD_ID].title, '')
    await assert.rejects(api.loadDoc(CHILD_ID), /Page not found/)
    await api.saveMeta({ ...apiMeta, pages: { ...apiMeta.pages, [OTHER_ID]: { ...apiMeta.pages[OTHER_ID], title: 'Via API' } } }, apiMeta)
    const afterApi = await readJson(path.join(dir, 'meta.json'))
    assert.equal(afterApi.pages[ROOT_ID].trashed, false, 'API cannot alter protected pages'); assert.equal(afterApi.pages[OTHER_ID].title, 'Via API')
    assert.equal((await api.listActivity()).some(entry => entry.pageId === ROOT_ID), false)

    await assert.rejects(pageLocks.unlock(dir, ROOT_ID, 'errada-123'), /WRONG_PASSWORD/)
    await pageLocks.unlock(dir, ROOT_ID, 'senha-da-pagina')
    assert.equal((await store.loadDoc(CHILD_ID))[0].content[0].text, `filha ${SECRET}`)
    assert.equal((await store.loadMeta()).pages[ROOT_ID].title, `Diário ${SECRET}`)
    await pageLocks.changePassword(dir, ROOT_ID, 'senha-da-pagina', 'nova-pagina-1', atomicWrite)
    pageLocks.relock(dir, ROOT_ID); pageLocks.forget(dir)
    await assert.rejects(pageLocks.unlock(dir, ROOT_ID, 'senha-da-pagina'), /WRONG_PASSWORD/)
    await pageLocks.unlock(dir, ROOT_ID, 'nova-pagina-1')

    // Works under a workspace vault too, and survives enabling it.
    await vaultWorkspace.enable(dir, 'senha-do-espaco', { kdf: KDF })
    await assertNoPlaintext(dir)
    restart(dir); await vaultWorkspace.unlock(dir, 'senha-do-espaco')
    await assert.rejects(store.loadDoc(ROOT_ID), /PAGE_LOCKED/)
    await pageLocks.unlock(dir, ROOT_ID, 'nova-pagina-1')
    await store.unprotectPages(ROOT_ID)
    restart(dir); await vaultWorkspace.unlock(dir, 'senha-do-espaco')
    assert.equal((await store.loadDoc(ROOT_ID))[0].content[0].text, `segunda ${SECRET}`)
    const plain = await store.loadMeta()
    assert.equal(plain.pages[ROOT_ID].title, `Diário ${SECRET}`); assert.equal(plain.pages[ROOT_ID].passwordLock, undefined)
  } finally { await teardown(root) }
})

test('interrupted page protection keeps clear text readable and reseals it on unlock', async () => {
  const { root, dir, store } = await setup()
  try {
    await store.protectPages(OTHER_ID, 'senha-da-pagina', { kdf: KDF })
    // Simulate a crash after the key record was written but before files were sealed.
    const file = path.join(dir, 'docs', `${OTHER_ID}.json`)
    pageLocks.registry(dir).unsealing.add(OTHER_ID)
    await atomicWrite(file, JSON.stringify(blocks('ainda legível')))
    pageLocks.registry(dir).unsealing.delete(OTHER_ID)
    pageLocks.forget(dir)
    // The clear-text file stays readable (no data loss) until it is resealed.
    assert.equal((await store.loadDoc(OTHER_ID))[0].content[0].text, 'ainda legível')
    await pageLocks.unlock(dir, OTHER_ID, 'senha-da-pagina')
    assert.equal(await store.resealProtected(OTHER_ID), 1)
    assert.equal(isPageEncrypted(vault.decodeOuter(dir, `docs/${OTHER_ID}.json`, await fs.readFile(file))), true)
  } finally { await teardown(root) }
})

test('password hints: readable before unlocking only from the lock metadata, validated and removed with the protection', async () => {
  const { root, dir, store } = await setup()
  const HINT = 'DICA-UNICA-azul'
  const outer = async () => { const found = []; for (const file of await files(dir)) { const rel = path.relative(dir, file).split(path.sep).join('/'); if (vault.decodeOuter(dir, rel, await fs.readFile(file)).includes(Buffer.from(HINT))) found.push(rel) } return found }
  try {
    assert.throws(() => vault.normalizeHint('minha SENHA-do-espaco', 'senha-do-espaco'), /HINT_HAS_PASSWORD/)
    assert.throws(() => vault.normalizeHint('x'.repeat(121), 'senha-do-espaco'), /HINT_TOO_LONG/)
    await assert.rejects(vaultWorkspace.enable(dir, 'senha-do-espaco', { kdf: KDF, hint: 'é senha-do-espaco' }), /HINT_HAS_PASSWORD/)
    assert.equal(vault.isEnabled(dir), false, 'a rejected hint changes nothing')
    await vaultWorkspace.enable(dir, 'senha-do-espaco', { kdf: KDF, hint: HINT })
    restart(dir)
    assert.equal((await vaultWorkspace.status(dir)).hint, HINT, 'hint available while locked')
    for (const file of await files(dir)) assert.equal((await fs.readFile(file)).includes(Buffer.from(HINT)), false, 'never clear text on disk (vault.json is device-encrypted)')
    await vaultWorkspace.unlock(dir, 'senha-do-espaco')
    assert.deepEqual(await outer(), ['vault.json'], 'only the vault header carries the hint')
    await assert.rejects(vaultWorkspace.changePassword(dir, 'senha-do-espaco', 'azul-nova', { hint: 'DICA azul-nova' }), /HINT_HAS_PASSWORD/)
    await vaultWorkspace.changePassword(dir, 'senha-do-espaco', 'outra-senha-9', { kdf: KDF })
    assert.equal((await vaultWorkspace.status(dir)).hint, HINT, 'kept when not edited')
    await vaultWorkspace.changePassword(dir, 'outra-senha-9', 'outra-senha-10', { kdf: KDF, hint: '' })
    assert.equal((await vaultWorkspace.status(dir)).hint, null, 'cleared when emptied')
    await vaultWorkspace.changePassword(dir, 'outra-senha-10', 'outra-senha-11', { kdf: KDF, hint: HINT })

    await assert.rejects(store.protectPages(ROOT_ID, 'senha-da-pagina', { kdf: KDF, hint: 'SENHA-DA-PAGINA!' }), /HINT_HAS_PASSWORD/)
    await store.protectPages(ROOT_ID, 'senha-da-pagina', { includeChildren: true, kdf: KDF, hint: `${HINT}-p` })
    pageLocks.relock(dir, ROOT_ID); pageLocks.forget(dir)
    assert.equal(pageLocks.hintOf(dir, CHILD_ID), `${HINT}-p`, 'page hint readable while the page is locked')
    assert.deepEqual((await outer()).sort(), ['page-locks.json', 'vault.json'])
    assert.equal(JSON.stringify(await store.loadMeta()).includes(HINT), false, 'not in meta (search index)')
    assert.equal(JSON.stringify(await store.backup()).includes(HINT), false, 'not in backups/exports')
    assert.equal(JSON.stringify(await pageLocks.guardForApi(store).loadMeta()).includes(HINT), false, 'not in the local API')
    await pageLocks.changePassword(dir, ROOT_ID, 'senha-da-pagina', 'nova-pagina-1', atomicWrite, { hint: 'outra dica' })
    assert.equal(pageLocks.hintOf(dir, ROOT_ID), 'outra dica')
    await store.unprotectPages(ROOT_ID)
    assert.equal(pageLocks.hintOf(dir, ROOT_ID), null)
    assert.deepEqual(await outer(), ['vault.json'], 'page hint removed with the protection')
    await vaultWorkspace.disable(dir, 'outra-senha-11')
    assert.deepEqual(await outer(), [], 'workspace hint removed with the password')
  } finally { await teardown(root) }
})

test('quick capture drafts follow the workspace cipher, migrate on enable/disable and survive a locked vault', async () => {
  const { createQuickDrafts } = require('../electron/quick-drafts.cjs')
  const { root, dir } = await setup()
  try {
    const DRAFT = 'RASCUNHO-RAPIDO-Z9'
    // Versão antiga: rascunho em texto claro na raiz dos dados.
    await fs.writeFile(path.join(root, 'quick-draft.json'), JSON.stringify({ title: DRAFT, body: 'corpo' }))
    const drafts = createQuickDrafts({ userData: () => root, dataDir: () => dir, isLocked: () => vault.isLocked(dir) })
    // Ativar a senha: o rascunho antigo entra na pasta do espaço e o texto claro é apagado.
    await drafts.purgeLegacy('default')
    await assert.rejects(fs.access(path.join(root, 'quick-draft.json')))
    await vaultWorkspace.enable(dir, 'senha-forte-1', { kdf: KDF })
    const draftPath = path.join(dir, 'quick-draft.json')
    const raw = await fs.readFile(draftPath)
    assert.equal(raw.subarray(0, 8).toString(), 'NPVLT01\n', 'draft is sealed by the vault layer')
    assert.equal(raw.includes(Buffer.from(DRAFT)), false)
    assert.equal((await drafts.load('default')).draft.title, DRAFT)
    // Novo texto com o espaço desbloqueado: cifrado em disco.
    await drafts.save('default', { title: `${DRAFT}-2`, body: SECRET })
    await drafts.saveInbox('default', ROOT_ID)
    await assertNoPlaintext(root, DRAFT)
    await assertNoPlaintext(root, SECRET)
    for (const name of ['quick-draft.json', 'quick-capture.json']) assert.equal((await fs.readFile(path.join(dir, name))).subarray(0, 8).toString(), 'NPVLT01\n', name)
    // Bloqueado: nada vai a disco, o texto fica na memória e nada se perde.
    vault.lock(dir)
    const before = await fs.readFile(draftPath)
    const locked = await drafts.save('default', { title: `${DRAFT}-3`, body: 'escrito bloqueado' })
    assert.equal(locked.locked, true)
    assert.ok((await fs.readFile(draftPath)).equals(before), 'locked vault: file untouched')
    const whileLocked = await drafts.load('default')
    assert.equal(whileLocked.locked, true); assert.equal(whileLocked.draft.title, `${DRAFT}-3`)
    assert.equal(await drafts.loadInbox('default'), null)
    await assert.rejects(fs.access(path.join(root, 'quick-draft.json')))
    // Desbloquear: o rascunho da memória é gravado (cifrado) no próximo acesso.
    await vaultWorkspace.unlock(dir, 'senha-forte-1')
    await drafts.flushAll()
    assert.equal(drafts.hasPending('default'), false)
    assert.equal((await readJson(draftPath)).title, `${DRAFT}-3`)
    await assertNoPlaintext(root, 'escrito bloqueado')
    // Desativar a senha: volta para a camada do dispositivo, ainda sem texto claro.
    await vaultWorkspace.disable(dir, 'senha-forte-1')
    const afterDisable = await fs.readFile(draftPath)
    assert.equal(afterDisable.subarray(0, 8).toString(), 'NPENC01\n')
    assert.equal(afterDisable.includes(Buffer.from('escrito bloqueado')), false)
    assert.equal((await drafts.load('default')).draft.title, `${DRAFT}-3`)
    assert.equal(await drafts.loadInbox('default'), ROOT_ID)
  } finally { await teardown(root) }
})

test('legacy plaintext draft is kept until the locked workspace can store it encrypted', async () => {
  const { createQuickDrafts } = require('../electron/quick-drafts.cjs')
  const { root, dir } = await setup()
  try {
    await vaultWorkspace.enable(dir, 'senha-forte-1', { kdf: KDF })
    vault.lock(dir)
    const legacy = path.join(root, 'quick-draft.json')
    await fs.writeFile(legacy, JSON.stringify({ title: 'antigo' }))
    const drafts = createQuickDrafts({ userData: () => root, dataDir: () => dir, isLocked: () => vault.isLocked(dir) })
    const first = await drafts.load('default')
    assert.equal(first.locked, true); assert.equal(first.draft.title, 'antigo')
    await fs.access(legacy) // ainda não apagado: não havia como gravar cifrado
    await vaultWorkspace.unlock(dir, 'senha-forte-1')
    await drafts.load('default')
    await assert.rejects(fs.access(legacy))
    assert.equal((await fs.readFile(path.join(dir, 'quick-draft.json'))).subarray(0, 8).toString(), 'NPVLT01\n')
  } finally { await teardown(root) }
})

test('subpages: rejected under a locked page (store, API, import), inherited when unlocked, repairable', async () => {
  const { root, dir, store } = await setup()
  const NEW = '55555555-5555-4555-8555-555555555555', NEW2 = '66666666-6666-4666-8666-666666666666'
  const KID = 'FILHA-NOVA-SEGREDO'
  try {
    await store.protectPages(ROOT_ID, 'senha-da-pagina', { includeChildren: true, kdf: KDF })
    pageLocks.relock(dir, ROOT_ID)
    let meta = await store.loadMeta()
    // Locked: every way of adding a page below it fails in the main process.
    await assert.rejects(store.saveMeta({ ...meta, pages: { ...meta.pages, [NEW]: page(NEW, KID, ROOT_ID) } }, meta), /PARENT_LOCKED/)
    await assert.rejects(store.saveMeta({ ...meta, pages: { ...meta.pages, [NEW]: page(NEW, KID, CHILD_ID) } }, meta), /PARENT_LOCKED/, 'grandchild too')
    await assert.rejects(store.saveMeta({ ...meta, pages: { ...meta.pages, [OTHER_ID]: { ...meta.pages[OTHER_ID], parentId: ROOT_ID } } }, meta), /PARENT_LOCKED/, 'move into it')
    await assert.rejects(store.mutateMeta(current => ({ ...current, pages: { ...current.pages, [NEW]: page(NEW, KID, ROOT_ID) } })), /PARENT_LOCKED/, 'quick capture / scheduled writes')
    const api = pageLocks.guardForApi(store), apiMeta = await api.loadMeta()
    await assert.rejects(api.saveMeta({ ...apiMeta, pages: { ...apiMeta.pages, [NEW]: page(NEW, KID, ROOT_ID) } }, apiMeta), /PARENT_LOCKED/, 'local API/MCP')
    assert.equal((await store.loadMeta()).pages[NEW], undefined)

    // Unlocked + "include subpages": a new subpage is adopted on save, content sealed.
    await pageLocks.unlock(dir, ROOT_ID, 'senha-da-pagina')
    meta = await store.loadMeta()
    const saved = await store.saveMeta({ ...meta, pages: { ...meta.pages, [NEW]: { ...page(NEW, KID, ROOT_ID), text: KID } } }, meta)
    assert.equal(saved.pages[NEW].passwordLock.rootId, ROOT_ID, 'returned with its lock')
    await store.saveDoc(NEW, blocks(`corpo ${KID}`))
    assert.equal(isPageEncrypted(vault.decodeOuter(dir, `docs/${NEW}.json`, await fs.readFile(path.join(dir, 'docs', `${NEW}.json`)))), true)
    // Moving an existing page in seals its existing document; moving a protected page out keeps its lock.
    meta = await store.loadMeta()
    await store.saveMeta({ ...meta, pages: { ...meta.pages, [OTHER_ID]: { ...meta.pages[OTHER_ID], parentId: ROOT_ID }, [CHILD_ID]: { ...meta.pages[CHILD_ID], parentId: null } } }, meta)
    assert.equal(isPageEncrypted(vault.decodeOuter(dir, `docs/${OTHER_ID}.json`, await fs.readFile(path.join(dir, 'docs', `${OTHER_ID}.json`)))), true)
    assert.equal(pageLocks.rootOf(dir, CHILD_ID), ROOT_ID)

    // Locked again: nothing about the new child leaks.
    pageLocks.relock(dir, ROOT_ID)
    await assert.rejects(store.loadDoc(NEW), /PAGE_LOCKED/)
    const disk = await readJson(path.join(dir, 'meta.json'))
    assert.equal(disk.pages[NEW].text, '', 'search index')
    assert.equal(JSON.stringify(await store.backup()).includes(`corpo ${KID}`), false, 'exports/backups')
    const apiView = await pageLocks.guardForApi(store).loadMeta()
    assert.equal(JSON.stringify(apiView.pages[NEW]).includes(KID), false, 'local API')
    await assert.rejects(pageLocks.guardForApi(store).loadDoc(NEW), /Page not found/)

    // Locks without inheritance leave new subpages alone; the repair protects them later.
    const LOOSE = '77777777-7777-4777-8777-777777777777'
    await pageLocks.unlock(dir, ROOT_ID, 'senha-da-pagina')
    const data = pageLocks.registry(dir).data
    data.roots[ROOT_ID].includeChildren = false
    meta = await store.loadMeta()
    const loose = await store.saveMeta({ ...meta, pages: { ...meta.pages, [LOOSE]: page(LOOSE, 'solta', ROOT_ID), [NEW2]: page(NEW2, 'solta 2', LOOSE) } }, meta)
    assert.equal(loose.pages[LOOSE].passwordLock, undefined, 'no inheritance requested')
    const repaired = await store.protectChildren(ROOT_ID)
    assert.equal(repaired.added, 2)
    assert.equal(repaired.meta.pages[NEW2].passwordLock.rootId, ROOT_ID)
    // Records saved before the flag existed inherit when they already cover subpages.
    delete data.roots[ROOT_ID].includeChildren
    assert.equal(pageLocks.inherits(data.roots[ROOT_ID], ROOT_ID), true)
  } finally { await teardown(root) }
})
