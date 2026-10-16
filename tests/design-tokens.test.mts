// Sistema de design (docs/DEVELOPMENT.md): contraste WCAG AA dos tokens nos dois temas, ausência do azul
// antigo nos componentes, fonte de títulos embutida localmente e escalas de espaço/raio/movimento/alvos.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const tokensCss = readFileSync(join(root, 'src/styles/tokens.css'), 'utf8')
const identityCss = readFileSync(join(root, 'src/styles/identity.css'), 'utf8')

/** Primeiro bloco `selector { … }` do arquivo (as declarações de tema ficam no topo de tokens.css). */
function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  assert.ok(start >= 0, `bloco ${selector} não encontrado`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  const vars: Record<string, string> = {}
  for (const match of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[match[1]] = match[2].trim()
  return vars
}
const light = block(tokensCss, ':root')
const dark = { ...light, ...block(tokensCss, ":root[data-theme='dark']") }

type RGBA = [number, number, number, number]
function parse(value: string, vars: Record<string, string>): RGBA {
  const ref = value.match(/^var\((--[\w-]+)\)$/)
  if (ref) return parse(vars[ref[1]], vars)
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as RGBA
  const rgba = value.match(/^rgba?\(([^)]+)\)$/)
  if (rgba) { const [r, g, b, a = 1] = rgba[1].split(',').map(Number); return [r, g, b, a] }
  throw new Error(`cor não suportada: ${value}`)
}
const over = ([r, g, b, a]: RGBA, [br, bg, bb]: RGBA): RGBA => [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1]
const lum = ([r, g, b]: RGBA) => [r, g, b].map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
function ratio(fg: string, bg: string, vars: Record<string, string>, base = 'var(--bg)') {
  const background = over(parse(bg, vars), parse(base, vars))
  const a = lum(over(parse(fg, vars), background)), b = lum(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const surfaces = ['var(--bg)', 'var(--bg-sidebar)', 'var(--bg-popover)', 'var(--bg-raised)']
const textTokens = ['--text', '--text-secondary', '--text-tertiary', '--accent-text', '--danger']

for (const [theme, vars] of [['claro', light], ['escuro', dark]] as const) {
  test(`tema ${theme}: textos e links têm contraste ≥ 4,5:1 em todas as superfícies`, () => {
    for (const token of textTokens) for (const surface of surfaces) {
      const value = ratio(`var(${token})`, surface, vars)
      assert.ok(value >= 4.5, `${token} sobre ${surface}: ${value.toFixed(2)}`)
    }
  })
  test(`tema ${theme}: botão primário e seleção no destaque passam AA`, () => {
    for (const fill of ['var(--accent)', 'var(--accent-hover)', 'var(--accent-active)']) {
      const value = ratio('var(--on-accent)', fill, vars)
      assert.ok(value >= 4.5, `--on-accent sobre ${fill}: ${value.toFixed(2)}`)
    }
    // Texto no destaque sobre o fundo suave (itens ativos, chips de filtro).
    const soft = ratio('var(--accent-text)', 'var(--accent-bg)', vars)
    assert.ok(soft >= 4.5, `--accent-text sobre --accent-bg: ${soft.toFixed(2)}`)
  })
  test(`tema ${theme}: componentes de interface (destaque, foco, ícones) têm ≥ 3:1`, () => {
    for (const surface of surfaces) {
      for (const token of ['--accent', '--icon']) {
        const value = ratio(`var(${token})`, surface, vars)
        assert.ok(value >= 3, `${token} sobre ${surface}: ${value.toFixed(2)}`)
      }
    }
  })
}

for (const [theme, vars] of [['claro', light], ['escuro', dark]] as const) {
  // Auditoria de UI (docs/DEVELOPMENT.md): pares dos controles compartilhados (Select, botões de perigo, estados de linha).
  test(`tema ${theme}: controles compartilhados (Select, perigo, linha ativa) passam AA`, () => {
    const pairs: [string, string, string][] = [
      ['--text', '--bg-input', 'texto do campo do Select'],
      ['--text-secondary', '--bg-input', 'texto secundário no campo'],
      ['--text', '--bg-hover', 'opção ativa do Select / linha em hover'],
      ['--accent-text', '--bg-hover', 'opção selecionada do Select'],
      ['--text-secondary', '--bg-hover', 'botão fantasma em hover'],
      ['--text-secondary', '--bg-active', 'item de navegação ativo'],
      ['--on-accent', '--danger', 'botão de perigo'],
      ['--on-accent', '--danger-hover', 'botão de perigo em hover'],
      ['--danger', '--danger-bg', 'botão de perigo discreto em hover'],
      ['--accent-text', '--accent-bg-strong', 'interruptor/pílula selecionada'],
    ]
    for (const surface of ['var(--bg)', 'var(--bg-popover)']) for (const [fg, bg, what] of pairs) {
      const value = ratio(`var(${fg})`, `var(${bg})`, vars, surface)
      assert.ok(value >= 4.5, `${what}: ${fg} sobre ${bg} (base ${surface}): ${value.toFixed(2)}`)
    }
  })
  test(`tema ${theme}: foco, borda do campo e ícones têm ≥ 3:1 em campos e popovers`, () => {
    for (const surface of ['var(--bg)', 'var(--bg-popover)', 'var(--bg-sidebar)']) {
      const focus = ratio('var(--accent)', surface, vars)
      assert.ok(focus >= 3, `anel de foco (--accent) sobre ${surface}: ${focus.toFixed(2)}`)
      const border = ratio('var(--border-strong)', surface, vars)
      assert.ok(border >= 1.3, `borda do campo sobre ${surface}: ${border.toFixed(2)} (decorativa; o foco e o texto carregam o contraste)`)
    }
  })
}

test('destaque próprio: não é o azul do Export Bundle e difere entre claro/escuro só em luminosidade', () => {
  assert.notEqual(light['--accent'].toLowerCase(), '#2383e2')
  assert.match(light['--accent'], /^#0f766e$/i)
  assert.match(dark['--accent'], /^#[0-9a-f]{6}$/i)
})

/** Arquivos de código e estilos dos componentes. */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(css|tsx?|mts)$/.test(name)) out.push(path)
  }
  return out
}
const sources = walk(join(root, 'src'))

test('nenhum arquivo do app usa o azul de destaque antigo (#2383e2 / #0077d4 / rgba(35,131,226))', () => {
  const old = /#2383e2|#0077d4|rgba\(\s*35\s*,\s*131\s*,\s*226/i
  const offenders = sources.filter(file => old.test(readFileSync(file, 'utf8'))).map(file => file.slice(root.length + 1))
  assert.deepEqual(offenders, [])
})

test('CSS de componentes: texto sobre fundo de destaque usa --on-accent (nunca branco fixo)', () => {
  const offenders: string[] = []
  for (const file of sources.filter(f => f.endsWith('.css'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(/\{([^{}]*)\}/g)) {
      const body = match[1]
      if (/background(-color)?\s*:\s*var\(--accent(-hover|-active)?\)/.test(body) && /(?<![-\w])color\s*:\s*(#fff\b|#ffffff\b|white\b)/i.test(body)) offenders.push(`${file.slice(root.length + 1)}: ${body.trim().slice(0, 80)}`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('cores de destaque só por tokens: CSS de componente não declara --accent próprio', () => {
  const offenders = sources.filter(file => file.endsWith('.css') && !file.endsWith('tokens.css') && /(^|[;{\s])--accent\s*:/m.test(readFileSync(file, 'utf8')))
  assert.deepEqual(offenders.map(file => file.slice(root.length + 1)), [])
})

test('fonte de títulos (Newsreader, OFL) embutida localmente, sem rede, com font-display: swap', () => {
  assert.ok(!/url\(\s*['"]?https?:|@import/.test(identityCss), 'identity.css não pode carregar nada da rede')
  const url = identityCss.match(/url\('([^']+newsreader[^']+\.woff2)'\)/)
  assert.ok(url, 'font-face da Newsreader')
  const file = resolve(dirname(join(root, 'src/styles/identity.css')), url![1])
  assert.ok(existsSync(file), `arquivo de fonte ausente: ${file}`)
  assert.ok(statSync(file).size < 200_000, 'subconjunto latino apenas')
  assert.match(identityCss, /font-display:\s*swap/)
  const license = readFileSync(join(root, 'node_modules/@fontsource-variable/newsreader/LICENSE'), 'utf8')
  assert.match(license, /SIL Open Font License/)
  assert.match(light['--font-display'], /Newsreader/)
  assert.match(tokensCss, /:root\[data-title-font='system'\]\s*\{\s*--font-display:\s*var\(--font-sans\)/)
})

test('escalas: espaço 4/8/12/16/24/32, raios 4–16, alvos de toque e movimento ≤ 220 ms', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(n => light[`--space-${n}`]), ['4px', '8px', '12px', '16px', '24px', '32px'])
  assert.deepEqual(['--radius-xs', '--radius', '--radius-md', '--radius-lg', '--radius-xl'].map(name => light[name]), ['4px', '6px', '8px', '12px', '16px'])
  assert.ok(parseInt(light['--hit-min']) >= 28 && parseInt(light['--hit-primary']) >= 32)
  for (const name of ['--dur-1', '--dur-2', '--dur-3']) assert.ok(parseInt(light[name]) <= 220, name)
  assert.match(tokensCss, /prefers-reduced-motion:\s*reduce/)
  for (const name of ['--shadow-1', '--shadow-2', '--shadow-3', '--focus-ring', '--selection', '--accent-bg', '--accent-hover', '--accent-active', '--link']) assert.ok(light[name], name)
})
