// Heurística de "colar já formatado" e conversão Markdown → blocos (src/components/page/paste).
import test from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeMarkdown, markdownSignals, parseTsv, conversationRoles } from '../src/components/page/paste/detect.ts'
import { markdownToPasteBlocks, splitMarkdownChunks, prepareMarkdown } from '../src/components/page/paste/markdown.ts'

const text = (block: any) => Array.isArray(block?.content) ? block.content.map((n: any) => n.text ?? n.content?.map((p: any) => p.text).join('') ?? n.props?.latex ?? '').join('') : ''
const types = (blocks: any[]) => blocks.map((b) => b.type).join(',')

test('detecção: Markdown real converte', () => {
  const positives = [
    '# Título\n\nTexto',
    '## Seção',
    '- um\n- dois',
    '* um\n* dois',
    '1. primeiro\n2. segundo',
    '- [ ] tarefa\n- [x] feita',
    '| a | b |\n| --- | --- |\n| 1 | 2 |',
    '```js\nconst a = 1\n```',
    '~~~\ncode\n~~~',
    '> citação\n> continua',
    'Isso é **muito** importante',
    'Rode `npm test` antes',
    'Veja [o site](https://example.com)',
    'Antes\n\n---\n\nDepois ~~riscado~~',
    '$$\nE = mc^2\n$$',
    '> [!note]\n> cuidado',
    '<details><summary>Mais</summary>\n\nconteúdo\n</details>',
    'Você: oi\nAssistente: olá, como posso ajudar?',
    'linha<br>outra e <b>negrito</b>',
  ]
  for (const sample of positives) assert.equal(looksLikeMarkdown(sample), true, sample)
})

test('detecção: texto comum NÃO converte', () => {
  const negatives = [
    'Olá, tudo bem?',
    'Comprar pão - leite - ovos',
    'R$ 5 * 3 = R$ 15',
    'O total é 2 * 3 * 4',
    'joao_silva@example.com',
    'maria.souza+teste@empresa.com.br',
    '/Users/dev/Documents/meus_projetos/arquivo_final.txt',
    'C:\\Users\\dev\\file_name.txt',
    'Adorei o evento #tbt #ferias',
    '#hashtag no começo',
    '- só um item solto',
    '* nota de rodapé',
    'Preço: $5 e $10 na promoção',
    'A = B',
    'Linha um\nLinha dois\nLinha três',
    'snake_case_variable e outra_variavel',
    'User: joao (sem conversa)',
  ]
  for (const sample of negatives) assert.equal(looksLikeMarkdown(sample), false, `${sample} → ${JSON.stringify(markdownSignals(sample))}`)
})

test('TSV de planilha vira linhas; texto com tabs inconsistentes não', () => {
  assert.deepEqual(parseTsv('Nome\tValor\nA\t1\nB\t2\n'), [['Nome', 'Valor'], ['A', '1'], ['B', '2']])
  assert.deepEqual(parseTsv('a\t"linha 1\nlinha 2"\nb\tc'), [['a', 'linha 1\nlinha 2'], ['b', 'c']])
  assert.equal(parseTsv('a\tb'), null)
  assert.equal(parseTsv('a\tb\nc'), null)
  assert.equal(parseTsv('\tcmd\n\tcmd2'), null)
  assert.equal(parseTsv('sem tabs\naqui'), null)
})

test('papéis de conversa exigem duas falas de papéis diferentes', () => {
  assert.equal(conversationRoles(['User: oi', 'Assistant: olá']).length, 2)
  assert.equal(conversationRoles(['User: oi', 'User: de novo']).length, 0)
  assert.equal(conversationRoles(['Você disse:', 'oi', 'O ChatGPT disse:', 'olá']).length, 2)
  assert.equal(conversationRoles(['```', 'User: x', 'Assistant: y', '```']).length, 0)
})

test('títulos 1–6 (4+ vira 3), parágrafos e quebras de linha', () => {
  const blocks = markdownToPasteBlocks('# Um\n## Dois\n### Três\n#### Quatro\n###### Seis\n\nlinha a\nlinha b\n\nnovo parágrafo')
  assert.deepEqual(blocks.map((b: any) => b.props?.level ?? 0), [1, 2, 3, 3, 3, 0, 0])
  assert.equal(text(blocks[5]), 'linha a\nlinha b')
  assert.equal(text(blocks[6]), 'novo parágrafo')
})

