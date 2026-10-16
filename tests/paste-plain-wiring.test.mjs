import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// ⌘⇧V no Electron: item do menu Editar -> comando 'paste-plain' -> renderer marca a próxima colagem como texto simples.
test('⌘⇧V "Colar como texto simples" está ligado do menu ao renderer', async () => {
  const main = await readFile('electron/main.cjs', 'utf8')
  const app = await readFile('src/App.tsx', 'utf8')
  const hook = await readFile('src/components/page/paste/useSmartPaste.tsx', 'utf8')
  assert.ok(/accelerator: 'CmdOrCtrl\+Shift\+V'[^\n]*pasteAsPlainText\(\)/.test(main), 'item de menu com CmdOrCtrl+Shift+V')
  assert.ok(/send\('np:command', 'paste-plain'\)[\s\S]{0,200}pasteAndMatchStyle\(\)/.test(main), 'main avisa o renderer e dispara colagem nativa')
  assert.ok(/command === 'paste-plain'[^\n]*np:paste-plain/.test(app), 'runCommand repassa o comando')
  assert.ok(/addEventListener\('np:paste-plain'/.test(hook) && /plainUntil\.current = Date\.now\(\)/.test(hook), 'hook marca a colagem como simples')
})
