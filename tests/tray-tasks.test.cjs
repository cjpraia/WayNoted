const PRODUCT = require('../shared/product.json')
// "Hoje" na barra de menus (C3a): validação do retrato, menu com ✓ por tarefa, contador opcional e fiação IPC.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createTrayTasks, sanitizeSnapshot, badgeTitle } = require('../electron/tray-tasks.cjs')
const { createTray } = require('../electron/tray.cjs')
const core = require('../electron/quick-capture-core.cjs')

const t = (pt, en) => en
const snapshot = (n, overdue = 0) => ({ total: n, overdue, items: Array.from({ length: Math.min(n, 10) }, (_, i) => ({ id: `task-${i}`, title: `Tarefa ${i}`, overdue: i < overdue })) })

test('sanitizeSnapshot limita a 10 itens, corta textos, descarta lixo e nunca confia no renderer', () => {
  const dirty = { total: 40, overdue: 2, items: [
    ...Array.from({ length: 14 }, (_, i) => ({ id: `t${i}`, title: `Título\ncom\tquebras ${'x'.repeat(200)}`, overdue: i === 0 })),
    { id: 't0', title: 'duplicado' }, { id: 5, title: 'sem id string' }, null, { id: '', title: 'vazio' }, { id: 'y'.repeat(400), title: 'id enorme' },
  ] }
  const clean = sanitizeSnapshot(dirty)
  assert.equal(clean.items.length, 10); assert.equal(clean.total, 40); assert.equal(clean.overdue, 2)
  assert.ok(clean.items.every(item => item.title.length <= 80 && !/[\n\t]/.test(item.title)))
  assert.equal(clean.items[0].overdue, true); assert.equal(clean.items[1].overdue, false)
  assert.equal(sanitizeSnapshot(null), null); assert.equal(sanitizeSnapshot({ items: 'x' }), null)
  assert.equal(sanitizeSnapshot({ items: [], total: -5, overdue: Infinity }).total, 0)
  assert.equal(sanitizeSnapshot({ items: [{ id: 'a', title: 'a' }], total: 0 }).total, 1, 'o total nunca é menor que os itens')
})

test('badgeTitle: só quando ligado e há tarefas; 99+ acima de 99', () => {
  assert.equal(badgeTitle(snapshot(3), true), '3'); assert.equal(badgeTitle(snapshot(3), false), '')
  assert.equal(badgeTitle(snapshot(0), true), ''); assert.equal(badgeTitle(null, true), '')
  assert.equal(badgeTitle({ items: [], total: 150, overdue: 0 }, true), '99+')
})

test('retrato por janela/espaço: o mais recente vale, ids desconhecidos não têm dono, fechar a janela descarta', () => {
  const store = createTrayTasks()
  store.set(1, 'default', snapshot(2)); store.set(2, 'other', { items: [{ id: 'z', title: 'Z' }], total: 1 })
  assert.equal(store.forWorkspace('default').senderId, 1)
  assert.equal(store.ownerOf('default', 'task-1'), 1); assert.equal(store.ownerOf('default', 'z'), null); assert.equal(store.ownerOf('other', 'z'), 2)
  assert.throws(() => store.set(3, 'default', 'lixo'), /inválido/)
  store.set(3, 'default', { items: [{ id: 'novo', title: 'N' }], total: 1 })
  assert.equal(store.ownerOf('default', 'novo'), 3); assert.equal(store.ownerOf('default', 'task-1'), null, 'o retrato antigo foi substituído')
  store.drop(3); assert.equal(store.ownerOf('default', 'novo'), null)
})

async function template(deps) {
  const tray = createTray({ t, recents: async () => [], quickNote() {}, search() {}, openApp() {}, openPage() {}, preferences() {}, quit() {}, ...deps })
  return tray.menuTemplate()
}
const labels = items => items.filter(item => item.type !== 'separator').map(item => item.label)

test('menu: lista as tarefas com ✓, marca atrasadas, conclui ao clicar e abre Meu dia', async () => {
  const completed = [], opened = []
  const items = await template({ todayTasks: () => snapshot(14, 1), taskPrefs: () => ({ trayTasks: true }), completeTask: id => completed.push(id), openToday: () => opened.push('today') })
  const all = labels(items)
  assert.ok(all.includes('Today (14)')); assert.ok(all.includes('! Tarefa 0')); assert.ok(all.includes('✓ Tarefa 1'))
  assert.equal(all.filter(label => /^[✓!] /.test(label)).length, 10, 'no máximo 10 tarefas')
  assert.ok(all.includes('+ 4 more…')); assert.ok(all.includes('Open My day'))
  items.find(item => item.label === '✓ Tarefa 3').click(); assert.deepEqual(completed, ['task-3'])
  items.find(item => item.label === 'Open My day').click(); assert.deepEqual(opened, ['today'])
  // As seções antigas continuam, depois das tarefas.
  assert.ok(all.indexOf('Today (14)') < all.indexOf('Recent'))
  assert.ok(all.includes('New quick note') && all.includes(`Quit ${PRODUCT.name}`))
})