test('listas aninhadas por 2/4 espaços e tab, numeradas e tarefas', () => {
  for (const indent of ['  ', '    ', '\t']) {
    const blocks: any[] = markdownToPasteBlocks(`- a\n${indent}- a1\n${indent}${indent}- a11\n- b`)
    assert.equal(types(blocks), 'bulletListItem,bulletListItem', JSON.stringify(indent))
    assert.equal(text(blocks[0].children[0]), 'a1')
    assert.equal(text(blocks[0].children[0].children[0]), 'a11')
  }
  const numbered: any[] = markdownToPasteBlocks('1. um\n2. dois\n   - sub\n3. três')
  assert.equal(types(numbered), 'numberedListItem,numberedListItem,numberedListItem')
  assert.equal(numbered[1].children[0].type, 'bulletListItem')
  const tasks: any[] = markdownToPasteBlocks('- [ ] fazer\n- [x] feito')
  assert.deepEqual(tasks.map((b) => [b.type, b.props.checked]), [['checkListItem', false], ['checkListItem', true]])
})

test('tabela GFM com alinhamento e formatação inline nas células', () => {
  const [table]: any[] = markdownToPasteBlocks('| Nome | **Valor** | Nota |\n|:-----|------:|:---:|\n| a | `1` | [x](https://e.com) |\n| b \\| c | 2 | ~~n~~ |')
  assert.equal(table.type, 'table')
  assert.equal(table.content.headerRows, 1)
  assert.equal(table.content.rows.length, 3)
  const cells = table.content.rows[0].cells
  assert.deepEqual(cells.map((c: any) => c.props.textAlignment ?? null), ['left', 'right', 'center'])
  assert.equal(cells[1].content[0].styles.bold, true)
  assert.equal(table.content.rows[1].cells[1].content[0].styles.code, true)
  assert.equal(table.content.rows[1].cells[2].content[0].href, 'https://e.com')
  assert.equal(table.content.rows[2].cells[0].content[0].text, 'b | c')
})

test('blocos de código com linguagem, inclusive vários numa conversa', () => {
  const blocks: any[] = markdownToPasteBlocks('Veja:\n\n```python\nprint("oi")\n# não é título\n```\n\nE também:\n\n```ts\nconst a: number = 1\n```')
  assert.equal(types(blocks), 'paragraph,codeBlock,paragraph,codeBlock')
  assert.equal(blocks[1].props.language, 'python')
  assert.equal(text(blocks[1]), 'print("oi")\n# não é título')
  assert.equal(blocks[3].props.language, 'typescript')
})

test('citação multilinha e aninhada, divisor', () => {
  const blocks: any[] = markdownToPasteBlocks('> linha 1\n> linha 2\n> > aninhada\n\n---\n\nfim')
  assert.equal(types(blocks), 'quote,divider,paragraph')
  assert.equal(text(blocks[0]), 'linha 1\nlinha 2')
  assert.equal(blocks[0].children[0].type, 'quote')
  assert.equal(text(blocks[0].children[0]), 'aninhada')
})

test('marcas inline: negrito, itálico, tachado, código, link, realce, HTML básico', () => {
  const [p]: any[] = markdownToPasteBlocks('**b** *i* ~~s~~ `c` [l](https://x.dev) ==h== <u>u</u> <b>B</b> <i>I</i> a<br>b')
  const find = (t: string) => p.content.find((n: any) => (n.text ?? n.content?.[0]?.text) === t)
  assert.equal(find('b').styles.bold, true)
  assert.equal(find('i').styles.italic, true)
  assert.equal(find('s').styles.strike, true)
  assert.equal(find('c').styles.code, true)
  assert.equal(find('l').href, 'https://x.dev')
  assert.equal(find('h').styles.backgroundColor, 'yellow')
  assert.equal(find('u').styles.underline, true)
  assert.equal(find('B').styles.bold, true)
  assert.equal(find('I').styles.italic, true)
  assert.match(text(p), /a\nb$/)
})

test('links e imagens perigosos não passam', () => {
  const blocks: any[] = markdownToPasteBlocks('[x](javascript:alert(1)) e ![i](javascript:alert(2)) <script>alert(3)</script> <a href="javascript:x">y</a>')
  const json = JSON.stringify(blocks)
  assert.doesNotMatch(json, /javascript:/)
  assert.doesNotMatch(json, /alert\(3\)/)
})

test('imagens: remota e data: viram bloco de imagem; inline remota vira link', () => {
  const blocks: any[] = markdownToPasteBlocks('![gráfico](https://example.com/a.png)\n\n![px](data:image/png;base64,aGVsbG8=)\n\ntexto com ![ícone](https://e.com/i.png) no meio')
  assert.equal(types(blocks), 'image,image,paragraph')
  assert.equal(blocks[0].props.url, 'https://example.com/a.png')
  assert.equal(blocks[0].props.caption, 'gráfico')
  assert.equal(blocks[1].props.url, 'data:image/png;base64,aGVsbG8=')
  assert.equal(blocks[2].content.find((n: any) => n.type === 'link').href, 'https://e.com/i.png')
})

