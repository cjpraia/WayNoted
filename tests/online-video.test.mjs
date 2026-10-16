// Vídeos online incorporados: parser, lista fechada, iframe, CSP, política do processo principal,
// modos Sempre/Clicar/Nunca (jsdom), conversão sem duplicar e exportação/importação.
// Regra de memória: nunca passar nós do DOM a assert — só strings/números/booleans.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'
import { createLoader } from './fixtures/tsx-loader.mjs'
import {
  parseVideoUrl, parseStartTime, withStart, iframeAttributes, iframeHtml, EMBED_FRAME_HOSTS, effectiveEmbedMode,
  IFRAME_SANDBOX, IFRAME_ALLOW,
} from '../src/components/page/videoEmbed.ts'
import { pasteChoicesFor, pastedUrlIsVideo } from '../src/components/page/pasteUrl.ts'
import { blocksToMarkdown } from '../src/export/markdown.ts'
import { markdownToBlocks } from '../src/export/parseMarkdown.ts'
import { blocksToHtml } from '../src/export/html.ts'

const require = createRequire(import.meta.url)
const policy = require('../electron/local-policy.cjs')
const ID = 'jNQXAC9IVRw'

test('YouTube: todos os formatos, tempos e listas viram a URL nocookie oficial', () => {
  const cases = {
    [`https://www.youtube.com/watch?v=${ID}`]: `https://www.youtube-nocookie.com/embed/${ID}`,
    [`https://youtu.be/${ID}?t=1m5s`]: `https://www.youtube-nocookie.com/embed/${ID}?start=65`,
    [`https://m.youtube.com/watch?v=${ID}&t=90`]: `https://www.youtube-nocookie.com/embed/${ID}?start=90`,
    [`https://www.youtube.com/shorts/${ID}`]: `https://www.youtube-nocookie.com/embed/${ID}`,
    [`https://www.youtube.com/embed/${ID}?start=7`]: `https://www.youtube-nocookie.com/embed/${ID}?start=7`,
    [`https://www.youtube-nocookie.com/embed/${ID}`]: `https://www.youtube-nocookie.com/embed/${ID}`,
    [`https://www.youtube.com/live/${ID}`]: `https://www.youtube-nocookie.com/embed/${ID}`,
    [`https://www.youtube.com/watch?v=${ID}&list=PLabcdefghij`]: `https://www.youtube-nocookie.com/embed/${ID}?list=PLabcdefghij`,
    'https://www.youtube.com/playlist?list=PLabcdefghij': 'https://www.youtube-nocookie.com/embed/videoseries?list=PLabcdefghij',
  }
  for (const [input, embed] of Object.entries(cases)) assert.equal(parseVideoUrl(input)?.embedUrl, embed, input)
  assert.equal(parseStartTime('1h2m3s'), 3723)
  assert.equal(parseStartTime('abc'), 0)
  assert.equal(withStart(parseVideoUrl(`https://youtu.be/${ID}?t=65`), 0).embedUrl, `https://www.youtube-nocookie.com/embed/${ID}`)
})

