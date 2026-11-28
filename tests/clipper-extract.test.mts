// B1 — extensão do clipper: extração "modo leitor" (extract.js) e cliente da API (api.js), avaliados em jsdom/vm.
// Regra deste arquivo: nunca passar nós do DOM para assert; só strings, números e booleanos.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'

const source = (name: string) => readFileSync(new URL(`../clipper/${name}`, import.meta.url), 'utf8')
function extract(html: string, url: string, options: Record<string, unknown> = {}, selectText = '') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' })
  const win = dom.window as unknown as { eval(code: string): unknown; getSelection: () => { toString(): string }; __workspaceExtract: (o: unknown) => Record<string, string> }
  win.eval(source('extract.js'))
  if (selectText) win.getSelection = () => ({ toString: () => selectText })
  const result = win.__workspaceExtract(options)
  dom.window.close()
  return result
}

const ARTICLE = `<!doctype html><html><head><title>Fallback title</title>
<meta property="og:title" content="Como cozinhar arroz"><meta property="og:site_name" content="Blog do Arroz">
<meta property="og:image" content="/img/capa.jpg"></head><body>
<nav class="navbar"><a href="/">Home</a><a href="/a">Sobre</a></nav>
<div class="cookie-banner">Aceitar cookies</div>
<article><h1>Como cozinhar arroz</h1>
<p>Primeiro, <strong>lave</strong> o arroz com <em>calma</em> e leia o <a href="/guia?utm_source=x">guia</a> completo antes de começar a receita de hoje.</p>
<script>alert(1)</script><style>p{}</style>
<h2>Ingredientes</h2><ul><li>1 xícara de arroz</li><li>2 xícaras de água<ul><li>filtrada</li></ul></li></ul>
<blockquote>Dica da vovó sobre o fogo baixo e a tampa fechada durante todo o cozimento.</blockquote>
<pre><code class="language-js">const a = 1</code></pre>
<p style="display:none">texto escondido</p>
<table><tr><th>Item</th><th>Qtd</th></tr><tr><td>Arroz</td><td>1</td></tr></table>
<img src="/img/passo1.png" alt="Passo 1">
</article><footer>Copyright</footer><aside class="sidebar related">Veja também outras coisas</aside></body></html>`

