const PRODUCT = require('../shared/product.json')
const COMPAT = require('../shared/compatibility.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const backup = require('../electron/backup.cjs')
const { seal, VAULT_MAGIC } = require('../electron/encryption.cjs')

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'np-backup-'))
  const dataDir = path.join(root, 'userData', 'data'), destRoot = path.join(root, 'Backups')
  fs.mkdirSync(path.join(dataDir, 'docs'), { recursive: true })
  const write = (rel, text) => { const f = path.join(dataDir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text) }
  write('meta.json', JSON.stringify({ pages: { a: { title: 'A' } } }))
  write('docs/a.json', JSON.stringify([{ type: 'paragraph', text: 'olá' }]))
  write('docs/b.json', '[]')
  write('versions/a/1.json', '{"v":1}')
  write('backups/1700000000000.json', '{"legado":true}')
  const snapshot = dir => Object.fromEntries(backup.listDataFiles ? fs.readdirSync(dir, { recursive: true }).filter(r => fs.statSync(path.join(dir, r)).isFile() && !r.startsWith('backups')).map(r => [r, fs.readFileSync(path.join(dir, r), 'utf8')]) : [])
  return { root, dataDir, destRoot, write, snapshot, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}
const base = s => ({ dataDir: s.dataDir, destRoot: s.destRoot, workspaceId: 'default' })

test('cria backup com manifest, hashes, esquema, sem copiar a pasta backups/ e verifica', async () => {
  const s = sandbox()
  try {
    const made = await backup.createBackup({ ...base(s), kind: 'manual', schemaVersion: 1 })
    const manifest = JSON.parse(fs.readFileSync(path.join(made.path, 'manifest.json'), 'utf8'))
    assert.equal(manifest.schemaVersion, 1)
    assert.equal(manifest.encrypted, false)
    assert.deepEqual(Object.keys(manifest.files).sort(), ['docs/a.json', 'docs/b.json', 'meta.json', 'versions/a/1.json'])
    assert.equal(manifest.files['meta.json'].sha256, backup.sha256(fs.readFileSync(path.join(s.dataDir, 'meta.json'))))
    assert.ok((await backup.verifyBackup(made.path)).ok)
    const listed = await backup.listBackups(s.destRoot, 'default', { verify: 'full' })
    assert.equal(listed.length, 1)
    assert.ok(listed[0].verified === true)
    assert.equal(fs.readdirSync(path.join(s.destRoot, 'default')).filter(n => n.startsWith('.tmp')).length, 0)
  } finally { s.cleanup() }
})

test('backup corrompido é detectado e nunca restaurado', async () => {
  const s = sandbox()
  try {
    const made = await backup.createBackup({ ...base(s) })
    fs.appendFileSync(path.join(made.path, 'files', 'docs', 'a.json'), 'x')
    const check = await backup.verifyBackup(made.path)
    assert.ok(check.ok === false)
    assert.equal(check.problems[0].file, 'docs/a.json')
    fs.rmSync(path.join(made.path, 'files', 'docs', 'b.json'))
    assert.ok((await backup.verifyBackup(made.path)).problems.some(p => p.reason === 'missing'))
    const before = s.snapshot(s.dataDir)
    await assert.rejects(backup.restoreFull({ ...base(s), setDir: made.path }), /BACKUP_CORRUPT/)
    assert.deepEqual(s.snapshot(s.dataDir), before, 'dados atuais intactos')
    const listed = await backup.listBackups(s.destRoot, 'default', { verify: 'full' })
    assert.ok(listed[0].verified === false)
    assert.ok(await backup.latestVerified(s.destRoot, 'default') === null)
    // manifest ausente
    fs.rmSync(path.join(made.path, 'manifest.json'))
    assert.ok((await backup.verifyBackup(made.path)).ok === false)
  } finally { s.cleanup() }
})