test('Vimeo, Loom, Dailymotion e Spotify', () => {
  assert.equal(parseVideoUrl('https://vimeo.com/76979871')?.embedUrl, 'https://player.vimeo.com/video/76979871')
  assert.equal(parseVideoUrl('https://vimeo.com/76979871/abc123def4')?.embedUrl, 'https://player.vimeo.com/video/76979871?h=abc123def4')
  assert.equal(parseVideoUrl('https://player.vimeo.com/video/76979871?h=abc123def4')?.embedUrl, 'https://player.vimeo.com/video/76979871?h=abc123def4')
  assert.equal(parseVideoUrl('https://vimeo.com/channels/staffpicks/76979871')?.id, '76979871')
  assert.equal(parseVideoUrl('https://www.loom.com/share/0123456789abcdef0123456789abcdef')?.embedUrl, 'https://www.loom.com/embed/0123456789abcdef0123456789abcdef')
  assert.equal(parseVideoUrl('https://www.dailymotion.com/video/x7tgad0')?.embedUrl, 'https://www.dailymotion.com/embed/video/x7tgad0')
  const spotify = parseVideoUrl('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=x')
  assert.equal(spotify?.embedUrl, 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC')
  assert.equal(spotify?.height, 152)
})

test('hosts falsos, esquemas perigosos e IDs inválidos são recusados', () => {
  for (const bad of [
    `https://youtube.com.evil.com/watch?v=${ID}`, `https://evil.com/youtube.com/watch?v=${ID}`, `https://notyoutube.com/watch?v=${ID}`,
    `https://youtu.be.evil.test/${ID}`, `https://user:pw@www.youtube.com/watch?v=${ID}`, `https://www.youtube.com:8443/watch?v=${ID}`,
    `javascript:alert(1)`, `data:text/html,<script>1</script>`, `file:///etc/passwd`, `ftp://www.youtube.com/watch?v=${ID}`,
    'https://www.youtube.com/watch?v=curto', 'https://www.youtube.com/watch?v="><script>', 'https://vimeo.com/abc', 'https://vimeo.com.evil.com/76979871',
    'https://www.loom.com/share/zz', 'https://example.com/video.mp4', '', 'texto qualquer',
  ]) assert.ok(parseVideoUrl(bad) === null, bad)
})

test('lista fechada coincide com CSP, política do processo principal e atributos do iframe', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)[1]
  const frameSrc = /frame-src ([^;]+)/.exec(csp)[1].split(/\s+/).filter(v => v.startsWith('https://')).map(v => v.slice(8)).sort()
  assert.deepEqual(frameSrc, [...EMBED_FRAME_HOSTS].sort())
  assert.deepEqual([...policy.EMBED_HOSTS].sort(), [...EMBED_FRAME_HOSTS].sort())
  assert.ok(!/img-src[^;]*https:/.test(csp), 'sem imagens remotas')
  assert.ok(!/default-src[^;]*https:/.test(csp))
  const attrs = iframeAttributes(parseVideoUrl(`https://youtu.be/${ID}`), 'Título')
  assert.equal(attrs.sandbox, IFRAME_SANDBOX)
  assert.ok(!/top-navigation|forms|downloads|modals/.test(attrs.sandbox))
  assert.equal(attrs.allow, IFRAME_ALLOW)
  assert.equal(attrs.referrerPolicy, 'strict-origin-when-cross-origin')
  assert.equal(attrs.loading, 'lazy')
  assert.equal(attrs.title, 'Título')
  const markup = iframeHtml(parseVideoUrl('https://vimeo.com/76979871'), 'A "b"')
  assert.ok(markup.includes('sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"') && markup.includes('title="A &quot;b&quot;"'))
})

test('processo principal: iframe só para hosts da lista e fora do modo Nunca; Referer só no quadro do player', () => {
  const frame = url => ({ url, resourceType: 'subFrame', frame: { url: 'file:///app/dist/index.html' } })
  assert.equal(policy.canEmbedRequest(frame(`https://www.youtube-nocookie.com/embed/${ID}`), 'always'), true)
  assert.equal(policy.canEmbedRequest(frame(`https://www.youtube-nocookie.com/embed/${ID}`), 'never'), false)
  assert.equal(policy.canEmbedRequest(frame('https://evil.com/'), 'always'), false)
  assert.equal(policy.canEmbedRequest(frame('https://youtube-nocookie.com.evil.com/x'), 'always'), false)
  assert.equal(policy.canEmbedRequest({ url: `https://www.youtube-nocookie.com/embed/${ID}`, resourceType: 'image', frame: { url: 'file:///app/dist/index.html' } }, 'always'), false)
  assert.equal(policy.canEmbedRequest({ url: 'https://i.ytimg.com/vi/x.jpg', resourceType: 'image', frame: { url: `https://www.youtube-nocookie.com/embed/${ID}` } }, 'always'), true)
  assert.equal(policy.canEmbedRequest({ url: 'https://i.ytimg.com/vi/x.jpg', resourceType: 'image', frame: { url: `https://www.youtube-nocookie.com/embed/${ID}` } }, 'never'), false)
  assert.equal(policy.canEmbedRequest({ url: 'http://www.youtube-nocookie.com/embed/x', resourceType: 'subFrame' }, 'always'), false)
  assert.equal(policy.embedRefererFor({ url: `https://www.youtube-nocookie.com/embed/${ID}`, resourceType: 'subFrame', requestHeaders: {} }), policy.EMBED_REFERER)
  assert.equal(policy.embedRefererFor({ url: `https://www.youtube-nocookie.com/embed/${ID}`, resourceType: 'subFrame', requestHeaders: { Referer: 'http://localhost:5310/' } }), null)
  assert.equal(policy.embedRefererFor({ url: 'https://i.ytimg.com/a.jpg', resourceType: 'image', requestHeaders: {} }), null)
  // O renderer continua sem rede por padrão.
  assert.equal(policy.canRequest('https://www.youtube-nocookie.com/embed/x', { isDev: false, entryFile: '/app/dist/index.html', devURL: 'http://localhost:5310' }), false)
})