test('menu: sem tarefas mostra o estado vazio; desligado esconde a seção; sem retrato ainda mostra só Meu dia', async () => {
  assert.ok(labels(await template({ todayTasks: () => snapshot(0), taskPrefs: () => ({ trayTasks: true }) })).includes('Nothing for today'))
  const off = labels(await template({ todayTasks: () => snapshot(5), taskPrefs: () => ({ trayTasks: false }) }))
  assert.equal(off.some(label => /Tarefa|Today|Open My day/.test(label)), false)
  const none = labels(await template({ todayTasks: () => null, taskPrefs: () => ({ trayTasks: true }) }))
  assert.ok(none.includes('Open My day')); assert.ok(none.includes('Nothing for today'))
  const legacy = labels(await template({}))
  assert.equal(legacy.includes('Open My day'), false, 'sem a dependência, o menu antigo continua igual')
})

test('contador no título: refreshTitle só mostra o número quando ligado, some sem tarefas e ao desligar a lista', () => {
  const titles = [], tips = []
  const fakeTray = { setToolTip: tip => tips.push(tip), setTitle: title => titles.push(title), on() {}, destroy() {} }
  const electron = { Tray: function () { return fakeTray }, nativeImage: { createFromBitmap: () => ({ addRepresentation() {}, setTemplateImage() {} }) } }
  let prefs = { trayTasks: true, trayCount: false }, current = snapshot(7)
  const tray = createTray({ t, electron, platform: 'darwin', todayTasks: () => current, taskPrefs: () => prefs })
  tray.setVisible(true)
  assert.equal(titles.at(-1), '', 'desligado por padrão')
  prefs = { trayTasks: true, trayCount: true }; tray.refreshTitle(); assert.equal(titles.at(-1), '7'); assert.match(tips.at(-1), /7 for today/)
  current = snapshot(0); tray.refreshTitle(); assert.equal(titles.at(-1), '')
  current = snapshot(3); prefs = { trayTasks: false, trayCount: true }; tray.refreshTitle(); assert.equal(titles.at(-1), '', 'sem a lista, sem contador')
  tray.setVisible(false); tray.refreshTitle() // sem ícone: não falha
})

test('preferências: trayTasks liga por padrão, trayCount desliga por padrão e valores inválidos voltam ao padrão', () => {
  const defaults = core.normalizePrefs({})
  assert.equal(defaults.trayTasks, true); assert.equal(defaults.trayCount, false)
  const custom = core.normalizePrefs({ trayTasks: false, trayCount: true }); assert.equal(custom.trayTasks, false); assert.equal(custom.trayCount, true)
  const bad = core.normalizePrefs({ trayTasks: 'sim', trayCount: 1 }); assert.equal(bad.trayTasks, true); assert.equal(bad.trayCount, false)
})

test('fiação: IPC via trustedHandler, conclusão volta ao renderer dono do item e usa a rota da Caixa de tarefas', () => {
  const main = fs.readFileSync('electron/main.cjs', 'utf8'), preload = fs.readFileSync('electron/preload.cjs', 'utf8'), renderer = fs.readFileSync('src/tray/trayTasks.ts', 'utf8')
  for (const channel of ['np:traySetTasks', 'np:trayTaskResult']) { assert.match(main, new RegExp(`trustedHandler\\('${channel}'`)); assert.ok(preload.includes(`ipcRenderer.invoke('${channel}'`)) }
  assert.match(main, /webContents\.send\('np:trayCompleteTask', id\)/); assert.match(preload, /ipcRenderer\.on\('np:trayCompleteTask'/)
  assert.match(main, /trayTasks\.ownerOf\(activeWorkspace\(\), id\)/, 'só ids do último retrato são encaminhados')
  assert.match(main, /trayTasks\.drop\(senderId\)/)
  assert.match(renderer, /completeTask\(item, true\)/, 'mesma rota da Caixa de tarefas (guardas U1)')
  assert.doesNotMatch(main, /tray-tasks[\s\S]{0,40}(loadMeta|saveDoc)/, 'o retrato é só leitura: nada de disco')
})


test('Windows tray shows counts in its tooltip without calling macOS title APIs', () => {
  const tips = []
  const electron = { Tray: function () { return { setToolTip: value => tips.push(value), on() {}, destroy() {} } }, nativeImage: { createFromBitmap: () => ({ addRepresentation() {} }) } }
  const tray = createTray({ t, electron, platform: 'win32', todayTasks: () => snapshot(3), taskPrefs: () => ({ trayTasks: true, trayCount: true }) })
  tray.setVisible(true); tray.refreshTitle()
  assert.match(tips.at(-1), /3 for today/)
  tray.setVisible(false)
})