test('extração: título/og, site, imagem absoluta, URL sem rastreadores e conteúdo limpo em Markdown', () => {
  const r = extract(ARTICLE, 'https://www.blog.example/receitas/arroz?utm_source=newsletter&id=7#comentarios', { markdown: true })
  assert.equal(r.title, 'Como cozinhar arroz'); assert.equal(r.site, 'Blog do Arroz')
  assert.equal(r.image, 'https://www.blog.example/img/capa.jpg')
  assert.equal(r.url, 'https://www.blog.example/receitas/arroz?id=7', 'sem utm_* nem hash')
  const md = r.markdown
  assert.match(md, /^# Como cozinhar arroz/m)
  assert.ok(md.includes('**lave**') && md.includes('*calma*'))
  assert.ok(md.includes('[guia](https://www.blog.example/guia?utm_source=x)'), 'links absolutos')
  assert.match(md, /^## Ingredientes$/m)
  assert.match(md, /^- 1 xícara de arroz$/m); assert.match(md, /^  - filtrada$/m)
  assert.match(md, /^> Dica da vovó/m)
  assert.match(md, /```js\nconst a = 1\n```/)
  assert.match(md, /\| Item \| Qtd \|\n\|---\|---\|\n\| Arroz \| 1 \|/)
  assert.ok(md.includes('![Passo 1](https://www.blog.example/img/passo1.png)'))
  for (const unwanted of ['alert(1)', 'Aceitar cookies', 'Home', 'Copyright', 'texto escondido', 'Veja também', 'p{}']) assert.ok(!md.includes(unwanted) && !r.text.includes(unwanted), unwanted)
  assert.ok(!r.text.includes('**') && !r.text.includes('](') && r.text.includes('Primeiro, lave o arroz'), 'texto simples sem marcação')
})

test('sem Markdown por padrão; seleção do usuário; modo "só a seleção" zera o corpo', () => {
  const plain = extract(ARTICLE, 'https://blog.example/a', {}, 'trecho escolhido')
  assert.equal('markdown' in plain, false); assert.equal(plain.selection, 'trecho escolhido'); assert.ok(plain.text.length > 100)
  const only = extract(ARTICLE, 'https://blog.example/a', { markdown: true, selectionOnly: true }, 'trecho escolhido')
  assert.equal(only.text, ''); assert.equal('markdown' in only, false); assert.equal(only.selection, 'trecho escolhido')
})

test('sem <article>: escolhe o bloco de maior densidade de texto e ignora menus e rodapés', () => {
  const html = `<html><head><title>Página sem semântica</title></head><body>
  <div id="menu"><a href="/1">Um</a> <a href="/2">Dois</a> <a href="/3">Três</a></div>
  <div class="conteudo"><p>${'Parágrafo longo de conteúdo real. '.repeat(6)}</p><p>${'Outro parágrafo substancial do texto principal. '.repeat(5)}</p></div>
  <div class="footer-links"><a href="/x">Termos</a> <a href="/y">Privacidade</a></div></body></html>`
  const r = extract(html, 'https://x.example/')
  assert.equal(r.title, 'Página sem semântica'); assert.equal(r.site, 'x.example'); assert.equal(r.image, '')
  assert.ok(r.text.includes('Parágrafo longo') && r.text.includes('Outro parágrafo'))
  assert.ok(!r.text.includes('Termos') && !r.text.includes('Três'))
})

test('segurança da extração: links javascript:/data: não viram links; limites de tamanho; caracteres de controle removidos', () => {
  const huge = 'palavra '.repeat(80_000)
  const html = `<html><body><article><p>Veja <a href="javascript:alert(1)">aqui</a> e <a href="data:text/html,x">ali</a>\u0007 e <a href="https://ok.example/">ok</a>.</p><p>${huge}</p></article></body></html>`
  const r = extract(html, 'https://x.example/', { markdown: true })
  assert.ok(!r.markdown.includes('javascript:') && !r.markdown.includes('data:text'))
  assert.ok(r.markdown.includes('[ok](https://ok.example/)'))
  assert.ok(!r.text.includes('\u0007'))
  assert.ok(r.text.length <= 250_000 && r.markdown.length <= 450_000)
})

test('api.js: só aceita http://127.0.0.1:porta; token fora do repositório; fetch sem credenciais', async () => {
  const calls: { url: string; init: Record<string, unknown> }[] = []
  const store: Record<string, unknown> = {}
  const sandbox: Record<string, unknown> = {
    chrome: { storage: { local: { get: (keys: string[], cb: (v: unknown) => void) => cb(Object.fromEntries(keys.map(key => [key, store[key]]))), set: (o: Record<string, unknown>, cb: () => void) => { Object.assign(store, o); cb() }, remove: (keys: string[], cb: () => void) => { keys.forEach(key => { delete store[key] }); cb() } } } },
    fetch: async (url: string, init: Record<string, unknown>) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ token: 'npc_x', folder: 'Recortes da web' }) } },
    AbortController, setTimeout, clearTimeout, URL, Promise, JSON, String, Number, console,
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(source('api.js'), sandbox)
  const api = sandbox.WorkspaceClipper as { normalizeBase(v: string): string | null; pair(b: string, c: string): Promise<{ token: string }>; send(c: { base: string; token: string }, clip: object): Promise<unknown>; save(c: object): Promise<void>; load(): Promise<Record<string, string>> }
  assert.equal(api.normalizeBase('127.0.0.1:5123'), 'http://127.0.0.1:5123')
  assert.equal(api.normalizeBase(' http://127.0.0.1:5123/ '), 'http://127.0.0.1:5123')
  for (const bad of ['', 'localhost:5123', 'http://evil.example:5123', 'https://127.0.0.1:5123', 'http://127.0.0.1', 'http://127.0.0.1:99999', 'http://u:p@127.0.0.1:5123', 'http://127.0.0.1:5123/x', 'http://127.0.0.1:5123/?a=1', 'http://127.0.0.2:5123', 'http://[::1]:5123']) assert.equal(api.normalizeBase(bad), null, bad)
  await api.pair('http://127.0.0.1:5123', ' ABCD-EFGH ')
  await api.send({ base: 'http://127.0.0.1:5123', token: 'npc_x' }, { title: 't' })
  assert.deepEqual(calls.map(c => c.url), ['http://127.0.0.1:5123/v1/clip/pair', 'http://127.0.0.1:5123/v1/clip'])
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, undefined, 'pareamento sem token')
  assert.equal((calls[1].init.headers as Record<string, string>).Authorization, 'Bearer npc_x')
  assert.ok(calls.every(c => c.init.credentials === 'omit' && c.init.redirect === 'error'))
  await assert.rejects(api.send({ base: 'http://example.test:5123', token: 'npc_x' }, { title: 't' }), { code: 'OFFLINE' })
  assert.equal(calls.length, 2, 'stored configuration cannot send the token outside localhost')
  await api.save({ base: 'b', token: 't' }); assert.equal((await api.load()).token, 't')
})