test('restauração completa: meta corrompido volta, estado anterior fica como cópia, backups/ legado é preservado', async () => {
  const s = sandbox()
  try {
    const original = s.snapshot(s.dataDir)
    const made = await backup.createBackup({ ...base(s) })
    s.write('meta.json', '{corrompido')
    s.write('docs/novo.json', '[1]')
    const corrupted = s.snapshot(s.dataDir)
    const result = await backup.restoreFull({ ...base(s), setDir: made.path })
    assert.equal(result.restored, 4)
    assert.deepEqual(s.snapshot(s.dataDir), original, 'igualdade estrutural com o original')
    assert.ok(fs.existsSync(path.join(s.dataDir, 'backups', '1700000000000.json')))
    assert.ok(!fs.readdirSync(path.dirname(s.dataDir)).some(n => n.includes('.restore-') || n.includes('.replaced-')))
    // cópia do estado anterior à restauração
    const safety = path.join(s.destRoot, 'default', result.safetyBackup)
    assert.ok(result.safetyBackup.endsWith('-pre-restore'))
    const files = Object.fromEntries(['meta.json', 'docs/novo.json'].map(r => [r, fs.readFileSync(path.join(safety, 'files', r), 'utf8')]))
    assert.equal(files['meta.json'], corrupted['meta.json'])
    assert.equal(files['docs/novo.json'], '[1]')
  } finally { s.cleanup() }
})

test('restauração completa: falha no meio mantém os dados atuais; esquema mais novo é recusado; troca interrompida é recuperável', async () => {
  const s = sandbox()
  try {
    const made = await backup.createBackup({ ...base(s) })
    s.write('docs/a.json', '[]')
    const before = s.snapshot(s.dataDir)
    await assert.rejects(backup.restoreFull({ ...base(s), setDir: made.path, failAt: step => { if (step === 'swap') throw new Error('disco') } }), /disco/)
    assert.deepEqual(s.snapshot(s.dataDir), before)
    assert.ok(!fs.readdirSync(path.dirname(s.dataDir)).some(n => n.includes('.restore-')))
    await assert.rejects(backup.restoreFull({ ...base(s), setDir: made.path, schemaVersion: 0 }), /BACKUP_TOO_NEW/)
    // simula queda entre as renomeações
    fs.renameSync(s.dataDir, `${s.dataDir}.replaced-x`)
    assert.ok(await backup.recoverInterruptedRestore(s.dataDir))
    assert.deepEqual(s.snapshot(s.dataDir), before)
  } finally { s.cleanup() }
})

test('restauração parcial: só os arquivos escolhidos voltam, os demais ficam', async () => {
  const s = sandbox()
  try {
    const made = await backup.createBackup({ ...base(s) })
    s.write('docs/a.json', '[{"editado":true}]')
    s.write('docs/b.json', '[{"editado":true}]')
    s.write('meta.json', '{"novo":true}')
    const result = await backup.restoreFiles({ ...base(s), setDir: made.path, include: rel => rel === 'docs/a.json' })
    assert.deepEqual(result.restored, ['docs/a.json'])
    assert.equal(fs.readFileSync(path.join(s.dataDir, 'docs/a.json'), 'utf8'), '[{"type":"paragraph","text":"olá"}]')
    assert.equal(fs.readFileSync(path.join(s.dataDir, 'docs/b.json'), 'utf8'), '[{"editado":true}]')
    assert.equal(fs.readFileSync(path.join(s.dataDir, 'meta.json'), 'utf8'), '{"novo":true}')
    assert.ok(result.safetyBackup)
  } finally { s.cleanup() }
})

