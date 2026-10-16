const PRODUCT = require('../shared/product.json')
// F7: "Buscar atualizações" sem telemetria — validação do feed, semver, https obrigatório e nenhum identificador.
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { checkForUpdates, compareSemver, validateFeed, httpsUrl, FEED_LIMIT } = require('../electron/update-check.cjs')

const address = { address: '93.184.216.34', family: 4 }
const fakeDestination = async value => ({ url: new URL(value), address })

/** Requisição falsa: registra URL e cabeçalhos e responde conforme o roteiro. */
function network(routes) {
  const calls = []
  const requester = (url, options, onResponse) => {
    calls.push({ url: String(url), options })
    const request = new EventEmitter()
    request.destroy = () => {}
    request.end = () => {
      const route = routes[calls.length - 1] ?? routes[routes.length - 1]
      if (route.error) { setImmediate(() => request.emit('error', route.error)); return }
      const response = new EventEmitter()
      response.statusCode = route.status ?? 200
      response.headers = route.headers ?? {}
      response.resume = () => {}
      onResponse(response)
      setImmediate(() => { for (const chunk of route.chunks ?? [Buffer.from(route.body ?? '')]) response.emit('data', chunk); response.emit('end') })
    }
    return request
  }
  return { calls, options: { requester, destination: fakeDestination } }
}
const json = value => ({ body: JSON.stringify(value) })

test('semver: ordem numérica, pré-lançamento antes da final, entradas inválidas rejeitadas', () => {
  assert.equal(compareSemver('1.10.0', '1.9.9'), 1)
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0)
  assert.equal(compareSemver('v1.0.0-beta.2', '1.0.0'), -1)
  assert.equal(compareSemver('1.0.0-beta.10', '1.0.0-beta.2'), 1)
  assert.equal(compareSemver('1.0.0-alpha', '1.0.0-1'), 1)
  assert.throws(() => compareSemver('1.0', '1.0.0'))
})

test('nova versão disponível: devolve notas, aviso de download e envia só cabeçalhos genéricos', async () => {
  const net = network([json({ version: '1.2.0', notes: { 'pt-BR': 'Novidades', 'en-US': 'News' }, downloadUrl: 'https://example.com/baixar' })])
  const result = await checkForUpdates('https://example.com/feed.json', '1.0.0', net.options)
  assert.deepEqual({ ...result }, { status: 'available', current: '1.0.0', latest: '1.2.0', notes: { 'pt-BR': 'Novidades', 'en-US': 'News' }, hasDownload: true, downloadUrl: 'https://example.com/baixar' })
  assert.equal(net.calls.length, 1, 'uma única requisição')
  const { headers, method } = net.calls[0].options
  assert.equal(method, 'GET')
  assert.deepEqual(Object.keys(headers).sort(), ['Accept', 'Accept-Encoding', 'User-Agent'])
  assert.equal(headers['User-Agent'], `${PRODUCT.name}`, 'sem versão nem identificador')
  assert.ok(!('Cookie' in headers) && !('Authorization' in headers))
})

test('já na versão mais recente (igual ou maior)', async () => {
  for (const latest of ['1.0.0', '0.9.0']) {
    const result = await checkForUpdates('https://example.com/f.json', '1.0.0', network([json({ version: latest })]).options)
    assert.equal(result.status, 'current')
  }
})

test('https é obrigatório na URL do usuário, no redirecionamento e na página de download', async () => {
  for (const url of ['http://example.com/f.json', 'ftp://example.com/f', 'https://user:pw@example.com/f.json', 'https://localhost/f.json', '', 'não é url', 'https://exemplo/' + 'a'.repeat(3000)]) {
    const net = network([json({ version: '2.0.0' })])
    const result = await checkForUpdates(url, '1.0.0', net.options)
    assert.deepEqual([result.status, result.code], ['error', 'invalid-url'], url)
    assert.equal(net.calls.length, 0, 'nenhuma requisição para URL inválida')
  }
  const toHttp = network([{ status: 302, headers: { location: 'http://example.com/inseguro.json' } }])
  assert.equal((await checkForUpdates('https://example.com/f.json', '1.0.0', toHttp.options)).code, 'invalid-url')
  assert.equal(toHttp.calls.length, 1, 'redirecionamento para http não é seguido')
  const ok = network([{ status: 301, headers: { location: '/novo.json' } }, json({ version: '1.1.0' })])
  assert.equal((await checkForUpdates('https://example.com/f.json', '1.0.0', ok.options)).status, 'available')
  assert.equal(ok.calls[1].url, 'https://example.com/novo.json')
  assert.throws(() => validateFeed({ version: '2.0.0', downloadUrl: 'http://example.com/x' }), /invalid-feed/)
  assert.throws(() => validateFeed({ version: '2.0.0', downloadUrl: 'javascript:alert(1)' }), /invalid-feed/)
  assert.equal(httpsUrl('https://example.com/a', 'x').hostname, 'example.com')
})

test('redirecionamentos demais, HTTP != 200, JSON inválido, versão inválida, arquivo grande e timeout viram erro tratado', async () => {
  const loop = network([{ status: 302, headers: { location: 'https://example.com/a' } }])
  assert.equal((await checkForUpdates('https://example.com/a', '1.0.0', loop.options)).code, 'network')
  assert.equal((await checkForUpdates('https://example.com/f', '1.0.0', network([{ status: 404 }]).options)).code, 'http')
  assert.equal((await checkForUpdates('https://example.com/f', '1.0.0', network([{ body: '<html>' }]).options)).code, 'invalid-feed')
  assert.equal((await checkForUpdates('https://example.com/f', '1.0.0', network([json({ version: 'latest' })]).options)).code, 'invalid-feed')
  assert.equal((await checkForUpdates('https://example.com/f', '1.0.0', network([json([1, 2])]).options)).code, 'invalid-feed')
  const huge = network([{ chunks: [Buffer.alloc(FEED_LIMIT), Buffer.alloc(10)] }])
  assert.equal((await checkForUpdates('https://example.com/f', '1.0.0', huge.options)).code, 'too-large')
  const timeout = network([{ error: Object.assign(new Error('t'), { name: 'TimeoutError' }) }])
  assert.equal((await checkForUpdates('https://example.com/f', '1.0.0', timeout.options)).code, 'timeout')
  const down = network([{ error: new Error('ECONNREFUSED') }])
  assert.equal((await checkForUpdates('https://example.com/f', '1.0.0', down.options)).code, 'network')
})

test('endereço resolvido para rede privada é recusado (sem requisição)', async () => {
  const net = network([json({ version: '2.0.0' })])
  const result = await checkForUpdates('https://example.com/f', '1.0.0', { ...net.options, destination: async () => { throw new Error('privado') } })
  assert.equal(result.code, 'invalid-url')
  assert.equal(net.calls.length, 0)
})

test('feed saneia notas e ignora campos desconhecidos', () => {
  const feed = validateFeed({ version: 'v3.1.4', notes: 'a\u0000b\u0007c', url: 'https://example.com/d', extra: { x: 1 } })
  assert.deepEqual(feed, { version: '3.1.4', notes: { default: 'abc' }, downloadUrl: 'https://example.com/d' })
})
