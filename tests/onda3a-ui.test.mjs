// Onda 3a (B5, B1, D3b): a interface nova usa os controles compartilhados, tem pt-BR e en-US e só grava com ação explícita.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [host, apple, agent, css1, css2, app] = await Promise.all(['src/openfile/ExternalFileHost.tsx', 'src/components/modals/AppleNotesImportDialog.tsx', 'src/agent/AgentSettings.tsx', 'src/openfile/externalFile.css', 'src/components/modals/AppleNotesImportDialog.css', 'src/App.tsx'].map(read))

test('os componentes novos usam Button/Textarea/Toggle compartilhados, sem <button>/<textarea> avulsos', () => {
  for (const [name, source] of [['ExternalFileHost', host], ['AppleNotesImportDialog', apple]]) {
    assert.ok(!/<button\b/.test(source), `${name}: sem <button> cru`)
    assert.ok(!/<textarea\b/.test(source), `${name}: sem <textarea> cru`)
    assert.ok(!/window\.(alert|confirm)\(/.test(source), `${name}: sem alert/confirm`)
  }
  assert.ok(/<Textarea\b/.test(host) && /<Toggle\b/.test(apple))
})

test('toda cópia visível tem as duas línguas (t(pt, en))', () => {
  for (const [name, source] of [['ExternalFileHost', host], ['AppleNotesImportDialog', apple]]) {
    const calls = source.match(/\bt\('/g)?.length ?? 0
    assert.ok(calls > 15, `${name}: textos passam por t()`)
    assert.ok(!/>\s*[A-ZÁÉÍÓÚ][a-záéíóúç ]{6,}\s*</.test(source.replace(/\{t\([^}]*\)\}/g, '')), `${name}: nenhum texto fixo fora de t()`)
  }
})

test('B5: só "Salvar no arquivo" grava; fechar com edições pede confirmação; conflito oferece recarregar/sobrescrever', () => {
  assert.equal((host.match(/api\.externalFileSave!?\(/g) ?? []).length, 1, 'um único ponto de gravação')
  assert.ok(/const save = async \(force = false\)/.test(host) && /onClick=\{\(\) => void save\(\)\}/.test(host) && /void save\(true\)/.test(host))
  assert.ok(/confirm === 'discard'/.test(host) && /if \(dirty && confirm !== 'discard'\)/.test(host))
  assert.ok(/externalFileReload/.test(host) && /Recarregar do disco/.test(host) && /Sobrescrever com a minha versão/.test(host))
  assert.ok(/addEventListener\('focus', check\)/.test(host), 'confere alteração externa ao voltar para a janela')
  assert.ok(/'open-markdown-file'/.test(app) && /<ExternalFileHost \/>/.test(app))
})

test('D3b: negação oferece o atalho para Ajustes → Automação; importação cancelável com ⌘Z do lote', () => {
  assert.ok(/openPrivacySettings\?\.\('automation'\)/.test(apple) && /case 'denied'/.test(apple))
  assert.ok(/actions\.transact\(/.test(apple) && /AbortController/.test(apple) && /appleNotesCancel/.test(apple))
  assert.ok(/'import-apple-notes'/.test(app) && /<AppleNotesImportHost \/>/.test(app))
})

test('B1: cartão do clipper — pareamento por código, sem token exibido, só revogar', () => {
  assert.ok(/clipperPairStart/.test(agent) && /ag-pair-code/.test(agent) && /Desconectar/.test(agent))
  assert.ok(!/token/i.test(agent.slice(agent.indexOf('Web clipper (navegador)'), agent.indexOf('Conectar ao Claude (MCP)')).replace(/ag-token/g, '')), 'o token do clipper nunca aparece na interface')
})

test('CSS novo usa a escala --space-* e não cria alvos pequenos', () => {
  for (const css of [css1, css2]) {
    assert.ok(!/(padding|margin|gap)[a-z-]*:[^;{}]*\b(?:3|5|6|7|9|10|11|13|14|15)px/.test(css), 'espaçamento fora da escala')
    assert.ok(!/(?:^|[^-])(?:height|width):\s*(?:1\d|2[0-3]|\d)px/.test(css), 'alvo menor que 24 px')
  }
})
