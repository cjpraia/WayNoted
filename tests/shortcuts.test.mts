import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SHORTCUTS, SHORTCUT_AREAS, QUERY_SHORTCUT, REBINDABLE_IDS, MENU_SHORTCUT_IDS, canonicalCombo, groupShortcuts, shortcutLabel, defaultKeys, effectiveKeys, sanitizeOverrides, withOverride, comboFromEvent, matchesCombo,
  findShortcutHit, findConflict, validateCombo, toAccelerator, menuAccelerators, isCustomized, setShortcutOverridesSource, shortcutHint,
} from '../src/shortcuts.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const table = new Set(SHORTCUTS.flatMap(item => item.keys.map(canonicalCombo)))
const tableKeys = new Set([...table].map(combo => combo.split('+').at(-1)))

test('todo acelerador do menu nativo está na tabela única e ligado ao id certo', () => {
  const main = read('electron/main.cjs')
  const found = [...main.matchAll(/accel\('([^']+)', '([^']+)'\)/g)].map(match => ({ id: match[1], accelerator: match[2] }))
  const literal = [...main.matchAll(/accelerator: '([^']+)'/g)].map(match => ({ id: '', accelerator: match[1] }))
  assert.ok(found.length >= 12, 'o menu deveria registrar vários aceleradores personalizáveis')
  const missing: string[] = []
  for (const { id, accelerator } of [...found, ...literal]) {
    const parts = accelerator.split('+')
    const key = parts.pop()!.toLowerCase()
    const mods = parts.map(part => part === 'CmdOrCtrl' ? '⌘' : part === 'Shift' ? '⇧' : part === 'Alt' || part === 'Option' ? '⌥' : part === 'Ctrl' ? '⌃' : part).join('')
    const combo = canonicalCombo(`${mods}${key}`)
    if (!table.has(combo)) missing.push(accelerator)
    // O padrão do menu é exatamente a tecla padrão do comando.
    if (id) assert.ok(defaultKeys(id).map(canonicalCombo).includes(combo), `${id}: ${accelerator} difere da tabela`)
  }
  assert.deepEqual(missing, [])
  // Todo id do menu é rebindável e está declarado dos dois lados.
  for (const id of MENU_SHORTCUT_IDS) assert.ok(SHORTCUTS.find(item => item.id === id)?.rebind, `${id} deveria ser personalizável`)
  assert.deepEqual([...main.matchAll(/MENU_SHORTCUT_IDS = \[([^\]]+)\]/g)].flatMap(match => [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1])).sort(), [...MENU_SHORTCUT_IDS].sort())
})

test('o keydown do App é dirigido pela tabela: todo comando personalizável tem tratador', () => {
  const app = read('src/App.tsx')
  assert.match(app, /findShortcutHit\(e\)/)
  const handled = new Set([...app.matchAll(/case '([\w-]+)'/g)].map(match => match[1]))
  // Só de menu: exportar e fechar janela chegam pelo menu nativo; o modo foco, pelo FocusLayer.
  const menuOnly = new Set(['export', 'close-window', 'focus'])
  const missing = REBINDABLE_IDS.filter(id => !handled.has(id) && !menuOnly.has(id))
  assert.deepEqual(missing, [])
  assert.match(read('src/focus/FocusLayer.tsx'), /matchesCombo\(event, shortcutHint\('focus'\)\)/)
})

test('ids únicos, áreas válidas e ⌘⌥Q segue sendo a citação do editor', () => {
  assert.equal(new Set(SHORTCUTS.map(item => item.id)).size, SHORTCUTS.length)
  const areas = new Set(SHORTCUT_AREAS.map(area => area.id))
  assert.ok(SHORTCUTS.every(item => areas.has(item.area) && item.keys.length > 0))
  assert.notEqual(QUERY_SHORTCUT, '⌘⌥Q')
  const quote = SHORTCUTS.find(item => item.id === 'quote')!
  assert.deepEqual(quote.keys, ['⌘⌥Q'])
  // Nenhuma combinação do editor é repetida (um atalho = uma ação).
  const editor = SHORTCUTS.filter(item => item.area === 'editor').flatMap(item => item.keys.map(canonicalCombo))
  assert.equal(new Set(editor).size, editor.length)
})

