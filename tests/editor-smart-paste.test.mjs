// "Colar já formatado" pelo pipeline real de colagem do ProseMirror (evento paste → pasteHandler
// do BlockNote → runSmartPaste). Ver docs/USAGE.md. Nunca passar nós do DOM a asserts.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true })
for (const key of ['window','document','Node','Text','Element','HTMLElement','HTMLDivElement','HTMLInputElement','HTMLAnchorElement','HTMLImageElement','DocumentFragment','DOMParser','MutationObserver','DOMRect','Range','ShadowRoot','NodeFilter']) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key] })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.ClipboardEvent = class ClipboardEvent extends dom.window.Event { constructor(type, init = {}) { super(type, init) } }
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })

const { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, createBlockSpec, createInlineContentSpec } = await import('@blocknote/core')
const { editorStyleSpecs } = await import('../src/components/page/editorStyles.ts')
const { runSmartPaste, planPaste } = await import('../src/components/page/paste/smartPaste.ts')
const { cleanPastedHtml } = await import('../src/components/page/paste/html.ts')

// Blocos próprios equivalentes aos do app (o schema real é .tsx e importa a store).
const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node }
const callout = createBlockSpec({ type: 'callout', propSchema: { icon: { default: '💡' } }, content: 'inline' }, { render: (block) => { const dom = el('div', 'pg-callout'); const contentDOM = el('div'); dom.append(el('span', '', block.props.icon), contentDOM); return { dom, contentDOM } } })
const equation = createBlockSpec({ type: 'equation', propSchema: { latex: { default: 'x^2' } }, content: 'none' }, { render: (block) => ({ dom: el('div', 'pg-equation', block.props.latex) }) })
const inlineEquation = createInlineContentSpec({ type: 'inlineEquation', propSchema: { id: { default: '' }, latex: { default: 'x^2' } }, content: 'none' }, { render: (content) => ({ dom: el('span', 'pg-inline-eq', content.props.latex) }) })
const schema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, callout: callout(), equation: equation() }, inlineContentSpecs: { ...defaultInlineContentSpecs, inlineEquation }, styleSpecs: editorStyleSpecs })

let plainNext = false, lastResult = null
function setup(initialContent = [{ id: 'target', type: 'paragraph' }]) {
  const editor = BlockNoteEditor.create({ schema, initialContent, pasteHandler: ({ event, editor, defaultPasteHandler }) => {
    lastResult = runSmartPaste(event, editor, defaultPasteHandler, { convert: true, plain: plainNext })
    plainNext = false
    return lastResult.handled
  } })
  const host = document.createElement('div'); document.body.append(host); editor.mount(host)
  editor.setTextCursorPosition(initialContent[0].id, 'end')
  return { editor, done: () => { editor.unmount(); host.remove() } }
}
function paste(editor, data) {
  const event = new globalThis.ClipboardEvent('paste', { bubbles: true, cancelable: true })
  const types = Object.keys(data)
  Object.defineProperty(event, 'clipboardData', { value: { types, files: { length: 0 }, getData: (type) => data[type] ?? '' } })
  editor.prosemirrorView.dom.dispatchEvent(event)
}
const text = (block) => Array.isArray(block?.content) ? block.content.map((n) => n.text ?? n.content?.map((p) => p.text).join('') ?? n.props?.latex ?? '').join('') : ''
const kinds = (blocks) => blocks.map((b) => b.type)
const persistedRoundTrip = (editor) => { const json = JSON.parse(JSON.stringify(editor.document)); assert.deepEqual(JSON.parse(JSON.stringify(BlockNoteEditor.create({ schema, initialContent: json }).document)), json) }

