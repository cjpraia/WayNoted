import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true })
for (const key of ['window', 'document', 'Node', 'Text', 'Element', 'HTMLElement', 'HTMLDivElement', 'DocumentFragment', 'DOMParser', 'MutationObserver', 'DOMRect', 'Range', 'ShadowRoot']) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key] })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

const { BlockNoteEditor } = await import('@blocknote/core')
const { SLASH_CATALOG, SLASH_CATEGORY_PT, catalogForQuery } = await import('../src/components/page/slashMenu/catalog.ts')
const { columnsFromBlock, copyBlockForNewPage, persistOwnedBlockBeforeNavigation } = await import('../src/components/page/slashMenu/lifecycle.ts')
const { blocksToText } = await import('../src/components/page/util.ts')

let duplicated = []
const actions = { duplicateOwnedPageBlocks: async (_owner, blocks) => { duplicated = blocks; return blocks.map((block) => ({ ...structuredClone(block), id: 'copy' })) }, flushMeta: async () => {}, openPage() {} }
globalThis.__handleMocks = { TEMPLATE_VARIABLE_COMMANDS: [], runTemplateVariableCommand: () => false, templateVariableIcon: () => null, insertOrUpdateBlockForSlashMenu() {}, insertColumnList() {}, getDefaultReactSlashMenuItems: () => [], actions, getState: () => ({ settings: {} }), BlockIcon: () => null, INTEGRATION_COMMANDS: [], integrationIcon: () => null, runIntegrationCommand: () => false, QUERY_COMMANDS: [], queryIcon: () => null, runQueryCommand: () => false, TYPE_COMMANDS: [], typeIcon: () => null, runTypeCommand: () => false, CANVAS_COMMANDS: [], canvasIcon: () => null, runCanvasCommand: () => false, blocksToText, SLASH_CATALOG, SLASH_CATEGORY_PT, catalogForQuery, columnsFromBlock, copyBlockForNewPage, persistOwnedBlockBeforeNavigation }
let source = await readFile(new URL('../src/components/page/slashMenu/build.tsx', import.meta.url), 'utf8')
source = source.replace(/import\s+type\s+[^\n]+\n/g, '').replace(/import\s+(\{[\s\S]*?\})\s+from\s+'[^']+'\s*\n/g, (_match, bindings) => `const ${bindings.replace(/\btype\s+\w+\s*,?/g, '')} = globalThis.__handleMocks\n`)
const transformed = await transformWithOxc(source, 'build.tsx', { jsx: { runtime: 'automatic' } })
const code = transformed.code.replace(/from ["']react\/jsx-runtime["']/g, `from ${JSON.stringify(import.meta.resolve('react/jsx-runtime'))}`)
const { executeSlashCommand } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

const item = (id) => SLASH_CATALOG.find((entry) => entry.id === id)
function fixture() {
  const editor = BlockNoteEditor.create({ initialContent: [{ id: 'a', type: 'paragraph', content: 'First' }, { id: 'b', type: 'paragraph', content: 'Second' }] })
  const host = document.createElement('div'); document.body.append(host); editor.mount(host)
  editor.setTextCursorPosition('b', 'end')
  const events = { copied: [], moved: [], commented: [], errors: [] }
  const context = { editor, pageId: 'owner', locale: 'en-US', query: '', targetBlockId: 'a', onCreated: async () => {}, onPick() {}, onFile() {}, onImport() {}, onCopy: (id) => events.copied.push(id), onMove: (id) => events.moved.push(id), onAI() {}, onComment: (id) => events.commented.push(id), onError: (message) => events.errors.push(message) }
  return { editor, host, context, events, close: () => { editor.unmount(); host.remove() } }
}

test('ações do handle usam ID do bloco selecionado, não o cursor deslocado pela busca', async () => {
  const f = fixture()
  try {
    await executeSlashCommand(item('copy-link'), f.context)
    await executeSlashCommand(item('move-to'), f.context)
    await executeSlashCommand(item('comment'), f.context)
    assert.deepEqual(f.events.copied, ['a'])
    assert.deepEqual(f.events.moved, ['a'])
    assert.deepEqual(f.events.commented, ['a'])
    await executeSlashCommand(item('text-color-red'), f.context)
    assert.equal(f.editor.getBlock('a').props.textColor, 'red')
    assert.notEqual(f.editor.getBlock('b').props.textColor, 'red')
    await executeSlashCommand(item('turn-quote'), f.context)
    assert.equal(f.editor.getBlock('a').type, 'quote')
    assert.equal(f.editor.getBlock('b').type, 'paragraph')
    await executeSlashCommand(item('duplicate'), f.context)
    assert.equal(duplicated[0].id, 'a')
    assert.equal(f.editor.getBlock('copy').type, 'quote')
    await executeSlashCommand(item('delete'), f.context)
    assert.equal(f.editor.getBlock('a'), undefined)
    assert.equal(f.editor.undo(), true)
    assert.ok(f.editor.getBlock('a'))
    assert.deepEqual(f.events.errors, [])
  } finally { f.close() }
})

test('executor bloqueia mutação no editor somente leitura, mas permite copiar link', async () => {
  const f = fixture()
  try {
    f.editor.isEditable = false
    await executeSlashCommand(item('delete'), f.context)
    assert.ok(f.editor.getBlock('a'))
    assert.match(f.events.errors[0], /locked/)
    await executeSlashCommand(item('copy-link'), f.context)
    assert.deepEqual(f.events.copied, ['a'])
  } finally { f.close() }
})