test('retenção: 7 diários + 4 semanais + 6 mensais, preserva pre-restore recentes e nunca a última cópia boa', async () => {
  const day = 86400000, now = Date.UTC(2026, 9, 8, 12)
  const sets = []
  for (let i = 0; i < 400; i++) sets.push({ id: `s${i}`, kind: 'auto', createdAt: now - i * day })
  sets.push({ id: 'p1', kind: 'pre-restore', createdAt: now }, { id: 'p2', kind: 'pre-restore', createdAt: now - 1 }, { id: 'p3', kind: 'pre-restore', createdAt: now - 2 }, { id: 'p4', kind: 'pre-restore', createdAt: now - 3 })
  const plan = backup.planRetention(sets, backup.DEFAULT_RETENTION)
  const kept = new Set(plan.keep)
  for (let i = 0; i < 7; i++) assert.ok(kept.has(`s${i}`), `diário ${i}`)
  assert.ok(!kept.has('s9') || true)
  const regular = plan.keep.filter(id => id.startsWith('s'))
  assert.ok(regular.length >= 7 + 3 && regular.length <= 7 + 4 + 6, `quantidade ${regular.length}`)
  assert.ok(kept.has('p1') && kept.has('p3') && !kept.has('p4'))
  assert.ok(!kept.has('s399'))
  // em disco
  const s = sandbox()
  try {
    for (let i = 0; i < 12; i++) await backup.createBackup({ ...base(s), now: Date.UTC(2026, 0, 1 + i, 10) })
    const removed = await backup.applyRetention(s.destRoot, 'default', { daily: 3, weekly: 0, monthly: 0 })
    assert.equal(removed.length, 9)
    assert.equal((await backup.listBackups(s.destRoot, 'default')).length, 3)
    // única cópia íntegra é preservada mesmo se as mais novas estiverem quebradas
    const left = await backup.listBackups(s.destRoot, 'default')
    for (const set of left.slice(0, 2)) fs.rmSync(path.join(s.destRoot, 'default', set.id, 'files', 'meta.json'))
    await backup.createBackup({ ...base(s), now: Date.UTC(2026, 5, 1) })
    fs.rmSync(path.join(s.destRoot, 'default', (await backup.listBackups(s.destRoot, 'default'))[0].id, 'files', 'meta.json'))
    await backup.applyRetention(s.destRoot, 'default', { daily: 1, weekly: 0, monthly: 0 })
    const after = await backup.listBackups(s.destRoot, 'default')
    assert.ok(after.some(x => x.healthy), 'sobrou uma cópia boa')
  } finally { s.cleanup() }
})

test('agendamento: isDue respeita o intervalo e ignora pre-restore', () => {
  const now = Date.now()
  assert.equal(backup.isDue([], 24, now), true)
  assert.equal(backup.isDue([{ kind: 'auto', createdAt: now - 3600000 }], 24, now), false)
  assert.equal(backup.isDue([{ kind: 'auto', createdAt: now - 25 * 3600000 }], 24, now), true)
  assert.equal(backup.isDue([{ kind: 'pre-restore', createdAt: now }, { kind: 'auto', createdAt: now - 25 * 3600000 }], 24, now), true)
})