test('conversa de IA completa entra como blocos formatados (títulos, listas, tabela, código, negrito)', async () => {
  const md = await readFile(new URL('./fixtures/paste/ai-conversation.md', import.meta.url), 'utf8')
  const { editor, done } = setup()
  try {
    paste(editor, { 'text/plain': md })
    assert.equal(lastResult.plan.kind, 'markdown'); assert.equal(lastResult.converted, true)
    const doc = editor.document
    const roles = doc.filter((b) => b.type === 'paragraph' && b.content[0]?.styles?.bold && /:$/.test(text(b))).map(text)
    assert.deepEqual(roles, ['Você:', 'Assistente:', 'Você:', 'Assistente:'])
    assert.deepEqual(doc.filter((b) => b.type === 'heading').map((b) => [b.props.level, text(b)]), [[2, 'Visão geral'], [3, 'Comparação'], [3, 'Quando usar cada um']])
    const table = doc.find((b) => b.type === 'table')
    assert.equal(table.content.rows.length, 4)
    assert.equal(table.content.rows[0].cells[1].props.textAlignment, 'center')
    assert.equal(table.content.rows[0].cells[2].props.textAlignment, 'right')
    assert.equal(table.content.rows[2].cells[2].content[0].styles.bold, true)
    const numbered = doc.filter((b) => b.type === 'numberedListItem')
    assert.equal(numbered.length, 2); assert.equal(numbered[0].children.length, 2); assert.equal(numbered[0].children[0].type, 'bulletListItem')
    assert.deepEqual(doc.filter((b) => b.type === 'codeBlock').map((b) => b.props.language), ['python', 'typescript'])
    assert.match(text(doc.find((b) => b.type === 'codeBlock')), /^import sqlite3\n\nconn = /)
    assert.deepEqual(doc.filter((b) => b.type === 'checkListItem').map((b) => b.props.checked), [true, false])
    const tip = doc.find((b) => b.type === 'callout'); assert.equal(tip.props.icon, '💡'); assert.match(text(tip), /Dica/)
    const linkPara = doc.find((b) => b.content?.some?.((n) => n.type === 'link'))
    assert.equal(linkPara.content.find((n) => n.type === 'link').href, 'https://sqlite.org/docs.html')
    persistedRoundTrip(editor)
    // ⌘Z desfaz a colagem inteira em um passo.
    editor.undo()
    assert.equal(editor.document.length, 1); assert.equal(text(editor.document[0]), '')
  } finally { done() }
})

