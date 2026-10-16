import { fileURLToPath } from 'node:url'
// Glossário (docs/USAGE.md): "um nome por conceito". A lousa (canvas) nunca se chama "Quadro livre";
// "Quadro" é só a visualização kanban. O menu "/" mantém os apelidos de busca antigos.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(ts|tsx|cjs|mjs)$/.test(name)) out.push(path)
  }
  return out
}
const files = [...walk(join(root, 'src')), ...walk(join(root, 'electron'))]
const sources = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]))

test('nenhum texto t(...) chama a lousa de "Quadro livre" ou "Novo quadro"', () => {
  const call = /\bt(?:Now)?\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)(?:\s*,\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`))?/g
  const bad: string[] = []
  for (const [file, text] of sources) {
    for (const match of text.matchAll(call)) {
      const strings = match.slice(1).filter((s): s is string => typeof s === 'string')
      for (const s of strings) if (/quadro livre|free board|novo quadro|new board\b|mostrar no quadro|show on board/i.test(s)) bad.push(`${file.replace(root, '')}: ${s}`)
    }
  }
  assert.deepEqual(bad, [])
})

test('textos visíveis da lousa usam "lousa"/"whiteboard"', () => {
  const dir = join(root, 'src/components/canvas')
  const bad: string[] = []
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/\bt(?:Now)?\(\s*'([^']*)'\s*,\s*'([^']*)'/g)) {
      if (/\bquadros?\b/i.test(match[1]) && !/slash/.test(file)) bad.push(`${file.replace(root, '')}: ${match[1]}`)
      if (/\bboards?\b/i.test(match[2])) bad.push(`${file.replace(root, '')}: ${match[2]}`)
    }
  }
  assert.deepEqual(bad, [])
})

test('/Lousa mantém os apelidos de busca antigos', () => {
  const text = sources.get(join(root, 'src/components/canvas/slash.tsx'))!
  const entry = text.split('\n').find((line) => line.includes("id: 'canvas'"))!
  assert.ok(entry.includes("pt: 'Lousa (canvas)'"), 'rótulo pt')
  assert.ok(entry.includes("en: 'Whiteboard (canvas)'"), 'rótulo en')
  for (const alias of ['quadro livre', 'canvas', 'whiteboard', 'quadro', 'lousa']) assert.ok(entry.includes(`'${alias}'`), `alias ${alias}`)
})

test('atalhos: a área do canvas se chama Lousa', () => {
  const text = sources.get(join(root, 'src/shortcuts.ts'))!
  assert.ok(text.includes("label: ['Lousa', 'Whiteboard']"))
})
