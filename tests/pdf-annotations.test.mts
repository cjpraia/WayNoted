// Modelo de anotações de PDF (src/components/pdf/annotations.ts) e exportação com pdf-lib. Sem DOM.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import {
  bounds, canRedo, canUndo, createHistory, displayToPdf, filterAnnotations, groupByPage, highlightsToMarkdown, mergeLineRects, moveAnnotation, normalizeRect, parseAnnotations,
  pushHistory, rectFromView, rectToView, redoHistory, rotatePoint, serializeAnnotations, sha256Hex, simplifyPoints, undoHistory, unrotatePoint, textualAnnotations,
  type Annotation, type Rotation,
} from '../src/components/pdf/annotations.ts'
import { exportAnnotatedPdf, safeText, wrapText } from '../src/components/pdf/exportAnnotated.ts'

const t = (pt: string, en: string) => en
const mk = (patch: Partial<Annotation>): Annotation => ({ id: 'a1', kind: 'highlight', page: 1, color: 'yellow', rects: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.02 }], created: 1, updated: 1, ...patch })

test('normalizeRect converts browser pixels into page fractions and clamps to the page', () => {
  const r = normalizeRect({ left: 150, top: 120, width: 100, height: 20 }, { left: 100, top: 100, width: 400, height: 800 })
  assert.deepEqual(r, { x: 0.125, y: 0.025, w: 0.25, h: 0.025 })
  const out = normalizeRect({ left: 50, top: 0, width: 1000, height: 5000 }, { left: 100, top: 100, width: 400, height: 800 })
  assert.equal(out.x, 0); assert.equal(out.y, 0); assert.equal(out.x + out.w, 1); assert.equal(out.y + out.h, 1)
  assert.deepEqual(normalizeRect({ left: 0, top: 0, width: 1, height: 1 }, { left: 0, top: 0, width: 0, height: 0 }), { x: 0, y: 0, w: 0, h: 0 })
})

test('view rotation round-trips for points and rectangles (annotations survive rotation)', () => {
  for (const rotation of [0, 90, 180, 270] as Rotation[]) {
    const [vx, vy] = rotatePoint(0.2, 0.7, rotation)
    const [bx, by] = unrotatePoint(vx, vy, rotation)
    assert.ok(Math.abs(bx - 0.2) < 1e-9 && Math.abs(by - 0.7) < 1e-9, `point ${rotation}`)
    const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.05 }
    const back = rectFromView(rectToView(rect, rotation), rotation)
    assert.ok(Math.abs(back.x - rect.x) < 1e-4 && Math.abs(back.y - rect.y) < 1e-4 && Math.abs(back.w - rect.w) < 1e-4 && Math.abs(back.h - rect.h) < 1e-4, `rect ${rotation}`)
  }
  assert.deepEqual(rotatePoint(0, 0, 90), [1, 0])
  const swapped = rectToView({ x: 0, y: 0, w: 0.5, h: 0.1 }, 90)
  assert.equal(swapped.w, 0.1); assert.equal(swapped.h, 0.5)
})

test('displayToPdf maps display fractions to PDF space for every /Rotate', () => {
  const box = { x: 10, y: 20, width: 400, height: 500 }
  assert.deepEqual(displayToPdf(0, 0, 0, box), [10, 520])
  assert.deepEqual(displayToPdf(1, 1, 0, box), [410, 20])
  assert.deepEqual(displayToPdf(0, 0, 90, box), [10, 20])
  assert.deepEqual(displayToPdf(1, 0, 90, box), [10, 520])
  assert.deepEqual(displayToPdf(0, 0, 180, box), [410, 20])
  assert.deepEqual(displayToPdf(0, 0, 270, box), [410, 520])
  assert.deepEqual(displayToPdf(1, 0, 270, box), [410, 20])
})

test('mergeLineRects joins fragments of one line and keeps separate lines', () => {
  const merged = mergeLineRects([
    { x: 0.1, y: 0.1, w: 0.1, h: 0.02 }, { x: 0.21, y: 0.101, w: 0.1, h: 0.02 }, { x: 0.1, y: 0.2, w: 0.2, h: 0.02 }, { x: 0.5, y: 0.5, w: 0.0001, h: 0.0001 },
  ])
  assert.equal(merged.length, 2)
  assert.ok(Math.abs(merged[0].w - 0.21) < 1e-3)
})

