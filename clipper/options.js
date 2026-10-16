const PRODUCT = globalThis.WorkspaceProduct
// Opções: endereço da API local (só 127.0.0.1) e pareamento por código curto exibido no aplicativo.
;(function () {
  'use strict'
  var $ = function (id) { return document.getElementById(id) }
  var api = window.WorkspaceClipper
  var pt = (navigator.language || '').toLowerCase().indexOf('pt') === 0
  var T = function (a, b) { return pt ? a : b }
  document.title = PRODUCT.name + ' Web Clipper'
  $('h').textContent = document.title
  document.documentElement.lang = pt ? 'pt-BR' : 'en'
  $('intro').textContent = T(`No ${PRODUCT.name}, abra Configurações → Dados → Agentes → Web clipper e gere um código. Digite o endereço da API e o código aqui. O token fica só neste navegador e a extensão só fala com 127.0.0.1.`, `In ${PRODUCT.name}, open Settings → Data → Agents → Web clipper and generate a code. Enter the API address and the code here. The token stays only in this browser and the extension only talks to 127.0.0.1.`)
  $('l-base').textContent = T('Endereço da API', 'API address')
  $('l-code').textContent = T('Código de pareamento', 'Pairing code')
  $('pair-btn').textContent = T('Parear', 'Pair')
  $('test').textContent = T('Testar conexão', 'Test connection')
  $('unpair').textContent = T('Desparear', 'Unpair')

  function msg(text, bad) { var el = $('msg'); el.textContent = text || ''; el.className = bad ? 'error' : '' }
  function render(config) {
    var paired = !!(config && config.token)
    $('state').textContent = paired ? T('Pareado com ', 'Paired with ') + config.base : T('Não pareado.', 'Not paired.')
    $('test').disabled = !paired; $('unpair').disabled = !paired
    if (config && config.base) $('base').value = config.base
  }
  api.load().then(render)

  $('pair').addEventListener('submit', function (event) {
    event.preventDefault()
    var base = api.normalizeBase($('base').value)
    if (!base) { msg(T(`Use o endereço mostrado no ${PRODUCT.name} (http://127.0.0.1:porta).`, `Use the address shown in ${PRODUCT.name} (http://127.0.0.1:port).`), true); return }
    msg(T('Pareando…', 'Pairing…'))
    api.pair(base, $('code').value).then(function (result) {
      var config = { base: base, token: result.token }
      return api.save(config).then(function () { $('code').value = ''; render(config); msg(T('Pronto. Já pode recortar páginas.', 'Done. You can clip pages now.')) })
    }).catch(function (error) {
      msg(error.code === 'OFFLINE' ? T(`Não consegui falar com o ${PRODUCT.name}. Ele está aberto e com a API local ligada?`, `Could not reach ${PRODUCT.name}. Is it open with the local API on?`) : error.status === 403 ? T(`Código incorreto ou expirado. Gere outro no ${PRODUCT.name}.`, `Wrong or expired code. Generate another in ${PRODUCT.name}.`) : error.message, true)
    })
  })
  $('test').addEventListener('click', function () {
    api.load().then(function (config) { return api.whoami(config) }).then(function (info) { msg(T('Conectado. Os recortes vão para “', 'Connected. Clips go to “') + info.folder + '”.') })
      .catch(function (error) { msg(error.status === 401 ? T('O pareamento não vale mais. Pareie de novo.', 'The pairing is no longer valid. Pair again.') : T(`Sem conexão com o ${PRODUCT.name}.`, `No connection to ${PRODUCT.name}.`), true) })
  })
  $('unpair').addEventListener('click', function () { api.clear().then(function () { render({}); msg(T(`Desconectado neste navegador. Para revogar também no app, use “Desconectar” nas configurações do ${PRODUCT.name}.`, `Disconnected in this browser. To revoke in the app too, use “Disconnect” in ${PRODUCT.name} settings.`)) }) })
})()
