// Recuperação local de "Perguntar às suas notas" (src/ai/retrieval.ts): pedaços, BM25, híbrido,
// incremental, persistência e citações. Corpus sintético pequeno (sem rede, sem DOM).
import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkIndex, chunkBlocks, parseCitations, restoreIndex, serializeIndex, terms } from '../src/ai/retrieval.ts'

const para = (id: string, text: string) => ({ id, type: 'paragraph', content: text })
const heading = (id: string, level: number, text: string) => ({ id, type: 'heading', props: { level }, content: text })

test('chunks follow headings, keep the heading path and the first block id, and split huge blocks', () => {
  const blocks = [
    para('intro', 'Visão geral do projeto.'),
    heading('h1', 1, 'Arquitetura'),
    para('a1', 'Usamos Electron com processo principal isolado.'),
    { id: 'toggle', type: 'toggle', content: 'Detalhes', children: [para('a2', 'O renderer não tem rede.')] },
    heading('h2', 2, 'Banco'),
    para('b1', 'SQLite foi descartado; ficamos com JSON cifrado.'),
    heading('h3', 1, 'Riscos'),
    para('big', 'Frase longa sobre riscos. '.repeat(120)),
  ]
  const chunks = chunkBlocks('p', blocks, 400)
  assert.equal(chunks[0].path, ''); assert.equal(chunks[0].blockId, 'intro')
  const arch = chunks.find(c => c.text.includes('Electron'))!
  assert.equal(arch.path, 'Arquitetura'); assert.equal(arch.blockId, 'a1'); assert.match(arch.text, /renderer não tem rede/)
  const db = chunks.find(c => c.text.includes('SQLite'))!
  assert.equal(db.path, 'Arquitetura › Banco'); assert.equal(db.blockId, 'b1')
  const risks = chunks.filter(c => c.path === 'Riscos')
  assert.ok(risks.length >= 5, `split into ${risks.length}`)
  assert.ok(risks.every(c => c.blockId === 'big' && c.text.length <= 450))
  assert.equal(new Set(chunks.map(c => c.id)).size, chunks.length)
})

const corpus: Record<string, { title: string; text: string }> = {
  p01: { title: 'Reunião de arquitetura', text: 'Decidimos usar SQLite para o cache local e manter JSON para os documentos.' },
  p02: { title: 'Viagem a Lisboa', text: 'Reservar hotel em Alfama, comprar passagens de trem para Sintra.' },
  p03: { title: 'Receita de bolo', text: 'Bolo de cenoura: três cenouras, quatro ovos, óleo, açúcar e farinha.' },
  p04: { title: 'Orçamento 2026', text: 'Gastos com marketing sobem 12%; contratações congeladas até junho.' },
  p05: { title: 'Leituras', text: 'Livros para ler: Duna, Neuromancer e O Nome do Vento.' },
  p06: { title: 'Treino', text: 'Corrida de 5 km às terças; musculação às quintas e sábados.' },
  p07: { title: 'Ideias de produto', text: 'Modo offline completo, exportação em Markdown e sincronização opcional.' },
  p08: { title: 'Saúde', text: 'Consulta com dermatologista marcada; exames de sangue em jejum.' },
  p09: { title: 'Jardim', text: 'Plantar manjericão e alecrim; regar as orquídeas uma vez por semana.' },
  p10: { title: 'Carro', text: 'Trocar o óleo do motor e calibrar os pneus antes da viagem.' },
  p11: { title: 'Decisões do time', text: 'As decisões sobre contratação ficam com a diretoria; a decisão de preço foi adiada.' },
  p12: { title: 'Segurança', text: 'Senhas no Keychain, páginas protegidas e espaço com cofre cifrado.' },
}
function build() {
  const index = new ChunkIndex()
  for (const [id, page] of Object.entries(corpus)) index.setPage(id, page.title, '1', chunkBlocks(id, [para(`${id}-b`, page.text)]))
  return index
}

test('lexical retrieval is accurate on a synthetic corpus (accents, plurals, stopwords)', () => {
  const index = build()
  const cases: [string, string][] = [
    ['O que decidimos sobre o cache?', 'p01'], ['passagens de trem', 'p02'], ['como fazer bolo de cenoura', 'p03'],
    ['quanto subiu o marketing', 'p04'], ['quais livros ler', 'p05'], ['dias de corrida', 'p06'],
    ['exportacao markdown', 'p07'], ['exame de sangue', 'p08'], ['orquídea', 'p09'], ['pneus', 'p10'],
    ['decisão de contratação', 'p11'], ['onde ficam as senhas', 'p12'],
  ]
  let top1 = 0
  for (const [query, expected] of cases) {
    const hits = index.search(query, { k: 3 })
    if (hits[0]?.chunk.pageId === expected) top1++
    assert.ok(hits.some(hit => hit.chunk.pageId === expected), `${query} → ${hits.map(h => h.chunk.pageId)}`)
  }
  assert.ok(top1 / cases.length >= 0.9, `precision@1 ${top1}/${cases.length}`)
  assert.deepEqual(index.search('xyzzy quux', { k: 3 }), [])
  assert.deepEqual(index.search('o que é de', { k: 3 }), [], 'only stopwords → nothing')
  assert.deepEqual(terms('O que decidimos sobre as Decisões?'), ['decidimos', 'decisoes'])
})

