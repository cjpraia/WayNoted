// Avisos de terceiros (Configurações → Sobre). O caminho é FIXO: nunca vem do renderer.
// Empacotado (electron-packager sem asar), THIRD-PARTY-NOTICES.md fica na raiz do app (app.getAppPath());
// em desenvolvimento, app.getAppPath() é a raiz do repositório. Somente leitura.
const fs = require('node:fs/promises')
const path = require('node:path')

const FILE_NAME = 'THIRD-PARTY-NOTICES.md'
const MAX_BYTES = 4 * 1024 * 1024

function registerNoticesIpc({ trustedHandler, app, shell, root }) {
  const noticesPath = () => path.join(root ?? app.getAppPath(), FILE_NAME)
  trustedHandler('np:readThirdPartyNotices', async () => {
    const version = app.getVersion()
    try {
      const file = noticesPath()
      const stat = await fs.stat(file)
      if (!stat.isFile() || stat.size > MAX_BYTES) return { found: false, text: '', version }
      return { found: true, text: await fs.readFile(file, 'utf8'), version }
    } catch {
      return { found: false, text: '', version }
    }
  })
  trustedHandler('np:revealThirdPartyNotices', async () => {
    const file = noticesPath()
    await fs.access(file)
    shell.showItemInFolder(file)
  })
}

module.exports = { registerNoticesIpc, FILE_NAME }
