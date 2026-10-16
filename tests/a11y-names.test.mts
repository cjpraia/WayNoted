// Acessibilidade — nomes acessíveis: nenhum <button> só com ícone/símbolo sem aria-label/title, landmarks e regiões vivas
// nas telas-chave (verificação estática do código-fonte; a medição na árvore de acessibilidade está em docs/USAGE.md).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
function tsx(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) tsx(full, out)
    else if (name.endsWith('.tsx')) out.push(full)
  }
  return out
}
/** Índice do `>` que fecha a tag aberta em `start`, ignorando chaves e aspas. */
function tagEnd(source: string, start: number): number {
  let depth = 0, quote: string | null = null
  for (let i = start; i < source.length; i++) {
    const c = source[i]
    if (quote) { if (c === quote && source[i - 1] !== '\\') quote = null; continue }
    if (depth > 0 && (c === '"' || c === "'" || c === '`')) { quote = c; continue }
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (depth === 0 && c === '"') quote = c
    else if (depth === 0 && c === '>' && source[i - 1] !== '=') return i
  }
  return -1
}
/** <button> cujo conteúdo não tem texto visível (só ícones) e que não tem aria-label/aria-labelledby/title/spread. */
export function unnamedButtons(source: string): number[] {
  const lines: number[] = []
  for (const match of source.matchAll(/<button\b/g)) {
    const end = tagEnd(source, match.index)
    if (end < 0) continue
    const tag = source.slice(match.index, end + 1)
    if (/aria-label(ledby)?=|\btitle=|\{\.\.\./.test(tag) || tag.endsWith('/>')) continue
    const close = source.indexOf('</button>', end)
    if (close < 0) continue
    const inner = source.slice(end + 1, close).replace(/<[A-Za-z][^<>]*?\/>/g, '').replace(/<\/?[A-Za-z][^<>]*>/g, '')
    const text = inner.replace(/\{[^{}]*\}/g, expr => /t\(|label|name|title|text|children|\w+\(/i.test(expr) ? 'X' : '')
    if (!/[A-Za-zÀ-ÿ0-9]/.test(text)) lines.push(source.slice(0, match.index).split('\n').length)
  }
  return lines
}

// Botões sem texto próprio cujo nome vem do conteúdo de elementos filhos (chips/ícones nomeados): revisados à mão.
const REVIEWED = new Set(['src/components/database/PropertyMenu.tsx', 'src/components/database/ViewControls.tsx', 'src/components/database/views/CalendarView.tsx', 'src/components/database/views/ExtraViews.tsx', 'src/components/graph/LocalGraphPanel.tsx', 'src/components/query/QueryBuilder.tsx'])

test('nenhum <button> só com ícone ou símbolo fica sem nome acessível', () => {
  const failures: string[] = []
  for (const file of tsx(join(ROOT, 'src'))) {
    const rel = relative(ROOT, file)
    if (REVIEWED.has(rel)) continue
    for (const line of unnamedButtons(readFileSync(file, 'utf8'))) failures.push(`${rel}:${line}`)
  }
  assert.deepEqual(failures, [])
})

test('o detector enxerga um botão de ícone sem nome e aceita aria-label/title/texto', () => {
  assert.equal(unnamedButtons('<button onClick={go}><Plus size={14} /></button>').length, 1)
  assert.equal(unnamedButtons('<button>＋</button>').length, 1)
  assert.equal(unnamedButtons('<button aria-label="x"><Plus /></button>').length, 0)
  assert.equal(unnamedButtons('<button title={t("a","b")}><Plus /></button>').length, 0)
  assert.equal(unnamedButtons('<button>{t("a","b")}</button>').length, 0)
})

test('IconButton exige label (vira aria-label e dica)', () => {
  const button = read('src/components/ui/Button.tsx')
  assert.match(button, /IconButton[\s\S]*label: string/)
  assert.match(button, /aria-label=\{label\}/)
})

test('landmarks: complementary (barra lateral) com navigation, main nomeado e skip link antes de tudo', () => {
  const sidebar = read('src/components/sidebar/Sidebar.tsx')
  assert.match(sidebar, /<aside[\s\S]*aria-label=\{t\("Barra lateral", "Sidebar"\)\}/)
  assert.match(sidebar, /<nav className="sb-fixed" aria-label=/)
  assert.match(sidebar, /role="tree"[\s\S]{0,80}aria-multiselectable/)
  const app = read('src/App.tsx')
  assert.match(app, /<main className="app-main" id=\{MAIN_ID\} tabIndex=\{-1\} aria-label=/)
  const topbar = read('src/components/page/Topbar.tsx')
  assert.equal((topbar.match(/<nav className="pg-crumbs" aria-label=/g) ?? []).length, 2)
  assert.ok(topbar.includes("aria-current={current ? 'page' : undefined}"))
})

test('avisos (toast): região viva sempre montada, erros como alert', () => {
  const toast = read('src/components/ui/Toast.tsx')
  assert.match(toast, /className="np-toasts" aria-live="polite"/)
  assert.ok(!/if \(!items\.length\) return null/.test(toast), 'a região viva não pode desmontar quando vazia')
  assert.ok(toast.includes("role={item.tone === 'error' ? 'alert' : undefined}"))
  assert.ok(toast.includes('aria-label={t(\'Fechar aviso\''))
})

test('busca ⌘K: combobox + listbox + opções com aria-selected e contagem de resultados anunciada', () => {
  const search = read('src/components/modals/SearchModal.tsx')
  for (const needle of ['role="combobox"', 'aria-autocomplete="list"', 'aria-activedescendant', 'role="listbox"', 'role="option"', 'aria-selected={index === active}', 'role="dialog" aria-modal="true"']) assert.ok(search.includes(needle), needle)
  assert.match(search, /np-sr-only" role="status" aria-live="polite"/)
})

test('tabela de banco: grid com contagem de linhas/colunas, posição, seleção e ordenação anunciadas', () => {
  const table = read('src/components/database/TableView.tsx')
  for (const needle of ['role="grid"', 'aria-rowcount={rows.length + 1}', 'aria-colcount=', 'aria-activedescendant={activeDomId}', 'role="columnheader"', 'aria-sort=', 'role="rowgroup"', 'aria-rowindex={props.rowIndex}', 'role="gridcell"', 'aria-colindex={props.colIndex}']) assert.ok(table.includes(needle), needle)
})

test('Configurações: diálogo modal nomeado com foco preso e devolvido', () => {
  const settings = read('src/components/modals/SettingsModal.tsx')
  for (const needle of ['role="dialog" aria-modal="true"', "e.key === 'Escape'", "e.key === 'Tab'", 'previous?.focus()']) assert.ok(settings.includes(needle), needle)
})

test('todo diálogo modal (atributo JSX role="dialog") tem nome via aria-label/aria-labelledby', () => {
  const failures: string[] = []
  for (const file of tsx(join(ROOT, 'src'))) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/\srole="dialog"/g)) {
      const end = tagEnd(source, source.lastIndexOf('<', match.index))
      const tag = source.slice(source.lastIndexOf('<', match.index), end + 1)
      if (!/aria-label(ledby)?=/.test(tag)) failures.push(`${relative(ROOT, file)}: diálogo sem nome`)
    }
  }
  assert.deepEqual(failures, [])
})
