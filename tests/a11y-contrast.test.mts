import { fileURLToPath } from 'node:url'
// Acessibilidade — alto contraste (prefers-contrast: more), menos movimento e menos transparência em src/styles/tokens.css.
// Pares críticos: texto AAA (7:1), ícones/bordas/anel de foco ≥ 3:1 (WCAG 1.4.11), nos dois temas. docs/USAGE.md
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const css = readFileSync(join(ROOT, 'src/styles/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function vars(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[match[1]] = match[2].trim()
  return out
}
function firstBlock(source: string, selector: string, from = 0): Record<string, string> {
  const start = source.indexOf(`${selector} {`, from)
  assert.ok(start >= 0, `bloco ${selector}`)
  return vars(source.slice(source.indexOf('{', start) + 1, source.indexOf('}', start)))
}
/** Corpo do primeiro `@media (query) { … }` (chaves balanceadas). */
function mediaBody(query: string, nth = 0): string {
  let from = 0, start = -1
  for (let i = 0; i <= nth; i++) { start = css.indexOf(`@media (${query}) {`, from); assert.ok(start >= 0, query); from = start + 1 }
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i)
  }
  throw new Error('media sem fim')
}

const baseLight = firstBlock(css, ':root')
const baseDark = { ...baseLight, ...firstBlock(css, ":root[data-theme='dark']") }
const contrastBody = mediaBody('prefers-contrast: more')
const moreLight = { ...baseLight, ...firstBlock(contrastBody, ':root') }
const moreDark = { ...baseDark, ...firstBlock(contrastBody, ':root'), ...firstBlock(contrastBody, ":root[data-theme='dark']") }

type RGBA = [number, number, number, number]
function parse(value: string, v: Record<string, string>): RGBA {
  const ref = value.match(/^var\((--[\w-]+)\)$/)
  if (ref) return parse(v[ref[1]], v)
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as RGBA
  const rgba = value.match(/^rgba?\(([^)]+)\)$/)
  if (rgba) { const [r, g, b, a = 1] = rgba[1].split(',').map(Number); return [r, g, b, a] }
  throw new Error(`cor não suportada: ${value}`)
}
const over = ([r, g, b, a]: RGBA, [br, bg, bb]: RGBA): RGBA => [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1]
const lum = ([r, g, b]: RGBA) => [r, g, b].map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
function ratio(fg: string, bg: string, v: Record<string, string>, base = 'var(--bg)') {
  const background = over(parse(bg, v), parse(base, v))
  const a = lum(over(parse(fg, v), background)), b = lum(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
const surfaces = ['var(--bg)', 'var(--bg-sidebar)', 'var(--bg-popover)', 'var(--bg-raised)']

for (const [theme, v, base] of [['claro', moreLight, baseLight], ['escuro', moreDark, baseDark]] as const) {
  test(`alto contraste (${theme}): texto, link e perigo atingem AAA 7:1 em todas as superfícies`, () => {
    for (const token of ['--text', '--text-secondary', '--text-tertiary', '--accent-text', '--danger']) for (const surface of surfaces) {
      const value = ratio(`var(${token})`, surface, v)
      assert.ok(value >= 7, `${token} sobre ${surface}: ${value.toFixed(2)}`)
    }
  })
  test(`alto contraste (${theme}): placeholder e ícones ≥ 4,5:1; texto sobre destaque suave AA`, () => {
    for (const surface of surfaces) {
      assert.ok(ratio('var(--text-placeholder)', surface, v) >= 4.5, `placeholder sobre ${surface}`)
      assert.ok(ratio('var(--icon)', surface, v) >= 4.5, `ícone sobre ${surface}`)
    }
    const soft = ratio('var(--accent-text)', 'var(--accent-bg)', v)
    assert.ok(soft >= 4.5, `--accent-text sobre --accent-bg: ${soft.toFixed(2)}`)
    for (const fill of ['var(--accent)', 'var(--accent-hover)', 'var(--accent-active)']) assert.ok(ratio('var(--on-accent)', fill, v) >= 7, `--on-accent sobre ${fill}`)
  })
  test(`alto contraste (${theme}): bordas e anel de foco ≥ 3:1 (WCAG 1.4.11) e sempre melhores que o tema normal`, () => {
    for (const surface of surfaces) {
      for (const token of ['--border', '--border-strong', '--focus-outline']) {
        const value = ratio(token === '--focus-outline' ? 'var(--accent)' : `var(${token})`, surface, v)
        assert.ok(value >= 3, `${token} sobre ${surface}: ${value.toFixed(2)}`)
      }
      assert.ok(ratio('var(--border)', surface, v) > ratio('var(--border)', surface, base), `--border deve subir sobre ${surface}`)
      assert.ok(ratio('var(--text-tertiary)', surface, v) > ratio('var(--text-tertiary)', surface, base), `--text-tertiary deve subir sobre ${surface}`)
    }
  })
}

test('alto contraste: o anel de foco fica mais grosso (3 px) e a opacidade de desativado sobe', () => {
  assert.equal(firstBlock(contrastBody, ':root')['--focus-width'], '3px')
  assert.equal(baseLight['--focus-width'], '2px')
  assert.ok(Number(firstBlock(contrastBody, ':root')['--disabled-opacity']) > Number(baseLight['--disabled-opacity']))
})

test('alvos de clique mínimos (28 px) e escala não são reduzidos por nenhum modo de acessibilidade', () => {
  assert.equal(baseLight['--hit-min'], '28px')
  for (const query of ['prefers-contrast: more', 'prefers-reduced-motion: reduce', 'prefers-reduced-transparency: reduce']) {
    assert.ok(!/--hit-(min|primary)/.test(mediaBody(query)), `${query} não deve mexer nos alvos`)
  }
})

test('menos movimento: animações e transições não essenciais zeradas', () => {
  const body = mediaBody('prefers-reduced-motion: reduce')
  for (const needle of ['animation-duration: 0.01ms !important', 'animation-iteration-count: 1 !important', 'transition-duration: 0.01ms !important', 'scroll-behavior: auto !important']) assert.ok(body.includes(needle), needle)
})

test('menos transparência: sem desfoque de fundo e véu de modal mais opaco', () => {
  const body = mediaBody('prefers-reduced-transparency: reduce')
  assert.ok(body.includes('backdrop-filter: none !important'))
  const alpha = (value: string) => parse(value, {})[3]
  assert.ok(alpha(firstBlock(body, ':root')['--bg-overlay']) > alpha(baseLight['--bg-overlay']))
  assert.ok(alpha(firstBlock(body, ":root[data-theme='dark']")['--bg-overlay']) > alpha(baseDark['--bg-overlay']))
})