test('busca na lista ignora acento/caixa e procura por teclas', () => {
  const total = groupShortcuts('', 'pt-BR').reduce((sum, group) => sum + group.items.length, 0)
  assert.equal(total, SHORTCUTS.length)
  assert.ok(groupShortcuts('GRAFO', 'pt-BR').some(group => group.items.some(item => item.id === 'graph')))
  assert.ok(groupShortcuts('⌘⇧M', 'en-US').some(group => group.items.some(item => item.id === 'comment')))
  assert.equal(groupShortcuts('zzzz-nada', 'pt-BR').length, 0)
  assert.equal(shortcutLabel(SHORTCUTS[0], 'en-US'), 'Search and run commands')
})

test('todo rótulo do menu do bloco corresponde a um atalho real registrado e tratado', () => {
  const menu = read('src/components/page/BlockHandleMenu.tsx')
  const declared = /BLOCK_MENU_SHORTCUTS: Record<string, string> = \{([^}]*)\}/.exec(menu)
  assert.ok(declared, 'BLOCK_MENU_SHORTCUTS não encontrado')
  const BLOCK_MENU_SHORTCUTS = Object.fromEntries([...declared![1].matchAll(/'?([\w-]+)'?:\s*'([^']+)'/g)].map(match => [match[1], match[2]]))
  assert.ok(Object.keys(BLOCK_MENU_SHORTCUTS).length >= 2)
  const literal = [...menu.matchAll(/<kbd>([^<]+)<\/kbd>/g)].map(match => match[1])
  assert.deepEqual(literal.filter(item => !item.startsWith('{')), [], 'rótulos de tecla devem vir de BLOCK_MENU_SHORTCUTS')
  const editor = new Set(SHORTCUTS.filter(item => item.area === 'editor').flatMap(item => item.keys.map(canonicalCombo)))
  for (const [id, label] of Object.entries(BLOCK_MENU_SHORTCUTS)) assert.ok(editor.has(canonicalCombo(label)), `${id}: ${label} sem atalho registrado`)
  // ⌘D e ⌘⇧M têm tratador no editor; ⌘⇧P é Produtividade e ⌘J é "Perguntar".
  const page = read('src/components/page/PageEditor.tsx')
  assert.match(page, /event\.code === 'KeyD'/)
  assert.match(page, /key\.toLowerCase\(\) === 'm'/)
  assert.ok(!Object.values(BLOCK_MENU_SHORTCUTS).some(label => ['⌘⇧P', '⌘⇧L', '⌘J', '⌘⇧X'].includes(label)))
})

const ev = (key: string, code: string, mods: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) => ({ key, code, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift })

test('U2: teclas efetivas = padrão + personalizações; ids inválidos e tamanhos errados são limpos', () => {
  assert.deepEqual(effectiveKeys('search', {}), ['⌘K', '⌘P'])
  assert.deepEqual(effectiveKeys('search', { search: ['⌘⇧K', ''] }), ['⌘⇧K', '⌘P'])
  assert.deepEqual(effectiveKeys('quote', { quote: ['⌘⇧9'] }), ['⌘⌥Q'], 'atalhos do editor são fixos')
  const clean = sanitizeOverrides({ search: ['⌘⇧K'], nada: ['⌘J'], graph: 'x', ask: ['Z'], sidebar: ['⌘\\'], reload: [''] })
  assert.deepEqual(clean, { search: ['⌘⇧K', '⌘P'] }, 'tecla sem modificador, id inexistente, tipo errado e valor igual ao padrão saem')
  assert.deepEqual(sanitizeOverrides(null), {})
  assert.deepEqual(sanitizeOverrides([1]), {})
})

test('U2: withOverride grava por posição e volta ao padrão sozinho', () => {
  let map = withOverride(undefined, 'search', 1, '⌘⇧O')
  assert.deepEqual(map, { search: ['⌘K', '⌘⇧O'] })
  assert.ok(isCustomized('search', map))
  map = withOverride(map, 'search', 1, null)
  assert.deepEqual(map, {}, 'restaurar a única posição alterada remove a entrada')
  assert.deepEqual(withOverride({}, 'quote', 0, '⌘⇧9'), {}, 'comando fixo não grava')
  assert.deepEqual(withOverride({}, 'graph', 3, '⌘⇧9'), {}, 'posição inexistente é ignorada')
})

