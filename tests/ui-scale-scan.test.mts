// Varredura do CSS dos componentes (Fitts, Proximidade, Similaridade): alvos pequenos e espaçamentos fora da escala.
// É uma catraca: o baseline (tests/fixtures/ui-scan-baseline.json) guarda a dívida existente por arquivo; o teste
// falha se um arquivo piorar ou se surgir arquivo novo com problema. Para quitar dívida, corrija e rode:
//   UI_SCAN_UPDATE=1 node scripts/run-tests.mjs tests/ui-scale-scan.test.mts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const BASELINE = join(ROOT, 'tests/fixtures/ui-scan-baseline.json')
const SCALE = new Set([0, 1, 2, 4, 8, 12, 16, 24, 32, 40, 48, 64])
const BUTTON = /(btn|button|-close\b|-x\b|toggle)/i
const EXEMPT = /(svg|> span|-icon\b|swatch|dot|avatar|bar\b|track|thumb|handle|resize|knob|badge|spinner|caret|arrow|check(box)?\b|radio|marker|glyph|logo|mark\b|illustr|cover|preview|sample|scrollbar|cursor|pin\b)/i
const SPACING = /^(padding|margin)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$|^(gap|row-gap|column-gap)$/

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) cssFiles(full, out)
    else if (name.endsWith('.css') && !/^(tokens|db-tokens)\.css$/.test(name)) out.push(full)
  }
  return out
}

interface Rule { selector: string; body: string }
export function parseRules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: Rule[] = []
  const walk = (source: string) => {
    let i = 0
    while (i < source.length) {
      const open = source.indexOf('{', i)
      if (open < 0) break
      let depth = 1, j = open + 1
      while (j < source.length && depth) { if (source[j] === '{') depth++; else if (source[j] === '}') depth--; j++ }
      const head = source.slice(i, open).trim(), body = source.slice(open + 1, j - 1)
      if (head.startsWith('@')) { if (/^@(media|supports|layer)/.test(head)) walk(body) }
      else rules.push({ selector: head, body })
      i = j
    }
  }
  walk(text)
  return rules
}
const decls = (body: string) => body.split(';').map(part => { const k = part.indexOf(':'); return k < 0 ? null : [part.slice(0, k).trim().toLowerCase(), part.slice(k + 1).trim()] as [string, string] }).filter((entry): entry is [string, string] => !!entry)
const px = (value: string) => { const m = /^(-?\d*\.?\d+)px$/.exec(value.trim()); return m ? Number(m[1]) : null }