test('parseAnnotations is tolerant: bad JSON, unknown kinds, out-of-range numbers and duplicates', () => {
  assert.deepEqual(parseAnnotations('{not json'), { v: 1, hash: '', annotations: [] })
  assert.deepEqual(parseAnnotations(''), { v: 1, hash: '', annotations: [] })
  assert.deepEqual(parseAnnotations(42), { v: 1, hash: '', annotations: [] })
  const doc = parseAnnotations(JSON.stringify({
    hash: 'x', annotations: [
      mk({ id: 'ok' }), mk({ id: 'ok' }), { kind: 'laser', page: 1 }, { kind: 'highlight', page: 0, rects: [{ x: 0, y: 0, w: 1, h: 1 }] },
      mk({ id: 'far', rects: [{ x: -4, y: 0.9, w: 9, h: 9 }], color: 'purple' as never }),
      { kind: 'pen', page: 2, points: [[0, 0]] }, { kind: 'pen', page: 2, points: [[0, 0], [2, 3]], size: 9 },
      { kind: 'note', page: 1, x: 'a', y: 1 }, { kind: 'note', page: 3, x: 0.5, y: 0.5, text: 'oi' }, null, 'x',
    ],
  }))
  assert.equal(doc.hash, '')
  assert.deepEqual(doc.annotations.map((a) => a.kind), ['highlight', 'highlight', 'highlight', 'pen', 'note'])
  assert.equal(new Set(doc.annotations.map((a) => a.id)).size, 5)
  const far = doc.annotations[2]
  assert.equal(far.color, 'yellow'); assert.equal(far.rects![0].x, 0); assert.ok(far.rects![0].y + far.rects![0].h <= 1)
  assert.deepEqual(doc.annotations[3].points, [[0, 0], [1, 1]]); assert.ok(doc.annotations[3].size! <= 0.05)
})

test('serialize/parse round trip keeps the hash and drops to an empty string when there is nothing to store', () => {
  const hash = 'a'.repeat(64)
  const list = [mk({}), mk({ id: 'n', kind: 'note', rects: undefined, x: 0.4, y: 0.4, text: 'olá', created: 5, updated: 6 })]
  const json = serializeAnnotations({ v: 1, hash, annotations: list })
  const back = parseAnnotations(json)
  assert.equal(back.hash, hash)
  assert.deepEqual(back.annotations, JSON.parse(JSON.stringify(list)))
  assert.equal(serializeAnnotations({ v: 1, hash, annotations: [] }), '')
})

test('sha256Hex matches node crypto', async () => {
  const bytes = new Uint8Array(await readFile(new URL('./fixtures/sample-annotation.pdf', import.meta.url)))
  assert.equal(await sha256Hex(bytes), createHash('sha256').update(bytes).digest('hex'))
})

test('history: undo, redo, coalescing of typing and redo cleared by a new edit', () => {
  let h = createHistory([])
  const a = mk({ id: '1' }), b = mk({ id: '2' })
  h = pushHistory(h, [a], undefined, 1000)
  h = pushHistory(h, [a, b], undefined, 1100)
  assert.ok(canUndo(h) && !canRedo(h))
  h = undoHistory(h)
  assert.deepEqual(h.present.map((x) => x.id), ['1']); assert.ok(canRedo(h))
  h = redoHistory(h)
  assert.deepEqual(h.present.map((x) => x.id), ['1', '2'])
  h = undoHistory(undoHistory(h)); assert.equal(h.present.length, 0); assert.ok(!canUndo(h))
  h = pushHistory(h, [a], undefined, 2000)
  assert.ok(!canRedo(h))
  const base = h.past.length
  h = pushHistory(h, [{ ...a, text: 'o' }], 'text:1', 3000)
  h = pushHistory(h, [{ ...a, text: 'ol' }], 'text:1', 3200)
  h = pushHistory(h, [{ ...a, text: 'ola' }], 'text:1', 3400)
  assert.equal(h.past.length, base + 1, 'typing is one undo step')
  assert.equal(undoHistory(h).present[0].text, undefined)
  h = pushHistory(h, [{ ...a, text: 'ola!' }], 'text:1', 9000)
  assert.equal(h.past.length, base + 2, 'a pause starts a new step')
})

test('filter by color and search over quote and comment; grouping by page in reading order', () => {
  const list = [
    mk({ id: 'b', page: 2, quote: 'Local-first notes', color: 'green' }), mk({ id: 'a', page: 1, quote: 'Another thing', text: 'Revisar', color: 'yellow' }),
    mk({ id: 'c', page: 2, kind: 'note', rects: undefined, x: 0.5, y: 0.05, text: 'pergunta', color: 'blue' }),
  ]
  assert.deepEqual(filterAnnotations(list, { color: 'green' }).map((a) => a.id), ['b'])
  assert.deepEqual(filterAnnotations(list, { query: 'REVISAR' }).map((a) => a.id), ['a'])
  assert.deepEqual(filterAnnotations(list, { query: 'notes', color: 'yellow' }), [])
  const groups = groupByPage(list)
  assert.deepEqual(groups.map((g) => [g.page, g.items.map((i) => i.id)]), [[1, ['a']], [2, ['c', 'b']]])
})