test('hybrid: local embeddings find paraphrases that words miss; RRF keeps lexical hits; accept() filters scope', () => {
  const index = build()
  // "Embeddings" sintéticos: sinônimos caem na mesma dimensão.
  const groups = [['automovel', 'carro', 'motor', 'pneus', 'oleo'], ['viagem', 'hotel', 'passagens', 'trem', 'ferias'], ['comida', 'bolo', 'receita', 'cenoura', 'sobremesa'], ['dinheiro', 'orcamento', 'gastos', 'marketing']]
  const embed = (text: string) => groups.map(group => terms(text).filter(word => group.some(g => word.startsWith(g.slice(0, 5)))).length)
  for (const pageId of index.pageIds()) for (const chunk of index.chunksOf(pageId)) index.setVector(chunk.id, embed(`${index.titleOf(pageId)} ${chunk.text}`).map(v => v + 0.001))
  assert.equal(index.search('automóvel sobremesa', { k: 3 }).length, 0, 'no lexical match')
  const semantic = index.search('automóvel', { k: 3, queryVector: embed('automóvel').map(v => v + 0.001) })
  assert.equal(semantic[0]?.chunk.pageId, 'p10')
  const mixed = index.search('férias no hotel', { k: 3, queryVector: embed('férias no hotel') })
  assert.equal(mixed[0]?.chunk.pageId, 'p02'); assert.ok(mixed[0].lexical > 0 && mixed[0].semantic > 0)
  const scoped = index.search('férias no hotel', { k: 3, queryVector: embed('férias no hotel'), accept: id => id !== 'p02' })
  assert.equal(scoped.some(hit => hit.chunk.pageId === 'p02'), false)
})

test('incremental updates replace a page, keep document frequencies consistent and reuse unchanged vectors', () => {
  const index = build()
  const before = index.search('SQLite', { k: 3 })
  assert.equal(before[0].chunk.pageId, 'p01')
  index.setVector(index.chunksOf('p02')[0].id, [1, 0, 0])
  index.setPage('p01', 'Reunião de arquitetura', '2', chunkBlocks('p01', [para('x', 'Trocamos para IndexedDB no cache.')]))
  assert.equal(index.search('SQLite', { k: 3 }).length, 0)
  assert.equal(index.search('IndexedDB', { k: 3 })[0].chunk.pageId, 'p01')
  // Mesmo texto → mesmo hash → o vetor é preservado ao reindexar a página.
  index.setPage('p02', 'Viagem a Lisboa', '2', chunkBlocks('p02', [para('p02-b', corpus.p02.text)]))
  assert.ok(index.chunksOf('p02')[0].vec, 'vector reused')
  index.removePage('p03')
  assert.equal(index.search('cenoura', { k: 3 }).length, 0)
  assert.equal(index.pageCount, 11)
  // Reconstruir do zero dá o mesmo resultado que o incremental.
  const fresh = new ChunkIndex()
  for (const id of index.pageIds()) fresh.setPage(id, index.titleOf(id), '2', index.chunksOf(id).map(({ vec: _vec, ...chunk }) => chunk))
  for (const query of ['IndexedDB cache', 'pneus', 'decisões']) assert.deepEqual(fresh.search(query).map(h => h.chunk.id), index.search(query).map(h => h.chunk.id), query)
})

test('persistence round-trips vectors and drops pages that became protected or trashed', () => {
  const index = build()
  index.setVector(index.chunksOf('p05')[0].id, [0.6, 0.8])
  const data = JSON.parse(JSON.stringify(serializeIndex(index, 'nomic-embed-text')))
  const restored = new ChunkIndex()
  const count = restoreIndex(restored, data, id => id === 'p12' || id === 'p11' ? null : corpus[id].title, 'nomic-embed-text')
  assert.equal(count, 10)
  assert.equal(restored.search('senhas keychain').some(h => h.chunk.pageId === 'p12'), false)
  const vec = restored.chunksOf('p05')[0].vec!
  assert.ok(Math.abs(vec[0] - 0.6) < 1e-6 && Math.abs(vec[1] - 0.8) < 1e-6)
  const otherModel = new ChunkIndex()
  restoreIndex(otherModel, data, id => corpus[id].title, 'mxbai-embed-large')
  assert.equal(otherModel.embeddedCount(), 0, 'vectors from another embedding model are discarded')
  assert.equal(restoreIndex(new ChunkIndex(), { version: 9 }, () => 'x', ''), 0)
})