test('callouts > [!note]/[!warning], <details> → toggle, equações', () => {
  const blocks: any[] = markdownToPasteBlocks('> [!warning] Atenção\n> Não apague.\n\n> [!note]\n> Só uma nota\n\n<details>\n<summary>Ver mais</summary>\n\nescondido\n</details>\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nEm linha $a^2+b^2$ e \\(c^2\\).\n\n\\[\nx = 1\n\\]')
  assert.equal(types(blocks), 'callout,callout,toggleListItem,equation,paragraph,equation')
  assert.equal(blocks[0].props.icon, '⚠️')
  assert.match(text(blocks[0]), /Atenção/)
  assert.equal(blocks[1].props.icon, 'ℹ️')
  assert.equal(text(blocks[1]), 'Só uma nota')
  assert.equal(text(blocks[2]), 'Ver mais')
  assert.equal(text(blocks[2].children[0]), 'escondido')
  assert.equal(blocks[3].props.latex, '\\int_0^1 x\\,dx')
  assert.deepEqual(blocks[4].content.filter((n: any) => n.type === 'inlineEquation').map((n: any) => n.props.latex), ['a^2+b^2', 'c^2'])
  assert.equal(blocks[5].props.latex, 'x = 1')
})

test('notas de rodapé simples', () => {
  const blocks: any[] = markdownToPasteBlocks('Texto com nota[^1].\n\n[^1]: A explicação.')
  assert.equal(text(blocks[0]), 'Texto com nota¹.')
  assert.equal(text(blocks[1]), '¹ A explicação.')
})

test('conversa copiada preserva papéis sem destruir listas, tabelas e código', () => {
  const chat = 'Você: Compare as opções\nAssistente: Claro! Aqui vai:\n\n## Resumo\n\n- **A**: rápida\n- **B**: barata\n\n| Opção | Custo |\n|---|---|\n| A | 10 |\n\n```bash\nnpm i\n```\nVocê: Obrigado'
  const blocks: any[] = markdownToPasteBlocks(chat)
  assert.deepEqual(blocks.filter((b) => b.type === 'paragraph' && b.content[0]?.styles?.bold).map(text), ['Você:', 'Assistente:', 'Você:'])
  assert.ok(blocks.some((b) => b.type === 'heading' && text(b) === 'Resumo'))
  assert.equal(blocks.filter((b) => b.type === 'bulletListItem').length, 2)
  assert.ok(blocks.some((b) => b.type === 'table'))
  assert.equal(blocks.find((b) => b.type === 'codeBlock').props.language, 'bash')
  assert.equal(text(blocks.at(-1)), 'Obrigado')
})

test('fallback de schema: sem callout/equação usa citação/código', () => {
  const support = { block: (t: string) => !['callout', 'equation'].includes(t), inline: (t: string) => t !== 'inlineEquation' }
  const blocks: any[] = markdownToPasteBlocks('> [!tip] Dica\n\n$$x$$\n\nvalor $y^2$ aqui', support)
  assert.equal(types(blocks), 'quote,codeBlock,paragraph')
  assert.equal(blocks[2].content.find((n: any) => n.text === 'y^2').styles.code, true)
})

test('idempotente e sem mutar entrada; fatias preservam blocos inteiros', () => {
  const md = '# A\n\n```js\nx\n\ny\n```\n\n- a\n- b\n\ntexto'
  assert.deepEqual(markdownToPasteBlocks(md).map((b: any) => [b.type, text(b)]), markdownToPasteBlocks(md).map((b: any) => [b.type, text(b)]))
  assert.equal(prepareMarkdown(md).text.includes('```js'), true)
  const big = Array.from({ length: 200 }, (_, i) => `## S${i}\n\n\`\`\`\nlinha\n\nmais\n\`\`\`\n\n- x\n- y\n`).join('\n')
  const chunks = splitMarkdownChunks(big, 2000)
  assert.ok(chunks.length >= 4)
  assert.equal(chunks.join('\n'), big)
  for (const chunk of chunks) assert.equal((chunk.match(/```/g) ?? []).length % 2, 0)
})

test('desempenho: 200 KB de Markdown convertem em < 300 ms', () => {
  const unit = '## Seção\n\nParágrafo com **negrito**, `código` e [link](https://e.com).\n\n- item 1\n- item 2\n  - sub\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1\n```\n\n'
  const md = unit.repeat(Math.ceil(200_000 / unit.length))
  markdownToPasteBlocks(md.slice(0, 5000))
  const start = performance.now()
  const blocks = markdownToPasteBlocks(md)
  const elapsed = performance.now() - start
  assert.ok(blocks.length > 1000)
  assert.ok(elapsed < 300, `${elapsed.toFixed(0)} ms`)
})