test('U2: gravação a partir do evento e comparação (⌘ aceita Ctrl, ⌃ só Ctrl)', () => {
  assert.equal(comboFromEvent(ev('k', 'KeyK', { meta: true, shift: true }), true), '⇧⌘K')
  assert.equal(comboFromEvent(ev('˚', 'KeyK', { meta: true, alt: true }), true), '⌥⌘K', 'o código da tecla vence o caractere do ⌥')
  assert.equal(comboFromEvent(ev('Meta', 'MetaLeft', { meta: true }), true), null, 'modificador sozinho não grava')
  assert.equal(comboFromEvent(ev('Tab', 'Tab', { ctrl: true }), true), '⌃Tab')
  assert.equal(comboFromEvent(ev('k', 'KeyK', { ctrl: true }), false), '⌘K', 'fora do Mac Ctrl faz o papel do ⌘')
  assert.ok(matchesCombo(ev('k', 'KeyK', { meta: true }), '⌘K'))
  assert.ok(matchesCombo(ev('k', 'KeyK', { ctrl: true }), '⌘K'))
  assert.ok(!matchesCombo(ev('k', 'KeyK', { meta: true, shift: true }), '⌘K'), 'Shift extra não casa')
  assert.ok(!matchesCombo(ev('k', 'KeyK'), '⌘K'))
  assert.ok(matchesCombo(ev('Tab', 'Tab', { ctrl: true, shift: true }), '⌃⇧Tab'))
  assert.ok(!matchesCombo(ev('Tab', 'Tab', { meta: true }), '⌃Tab'))
  assert.ok(matchesCombo(ev('\\', 'Backslash', { meta: true }), '⌘\\'))
  assert.ok(matchesCombo(ev('[', 'BracketLeft', { meta: true }), '⌘['))
})

test('U2: o keydown acha o comando pelo atalho efetivo (padrão e personalizado)', () => {
  setShortcutOverridesSource(() => undefined)
  assert.deepEqual(findShortcutHit(ev('k', 'KeyK', { meta: true })), { id: 'search', slot: 0 })
  assert.deepEqual(findShortcutHit(ev('p', 'KeyP', { meta: true })), { id: 'search', slot: 1 })
  assert.deepEqual(findShortcutHit(ev('P', 'KeyP', { meta: true, shift: true })), { id: 'productivity', slot: 0 })
  assert.deepEqual(findShortcutHit(ev(']', 'BracketRight', { meta: true })), { id: 'back-forward', slot: 1 })
  assert.equal(findShortcutHit(ev('b', 'KeyB', { meta: true })), null, 'atalho do editor não é do app')
  const custom = { graph: ['⌘⇧G'], search: ['⌘K', '⌘⇧O'] }
  setShortcutOverridesSource(() => custom)
  assert.equal(findShortcutHit(ev('g', 'KeyG', { meta: true })), null, 'o padrão deixa de valer depois de alterado')
  assert.deepEqual(findShortcutHit(ev('G', 'KeyG', { meta: true, shift: true })), { id: 'graph', slot: 0 })
  assert.deepEqual(findShortcutHit(ev('o', 'KeyO', { meta: true, shift: true })), { id: 'search', slot: 1 })
  assert.equal(shortcutHint('graph'), process.platform === 'win32' ? 'Ctrl+Shift+G' : '⌘⇧G', 'dicas e tooltips seguem o atalho novo')
  assert.equal(shortcutHint('back-forward', 1), process.platform === 'win32' ? 'Ctrl+]' : '⌘]')
  setShortcutOverridesSource(() => undefined)
  assert.equal(shortcutHint('graph'), process.platform === 'win32' ? 'Ctrl+G' : '⌘G')
})