test('manifesto: MV3, permissões mínimas, só 127.0.0.1, sem content scripts nem origens amplas', () => {
  const manifest = JSON.parse(source('manifest.json'))
  assert.equal(manifest.manifest_version, 3)
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'scripting', 'storage'])
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*'])
  for (const [size, icon] of Object.entries(manifest.icons)) {
    const png = readFileSync(new URL(`../clipper/${icon}`, import.meta.url))
    assert.equal(png.toString('ascii', 12, 16), 'IHDR')
    assert.equal(png.readUInt32BE(16), Number(size))
    assert.equal(png.readUInt32BE(20), Number(size))
  }
  assert.equal(manifest.content_scripts, undefined); assert.equal(manifest.background, undefined)
  assert.ok(!JSON.stringify(manifest).includes('<all_urls>'))
  for (const file of ['popup.html', 'options.html']) assert.ok(!/<script(?![^>]*\bsrc=)/i.test(source(file)), `${file}: sem script inline`)
  for (const file of ['popup.js', 'options.js', 'api.js']) assert.ok(!/https?:\/\/(?!127\.0\.0\.1)[a-z]/i.test(source(file).replace(/\/\/.*$/gm, '').replace(/chrome-extension:\/\//g, '')), `${file}: nenhum outro host`)
})

test('popup saves the selection once and links to the note acknowledged by WayNoted', async () => {
  const dom = new JSDOM(source('popup.html'), { runScripts: 'outside-only' })
  const win = dom.window
  const id = 'f3f403a8-2d66-4316-99c8-3cda1990ebff'
  const payload = { title: 'Article title', selection: 'Excerpt', image: 'https://example.test/image.png' }
  const sends: object[] = []
  const extracted: object[] = []
  let acknowledge!: () => void
  const saved = new Promise(resolve => {
    acknowledge = () => resolve({ pageId: id, title: payload.title, folder: 'Web clips' })
  })
  Object.assign(win, {
    WorkspaceProduct: { name: 'WayNoted' },
    WorkspaceClipper: {
      load: async () => ({ base: 'http://127.0.0.1:5123', token: 'npc_test' }),
      send: async (_config: object, clip: object) => { sends.push(clip); return saved },
    },
    chrome: {
      tabs: { query: async () => [{ id: 7, title: payload.title, url: 'https://example.test/article' }] },
      scripting: { executeScript: async (script: { args?: object[] }) => {
        if (!script.args) return []
        extracted.push(...script.args)
        return [{ result: { ...payload } }]
      } },
    },
  })
  function element<T extends HTMLElement>(selector: string) { return win.document.querySelector<T>(selector)! }
  const tick = () => new Promise(resolve => setImmediate(resolve))

  try {
    win.eval(source('popup.js'))
    await tick()
    assert.equal(element('#form').hidden, false)
    const selection = element<HTMLInputElement>('input[value="selection"]')
    selection.click()
    assert.equal(element<HTMLInputElement>('#markdown').disabled, true)
    element<HTMLInputElement>('#image').checked = false
    element<HTMLFormElement>('#form').requestSubmit()
    element<HTMLFormElement>('#form').requestSubmit()
    await tick()
    assert.deepEqual(extracted.map(value => JSON.stringify(value)), ['{"markdown":false,"selectionOnly":true}'])
    assert.deepEqual(sends, [{ ...payload, image: '' }])
    assert.equal(element('#open-clip').hidden, true, 'await real acknowledgement')
    acknowledge()
    await tick()
    assert.equal(element('#form').hidden, true)
    assert.equal(element('#open-clip').hidden, false)
    assert.equal(element<HTMLAnchorElement>('#open-clip').href, `workspace://page/${id}`)
    assert.equal(element('#status').textContent, 'Saved in “Web clips”: Article title')
  } finally {
    win.close()
  }
})

test('popup negocia suporte à classificação Recurso e só confirma resposta classificada', async () => {
  for (const [supported, acknowledged, expected] of [
    [false, false, /Update the app|Atualize o app/],
    [true, false, /did not confirm the classification|não confirmou a classificação/],
    [true, true, /Saved in|Salvo em/],
  ] as const) {
    const dom = new JSDOM(source('popup.html'), { runScripts: 'outside-only' })
    const win = dom.window
    const requests: string[] = []
    const sent: Record<string, unknown>[] = []
    const url = 'https://example.test/article'
    const title = 'Article title'
    const tick = () => new Promise(resolve => setImmediate(resolve))
    Object.assign(win, {
      WorkspaceProduct: { name: 'WayNoted' },
      WorkspaceClipper: {
        load: async () => ({ base: 'http://127.0.0.1:5123', token: 'npc_test' }),
        whoami: async () => { requests.push('whoami'); return { supportsResourcePreset: supported } },
        send: async (_config: object, clip: Record<string, unknown>) => {
          requests.push('send')
          sent.push(clip)
          return { pageId: 'f3f403a8-2d66-4316-99c8-3cda1990ebff', folder: 'Web clips', title, ...(acknowledged ? { preset: clip.preset } : {}) }
        },
      },
      chrome: {
        tabs: { query: async () => [{ id: 7, title, url }] },
        scripting: { executeScript: async (script: { args?: object[] }) => script.args ? [{ result: { title, url, text: 'Article content' } }] : [] },
      },
    })
    try {
      win.eval(source('popup.js'))
      await tick()
      const resource = win.document.querySelector<HTMLInputElement>('#resource')!
      assert.equal(resource.checked, false)
      resource.click()
      win.document.querySelector<HTMLFormElement>('#form')!.requestSubmit()
      await tick()
      assert.deepEqual(requests, supported ? ['whoami', 'send'] : ['whoami'])
      assert.equal(sent[0]?.preset, supported ? 'resource' : undefined)
      assert.match(win.document.querySelector('#status')!.textContent!, expected)
      assert.equal(win.document.querySelector<HTMLAnchorElement>('#open-clip')!.hidden, !acknowledged)
    } finally { win.close() }
  }
})
