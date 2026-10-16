import { fileURLToPath } from 'node:url'
// Acessibilidade — foco visível: cada `outline: none/0` dos CSS tem anel equivalente (src/styles/a11y.css, `!important`)
// ou está numa exceção documentada. Também: `lang` dinâmico e skip link. docs/USAGE.md
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { htmlLang, syncDocumentLang } from '../src/a11y/lang.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const a11yCss = readFileSync(join(ROOT, 'src/styles/a11y.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Campos de título / texto livre em que o cursor de texto é o indicador de foco (exceção documentada). */
const TITLE_FIELDS = ['.pg-title', '.dbv-title', '.cv-title', '.cv-text-editor', '.cv-layer-rename', '.fx-input', '.ot-name', '.ot-desc', '.pg-video-caption', '.qn-title', '.qn-body']
/** Contêineres focados só por programa (tabindex -1): diálogos, menus e o corpo de painéis; não recebem Tab. */
const PROGRAMMATIC_HOSTS = ['.ai-dialog', '.csvp', '.rec-dialog', '.exd-dialog', '.inbox-modal', '.lai-dialog', '.nid-dialog', '.dr-dialog', '.vs-body', '.pg-paste-url-menu', '.sb-menu-body', '.np-select-list', '.tb-inner']

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) cssFiles(full, out)
    else if (name.endsWith('.css')) out.push(full)
  }
  return out
}
function outlineNoneRules() {
  const found: { file: string; selector: string }[] = []
  for (const file of cssFiles(join(ROOT, 'src'))) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/outline\s*:\s*(none|0)\b/.test(match[2])) found.push({ file: relative(ROOT, file).replace(/\\/g, '/'), selector: match[1].trim().replace(/\s+/g, ' ') })
    }
  }
  return found
}

test('a11y.css: o anel global usa !important, espessura/cor por token e a lista de exceções espelha o teste', () => {
  assert.match(a11yCss, /outline:\s*var\(--focus-width.*\)\s+solid\s+var\(--focus-outline.*\)\s*!important/)
  assert.match(a11yCss, /outline-offset:\s*var\(--focus-offset.*\)\s*!important/)
  const notList = /:focus-visible:not\(([^)]*)\)/.exec(a11yCss)?.[1] ?? ''
  const listed = notList.split(',').map(part => part.trim()).filter(part => part.startsWith('.')).sort()
  assert.deepEqual(listed, [...TITLE_FIELDS].sort())
  for (const role of ['grid', 'menu', 'listbox']) assert.ok(notList.includes(`[role='${role}'][aria-activedescendant]`), `anfitrião ${role} com aria-activedescendant fica de fora (o indicador é o descendente)`)
  assert.ok(!/(^|,)\s*\[aria-activedescendant\]/.test(notList), 'campos/botões com aria-activedescendant (combobox) mantêm o anel')
})

test('todo `outline: none/0` é campo de título (exceção), contêiner de foco programático ou coberto pelo anel global', () => {
  const rules = outlineNoneRules()
  assert.ok(rules.length >= 90, `esperava ~97 regras, achei ${rules.length}`)
  const covered: string[] = []
  for (const { file, selector } of rules) {
    const parts = selector.split(',').map(part => part.trim().replace(/:(hover|focus|focus-visible|focus-within)\b/g, '').replace(/\[[^\]]*\]/g, ''))
    const classes = parts.map(part => /(\.[\w-]+)(?:\s+(?:input|textarea|button))?$/.exec(part.replace(/\s*>\s*/g, ' '))?.[1] ?? part)
    const isException = classes.every(cls => TITLE_FIELDS.includes(cls) || PROGRAMMATIC_HOSTS.includes(cls))
    if (!isException) covered.push(`${file} ${selector}`)
  }
  // O restante depende do anel global: ele precisa alcançar botões, campos, papéis interativos e tabindex.
  for (const needle of ['button', 'input', 'textarea', 'select', "[role='treeitem']", "[role='row']", "[role='gridcell']", "[role='option']", "[role='menuitem']", "[tabindex]:not([tabindex='-1'])", 'a[href]']) {
    assert.ok(a11yCss.includes(needle), `anel global deve cobrir ${needle}`)
  }
  assert.ok(covered.length > 0 && covered.length <= rules.length)
})

test('nenhum CSS reintroduz `outline: none !important` (derrotaria o anel global)', () => {
  for (const file of cssFiles(join(ROOT, 'src'))) {
    assert.ok(!/outline\s*:\s*(none|0)\s*!important/.test(readFileSync(file, 'utf8')), `${relative(ROOT, file).replace(/\\/g, '/')} usa outline none !important`)
  }
})

test('tokens do anel de foco existem no tema e engrossam em alto contraste', () => {
  const tokens = readFileSync(join(ROOT, 'src/styles/tokens.css'), 'utf8')
  for (const name of ['--focus-outline', '--focus-width', '--focus-offset']) assert.ok(tokens.includes(`${name}:`), name)
  assert.match(tokens, /@media \(prefers-contrast: more\)[\s\S]*--focus-width:\s*3px/)
})

test('lang do <html> segue o idioma do app', () => {
  assert.equal(htmlLang('en-US'), 'en-US')
  assert.equal(htmlLang('pt-BR'), 'pt-BR')
  assert.equal(htmlLang(undefined), 'pt-BR')
  const doc = { documentElement: { lang: 'pt-BR' } } as unknown as Document
  assert.equal(syncDocumentLang('pt-BR', doc), false)
  assert.equal(syncDocumentLang('en-US', doc), true)
  assert.equal(doc.documentElement.lang, 'en-US')
  assert.equal(syncDocumentLang('pt-BR', doc), true)
  assert.equal(doc.documentElement.lang, 'pt-BR')
})

test('skip link: é o primeiro filho do app, aponta para o <main> focável e está estilizado', () => {
  const app = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8')
  assert.ok(app.indexOf('<SkipLink />') > 0 && app.indexOf('<SkipLink />') < app.indexOf('<Sidebar />'))
  assert.match(app, /<main className="app-main" id=\{MAIN_ID\} tabIndex=\{-1\}/)
  assert.ok(app.includes('syncDocumentLang(locale)'))
  const skip = readFileSync(join(ROOT, 'src/a11y/SkipLink.tsx'), 'utf8')
  assert.ok(skip.includes('Pular para o conteúdo') && skip.includes('Skip to content'))
  assert.ok(a11yCss.includes('.np-skip-link'))
})