test('README vira títulos, código com linguagem, tabela, lista numerada e divisor', async () => {
  const md = await readFile(new URL('./fixtures/paste/readme.md', import.meta.url), 'utf8')
  const { editor, done } = setup()
  try {
    paste(editor, { 'text/plain': md })
    const doc = editor.document
    assert.equal(doc[0].type, 'heading'); assert.equal(text(doc[0]), "workspace-cli")
    assert.deepEqual(doc.filter((b) => b.type === 'codeBlock').map((b) => b.props.language), ['bash', 'bash'])
    assert.equal(doc.find((b) => b.type === 'table').content.rows.length, 3)
    assert.equal(doc.filter((b) => b.type === 'numberedListItem').length, 3)
    assert.ok(doc.some((b) => b.type === 'divider'))
    assert.doesNotMatch(JSON.stringify(doc), /```|\| ---/)
  } finally { done() }
})

test('tabela do Excel (HTML + TSV) e TSV sozinho viram tabela do editor', () => {
  const tsv = 'Produto\tQtd\tPreço\nCaneta\t10\tR$ 2,50\nCaderno\t3\tR$ 15,00\n'
  const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style>.xl65{mso-number-format:"\\@"}</style></head><body><!--StartFragment--><table border=0 cellpadding=0 cellspacing=0 width=300><col width=100 span=3><tr height=20><td height=20 class=xl65 width=100>Produto</td><td width=100>Qtd</td><td width=100>Preço</td></tr><tr><td>Caneta</td><td align=right>10</td><td>R$&nbsp;2,50</td></tr><tr><td>Caderno</td><td align=right>3</td><td>R$&nbsp;15,00</td></tr><!--EndFragment--></table></body></html>'
  for (const data of [{ 'text/html': html, 'text/plain': tsv }, { 'text/plain': tsv }]) {
    const { editor, done } = setup()
    try {
      paste(editor, data)
      const table = editor.document.find((b) => b.type === 'table')
      assert.ok(table, JSON.stringify(Object.keys(data)))
      assert.equal(table.content.rows.length, 3)
      const cell = (r, c) => { const value = table.content.rows[r].cells[c]; return text(Array.isArray(value) ? { content: value } : value) }
      assert.equal(cell(0, 0), 'Produto'); assert.equal(cell(2, 2), 'R$ 15,00')
    } finally { done() }
  }
})

test('HTML do Google Docs: wrapper font-weight normal, spans com estilo, listas aninhadas e títulos', () => {
  const html = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1234"><h1 dir="ltr" style="line-height:1.38;"><span style="font-size:20pt;font-weight:400;">Plano do projeto</span></h1><p dir="ltr"><span style="font-weight:700;">Objetivo:</span><span style="font-weight:400;"> entregar&nbsp;em </span><span style="font-style:italic;">outubro</span><span style="text-decoration:line-through;"> setembro</span></p><ul><li dir="ltr" aria-level="1"><p dir="ltr" role="presentation"><span>Fase 1</span></p></li><ul><li dir="ltr" aria-level="2"><p dir="ltr" role="presentation"><span>Subtarefa</span></p></li></ul><li dir="ltr" aria-level="1"><p dir="ltr" role="presentation"><span>Fase 2</span></p></li></ul><p dir="ltr"><a href="https://docs.example.com" style="text-decoration:none;"><span style="color:#1155cc;text-decoration:underline;">link</span></a></p></b>'
  const { editor, done } = setup()
  try {
    paste(editor, { 'text/html': html, 'text/plain': 'Plano do projeto\nObjetivo: entregar em outubro setembro\nFase 1\nSubtarefa\nFase 2\nlink' })
    assert.equal(lastResult.plan.kind, 'html')
    const doc = editor.document
    assert.equal(doc[0].type, 'heading'); assert.equal(text(doc[0]), 'Plano do projeto')
    const para = doc.find((b) => /Objetivo/.test(text(b)))
    assert.equal(para.content.find((n) => n.text === 'Objetivo:').styles.bold, true)
    assert.equal(para.content.find((n) => n.text === 'outubro').styles.italic, true)
    assert.equal(para.content.find((n) => n.text === ' setembro').styles.strike, true)
    assert.doesNotMatch(text(para), /\u00a0/)
    assert.equal(para.content.some((n) => n.styles?.bold && n.text.includes('entregar')), false)
    const bullets = doc.filter((b) => b.type === 'bulletListItem')
    assert.deepEqual(bullets.map(text), ['Fase 1', 'Fase 2'])
    assert.equal(text(bullets[0].children[0]), 'Subtarefa')
    assert.equal(doc.find((b) => b.content?.some?.((n) => n.type === 'link')).content.find((n) => n.type === 'link').href, 'https://docs.example.com')
  } finally { done() }
})

test('HTML da interface web de chat: <pre> com cabeçalho/botão, KaTeX, tabela, citação e títulos', () => {
  const html = '<div class="markdown prose"><h3>Resumo</h3><p>Use <strong>isto</strong> e <code>aquilo</code>. Fórmula <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">x2</span></span>.</p><pre class="!overflow-visible"><div class="contain-inline-size"><div class="flex items-center">python</div><div class="sticky"><button class="flex gap-1">Copiar código</button></div><div class="overflow-y-auto p-4" dir="ltr"><code class="whitespace-pre! language-python"><span class="hljs-keyword">def</span> <span class="hljs-title">f</span>():\n    <span class="hljs-keyword">return</span> 1</code></div></div></pre><blockquote><p>Citado</p></blockquote><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td><strong>1</strong></td><td>2</td></tr></tbody></table><h5>Pequeno</h5><p onclick="alert(1)"><a href="javascript:alert(1)">mau</a> <img src="x" onerror="alert(1)"></p></div>'
  const { editor, done } = setup()
  try {
    paste(editor, { 'text/html': html, 'text/plain': 'Resumo ...' })
    const doc = editor.document
    assert.deepEqual(doc.filter((b) => b.type === 'heading').map((b) => [b.props.level, text(b)]), [[3, 'Resumo'], [3, 'Pequeno']])
    const code = doc.find((b) => b.type === 'codeBlock')
    assert.equal(code.props.language, 'python')
    assert.equal(text(code), 'def f():\n    return 1')
    const para = doc.find((b) => /isto/.test(text(b)))
    assert.equal(para.content.find((n) => n.type === 'inlineEquation')?.props.latex, 'x^2')
    assert.ok(doc.some((b) => b.type === 'quote' && text(b) === 'Citado'))
    assert.equal(doc.find((b) => b.type === 'table').content.rows.length, 2)
    const json = JSON.stringify(doc)
    assert.doesNotMatch(json, /javascript:|alert|Copiar código|onerror/)
  } finally { done() }
})

test('HTML do Word: listas MsoListParagraph viram listas aninhadas', () => {
  const html = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><body><p class=MsoNormal><b>Título Word</b><o:p></o:p></p><p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span><![endif]>Primeiro<o:p></o:p></p><p class=MsoListParagraphCxSpMiddle style='margin-left:72.0pt;mso-list:l0 level2 lfo1'><span style='mso-list:Ignore'>o<span>&nbsp; </span></span>Dentro<o:p></o:p></p><p class=MsoListParagraphCxSpLast style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>·<span>&nbsp; </span></span>Segundo<o:p></o:p></p></body></html>`
  const cleaned = cleanPastedHtml(html)
  assert.match(cleaned, /<ul><li>Primeiro<ul><li>Dentro<\/li><\/ul><\/li><li>Segundo<\/li><\/ul>/)
  const { editor, done } = setup()
  try {
    paste(editor, { 'text/html': html, 'text/plain': 'Título Word\nPrimeiro\nDentro\nSegundo' })
    const bullets = editor.document.filter((b) => b.type === 'bulletListItem')
    assert.deepEqual(bullets.map(text), ['Primeiro', 'Segundo'])
    assert.equal(text(bullets[0].children[0]), 'Dentro')
  } finally { done() }
})

test('texto comum cola como texto (inline, sem novo bloco); uma linha com **negrito** fica inline', () => {
  const { editor, done } = setup([{ id: 'target', type: 'paragraph', content: 'Antes: ' }])
  try {
    paste(editor, { 'text/plain': 'R$ 5 * 3 com joao_silva@x.com #tag' })
    assert.equal(lastResult.plan.kind, 'plain')
    assert.equal(editor.document.length, 1)
    assert.equal(text(editor.document[0]), 'Antes: R$ 5 * 3 com joao_silva@x.com #tag')
    paste(editor, { 'text/plain': ' e **forte**' })
    assert.equal(editor.document.length, 1)
    assert.equal(editor.document[0].content.find((n) => n.text === 'forte').styles.bold, true)
  } finally { done() }
})

test('⌘⇧V cola Markdown como texto simples; dentro de bloco de código nunca converte', () => {
  const { editor, done } = setup()
  try {
    plainNext = true
    paste(editor, { 'text/plain': '# Não é título\n\n- item\n- item' })
    assert.equal(lastResult.plan.kind, 'plain')
    assert.equal(editor.document.some((b) => b.type === 'heading' || b.type === 'bulletListItem'), false)
    assert.match(JSON.stringify(editor.document), /# Não é título/)
  } finally { done() }
  const code = setup([{ id: 'code', type: 'codeBlock', props: { language: 'text' }, content: '' }])
  try {
    paste(code.editor, { 'text/plain': '# Título\n- a\n- b', 'text/html': '<h1>Título</h1>' })
    assert.equal(code.editor.document.length, 1)
    assert.equal(code.editor.document[0].type, 'codeBlock')
    assert.equal(text(code.editor.document[0]), '# Título\n- a\n- b')
  } finally { code.done() }
})

test('planPaste: preserva caminhos existentes (blocknote/html, arquivos, VS Code) e respeita a configuração', () => {
  const data = (map) => ({ types: Object.keys(map), getData: (t) => map[t] ?? '' })
  assert.equal(planPaste(data({ 'blocknote/html': '<p>x</p>', 'text/plain': '# x' }), { convert: true }).kind, 'default')
  assert.equal(planPaste(data({ Files: '' }), { convert: true }).kind, 'default')
  assert.equal(planPaste(data({ 'vscode-editor-data': '{"mode":"typescript"}', 'text/plain': '# x\n' }), { convert: true }).kind, 'default')
  assert.equal(planPaste(data({ 'vscode-editor-data': '{"mode":"markdown"}', 'text/plain': '# x\n' }), { convert: true }).kind, 'markdown')
  assert.equal(planPaste(data({ 'text/plain': '# Título\n\n- a\n- b' }), { convert: false }).kind, 'plain')
  assert.equal(planPaste(data({ 'text/plain': 'a\tb\nc\td' }), { convert: false }).kind, 'plain')
  assert.equal(planPaste(data({ 'text/plain': '- a\n- b' }), { convert: true, inTable: true }).kind, 'plain')
  // HTML "pobre" (só <div>/<span> de editor de texto) + Markdown no texto → Markdown.
  assert.equal(planPaste(data({ 'text/html': '<div><span>## Título</span></div><div><span>- a</span></div>', 'text/plain': '## Título\n- a\n- b' }), { convert: true }).kind, 'markdown')
})

test('colar Markdown no meio de um parágrafo com texto preserva o título colado', () => {
  const { editor, done } = setup([{ id: 'target', type: 'paragraph', content: 'Texto existente' }])
  try {
    paste(editor, { 'text/plain': '## Novo título\n\n- a\n- b' })
    const doc = editor.document
    assert.equal(text(doc[0]), 'Texto existente')
    assert.equal(doc[1].type, 'heading'); assert.equal(text(doc[1]), 'Novo título')
    assert.deepEqual(doc.filter((b) => b.type === 'bulletListItem').map(text), ['a', 'b'])
    editor.undo()
    assert.equal(editor.document.length, 1); assert.equal(text(editor.document[0]), 'Texto existente')
  } finally { done() }
})
