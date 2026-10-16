// Carrega módulos .ts/.tsx do app para testes jsdom: compila com o oxc do Vite, resolve imports
// relativos recursivamente (cada arquivo vira um módulo data: único e compartilhado) e troca
// módulos com efeitos colaterais (store, i18n…) por mocks em `globalThis.__tsxMocks`.
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EXTS = ['', '.ts', '.tsx', '.mts', '/index.ts', '/index.tsx']

export function createLoader(mocks = {}) {
  globalThis.__tsxMocks = {}
  const mockByPath = new Map()
  for (const [rel, value] of Object.entries(mocks)) {
    const key = path.resolve(root, rel).replace(/\.(tsx?|mts)$/, '')
    globalThis.__tsxMocks[key] = value
    mockByPath.set(key, `data:text/javascript;base64,${Buffer.from(Object.keys(value).map(name => `export const ${name} = globalThis.__tsxMocks[${JSON.stringify(key)}][${JSON.stringify(name)}];`).join('\n')).toString('base64')}`)
  }
  const urls = new Map()
  const resolveFile = (from, spec) => {
    const base = path.resolve(path.dirname(from), spec)
    for (const ext of EXTS) if (existsSync(base + ext) && !base.endsWith('/') && (ext || /\.[cm]?[jt]sx?$/.test(base))) return base + ext
    throw new Error(`não encontrado: ${spec} (de ${from})`)
  }
  async function urlFor(file) {
    const mock = mockByPath.get(file.replace(/\.(tsx?|mts)$/, ''))
    if (mock) return mock
    if (urls.has(file)) return urls.get(file)
    const promise = (async () => {
      const source = await readFile(file, 'utf8')
      const lang = file.endsWith('.tsx') ? 'tsx' : 'ts'
      const { code } = await transformWithOxc(source, path.basename(file), { lang, jsx: { runtime: 'automatic' } })
      const specs = new Map()
      for (const match of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g)) specs.set(match[1], null)
      for (const spec of specs.keys()) {
        if (/\.css$/.test(spec)) continue
        if (spec.startsWith('.')) specs.set(spec, await urlFor(resolveFile(file, spec)))
        else specs.set(spec, import.meta.resolve(spec))
      }
      const rewritten = code
        .replace(/^\s*import\s*["'][^"']+\.css["'];?\s*$/gm, '')
        .replace(/(\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g, (all, prefix, spec) => specs.get(spec) ? `${prefix}${JSON.stringify(specs.get(spec))}` : all)
      return `data:text/javascript;base64,${Buffer.from(rewritten + `\n//# sourceURL=${file}`).toString('base64')}`
    })()
    urls.set(file, promise)
    return promise
  }
  return { load: async rel => import(await urlFor(path.resolve(root, rel))) }
}
