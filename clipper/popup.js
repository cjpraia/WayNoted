const PRODUCT = globalThis.WorkspaceProduct
// Popup: extrai a página da aba ativa (activeTab) e envia para o aplicativo em 127.0.0.1. Nada vai a outro host.
;(function () {
  'use strict'
  var $ = function (id) { return document.getElementById(id) }
  var pt = (navigator.language || '').toLowerCase().indexOf('pt') === 0
  var T = function (a, b) { return pt ? a : b }
  var config = null, tab = null

  $('title').textContent = T(`Recortar para o ${PRODUCT.name}`, `Clip to ${PRODUCT.name}`)
  $('l-page').textContent = T('Página (texto limpo)', 'Page (clean text)')
  $('l-selection').textContent = T('Só a seleção', 'Selection only')
  $('l-markdown').textContent = T('Preservar formatação (Markdown)', 'Keep formatting (Markdown)')
  $('l-image').textContent = T('Incluir link da imagem destaque', 'Include featured image link')
  $('send').textContent = T('Enviar', 'Send')
  $('open-options').textContent = T('Abrir opções', 'Open options')
  document.querySelector('#setup p').textContent = T(`Pareie a extensão com o ${PRODUCT.name} antes do primeiro uso.`, `Pair the extension with ${PRODUCT.name} before first use.`)
  document.title = PRODUCT.name + ' Web Clipper'
  document.documentElement.lang = pt ? 'pt-BR' : 'en'

  function status(text, bad) { var el = $('status'); el.textContent = text || ''; el.className = bad ? 'error' : '' }
  function explain(error) {
    if (error.code === 'OFFLINE') return T(`Não consegui falar com o ${PRODUCT.name}. Abra o app e ative a API local.`, `Could not reach ${PRODUCT.name}. Open the app and turn on the local API.`)
    if (error.status === 401) return T('O pareamento não vale mais. Pareie de novo nas opções.', 'The pairing is no longer valid. Pair again in the options.')
    if (error.status === 429) return T('Muitos recortes seguidos. Tente de novo em instantes.', 'Too many clips in a row. Try again shortly.')
    if (error.status === 413) return T('A página é grande demais para um recorte.', 'The page is too large for a clip.')
    if (error.status === 423) return T(`A tabela “Recortes da web” está bloqueada no ${PRODUCT.name}.`, `The “Web clips” table is locked in ${PRODUCT.name}.`)
    return error.message
  }

  function run(options) {
    return chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['extract.js'] })
      .then(function () { return chrome.scripting.executeScript({ target: { tabId: tab.id }, func: function (opts) { return window.__workspaceExtract(opts) }, args: [options] }) })
      .then(function (results) { return results && results[0] && results[0].result })
  }

  chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
    tab = tabs[0]
    $('page').textContent = tab && tab.title ? tab.title : ''
    return window.WorkspaceClipper.load()
  }).then(function (stored) {
    config = stored
    if (!config.token || !config.base) { $('setup').hidden = false; return }
    $('form').hidden = false
    if (!tab || !/^https?:/i.test(tab.url || '')) { $('send').disabled = true; status(T('Esta página não pode ser recortada.', 'This page cannot be clipped.'), true); return }
    run({ markdown: false }).then(function (probe) { if (probe && probe.selection) $('sel-info').textContent = '(' + probe.selection.length + ')' }).catch(function () {})
  })

  $('open-options').addEventListener('click', function () { chrome.runtime.openOptionsPage() })
  $('form').addEventListener('submit', function (event) {
    event.preventDefault()
    $('send').disabled = true; status(T('Enviando…', 'Sending…'))
    var selectionOnly = document.querySelector('input[name=mode]:checked').value === 'selection'
    run({ markdown: $('markdown').checked, selectionOnly: selectionOnly }).then(function (clip) {
      if (!clip) throw new Error(T('Não consegui ler a página.', 'Could not read the page.'))
      if (selectionOnly && !clip.selection) throw new Error(T('Nada selecionado.', 'Nothing is selected.'))
      if (!$('image').checked) clip.image = ''
      return window.WorkspaceClipper.send(config, clip)
    }).then(function (result) {
      status(T('Salvo em “', 'Saved in “') + result.folder + T('”: ', '”: ') + result.title)
      setTimeout(function () { window.close() }, 1400)
    }).catch(function (error) { status(explain(error), true); $('send').disabled = false })
  })
})()
