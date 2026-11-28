const PRODUCT = globalThis.WorkspaceProduct

;(function () {
  'use strict'
  const $ = id => document.getElementById(id)
  const pt = (navigator.language || '').toLowerCase().startsWith('pt')
  const t = (portuguese, english) => pt ? portuguese : english
  const api = window.WorkspaceClipper
  let config
  let tab
  let submitting = false
  let saved = false

  document.title = PRODUCT.name + ' Web Clipper'
  document.documentElement.lang = pt ? 'pt-BR' : 'en'
  $('title').textContent = document.title
  $('open-options').textContent = t('Opções', 'Options')
  $('setup-title').textContent = t('Conecte a extensão', 'Connect the extension')
  $('setup-info').textContent = t(
    `Use o endereço local e o código de pareamento gerados no ${PRODUCT.name}.`,
    `Use the local address and pairing code from ${PRODUCT.name}.`,
  )
  $('pair').textContent = t('Configurar conexão', 'Set up connection')
  $('capture-label').textContent = t('O que salvar', 'What to save')
  $('l-page').textContent = t('Página', 'Page')
  $('page-info').textContent = t('Texto principal e link de origem.', 'Main content and source link.')
  $('l-selection').textContent = t('Só o trecho selecionado', 'Selected text only')
  $('sel-info').textContent = t('Selecione o texto na aba antes de salvar.', 'Select the text in the tab before saving.')
  $('content-label').textContent = t('Opções de conteúdo', 'Content options')
  $('l-markdown').textContent = t('Preservar a formatação da página', 'Keep page formatting')
  $('l-image').textContent = t('Incluir link da imagem de destaque', 'Include featured image link')
  $('l-resource').textContent = t('Salvar como Recurso', 'Save as Resource')
  $('send').textContent = t(`Salvar no ${PRODUCT.name}`, `Save to ${PRODUCT.name}`)
  $('open-clip').textContent = t(`Abrir no ${PRODUCT.name}`, `Open in ${PRODUCT.name}`)

  function status(message, kind = '') {
    const element = $('status')
    element.textContent = message
    element.className = kind ? `notice ${kind}` : ''
    element.hidden = !message
  }

  function explain(error) {
    if (error.code === 'OFFLINE') return t(`Abra o ${PRODUCT.name} com a API local ativada e tente novamente.`, `Open ${PRODUCT.name} with its local API enabled and try again.`)
    if (error.status === 401 || error.code === 'SCOPE_REQUIRED') return t('Refaça o pareamento nas opções da extensão.', 'Pair again in the extension options.')
    if (error.status === 429) return t('Muitos recortes seguidos. Tente de novo em instantes.', 'Too many clips in a row. Try again shortly.')
    if (error.status === 413) return t('A página é grande. Tente salvar só um trecho.', 'The page is large. Try saving a selection.')
    if (error.code === 'CLIP_RESOURCE_UNAVAILABLE') return t('Confira se há um único tipo Recurso disponível no app.', 'Check that one Resource type is available in the app.')
    if (error.code === 'CLIP_RESOURCE_URL_UNAVAILABLE') return t('Confira o campo URL do tipo Recurso no app.', 'Check the URL field on the Resource type in the app.')
    if (error.status === 423) return t(`Desbloqueie “Recortes da web” no ${PRODUCT.name} e tente novamente.`, `Unlock “Web clips” in ${PRODUCT.name} and try again.`)
    return error.message
  }

  async function extract(options) {
    const target = { tabId: tab.id }
    try {
      await chrome.scripting.executeScript({ target, files: ['extract.js'] })
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target,
        func: opts => window.__workspaceExtract(opts),
        args: [options],
      })
      if (result) return result
    } catch {
      // Chrome can restrict access to a tab even if its URL uses HTTPS.
    }
    throw new Error(t('O Chrome não permitiu ler esta página.', 'Chrome did not allow access to this page.'))
  }

  function selectionOnly() {
    return $('form').elements.mode.value === 'selection'
  }

  function togglePageOptions() {
    $('markdown').disabled = selectionOnly()
  }

  async function initialize() {
    config = await api.load()
    if (!config.token || !config.base) {
      $('setup').hidden = false
      return
    }

    $('open-options').hidden = false
    ;[tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) {
      status(t('Abra uma página da web para salvar um recorte.', 'Open a web page to save a clip.'), 'error')
      return
    }

    $('page').textContent = tab.title || t('Página sem título', 'Untitled page')
    $('site').textContent = new URL(tab.url).hostname
    $('form').hidden = false
  }

  function openOptions() {
    chrome.runtime.openOptionsPage()
  }

  $('pair').addEventListener('click', openOptions)
  $('open-options').addEventListener('click', openOptions)
  $('capture-options').addEventListener('change', togglePageOptions)
  $('form').addEventListener('submit', async event => {
    event.preventDefault()
    if (submitting || saved) return

    submitting = true
    $('send').disabled = true
    status(t('Salvando…', 'Saving…'))
    try {
      const onlySelection = selectionOnly()
      const options = { markdown: !onlySelection && $('markdown').checked, selectionOnly: onlySelection }
      const resource = $('resource').checked
      if (resource && (await api.whoami(config)).supportsResourcePreset !== true) {
        throw new Error(t('Atualize o app para salvar este recorte como Recurso.', 'Update the app to save this clip as Resource.'))
      }
      const clip = await extract(options)
      if (onlySelection && !clip.selection) throw new Error(t('Selecione um trecho na aba antes de salvar.', 'Select some text in the tab before saving.'))
      if (!$('image').checked) clip.image = ''
      if (resource) clip.preset = 'resource'
      const result = await api.send(config, clip)
      if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(result.pageId || '') || !result.folder) {
        throw new Error(t(`Não consegui confirmar o recorte. Confira no ${PRODUCT.name}.`, `I could not confirm this clip. Check in ${PRODUCT.name}.`))
      }

      if (resource && result.preset !== 'resource') {
        throw new Error(t('O app não confirmou a classificação. Confira o recorte antes de tentar novamente.', 'The app did not confirm the classification. Check the clip before trying again.'))
      }

      saved = true
      $('form').hidden = true
      status(t(`Salvo em “${result.folder}”: ${result.title}`, `Saved in “${result.folder}”: ${result.title}`), 'success')
      $('open-clip').href = `workspace://page/${result.pageId}`
      $('open-clip').hidden = false
      $('open-clip').focus()
    } catch (error) {
      status(explain(error), 'error')
      $('send').disabled = false
    } finally {
      submitting = false
    }
  })

  initialize().catch(error => {
    $('open-options').hidden = false
    status(explain(error), 'error')
  })
})()
