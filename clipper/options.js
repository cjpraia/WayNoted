const PRODUCT = globalThis.WorkspaceProduct

;(function () {
  'use strict'
  const $ = id => document.getElementById(id)
  const api = window.WorkspaceClipper
  const pt = (navigator.language || '').toLowerCase().startsWith('pt')
  const t = (portuguese, english) => pt ? portuguese : english
  let busy = false

  document.title = PRODUCT.name + ' Web Clipper'
  document.documentElement.lang = pt ? 'pt-BR' : 'en'
  $('h').textContent = document.title
  $('connection-title').textContent = t(`Conexão com o ${PRODUCT.name}`, `Connection to ${PRODUCT.name}`)
  $('guide-open').textContent = t(
    `No ${PRODUCT.name}, abra Configurações → Dados → Agentes. Ative a API local para integrações.`,
    `In ${PRODUCT.name}, go to Settings → Data → Agents and turn on the local API for integrations.`,
  )
  $('guide-pair').textContent = t(
    'Na seção Web clipper, gere um código de pareamento e copie o endereço e o código para os campos abaixo.',
    'In the Web clipper section, generate a pairing code and copy the address and code into the fields below.',
  )
  $('l-base').textContent = t('Endereço local', 'Local address')
  $('l-code').textContent = t('Código de pareamento', 'Pairing code')
  $('code-hint').textContent = t('O código vale por cinco minutos e pode ser usado uma vez.', 'The code expires after five minutes and can be used once.')
  $('pair-btn').textContent = t('Conectar extensão', 'Connect extension')
  $('test').textContent = t('Testar conexão', 'Test connection')
  $('unpair').textContent = t('Desconectar neste Chrome', 'Disconnect in this browser')

  function msg(message, kind = '') {
    const element = $('msg')
    element.textContent = message
    element.className = kind ? `notice ${kind}` : ''
    element.hidden = !message
  }

  function render(config) {
    const paired = Boolean(config?.token && config?.base)
    $('state').textContent = paired ? t('Pareamento salvo.', 'Pairing saved.') : t('Aguardando pareamento.', 'Waiting for pairing.')
    $('state').className = paired ? 'notice success' : 'muted'
    $('connected-actions').hidden = !paired
    $('base').value = config?.base || ''
    $('pair-btn').textContent = paired ? t('Parear novamente', 'Pair again') : t('Conectar extensão', 'Connect extension')
  }

  function explain(error) {
    if (error.code === 'OFFLINE') return t(`Abra o ${PRODUCT.name} com a API local ativada e tente novamente.`, `Open ${PRODUCT.name} with its local API enabled and try again.`)
    if (error.status === 401) return t('O pareamento expirou ou foi revogado. Gere um código para conectar novamente.', 'The pairing expired or was revoked. Generate a code to reconnect.')
    return error.message
  }

  async function perform(action) {
    if (busy) return
    busy = true
    for (const id of ['base', 'code', 'pair-btn', 'test', 'unpair']) $(id).disabled = true
    try {
      await action()
    } catch (error) {
      msg(explain(error), 'error')
    } finally {
      busy = false
      for (const id of ['base', 'code', 'pair-btn', 'test', 'unpair']) $(id).disabled = false
    }
  }

  void perform(async () => render(await api.load()))

  $('pair').addEventListener('submit', event => {
    event.preventDefault()
    const base = api.normalizeBase($('base').value)
    if (!base) {
      msg(t(`Use o endereço mostrado no ${PRODUCT.name} (http://127.0.0.1:porta).`, `Use the address shown in ${PRODUCT.name} (http://127.0.0.1:port).`), 'error')
      return
    }
    const code = $('code').value.trim()
    if (!code) {
      msg(t('Digite o código de pareamento.', 'Enter the pairing code.'), 'error')
      return
    }

    void perform(async () => {
      msg(t('Conectando…', 'Connecting…'))
      let result
      try {
        result = await api.pair(base, code)
      } catch (error) {
        if (error.status === 403) throw new Error(t(`Código incorreto ou expirado. Gere outro no ${PRODUCT.name}.`, `Incorrect or expired code. Generate another in ${PRODUCT.name}.`))
        throw error
      }
      if (!result.token) throw new Error(t(`O ${PRODUCT.name} não confirmou o pareamento.`, `${PRODUCT.name} did not confirm pairing.`))

      const config = { base, token: result.token }
      await api.save(config)
      $('code').value = ''
      render(config)
      msg(t(`Conectado. Abra uma página e clique no ícone da extensão para salvá-la no ${PRODUCT.name}.`, `Connected. Open a page and click the extension icon to save it to ${PRODUCT.name}.`))
    })
  })

  $('test').addEventListener('click', () => {
    void perform(async () => {
      msg(t('Testando conexão…', 'Testing connection…'))
      const info = await api.whoami(await api.load())
      msg(t(`Conectado. Os recortes vão para “${info.folder}”.`, `Connected. Clips go to “${info.folder}”.`), 'success')
    })
  })

  $('unpair').addEventListener('click', () => {
    void perform(async () => {
      await api.clear()
      render({})
      msg(t(
        `Desconectado deste Chrome. Você também pode revogar a conexão nas configurações do ${PRODUCT.name}.`,
        `Disconnected from this browser. You can also revoke the connection in ${PRODUCT.name} settings.`,
      ))
    })
  })
})()
