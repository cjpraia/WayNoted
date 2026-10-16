// Sem endereço de feed, "Buscar atualizações" não fica mudo nem faz rede: mostra a orientação para configurar.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/components/modals/UpdateCheck.tsx', import.meta.url), 'utf8')

test('botão não é desativado por falta de URL e a ação vazia só orienta (sem chamar checkForUpdates)', () => {
  assert.ok(/disabled=\{!native \|\| busy\}/.test(source), 'o botão não deve depender da URL')
  const check = source.slice(source.indexOf('const check = async'), source.indexOf('const openPage'))
  const guard = check.indexOf('!feedUrl.trim()'), call = check.indexOf('api.checkForUpdates(feedUrl')
  assert.ok(guard > 0 && call > guard, 'a checagem de URL vazia deve vir antes da chamada de rede')
  assert.ok(check.slice(guard, call).includes('setNeedsUrl(true)') && check.slice(guard, call).includes('return'), 'URL vazia define a mensagem e retorna')
  assert.ok(source.includes('Informe o endereço do arquivo de versões'), 'mensagem de configurar presente')
})