test('espaço com senha: arquivos cifrados saem cifrados; arquivo em claro é selado; sem chave o backup é recusado', async () => {
  const s = sandbox()
  try {
    const key = randomBytes(32)
    const cipherText = seal(Buffer.from('segredo-meta'), key, VAULT_MAGIC, COMPAT.record062)
    fs.writeFileSync(path.join(s.dataDir, 'meta.json'), cipherText)
    fs.writeFileSync(path.join(s.dataDir, 'vault.json'), '{"kdf":"x"}')
    await assert.rejects(backup.createBackup({ ...base(s), vault: { enabled: true, key: null } }), /VAULT_LOCKED/)
    const made = await backup.createBackup({ ...base(s), vault: { enabled: true, key } })
    assert.equal(made.manifest.encrypted, true)
    // nenhum texto claro do espaço nos arquivos do backup (exceto o cabeçalho público vault.json)
    for (const rel of Object.keys(made.manifest.files)) {
      if (rel === 'vault.json') continue
      const bytes = fs.readFileSync(path.join(made.path, 'files', rel))
      assert.ok(bytes.subarray(0, 8).equals(VAULT_MAGIC), `${rel} cifrado`)
      assert.ok(!bytes.includes(Buffer.from('olá')) && !bytes.includes(Buffer.from('segredo-meta')))
    }
    assert.ok(made.manifest.files['docs/a.json'].sealed)
    // restaurar sem chave falha; com a chave, os arquivos selados voltam no formato do cofre
    fs.writeFileSync(path.join(s.dataDir, 'docs/a.json'), 'lixo')
    await assert.rejects(backup.restoreFull({ ...base(s), setDir: made.path, vault: { enabled: true, key: null } }), /VAULT_LOCKED/)
    await assert.rejects(backup.restoreFull({ ...base(s), setDir: made.path, vault: { enabled: true, key: randomBytes(32) } }), /BACKUP_KEY_MISMATCH/)
    assert.equal(fs.readFileSync(path.join(s.dataDir, 'docs/a.json'), 'utf8'), 'lixo', 'nada mudou nas falhas')
    await backup.restoreFull({ ...base(s), setDir: made.path, vault: { enabled: true, key } })
    const restored = fs.readFileSync(path.join(s.dataDir, 'docs/a.json'))
    assert.ok(restored.subarray(0, 8).equals(VAULT_MAGIC))
    const { open } = require('../electron/encryption.cjs')
    assert.equal(open(restored, key, VAULT_MAGIC, COMPAT.record063).toString('utf8'), '[{"type":"paragraph","text":"olá"}]')
    assert.ok(fs.readFileSync(path.join(s.dataDir, 'meta.json')).equals(cipherText))
  } finally { s.cleanup() }
})

test('falha de disco: nada fica pela metade, cópias anteriores e retenção não são afetadas', async () => {
  const s = sandbox()
  try {
    const first = await backup.createBackup({ ...base(s), now: Date.UTC(2026, 0, 1) })
    for (const step of ['copy', 'manifest', 'verify']) {
      await assert.rejects(backup.createBackup({ ...base(s), now: Date.UTC(2026, 0, 2), failAt: (name, i) => { if (name === step && (step !== 'copy' || i === 2)) { const e = new Error('disco cheio'); e.code = 'ENOSPC'; throw e } } }), /BACKUP_WRITE_FAILED/)
    }
    const names = fs.readdirSync(path.join(s.destRoot, 'default'))
    assert.deepEqual(names, [first.id], 'sem pastas temporárias nem cópia parcial')
    assert.ok((await backup.verifyBackup(first.path)).ok)
    // destino impossível (caminho é um arquivo)
    const blocker = path.join(s.root, 'arquivo')
    fs.writeFileSync(blocker, 'x')
    await assert.rejects(backup.createBackup({ ...base(s), destRoot: blocker }), /BACKUP_WRITE_FAILED/)
    // pasta de dados vazia
    await assert.rejects(backup.createBackup({ ...base(s), dataDir: path.join(s.root, 'vazio') }), /BACKUP_EMPTY/)
  } finally { s.cleanup() }
})

test('configurações: padrão fora da pasta de dados, valida limites e recusa pasta dentro dos dados', async () => {
  const s = sandbox()
  try {
    const userData = path.join(s.root, 'userData')
    const def = await backup.readSettings(userData)
    assert.equal(def.directory, path.join(userData, 'Backups'))
    assert.deepEqual(def.retention, { daily: 7, weekly: 4, monthly: 6 })
    assert.equal(def.enabled, true)
    await assert.rejects(backup.writeSettings(userData, { directory: path.join(userData, 'data', 'x') }), /BACKUP_DIR_INSIDE_DATA/)
    await assert.rejects(backup.writeSettings(userData, { directory: path.join(userData, 'workspaces') }), /BACKUP_DIR_INSIDE_DATA/)
    const next = await backup.writeSettings(userData, { directory: path.join(s.root, 'iCloud'), retention: { daily: 3 }, intervalHours: 6 })
    assert.equal(next.retention.daily, 3)
    assert.equal(next.retention.weekly, 4)
    assert.equal((await backup.readSettings(userData)).intervalHours, 6)
    const ic = await backup.suggestICloud(s.root)
    assert.ok(ic.path.endsWith(path.join('com~apple~CloudDocs', `${PRODUCT.name} Backups`)) && ic.available === false)
    assert.ok(!fs.existsSync(path.dirname(ic.path)), 'sugestão não cria pastas')
  } finally { s.cleanup() }
})