test('modos de incorporação e interruptor mestre', () => {
  assert.equal(effectiveEmbedMode({}), 'always')
  assert.equal(effectiveEmbedMode({ embedVideos: 'click' }), 'click')
  assert.equal(effectiveEmbedMode({ embedVideos: 'lixo' }), 'always')
  assert.equal(effectiveEmbedMode({ embedVideos: 'always', blockRemoteContent: true }), 'never')
})

test('menu de colar mostra só as opções pertinentes ao host', () => {
  assert.deepEqual(pasteChoicesFor(`https://www.youtube.com/watch?v=${ID}`), ['mention', 'video', 'bookmark', 'url'])
  assert.deepEqual(pasteChoicesFor('https://example.com/a'), ['mention', 'url', 'bookmark', 'embed'])
  assert.equal(pastedUrlIsVideo('https://youtube.com.evil.com/watch?v=' + ID), false)
  assert.ok(!pasteChoicesFor(`https://vimeo.com/76979871`).includes('embed'))
})

const block = (props, extra = {}) => ({ id: 'v1', type: 'onlineVideo', props: { url: `https://www.youtube.com/watch?v=${ID}`, title: '', caption: 'Minha legenda', width: 400, align: 'left', ...props }, children: [], ...extra })
const mdCtx = { href: v => v, media: v => v, json: v => v, pageLink: () => ({ label: '', destination: '' }), synced: () => undefined, keepIds: new Set() }

