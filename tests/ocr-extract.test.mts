// "Extrair texto" (B6a): parágrafos a partir do OCR, PDF com camada de texto + escaneado (Vision página a página),
// progresso, cancelamento e limites. Sem DOM nem rede: o PDF e o OCR são simulados.
import test from 'node:test'
import assert from 'node:assert/strict'
import { MIN_TEXT_LAYER_CHARS, extractFromImage, extractFromPdf, extractTargetOf, paragraphsFromEditedText, textToParagraphs, type PdfPageSource } from '../src/ocr/extractText.ts'

const fakePdf = (pages: (string | null)[], log: string[] = []): PdfPageSource => ({
  numPages: pages.length,
  textOf: async n => pages[n - 1] ?? '',
  renderPng: async n => { log.push(`render${n}`); return `data:image/png;base64,PAGE${n}` },
  destroy: () => { log.push('destroy') },
})

test('textToParagraphs: junta linhas quebradas, separa listas, frases curtas e linhas em branco; desfaz hifenização', () => {
  const lines = ['Este contrato estabelece as condições gerais de loca-', 'ção do imóvel descrito abaixo, com validade de doze', 'meses.', 'Cláusula segunda: pagamento.', '- Aluguel mensal', '- Condomínio', '', 'Assinado em Lisboa.']
  const out = textToParagraphs(lines.join('\n'))
  assert.deepEqual(out, ['Este contrato estabelece as condições gerais de locação do imóvel descrito abaixo, com validade de doze meses.', 'Cláusula segunda: pagamento.', '- Aluguel mensal', '- Condomínio', 'Assinado em Lisboa.'])
  assert.deepEqual(textToParagraphs('  \n\n '), [])
  assert.equal(textToParagraphs('x'.repeat(9000))[0].length, 4000)
  assert.deepEqual(paragraphsFromEditedText('Um\ncom quebra\n\n\nDois\n\n   \nTrês'), ['Um com quebra', 'Dois', 'Três'])
})

test('extractTargetOf: só imagem/PDF com o arquivo embutido; URL externa não vira alvo', () => {
  const png = 'data:image/png;base64,AAAA', pdf = 'data:application/pdf;base64,AAAA'
  assert.deepEqual(extractTargetOf({ id: 'a', type: 'image', props: { url: png, name: 'foto' } }), { blockId: 'a', kind: 'image', data: png, name: 'foto' })
  assert.equal(extractTargetOf({ id: 'b', type: 'pdfPreview', props: { data: pdf, name: 'x.pdf' } })?.kind, 'pdf')
  assert.equal(extractTargetOf({ id: 'c', type: 'file', props: { url: pdf } })?.kind, 'pdf')
  assert.equal(extractTargetOf({ id: 'd', type: 'image', props: { url: 'https://example.com/a.png' } }), null)
  assert.equal(extractTargetOf({ id: 'e', type: 'paragraph', props: {} }), null)
  assert.equal(extractTargetOf(null), null)
})

test('imagem: usa o OCR local e falha com código claro sem Vision', async () => {
  const result = await extractFromImage('data:image/png;base64,AAAA', { canOcr: () => true, recognize: async () => 'Nota fiscal 123' })
  assert.equal(result.text, 'Nota fiscal 123'); assert.equal(result.ocrPages, 1)
  await assert.rejects(extractFromImage('data:image/png;base64,AAAA', { canOcr: () => false }), /OCR_UNAVAILABLE/)
  await assert.rejects(extractFromImage('data:image/png;base64,AAAA', { canOcr: () => true, recognize: async () => null }), /OCR_FAILED/)
})

test('PDF misto: camada de texto quando existe; só as páginas escaneadas passam pelo Vision, com progresso', async () => {
  const log: string[] = [], seen: string[] = [], progress: string[] = []
  const long = 'Página com texto digital suficiente para dispensar o OCR.'
  assert.ok(long.length > MIN_TEXT_LAYER_CHARS)
  const result = await extractFromPdf('data:application/pdf;base64,AA', {
    openPdf: async () => fakePdf([long, '', ' ', 'Outra página digital com bastante texto aqui.'], log),
    canOcr: () => true,
    recognize: async png => { seen.push(png); return `OCR de ${png.slice(-5)}` },
    onProgress: p => progress.push(`${p.phase}${p.page}/${p.total}`),
  })
  assert.deepEqual(log, ['render2', 'render3', 'destroy'], 'só as páginas sem texto são rasterizadas; o PDF é fechado')
  assert.deepEqual(seen, ['data:image/png;base64,PAGE2', 'data:image/png;base64,PAGE3'])
  assert.equal(result.ocrPages, 2); assert.equal(result.pages, 4); assert.equal(result.cancelled, false)
  assert.equal(result.text, [long, 'OCR de PAGE2', 'OCR de PAGE3', 'Outra página digital com bastante texto aqui.'].join('\n\n'))
  assert.deepEqual(progress, ['text1/4', 'text2/4', 'ocr2/4', 'text3/4', 'ocr3/4', 'text4/4'])
})

test('PDF: cancelar interrompe entre páginas e devolve o texto parcial; limite de páginas é avisado', async () => {
  const controller = new AbortController()
  const recognized: string[] = []
  const result = await extractFromPdf('data:application/pdf;base64,AA', {
    openPdf: async () => fakePdf(['', '', '', '']), canOcr: () => true, signal: controller.signal,
    recognize: async png => { recognized.push(png); if (recognized.length === 2) controller.abort(); return `texto ${recognized.length}` },
  })
  assert.equal(result.cancelled, true); assert.equal(recognized.length, 2)
  assert.equal(result.text, 'texto 1\n\ntexto 2', 'a página em andamento quando cancelou é mantida')
  const limited = await extractFromPdf('data:application/pdf;base64,AA', { openPdf: async () => fakePdf(Array(5).fill('Texto digital longo o bastante para valer.')), canOcr: () => false, limit: 3 })
  assert.equal(limited.pages, 3); assert.equal(limited.truncated, true)
})

test('PDF: escaneado sem Vision falha com OCR_UNAVAILABLE; ilegível falha com PDF_UNREADABLE; digital funciona sem Vision', async () => {
  await assert.rejects(extractFromPdf('data:application/pdf;base64,AA', { openPdf: async () => fakePdf(['', '']), canOcr: () => false }), /OCR_UNAVAILABLE/)
  await assert.rejects(extractFromPdf('data:application/pdf;base64,AA', { openPdf: async () => null }), /PDF_UNREADABLE/)
  const digital = await extractFromPdf('data:application/pdf;base64,AA', { openPdf: async () => fakePdf(['Texto digital com tamanho suficiente aqui.']), canOcr: () => false })
  assert.equal(digital.ocrPages, 0); assert.match(digital.text, /Texto digital/)
})

test('integração: item "Extrair texto" no menu do bloco, só para imagem/PDF, e inserção numa única operação', async () => {
  const { readFileSync } = await import('node:fs')
  const menu = readFileSync('src/components/page/BlockHandleMenu.tsx', 'utf8'), editor = readFileSync('src/components/page/PageEditor.tsx', 'utf8')
  assert.match(menu, /extractTargetOf\(block/); assert.match(menu, /Extrair texto/); assert.match(menu, /ocrAvailable\(\)/)
  assert.match(editor, /ExtractTextDialog/); assert.match(editor, /editor\.insertBlocks\(blocks as never, extractTarget\.blockId, 'after'\)/)
  assert.equal((editor.match(/extractTarget\.blockId/g) ?? []).length >= 1, true)
})