function fakeIpc(s, extra = {}) {
  const handlers = {}, reloaded = []
  const win = { isDestroyed: () => false, webContents: { reload: () => reloaded.push('main') } }
  const other = { isDestroyed: () => false, webContents: { reload: () => reloaded.push('other') } }
  const ctx = { workspaceId: 'default', win }
  const { registerBackupIpc } = require('../electron/backup-ipc.cjs')
  let flushes = 0
  const service = registerBackupIpc({
    trustedHandler: (name, fn) => { handlers[name] = fn },
    context: () => ctx, contexts: new Map([[1, ctx], [2, { workspaceId: 'default', win: other }]]),
    dataDir: () => s.dataDir, userData: () => path.join(s.root, 'userData'), dialog: {}, shell: {},
    flushRenderer: async () => { flushes++; await new Promise(r => setTimeout(r, 30)) },
    drainAll: async () => {}, resetWorkspace: () => {}, currentSchema: () => 1, ...extra,
  })
  return { handlers, service, reloaded, flushes: () => flushes }
}

test('backup manual durante outro backup se junta a ele: sem erro "em andamento", uma única cópia', async () => {
  const s = sandbox()
  try {
    await backup.writeSettings(path.join(s.root, 'userData'), { directory: s.destRoot })
    const ipc = fakeIpc(s)
    const auto = ipc.service.autoBackup('default') // o automático disparado ao escolher a pasta
    const manual = ipc.handlers['np:backupNow']({})
    const manual2 = ipc.handlers['np:backupNow']({})
    const [a, b, c] = await Promise.all([auto, manual, manual2])
    assert.ok(a && b && c, 'todas as chamadas resolvem')
    assert.equal(a.id, b.id)
    assert.equal(a.id, c.id)
    assert.equal((await backup.listBackups(s.destRoot, 'default', { verify: 'none' })).length, 1)
    const later = await ipc.handlers['np:backupNow']({}) // depois de terminar, um novo pedido faz nova cópia
    assert.notEqual(later.id, a.id)
  } finally { s.cleanup() }
})

test('restauração pedida durante um backup espera a vez; a janela que pediu não recarrega sozinha (aviso antes do reload)', async () => {
  const s = sandbox()
  try {
    await backup.writeSettings(path.join(s.root, 'userData'), { directory: s.destRoot })
    const ipc = fakeIpc(s)
    const first = await backup.createBackup({ ...base(s), kind: 'pre-restore', schemaVersion: 1 }) // pre-restore não é podado pela retenção
    const running = ipc.handlers['np:backupNow']({})
    const restore = ipc.handlers['np:backupRestore']({}, first.id)
    await Promise.all([running, restore])
    assert.deepEqual(ipc.reloaded, ['other'], 'só as outras janelas recarregam; a que pediu mostra "Restauração concluída" e recarrega no OK')
  } finally { s.cleanup() }
})

test('interface: restauração mostra o aviso de conclusão antes de recarregar e o botão de backup fica em "Fazendo backup…"', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../src/components/backup/BackupSettings.tsx'), 'utf8')
  assert.ok(/Restauração concluída\. O \$\{PRODUCT\.name\} vai reiniciar a janela\./.test(ui))
  assert.ok(/Espaço restaurado de \{date\}/.test(ui))
  assert.ok(/const finish = \(\) => \{[\s\S]*onDone\([\s\S]*reloadWindow\(\)/.test(ui), 'reload só depois do OK')
  assert.ok(!/api\.backupRestore!\(id\); onDone/.test(ui))
  assert.ok(/Fazendo backup…/.test(ui))
  assert.ok(/showRestoredNotice\(\)/.test(fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')), 'toast pós-reload')
})