test('Markdown export lists highlights per page with comments and notes', () => {
  const list = [mk({ id: 'a', quote: 'Frase  importante\nem duas linhas', text: 'concordo' }), mk({ id: 'n', page: 3, kind: 'note', rects: undefined, x: 0.1, y: 0.1, text: 'ver depois' }), mk({ id: 'p', kind: 'pen', rects: undefined, points: [[0, 0], [1, 1]] })]
  const md = highlightsToMarkdown(list, 'livro.pdf', t)
  assert.equal(md, '## livro.pdf\n\n### Page 1\n\n> Frase importante em duas linhas\n>\n> Comment: concordo\n\n### Page 3\n\n- Note: ver depois\n')
  assert.equal(highlightsToMarkdown([list[2]], 'x.pdf', t), '')
  assert.equal(textualAnnotations(list).length, 2)
})

test('moveAnnotation clamps to the page, ignores text-anchored highlights and moves pen strokes', () => {
  const note = mk({ id: 'n', kind: 'note', rects: undefined, x: 0.5, y: 0.5 })
  assert.equal(moveAnnotation(note, 0.1, 0).x, 0.6)
  const edge = moveAnnotation(note, 5, 5)
  assert.ok(edge.x! <= 1 && edge.y! <= 1)
  assert.equal(moveAnnotation(mk({}), 0.2, 0.2).rects![0].x, 0.1)
  const pen = mk({ id: 'p', kind: 'pen', rects: undefined, points: [[0.1, 0.1], [0.2, 0.2]] })
  assert.deepEqual(moveAnnotation(pen, 0.1, 0).points, [[0.2, 0.1], [0.3, 0.2]])
  const left = moveAnnotation(pen, -1, -1).points!
  assert.equal(Math.min(left[0][0], left[1][0]), 0)
  assert.ok(bounds(pen).w > 0)
})

test('simplifyPoints drops near-duplicates but keeps the final point', () => {
  const out = simplifyPoints([[0, 0], [0.0001, 0], [0.1, 0], [0.1001, 0]])
  assert.equal(out.length, 2)
  assert.deepEqual(out[out.length - 1], [0.1001, 0])
})

test('safeText replaces characters the Helvetica encoding cannot hold, wrapText wraps by width', () => {
  const font = { encodeText: (c: string) => { if (c.charCodeAt(0) > 255) throw new Error('x'); return c }, widthOfTextAtSize: (s: string, size: number) => s.length * size }
  assert.equal(safeText(font as never, 'ação 😀 日本'), 'ação ? ??')
  assert.deepEqual(wrapText(font as never, 'aa bb cc\ndd', 1, 5), ['aa bb', 'cc', 'dd'])
})

test('export creates a NEW annotated PDF and leaves the original bytes untouched', async () => {
  const original = new Uint8Array(await readFile(new URL('./fixtures/sample-annotation.pdf', import.meta.url)))
  const before = createHash('sha256').update(original).digest('hex')
  const list: Annotation[] = [
    mk({ id: '1', page: 1, rects: [{ x: 0.1, y: 0.1, w: 0.4, h: 0.03 }] }), mk({ id: '2', page: 1, kind: 'underline', color: 'blue' }), mk({ id: '3', page: 2, kind: 'strike', color: 'pink' }),
    mk({ id: '4', page: 2, kind: 'note', rects: undefined, x: 0.5, y: 0.5, color: 'green' }), mk({ id: '5', page: 3, kind: 'pen', rects: undefined, points: [[0.1, 0.1], [0.3, 0.2], [0.5, 0.1]], size: 0.004, color: 'orange' }),
    mk({ id: '6', page: 3, kind: 'text', rects: undefined, x: 0.1, y: 0.6, w: 0.5, h: 0.1, size: 0.02, text: 'Caixa com acento e emoji 😀\nsegunda linha' }),
    mk({ id: '7', page: 99 }),
  ]
  const result = await exportAnnotatedPdf(original, list)
  assert.equal(result.drawn, 6); assert.equal(result.skipped, 1)
  assert.equal(createHash('sha256').update(original).digest('hex'), before, 'input bytes unchanged')
  assert.ok(result.bytes.byteLength > original.byteLength)
  assert.equal(Buffer.from(result.bytes.slice(0, 5)).toString('latin1'), '%PDF-')
  const { PDFDocument } = await import('pdf-lib')
  const reloaded = await PDFDocument.load(result.bytes)
  assert.equal(reloaded.getPageCount(), 3)
  const plain = await exportAnnotatedPdf(original, [])
  assert.equal(plain.drawn, 0)
})

test('export honours rotated pages without throwing', async () => {
  const { PDFDocument, degrees } = await import('pdf-lib')
  for (const angle of [90, 180, 270]) {
    const doc = await PDFDocument.create()
    const page = doc.addPage([300, 400]); page.setRotation(degrees(angle))
    const result = await exportAnnotatedPdf(await doc.save(), [mk({}), mk({ id: 't', kind: 'text', rects: undefined, x: 0.1, y: 0.1, w: 0.5, h: 0.2, text: 'olá mundo' })])
    assert.equal(result.drawn, 2, `rotate ${angle}`)
  }
})