test('citations: only numbers that exist become links', () => {
  const { parts, cited } = parseCitations('Usamos SQLite [1] e JSON [2][7]; ver também [1, 3].', 2)
  assert.deepEqual(cited, [1, 2])
  assert.deepEqual(parts.filter(p => p.cite).map(p => p.cite), [1, 2, 1])
  assert.equal(parts.map(p => p.text ?? '').join(''), 'Usamos SQLite  e JSON ; ver também .')
})

test('A3b: embedder injetável estilo Apple (anisotrópico) com centralização é >= léxico puro no corpus sintético', () => {
  // Mock determinístico: todo vetor carrega um grande componente comum (como os da Apple, cosseno alto entre quaisquer textos)
  // mais componentes de tópico. Sem centralizar, o limiar de similaridade não separaria nada.
  const topics: Record<string, string[]> = {
    tec: ['sqlite', 'cache', 'json', 'documentos', 'banco', 'arquitetura', 'decidimos', 'dados'],
    viagem: ['lisboa', 'hotel', 'alfama', 'trem', 'sintra', 'passagens', 'viagem', 'ferias', 'portugal'],
    comida: ['bolo', 'cenoura', 'ovos', 'acucar', 'farinha', 'receita', 'sobremesa', 'doce'],
    dinheiro: ['orcamento', 'gastos', 'marketing', 'contratacoes', 'dinheiro', 'custos'],
    saude: ['dermatologista', 'exames', 'sangue', 'consulta', 'medico', 'saude', 'jejum'],
    esporte: ['corrida', 'musculacao', 'treino', 'exercicio', 'fisico', 'km'],
    carro: ['oleo', 'motor', 'pneus', 'carro', 'automovel', 'veiculo'],
  }
  const names = Object.keys(topics)
  const embed = (text: string) => {
    const words = new Set(terms(text))
    return [10, ...names.map(name => topics[name].filter(word => words.has(word) || [...words].some(w => w.length > 4 && word.startsWith(w.slice(0, 5)))).length)]
  }
  const lexicalOnly = build(), hybrid = build()
  for (const pageId of hybrid.pageIds()) for (const chunk of hybrid.chunksOf(pageId)) hybrid.setVector(chunk.id, embed(`${hybrid.titleOf(pageId)} ${chunk.text}`))
  const cases: [string, string][] = [
    ['O que decidimos sobre o cache?', 'p01'], ['passagens de trem', 'p02'], ['como fazer bolo de cenoura', 'p03'], ['quanto subiu o marketing', 'p04'],
    ['exame de sangue', 'p08'], ['pneus', 'p10'], ['onde ficam as senhas', 'p12'],
    // paráfrases sem nenhuma palavra em comum (o léxico não acha):
    ['automóvel', 'p10'], ['sobremesa doce', 'p03'], ['férias em Portugal', 'p02'], ['dinheiro e custos', 'p04'], ['médico', 'p08'], ['exercício físico', 'p06'],
  ]
  const score = (index: ChunkIndex, options: object) => cases.filter(([query, expected]) => index.search(query, { k: 3, ...options }).some(hit => hit.chunk.pageId === expected)).length
  const lexical = score(lexicalOnly, {})
  const withVectors = cases.filter(([query, expected]) => hybrid.search(query, { k: 3, center: true, semanticFloor: 0.12, queryVector: embed(query) }).some(hit => hit.chunk.pageId === expected)).length
  assert.ok(withVectors >= lexical, `híbrido ${withVectors} >= léxico ${lexical}`)
  assert.ok(withVectors > lexical, 'as paráfrases passam a ser achadas')
  assert.ok(withVectors >= cases.length - 2, `híbrido ${withVectors}/${cases.length}`)
  // A similaridade centralizada confere com o cálculo direto (subtrair a média e tirar o cosseno).
  const all = hybrid.pageIds().flatMap(id => hybrid.chunksOf(id)).filter(c => c.vec)
  const mean = all[0].vec!.map((_, j) => all.reduce((sum, c) => sum + c.vec![j], 0) / all.length)
  const unit = (v: ArrayLike<number>) => { const n = Math.hypot(...Array.from(v)) || 1; return Array.from(v, x => x / n) }
  const qv = unit(embed('pneus')), target = all.find(c => c.pageId === 'p10')!
  const direct = unit(unit(qv).map((x, j) => x - mean[j])).reduce((sum, x, j) => sum + x * unit(Array.from(target.vec!).map((y, k) => y - mean[k]))[j], 0)
  const reported = hybrid.search('pneus', { k: 3, center: true, semanticFloor: -1, queryVector: embed('pneus') }).find(h => h.chunk.id === target.id)!.semantic
  assert.ok(Math.abs(direct - reported) < 1e-4, `centrado ${reported} vs direto ${direct}`)
  // Vetor nulo (texto ilegível para o embedder) é ignorado, não vira vizinho de tudo.
  hybrid.setVector('p01#0', [0, 0, 0, 0, 0, 0, 0, 0])
  assert.equal(hybrid.chunksOf('p01')[0].vec, undefined)
})