test('U2: conflitos com o app, o editor e atalhos reservados do macOS/VoiceOver', () => {
  const app = findConflict('graph', 0, '⌘K', 'pt-BR', {})
  assert.equal(app?.level, 'block'); assert.equal(app?.kind, 'app'); assert.equal(app?.id, 'search')
  const editor = findConflict('graph', 0, '⌘B', 'en-US', {})
  assert.equal(editor?.level, 'block'); assert.equal(editor?.kind, 'editor')
  assert.equal(findConflict('graph', 0, '⌘G', 'pt-BR', {}), null, 'o próprio padrão não conflita consigo')
  assert.equal(findConflict('graph', 0, '⌘⇧Y', 'pt-BR', {}), null)
  // Reservados: aviso, não bloqueio.
  for (const reserved of ['⌃Espaço', '⌃Space', '⌘Space', '⌘Tab', '⌥⌘Esc', '⌃⌥K']) {
    const conflict = findConflict('graph', 0, reserved, 'pt-BR', {})
    assert.ok(conflict && conflict.level === 'warn' && conflict.kind === 'reserved', `${reserved} deveria ser reservado`)
  }
  // Tecla de outro contexto (tabela/lousa): aviso.
  assert.equal(findConflict('graph', 0, '⌘F', 'pt-BR', {})?.level, 'block', '⌘F é busca na página do editor')
  assert.equal(findConflict('graph', 0, '⌘L', 'pt-BR', {})?.kind, 'context')
  // Depois de alterado, o atalho antigo fica livre e o novo ocupa o lugar.
  const map = { search: ['⌘⇧O', '⌘P'] }
  assert.equal(findConflict('graph', 0, '⌘K', 'pt-BR', map), null)
  assert.equal(findConflict('graph', 0, '⌘⇧O', 'pt-BR', map)?.id, 'search')
})

test('U2: validação — exige ⌘/⌃ (exceto F1–F12), nada de Esc', () => {
  assert.equal(validateCombo('⌘⇧K'), null)
  assert.equal(validateCombo('⌃Tab'), null)
  assert.equal(validateCombo('F5'), null)
  assert.equal(validateCombo('K'), 'needs-modifier')
  assert.equal(validateCombo('⌥K'), 'needs-modifier')
  assert.equal(validateCombo('⇧K'), 'needs-modifier')
  assert.equal(validateCombo('Esc'), 'needs-modifier')
  assert.equal(validateCombo('⌘Esc'), 'bad-key')
  assert.equal(validateCombo('⌘'), 'empty')
})

test('U2: aceleradores do Electron para o menu nativo só saem do que foi personalizado', () => {
  assert.equal(toAccelerator('⌘⇧N'), 'CmdOrCtrl+Shift+N')
  assert.equal(toAccelerator('⌃⌥⇧⌘K'), 'CmdOrCtrl+Ctrl+Alt+Shift+K')
  assert.equal(toAccelerator('⌃Tab'), 'Ctrl+Tab')
  assert.equal(toAccelerator('⌘\\'), 'CmdOrCtrl+\\')
  assert.equal(toAccelerator('⌘↑'), 'CmdOrCtrl+Up')
  assert.deepEqual(menuAccelerators({}), {})
  assert.deepEqual(menuAccelerators({ 'new-page': ['⌘⇧O'], graph: ['⌘⇧G'], search: ['⌘⇧K', '⌘P'] }), { 'new-page': 'CmdOrCtrl+Shift+O', search: 'CmdOrCtrl+Shift+K' }, 'graph não está no menu')
})

test('U2: as dicas ⌘⇧L/⌘D/⌘⇧P têm tratador ou foram removidas', () => {
  const page = read('src/components/page/PageEditor.tsx')
  assert.match(page, /event\.code === 'KeyD'/, '⌘D duplica o bloco')
  assert.ok(effectiveKeys('productivity', {}).includes('⌘⇧P'), '⌘⇧P é o painel de produtividade (tratador no App)')
  const menu = read('src/components/page/BlockHandleMenu.tsx')
  assert.ok(!/⌘⇧L/.test(menu), '⌘⇧L não é mais prometido no menu do bloco')
  assert.ok(!SHORTCUTS.some(item => item.keys.includes('⌘⇧L')))
})

test('U2: o validador do meta limpa personalizações inválidas sem recusar o arquivo', async () => {
  const { validateMeta } = await import('../src/workspace.ts')
  const id = '11111111-1111-4111-8111-111111111111'
  const page = { id, parentId: null, title: 'A', icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: 1, updatedAt: 1, order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, text: '' }
  const meta = validateMeta({ pages: { [id]: page }, settings: { locale: 'pt-BR', shortcutOverrides: { search: ['⌘⇧K'], bogus: ['⌘J'], graph: [''] } } })
  assert.deepEqual(meta.settings.shortcutOverrides, { search: ['⌘⇧K', '⌘P'] })
})