/** Botões com altura/largura fixa < 24 px sem `min-*`, padding ou área estendida (::before) compensando. */
export function smallTargets(rules: Rule[], all: Rule[] = rules): string[] {
  const extended = new Set(all.filter(rule => /::?(before|after)/.test(rule.selector) && /(inset|top|bottom|left|right)\s*:\s*-/.test(rule.body)).flatMap(rule => rule.selector.split(',').map(part => part.replace(/::?(before|after)/g, '').trim())))
  const out: string[] = []
  for (const { selector, body } of rules) {
    if (/::?(before|after)/.test(selector) || /:(hover|active|focus|disabled)/.test(selector) && !BUTTON.test(selector)) continue
    if (!BUTTON.test(selector) || EXEMPT.test(selector)) continue
    const d = new Map(decls(body))
    const h = px(d.get('height') ?? ''), w = px(d.get('width') ?? '')
    const small = (h !== null && h < 24) || (w !== null && w < 24)
    if (!small) continue
    const minOk = (px(d.get('min-height') ?? '') ?? 0) >= 24 || (px(d.get('min-width') ?? '') ?? 0) >= 24 || /var\(--hit-/.test(d.get('min-height') ?? '') || /var\(--hit-/.test(d.get('min-width') ?? '')
    const pad = d.get('padding') ?? ''
    const padOk = pad.split(/\s+/).some(token => (px(token) ?? 0) >= 6) && (h === null || (h + 2 * Math.max(...pad.split(/\s+/).map(token => px(token) ?? 0)) >= 24))
    if (minOk || padOk) continue
    // Seletor composto: cada parte precisa ter a área estendida.
    const parts = selector.split(',').map(part => part.trim()).filter(part => BUTTON.test(part) && !EXEMPT.test(part))
    if (parts.every(part => extended.has(part))) continue
    out.push(`${selector.trim()} { ${h !== null ? `height:${h}px ` : ''}${w !== null ? `width:${w}px` : ''}}`)
  }
  return out
}

/** Espaçamentos (padding/margin/gap) em px fora da escala 4/8/12/16/24/32 (e 0/1/2). */
export function offScale(rules: Rule[]): string[] {
  const out: string[] = []
  for (const { selector, body } of rules) {
    for (const [prop, value] of decls(body)) {
      if (!SPACING.test(prop) || /var\(|calc\(|auto|%|em|vw|vh/.test(value)) continue
      for (const token of value.split(/\s+/)) {
        const n = px(token)
        if (n !== null && !SCALE.has(Math.abs(n))) out.push(`${selector.trim()} { ${prop}: ${value} }`)
      }
    }
  }
  return out
}

const files = cssFiles(join(ROOT, 'src'))
const parsed = new Map(files.map(file => [file, parseRules(readFileSync(file, 'utf8'))]))
const everyRule = [...parsed.values()].flat()
const results: Record<string, { small: number; scale: number }> = {}
const detail: Record<string, { small: string[]; scale: string[] }> = {}
for (const file of files) {
  const rules = parsed.get(file)!
  const small = smallTargets(rules, everyRule), scale = [...new Set(offScale(rules))]
  if (small.length || scale.length) { const key = relative(ROOT, file); results[key] = { small: small.length, scale: scale.length }; detail[key] = { small, scale } }
}

test('heurística: detecta botão pequeno e ignora o compensado', () => {
  const rules = parseRules(`.a-btn { width: 18px; height: 18px }
.b-btn { width: 18px; height: 18px; min-width: 28px; min-height: 28px }
.c-btn { height: 20px; padding: 0 8px }
.d-btn { width: 16px; height: 16px } .d-btn::before { content: ''; position: absolute; inset: -6px }
.e-swatch { width: 12px; height: 12px }
@media (max-width: 600px) { .f-btn { height: 16px } }`)
  const found = smallTargets(rules)
  assert.equal(found.length, 2, found.join(' | '))
  assert.ok(found[0].startsWith('.a-btn') && found[1].startsWith('.f-btn'))
})

test('heurística: espaçamento fora da escala', () => {
  const rules = parseRules('.x { padding: 6px 8px; margin: 0 auto; gap: 10px } .y { padding: 4px 12px; margin-top: 24px; gap: var(--space-2) }')
  assert.deepEqual(offScale(rules).map(line => line.split(' ')[0]), ['.x', '.x'])
})

test('catraca de UI: nenhum arquivo CSS piora em alvos pequenos nem em espaçamentos fora da escala', () => {
  if (process.env.UI_SCAN_DUMP === '1') for (const [file, d] of Object.entries(detail)) for (const line of d.small) console.log(`SMALL ${file}: ${line}`)
  const baseline: Record<string, { small: number; scale: number }> = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}
  const total = (map: Record<string, { small: number; scale: number }>, key: 'small' | 'scale') => Object.values(map).reduce((sum, entry) => sum + entry[key], 0)
  if (process.env.UI_SCAN_UPDATE === '1') {
    // O baseline só pode diminuir: reescrevê-lo para absorver CSS novo esconde dívida. Aumento exige justificativa explícita.
    const grew = total(results, 'scale') > total(baseline, 'scale') || total(results, 'small') > total(baseline, 'small') || Object.entries(results).some(([file, now]) => now.scale > (baseline[file]?.scale ?? 0) || now.small > (baseline[file]?.small ?? 0))
    if (grew && !process.env.UI_SCAN_ALLOW_INCREASE) throw new Error('O baseline só pode diminuir. Use --space-* em vez de px; se o aumento for inevitável, rode com UI_SCAN_ALLOW_INCREASE="motivo" e repita o motivo no commit.')
    writeFileSync(BASELINE, JSON.stringify(results, null, 1) + '\n'); return
  }
  const worse: string[] = []
  for (const [file, now] of Object.entries(results)) {
    const before = baseline[file] ?? { small: 0, scale: 0 }
    if (now.small > before.small) worse.push(`${file}: alvos pequenos ${before.small} → ${now.small}\n   ${detail[file].small.slice(0, 4).join('\n   ')}`)
    if (now.scale > before.scale) worse.push(`${file}: espaçamentos fora da escala ${before.scale} → ${now.scale}\n   ${detail[file].scale.slice(-4).join('\n   ')}`)
  }
  // Dívida quitada precisa ser travada: se o real ficou abaixo do baseline, o baseline deve descer junto.
  assert.ok(total(results, 'scale') <= total(baseline, 'scale') && total(results, 'small') <= total(baseline, 'small'), 'o total de dívida subiu em relação ao baseline')
  const slack = total(baseline, 'scale') - total(results, 'scale') + total(baseline, 'small') - total(results, 'small')
  assert.ok(slack === 0, `dívida quitada (${slack}): rode UI_SCAN_UPDATE=1 node scripts/run-tests.mjs tests/ui-scale-scan.test.mts para travar o novo baseline`)
  assert.equal(worse.length, 0, `\n${worse.join('\n')}\nUse --space-* / --hit-min ou aumente a área de clique (padding/::before).`)
})