test('exportação Markdown/HTML: link + np:embed, iframe só com a opção; importação recria o bloco', () => {
  const md = blocksToMarkdown([block({})], mdCtx)
  assert.match(md, /<!-- np:embed \{/)
  assert.match(md, /\[▶ https:\/\/www\.youtube\.com\/watch\?v=jNQXAC9IVRw\]/)
  assert.ok(!/<iframe/i.test(md))
  const back = markdownToBlocks(md, { href: v => v, media: v => v, json: v => v, pageLink: () => null })
  const video = back.filter(b => b.type === 'onlineVideo')
  assert.equal(video.length, 1)
  assert.equal(back.length, 1, 'um link vira UM bloco')
  assert.equal(video[0].props.url, `https://www.youtube.com/watch?v=${ID}`)
  assert.equal(video[0].props.caption, 'Minha legenda')
  assert.equal(video[0].props.width, 400)
  assert.equal(video[0].props.align, 'left')
  const forged = '<!-- np:embed {"url":"https://evil.com/x"} -->\n[▶ x](https://evil.com/x)'
  assert.ok(!markdownToBlocks(forged, { href: v => v, media: v => v, json: v => v, pageLink: () => null }).some(b => b.type === 'onlineVideo'))
  const ctx = { href: v => v, media: v => v, pageLink: () => ({ label: '', destination: '' }), synced: () => undefined }
  const plain = blocksToHtml([block({})], ctx)
  assert.ok(!/<iframe/i.test(plain) && /np:embed/.test(plain) && /Minha legenda/.test(plain))
  const withPlayer = blocksToHtml([block({})], { ...ctx, includePlayers: true })
  assert.ok(/<iframe[^>]+youtube-nocookie\.com\/embed\/jNQXAC9IVRw/.test(withPlayer) && !/top-navigation/.test(withPlayer))
})

// ---- UI (jsdom) ----
const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { default: React, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const t = (pt, _en) => pt
const state = { settings: { locale: 'pt-BR' } }
const opened = []
const loader = createLoader({
  'src/store.ts': { api: { openExternalPage: async url => { opened.push(url) } }, useStore: () => state, getState: () => state, subscribe: () => () => {}, actions: {} },
  'src/i18n.ts': { useI18n: () => ({ locale: 'pt-BR', t }), t },
  'src/clipboard.ts': { copyText: async () => {} },
})
const { OnlineVideo } = await loader.load('src/components/page/OnlineVideoBlock.tsx')

async function render(settings, value = { url: `https://youtu.be/${ID}`, title: '', caption: '', width: 0, align: 'center' }, actionsOverride = {}) {
  state.settings = { locale: 'pt-BR', ...settings }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const calls = []
  const actions = { update: p => calls.push(['update', p]), toBookmark: () => calls.push(['bookmark']), toLink: () => calls.push(['link']), remove: () => calls.push(['remove']), ...actionsOverride }
  await act(async () => root.render(React.createElement(OnlineVideo, { value, editable: true, actions })))
  return { host, root, calls, iframe: () => host.querySelector('iframe') }
}

test('UI: modo Sempre mostra o iframe com atributos mínimos', async () => {
  const view = await render({})
  const frame = view.iframe()
  assert.ok(frame !== null)
  assert.equal(frame.getAttribute('src'), `https://www.youtube-nocookie.com/embed/${ID}`)
  assert.equal(frame.getAttribute('sandbox'), IFRAME_SANDBOX)
  assert.ok(!frame.getAttribute('sandbox').includes('top-navigation'))
  assert.equal(frame.getAttribute('referrerpolicy'), 'strict-origin-when-cross-origin')
  assert.equal(frame.getAttribute('loading'), 'lazy')
  assert.ok(frame.getAttribute('title').length > 0)
  await act(async () => view.root.unmount()); view.host.remove()
})

test('UI: Clicar para carregar não cria iframe até o clique; Nunca e bloqueio mestre nunca criam', async () => {
  const click = await render({ embedVideos: 'click' })
  assert.ok(click.iframe() === null, 'nada de rede antes do clique')
  const load = [...click.host.querySelectorAll('button')].find(b => /Carregar vídeo/.test(b.textContent))
  assert.ok(load !== undefined)
  await act(async () => { load.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.ok(click.iframe() !== null)
  await act(async () => click.root.unmount()); click.host.remove()
  for (const settings of [{ embedVideos: 'never' }, { embedVideos: 'always', blockRemoteContent: true }]) {
    const view = await render(settings)
    assert.ok(view.iframe() === null)
    assert.ok(/Abrir no navegador/.test(view.host.textContent))
    assert.equal(view.host.querySelectorAll('.pg-video-card').length, 1, 'um único cartão')
    assert.ok(!/Editar marcador/.test(view.host.textContent))
    await act(async () => view.root.unmount()); view.host.remove()
  }
})

test('UI: link inválido vira cartão e converter em marcador/link aciona uma única ação', async () => {
  const bad = await render({}, { url: `https://youtube.com.evil.com/watch?v=${ID}`, title: '', caption: '', width: 0, align: 'center' })
  assert.ok(bad.iframe() === null)
  await act(async () => bad.root.unmount()); bad.host.remove()
  const view = await render({})
  const convert = view.host.querySelector('button[aria-label="Converter em marcador"]')
  assert.ok(convert !== null)
  await act(async () => { convert.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.equal(view.calls.length, 1)
  assert.equal(view.calls[0][0], 'bookmark')
  await act(async () => view.root.unmount()); view.host.remove()
})
