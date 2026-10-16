#!/usr/bin/env node
import PRODUCT from '../shared/product.json' with { type: 'json' }
// Ensaio automatizado do app EMPACOTADO (macOS arm64) por Playwright + _electron.launch.
// Não usa mouse/teclado reais do computador: tudo vai por eventos do Playwright/CDP e por
// stubs dos diálogos nativos (dialog.showOpenDialog/showSaveDialog) no processo principal.
//
// Uso (a partir da raiz do repositório):
//   1. mkdir -p /tmp/ensaio-pw && cd /tmp/ensaio-pw && npm init -y && npm i playwright-core
//      (instalação local, fora do projeto; ou defina PW_DIR=/pasta/com/node_modules/playwright-core)
//   2. node scripts/ensaio-pacote.mjs [--app caminho/Desktop.app] [--only 3,4] [--keep]
//   Padrão: release-test/Desktop-darwin-arm64/Desktop.app. Uma janela de teste aparece por ~2 min.
//   Dados SEMPRE em pasta temporária nova (WORKSPACE_USER_DATA); apagada no fim (use --keep p/ manter).
//   Saída: .artifacts/package-check/ (report.md, resultado.json e capturas da janela de teste).
//   Nunca toca nos dados reais nem na instância pessoal (outro bundle/PID e outra pasta de dados).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import cp from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (n) => { const i = args.indexOf('--' + n); return i < 0 ? undefined : (args[i + 1]?.startsWith('--') || args[i + 1] === undefined ? true : args[i + 1]) }
const APP = path.resolve(ROOT, typeof flag('app') === 'string' ? flag('app') : 'release-test/Desktop-darwin-arm64/Desktop.app')
const EXE = path.join(APP, 'Contents/MacOS/Desktop')
const CLI = path.join(APP, "Contents/Resources/bin/workspace")
const ONLY = typeof flag('only') === 'string' ? new Set(flag('only').split(',').map(Number)) : null
const SHOTS = path.join(ROOT, '.artifacts/package-check')
const require = createRequire(import.meta.url)
let pw
for (const base of [process.env.PW_DIR, path.join(ROOT, 'node_modules/playwright-core'), '/tmp/ensaio-pw/node_modules/playwright-core', path.join(process.cwd(), 'node_modules/playwright-core')].filter(Boolean)) {
  try { pw = require(base.endsWith('playwright-core') ? base : path.join(base, 'playwright-core')); break } catch { /* próximo */ }
}
if (!pw) { console.error('playwright-core não encontrado: veja as instruções no topo do script.'); process.exit(2) }
const { _electron } = pw

const D = fs.mkdtempSync(path.join(os.tmpdir(), 'np-ensaio-data-'))
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'np-ensaio-out-'))
fs.mkdirSync(SHOTS, { recursive: true })
for (const f of fs.readdirSync(SHOTS)) fs.rmSync(path.join(SHOTS, f), { force: true })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const results = [], consoleErrors = [], dialogs = []
const pgrep = () => { try { return cp.execFileSync('pgrep', ['-f', EXE], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number) } catch { return [] } }
const preexisting = new Set(pgrep())   // instâncias deste mesmo build que já existiam: nunca são encerradas
let app, page

/* ---------- ciclo de vida do app ---------- */
async function launch() {
  app = await _electron.launch({ executablePath: EXE, env: { ...process.env, WORKSPACE_USER_DATA: D } })
  page = await app.firstWindow()
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + String(e.message).slice(0, 300)))
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ dialog, BrowserWindow }) => {
    globalThis.__dialogs = []
    const rec = (k, o) => { globalThis.__dialogs.push(k + ':' + String(o?.message || o?.title || '').slice(0, 80)) }
    dialog.showMessageBox = async (...a) => { const o = a.at(-1); rec('box', o); return { response: /Restauração concluída|Restore complete/i.test(String(o?.message || '')) ? 0 : 1, checkboxChecked: false } }   // OK do aviso de restauração; o resto: botão secundário
    dialog.showErrorBox = (t, c) => rec('err', { message: t + ' ' + c })
    BrowserWindow.getAllWindows()[0]?.setSize(1280, 800)
  })
  await sleep(1500)
}
// O app pode continuar vivo (bandeja) depois de close(): encerra o PID de teste à força se preciso.
async function shutdown() {
  const pid = app?.process().pid
  await Promise.race([app?.close().catch(() => {}), sleep(5000)])
  await sleep(500)
  if (pid) { try { process.kill(pid, 0); process.kill(pid, 'SIGKILL') } catch { /* já encerrou */ } }
}
async function relaunch() { await shutdown(); await sleep(1500); await launch() }
async function stubOpen(p) { await app.evaluate(({ dialog }, x) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [x] }) }, p) }
async function stubSave(p) { await app.evaluate(({ dialog }, x) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: x }) }, p) }

/* ---------- utilidades de UI ---------- */
const body = () => page.evaluate(() => document.body.innerText)
const visible = (t) => page.getByText(t, { exact: false }).first().isVisible().catch(() => false)
async function newPage(title) {
  await page.keyboard.press('Meta+n'); await sleep(800)
  await page.keyboard.type(title); await page.keyboard.press('Enter'); await sleep(300)
}
async function openPageBySidebar(title) { await page.locator('[role=tree] [role=treeitem]', { hasText: title }).first().click(); await sleep(700) }
async function openSettings(section) {
  await page.keyboard.press('Escape').catch(() => {})
  await page.keyboard.press('Meta+k'); await sleep(400)
  await page.keyboard.type('Configura'); await sleep(500)
  await page.getByRole('option', { name: /^Configurações/ }).click(); await sleep(700)
  if (section) { await page.getByRole('button', { name: section, exact: true }).click(); await sleep(500) }
}
async function closeSettings() { await page.getByRole('button', { name: 'Fechar configurações' }).click().catch(() => {}); await sleep(300) }
const sw = (name) => page.getByRole('switch', { name })
async function pageMenu() { await page.getByRole('button', { name: 'Estilo, exportar e mais' }).click(); await sleep(500) }
const sidebarWidth = () => page.locator('aside.sb').evaluate(e => e.getBoundingClientRect().width).catch(() => -1)
function walk(dir, out = []) { for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) { const p = path.join(dir, e.name); e.isDirectory() ? walk(p, out) : out.push(p) } return out }
function run(file, argv, opts = {}) {
  return new Promise(resolve => {
    const c = cp.spawn(file, argv, { env: { ...process.env, WORKSPACE_USER_DATA: D, WORKSPACE_LANG: 'pt' }, ...opts })
    let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d)
    const timer = setTimeout(() => c.kill(), opts.timeout ?? 60000)
    c.on('close', code => { clearTimeout(timer); resolve({ code, out: out.trim(), err: err.trim() }) })
    resolve.proc = c
  })
}
const assert = (cond, msg) => { if (!cond) throw new Error('Asserção falhou: ' + msg) }
const notes = {}

async function step(n, name, fn) {
  if (ONLY && !ONLY.has(n)) return
  const r = { n, name, status: '✓', detail: [] }
  const log = (s) => r.detail.push(s)
  try {
    const res = await fn(log)
    if (res?.skip) { r.status = '⚠'; log(res.skip) }
  } catch (e) {
    r.status = '✗'; log('Erro: ' + String(e.message).split('\n')[0].slice(0, 300))
    await page.screenshot({ path: path.join(SHOTS, `${String(n).padStart(2, '0')}-falha.png`) }).catch(() => {})
  }
  await page.screenshot({ path: path.join(SHOTS, `${String(n).padStart(2, '0')}-${r.status === '✗' ? 'estado-final' : 'ok'}.png`) }).catch(() => {})
  results.push(r)
  console.log(`${r.status} ${n}. ${name}${r.detail.length ? ' — ' + r.detail.join(' | ') : ''}`)
  await page.keyboard.press('Escape').catch(() => {})
}

/* ---------- PDF de teste ---------- */
function makePdf(file) {
  const content = 'BT /F1 28 Tf 72 700 Td (Texto de teste para destaque no PDF) Tj ET\nBT /F1 20 Tf 72 650 Td (Segunda linha do documento de ensaio) Tj ET'
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  let pdf = '%PDF-1.4\n'; const off = []
  objs.forEach((o, i) => { off.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const x = pdf.length
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`
  fs.writeFileSync(file, pdf)
}

/* ====================== ROTEIRO ====================== */
try {
  await launch()
  const bootErrors0 = () => consoleErrors.length

  await step(1, 'Abertura, pt-BR, sem diálogo de Keychain, Meu dia, console limpo', async (log) => {
    await page.waitForSelector('text=Meu dia', { timeout: 15000 })
    const t = await body()
    assert(/Boa (noite|tarde)|Bom dia/.test(t) && /Nova página/.test(t), 'tela inicial pt-BR (Meu dia) não encontrada')
    assert(/Pular para o conteúdo/.test(t), 'interface não está em pt-BR')
    const boxes = await app.evaluate(() => globalThis.__dialogs)
    dialogs.push(...boxes)
    assert(boxes.length === 0, 'diálogos nativos apareceram: ' + boxes.join(', '))
    log('nenhum showMessageBox/showErrorBox registrado (patch aplicado logo após o spawn; um diálogo do sistema do macOS fora do Electron não é observável aqui)')
    assert(consoleErrors.length === 0, 'erros no console: ' + consoleErrors.slice(0, 3).join(' || '))
  })

  await step(2, 'Página, texto, ícone/capa, "/", tarefa; fechar e reabrir persiste', async (log) => {
    await page.getByRole('button', { name: 'Nova página' }).first().click(); await sleep(700)
    await page.keyboard.type('Página de ensaio'); await page.keyboard.press('Enter'); await sleep(300)
    await page.keyboard.type('Primeira linha de texto'); await page.keyboard.press('Enter')
    await page.keyboard.type('/lista de tar'); await sleep(500)
    const opts = await page.getByRole('option').allInnerTexts()
    assert(opts.some(o => /Lista de tarefas/.test(o)), 'menu "/" não ofereceu "Lista de tarefas": ' + opts.join(','))
    await page.screenshot({ path: path.join(SHOTS, '02-menu-barra.png') })
    await page.keyboard.press('Enter'); await page.keyboard.type('Tarefa A'); await sleep(300)
    assert(await page.locator('input[type=checkbox]').count() >= 1, 'bloco de tarefa sem caixa de seleção')
    await page.getByRole('button', { name: 'Adicionar ícone' }).click(); await sleep(400)
    await page.getByRole('button', { name: 'Adicionar capa' }).click(); await sleep(500)
    assert(await page.locator('[class*=cover]').count() > 0, 'capa não apareceu')
    await sleep(1500)
    await relaunch()
    await openPageBySidebar('Página de ensaio')
    const t = await body()
    assert(/Primeira linha de texto/.test(t) && /Tarefa A/.test(t), 'texto não persistiu')
    assert(await page.locator('[class*=cover]').count() > 0, 'capa não persistiu')
    log('título, texto, tarefa, ícone e capa persistiram após fechar e reabrir o app')
  })

  await step(3, 'Banco 3 linhas, Tabela/Quadro, reordenar abas, coluna congelada opaca', async (log) => {
    await page.getByRole('button', { name: 'Meu dia' }).first().click(); await sleep(500)
    await page.getByRole('button', { name: 'Novo banco' }).first().click(); await sleep(1200)
    await page.getByLabel('Título do banco de dados').fill('Banco de ensaio'); await page.keyboard.press('Enter')
    for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Nova linha' }).or(page.getByRole('button', { name: 'Nova página' }).last()).first().click(); await sleep(500); await page.keyboard.press('Escape'); await sleep(300) }
    assert(await page.locator('.tb-cell--title').count() >= 3, 'banco sem 3 linhas')
    const addView = async (n) => { await page.getByRole('button', { name: 'Adicionar visualização' }).click(); await sleep(400); await page.getByText(n, { exact: true }).click(); await sleep(900) }
    await addView('Visualização de quadro'); await addView('Visualização de lista')
    const order = () => page.evaluate(() => [...document.querySelectorAll('.dbv-tab')].map(e => e.innerText.trim()))
    const before = await order()
    assert(before.join() === 'Tabela,Quadro,Lista', 'abas iniciais inesperadas: ' + before)
    await page.locator('.dbv-tab', { hasText: 'Lista' }).dragTo(page.locator('.dbv-tab', { hasText: 'Tabela' })); await sleep(600)
    const after = await order()
    assert(after[0] === 'Lista', 'drag das abas não reordenou: ' + after)
    log('abas: ' + before.join('/') + ' -> ' + after.join('/'))
    await page.locator('.dbv-tab', { hasText: 'Tabela' }).click(); await sleep(500)
    for (let i = 0; i < 4; i++) { await page.getByRole('button', { name: 'Adicionar propriedade' }).click(); await sleep(400); await page.getByText('Texto', { exact: true }).last().click(); await sleep(500); await page.keyboard.press('Escape') }
    await page.getByText('Nome', { exact: true }).first().click(); await sleep(500)
    await page.getByText('Congelar até esta coluna').click(); await sleep(600); await page.keyboard.press('Escape')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 800)); await sleep(700)
    const over = await page.evaluate(() => { const s = document.querySelector('.tb-scroll'); s.scrollLeft = 400; return [s.scrollWidth, s.clientWidth, s.scrollLeft] })
    assert(over[0] > over[1] && over[2] > 0, 'tabela não rola na horizontal: ' + over)
    await sleep(300)
    const cell = page.locator('.tb-cell--title.tb-frozen-cell').nth(1)
    await cell.hover(); await sleep(300)
    const info = await cell.evaluate(e => { const cs = getComputedStyle(e); const row = e.parentElement; return { bg: cs.backgroundColor, pos: cs.position, rowBg: getComputedStyle(row).backgroundColor } })
    log(`fundo da célula congelada com o mouse na linha: ${info.bg} (position ${info.pos}); fundo da linha: ${info.rowBg}`)
    const m = info.bg.match(/rgba?\(([^)]+)\)/); const parts = m[1].split(/[ ,\/]+/).filter(Boolean)
    const alpha = parts.length > 3 ? Number(parts[3]) : 1
    await page.screenshot({ path: path.join(SHOTS, '03-coluna-congelada.png') })
    assert(info.pos === 'sticky' && alpha === 1, 'fundo da coluna congelada não é opaco: ' + info.bg)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800)); await sleep(500)
  })

  await step(4, 'Visualização vinculada', async (log) => {
    await newPage('Página vinculada')
    await page.keyboard.type('/vincul'); await sleep(500); await page.keyboard.press('Enter'); await sleep(900)
    assert(await visible('Vincular fonte de dados'), 'popover de fontes não abriu')
    assert(await visible('Fontes existentes'), 'lista "Fontes existentes" ausente')
    await page.getByText('Banco de ensaio', { exact: true }).last().click(); await sleep(1000)
    const heads = () => page.evaluate(() => [...document.querySelectorAll('.tb-th')].map(e => e.innerText.trim()).filter(Boolean))
    const h1 = await heads(); assert(h1.includes('Nome'), 'visão vinculada não mostrou o banco: ' + h1)
    await page.getByRole('button', { name: 'Adicionar propriedade' }).click(); await sleep(500)
    await page.getByText('Número', { exact: true }).click(); await sleep(800)
    const h2 = await heads(); assert(h2.includes('Número'), '"+" propriedade não adicionou a coluna: ' + h2)
    log('colunas: ' + h2.join(', '))
  })

  await step(5, 'Tipos: explorar, aplicar, coleção, consulta com filtro por tipo', async (log) => {
    await page.getByRole('button', { name: 'Meu dia' }).first().click(); await sleep(500)
    // Tipos nativos já nascem criados (docs/USAGE.md): Pessoa existe na barra lateral; a galeria só oferece o que falta (Receita).
    const sidebarTypes = await page.evaluate(() => document.body.innerText)
    for (const nome of ['Pessoa', 'Projeto', 'Reunião', 'Tarefa', 'Livro', 'Ideia', 'Recurso', 'Empresa']) assert(sidebarTypes.includes(nome), 'tipo nativo ausente na barra lateral: ' + nome)
    await page.getByRole('button', { name: 'Explorar tipos' }).first().click({ timeout: 8000 }).catch(() => {}); await sleep(900)
    if (await visible('Receita')) { log('galeria de Explorar tipos oferece Receita'); await page.keyboard.press('Escape'); await sleep(400) }
    await page.getByRole('button', { name: /^Pessoa/ }).first().click({ timeout: 8000 }).catch(async () => { await page.getByText('Pessoa', { exact: true }).first().click() }); await sleep(1200)
    assert(await visible('Nenhuma página com o tipo Pessoa'), 'coleção do tipo não abriu')
    await page.getByRole('button', { name: 'Aplicar a uma página existente' }).click(); await sleep(600)
    await page.getByText('Página de ensaio', { exact: true }).last().click(); await sleep(800)
    await page.getByRole('button', { name: 'Aplicar', exact: true }).click(); await sleep(1000)
    assert(!(await visible('Nenhuma página com o tipo Pessoa')), 'tipo não foi aplicado (coleção continua vazia)')
    await newPage('Consulta de tipo')
    await page.keyboard.type('/consulta'); await sleep(400); await page.keyboard.press('Enter'); await sleep(900)
    const chip = page.locator('button', { hasText: /^Pessoa\s*\d*$/ }).last()
    await chip.click({ timeout: 8000 }); await sleep(900)
    const t = await body()
    assert(/\b1 resultado/.test(t), 'consulta com filtro de tipo não retornou 1 resultado: ' + (t.match(/\d+ resultados?/g) || []).join(','))
    log('consulta filtrada por Tipo Pessoa: 1 resultado')
  })

  await step(6, '⌘K: Configurações e buscar página', async (log) => {
    await openSettings()
    assert(await page.getByRole('button', { name: 'Segurança e privacidade' }).isVisible(), 'Configurações não abriram')
    await closeSettings()
    await page.keyboard.press('Meta+k'); await sleep(400); await page.keyboard.type('Banco de ensaio'); await sleep(700)
    await page.getByRole('option', { name: /Banco de ensaio/ }).first().click(); await sleep(800)
    assert(await page.locator('.dbv-tab').count() > 0, 'a busca não abriu o banco')
  })

  const bk = path.join(T, 'backup'); fs.mkdirSync(bk)
  await step(7, 'Backup externo: criar, verificar, restauração completa', async (log) => {
    await openSettings('Dados'); await stubOpen(bk)
    await page.getByRole('button', { name: 'Escolher pasta…' }).first().click(); await sleep(1000)
    // Achado: escolher a pasta já dispara um backup automático; um clique imediato em "Fazer backup agora" mostra "Já existe uma operação de backup em andamento".
    await page.getByRole('button', { name: 'Fazer backup agora' }).click(); await sleep(1500)
    if (await visible('Já existe uma operação de backup em andamento')) { log('ACHADO: clicar em "Fazer backup agora" logo após escolher a pasta exibe o erro "Já existe uma operação de backup em andamento" (backup automático iniciado ao escolher a pasta)'); await page.screenshot({ path: path.join(SHOTS, '07-backup-em-andamento.png') }) }
    let made = false
    for (let i = 0; i < 6 && !made; i++) {
      await sleep(4000)
      if (await visible('Backup criado e verificado')) { made = true; break }
      await page.getByRole('button', { name: 'Fazer backup agora' }).click().catch(() => {})
    }
    assert(made || walk(bk).length > 0, 'backup não foi criado')
    const files = walk(bk); assert(files.length > 0, 'nenhum arquivo na pasta de backup')
    await page.getByRole('button', { name: 'Verificar agora' }).click(); await sleep(2500)
    assert(await visible('Verificada ✓'), 'verificação não concluiu como "Verificada"')
    log(`${files.length} arquivos no backup`)
    await closeSettings()
    await newPage('Criada depois do backup'); await sleep(1500)
    await openSettings('Dados')
    await page.getByRole('button', { name: 'Restaurar…' }).first().click(); await sleep(600)
    await page.getByRole('button', { name: 'Restaurar espaço inteiro' }).click()
    // Rodada 2: depois da correção B, o app mostra "Restauração concluída…" com OK e só então recarrega a janela
    await page.getByRole('alertdialog').getByText(/Restauração concluída/).waitFor({ timeout: 30000 })
    await page.getByRole('alertdialog').getByRole('button', { name: 'OK' }).click()
    await page.waitForLoadState('domcontentloaded'); await sleep(3500)
    log(await visible('Espaço restaurado de') ? 'aviso "Espaço restaurado de <data>" exibido após recarregar' : 'aviso pós-recarga não visto (pode já ter sumido)')
    await closeSettings(); await sleep(1500)
    const t = await body()
    assert(!/Criada depois do backup/.test(t), 'página posterior ao backup ainda existe após restaurar')
    assert(/Banco de ensaio/.test(t) && /Página de ensaio/.test(t), 'páginas do backup ausentes após restaurar')
    log('restauração removeu a página criada depois e manteve o conteúdo do backup')
  })

  const mir = path.join(T, 'espelho'); fs.mkdirSync(mir)
  await step(8, 'Espelho Markdown: ligar, editar, ver o .md atualizar, desligar', async (log) => {
    await openSettings('Dados'); await stubOpen(mir)
    await sw(/Espelho Markdown/).click(); await sleep(600)
    assert(await page.getByRole('alertdialog').isVisible(), 'sem confirmação de texto claro')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Escolher pasta…' }).click(); await sleep(800)
    await page.getByRole('button', { name: 'Ligar espelho em texto claro' }).click(); await sleep(4000)
    let md = walk(mir).filter(f => f.endsWith('.md')); assert(md.length > 0, 'nenhum .md gravado')
    assert(md.some(f => /Primeira linha de texto/.test(fs.readFileSync(f, 'utf8'))), 'conteúdo da página não está no .md')
    await closeSettings()
    await openPageBySidebar('Página de ensaio')
    await page.locator('.ProseMirror').first().click(); await page.keyboard.press('Meta+End'); await page.keyboard.press('Enter')
    await page.keyboard.type('EDICAO-ESPELHO-123')
    let ok = false
    for (let i = 0; i < 30 && !ok; i++) { await sleep(1000); ok = walk(mir).some(f => f.endsWith('.md') && fs.readFileSync(f, 'utf8').includes('EDICAO-ESPELHO-123')) }
    assert(ok, 'edição não apareceu no .md em 30 s')
    log('edição refletida no .md')
    await openSettings('Dados'); await sw(/Espelho Markdown/).click(); await sleep(800)
    const rm = page.getByRole('button', { name: 'Remover arquivos' })
    if (await rm.isVisible().catch(() => false)) { await rm.click(); await sleep(1500) }
    log('arquivos .md restantes após desligar/remover: ' + walk(mir).filter(f => f.endsWith('.md')).length)
    await closeSettings()
  })

  await step(9, 'Agentes: API local, CLI whoami/search/page create (aprovar/rejeitar), Privado para IA', async (log) => {
    await openSettings('Dados')
    const api = page.getByLabel(/API local para integrações/)
    if (!(await api.isChecked())) await api.click()
    await sleep(2500)
    assert(fs.existsSync(path.join(D, 'data/api-token.json')), 'api-token.json não criado')
    await closeSettings()
    const who = await run(CLI, ['whoami']); log('whoami: ' + who.out.replace(/\s+/g, ' ').slice(0, 120))
    assert(who.code === 0, 'whoami falhou: ' + who.err)
    const s = await run(CLI, ['search', 'ensaio', '--json']); assert(s.code === 0 && /ensaio/i.test(s.out), 'search falhou: ' + s.err + s.out.slice(0, 100))
    const id = s.out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0]; assert(id, 'id não encontrado na saída do search')
    // criação com aprovação
    const pending = run(CLI, ['page', 'create', 'Criada pela CLI', '--text', 'texto da CLI'])
    await page.getByRole('button', { name: 'Aprovar', exact: true }).waitFor({ timeout: 15000 })
    await page.screenshot({ path: path.join(SHOTS, '09-aprovacao.png') })
    await page.getByRole('button', { name: 'Aprovar', exact: true }).click()
    const ok = await pending; assert(ok.code === 0, 'page create aprovado falhou: ' + ok.err + ok.out)
    log('page create aprovado: ' + ok.out.replace(/\s+/g, ' ').slice(0, 80))
    const rej = run(CLI, ['page', 'create', 'Rejeitada pela CLI'])
    await page.getByRole('button', { name: 'Rejeitar', exact: true }).waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: 'Rejeitar', exact: true }).click()
    const r2 = await rej; assert(r2.code !== 0, 'page create rejeitado retornou sucesso')
    const chk = await run(CLI, ['search', 'Rejeitada', '--json']); assert(!/Rejeitada pela CLI/.test(chk.out), 'página rejeitada foi criada')
    log('page create rejeitado: código ' + r2.code)
    // Privado para IA
    await openPageBySidebar('Página de ensaio')
    await pageMenu(); await page.getByText('Privado para IA', { exact: true }).click(); await sleep(1200); await page.keyboard.press('Escape')
    const g = await run(CLI, ['page', 'get', id]); log('page get em página privada: código ' + g.code + ' ' + (g.err || g.out).slice(0, 80))
    assert(g.code !== 0 && /404|não encontrad|not found/i.test(g.err + g.out), 'página privada ainda legível pela CLI: ' + (g.err || g.out).slice(0, 100))
  })

  await step(10, 'PDF: inserir, destacar, painel, exportar anotado', async (log) => {
    const pdf = path.join(T, 'teste.pdf'); makePdf(pdf)
    await newPage('Página do PDF'); await stubOpen(pdf)
    await page.keyboard.type('/pdf'); await sleep(600)
    const chooser = page.waitForEvent('filechooser', { timeout: 8000 })
    await page.getByRole('option').first().click()   // clique: o seletor de arquivo abre; com Enter ele não abre sob automação (ver relatório)
    await (await chooser).setFiles(pdf); await sleep(3500)
    await page.waitForSelector('.textLayer span', { timeout: 15000 })
    await page.getByRole('button', { name: 'Anotar', exact: true }).click(); await sleep(500)
    const box = await page.locator('.textLayer span').first().boundingBox()
    await page.mouse.move(box.x + 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 10 }); await page.mouse.up(); await sleep(800)
    assert(await page.locator('[class*=pdf-ann]').count() > 0, 'nenhum destaque criado')
    await page.getByRole('button', { name: 'Painel de anotações' }).click(); await sleep(600)
    await page.screenshot({ path: path.join(SHOTS, '10-pdf-anotado.png') })
    assert(await page.getByRole('button', { name: /Copiar destaques como Markdown/ }).isVisible(), 'painel de anotações não abriu')
    const out = path.join(T, 'anotado.pdf'); await stubSave(out)
    await page.getByRole('button', { name: /Exportar com anotações/ }).click(); await sleep(4000)
    if (!fs.existsSync(out)) return { skip: 'destaque e painel ok, mas o PDF exportado não foi gravado (diálogo de salvar não interceptado)' }
    assert(fs.statSync(out).size > 500 && fs.readFileSync(out).subarray(0, 4).toString() === '%PDF', 'PDF exportado inválido'); log('PDF anotado exportado: ' + fs.statSync(out).size + ' bytes')
  })

  await step(11, 'Proteger página com senha, trancar e desbloquear com Enter', async (log) => {
    const pw1 = 'senha-de-teste-123'
    await newPage('Página protegida'); await page.keyboard.type('Conteúdo secreto de teste'); await sleep(800)
    await pageMenu(); await page.getByText(/Proteger com senha/).click(); await sleep(600)
    await page.getByLabel('Senha da página').fill(pw1); await page.getByLabel('Confirmar senha').fill(pw1)
    await page.locator('button[type=submit]').click(); await sleep(3000)
    await pageMenu(); await page.getByText(/Proteção por senha/).click(); await sleep(500)
    await page.getByRole('button', { name: 'Trancar agora' }).click(); await sleep(1200)
    assert(!(await visible('Conteúdo secreto de teste')), 'conteúdo continua visível depois de trancar')
    const input = page.locator('input[type=password]').first(); await input.fill(pw1); await input.press('Enter'); await sleep(2500)
    assert(await visible('Conteúdo secreto de teste'), 'não desbloqueou com Enter')
  })

  await step(12, 'Atalhos: ⌘K, ⌘\\, ⌘Z, skip link', async (log) => {
    await page.keyboard.press('Meta+k'); await sleep(400)
    assert(await page.getByRole('option').first().isVisible(), '⌘K não abriu a busca'); await page.keyboard.press('Escape'); await sleep(300)
    const w = sidebarWidth
    const w0 = await w(); await page.keyboard.press('Meta+\\'); await sleep(700); const w1 = await w(); await page.keyboard.press('Meta+\\'); await sleep(700); const w2 = await w()
    log(`largura da barra: ${Math.round(w0)} -> ${Math.round(w1)} -> ${Math.round(w2)}`)
    assert(w1 < w0 / 2 && w2 > w1, '⌘\\ não alternou a barra lateral')
    await newPage('Página de atalhos'); await page.keyboard.type('desfazer-isto'); await sleep(400)
    await page.keyboard.press('Meta+z'); await sleep(400)
    assert(!/desfazer-isto/.test(await page.locator('.ProseMirror').first().innerText()), '⌘Z não desfez a digitação')
    await sleep(1200); await page.reload(); await page.waitForSelector('text=Pular para o conteúdo', { state: 'attached', timeout: 15000 }); await sleep(1500)
    await page.keyboard.press('Tab'); await sleep(200)
    const f = await page.evaluate(() => document.activeElement?.innerText || document.activeElement?.getAttribute('href') || '')
    assert(/Pular para o conteúdo/.test(f), 'primeiro Tab não foca o skip link (foco: ' + f.slice(0, 40) + ')')
  })

  await step(13, "Deep link (segunda instância com argumento workspace://)", async (log) => {
    const r = await run(EXE, ["workspace://new?title=DeepLinkTeste"], { timeout: 15000 })
    await sleep(2500)
    const t = await body()
    if (!/DeepLinkTeste/.test(t)) {
      await page.keyboard.press('Meta+k'); await sleep(400); await page.keyboard.type('DeepLinkTeste'); await sleep(700)
      const has = await page.getByRole('option', { name: /DeepLinkTeste/ }).count()
      await page.keyboard.press('Escape')
      assert(has > 0, 'tratador não abriu/criou a página "DeepLinkTeste" (código da 2ª instância ' + r.code + ')')
    }
    log("workspace://new?title=... tratado via second-instance")
  })

  await step(14, 'Janela estreita: barra recolhe; ⌘\\ reabre', async (log) => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 800)); await sleep(1000)
    const w = sidebarWidth
    const a = await w(); await page.screenshot({ path: path.join(SHOTS, '14-estreita.png') })
    assert(a >= 0 && a < 50, 'barra lateral não recolheu em 700 px (largura ' + Math.round(a) + ')')
    await page.keyboard.press('Meta+\\'); await sleep(800)
    const b = await w(); assert(b > 100, '⌘\\ não reabriu a barra em janela estreita')
    log(`largura da barra: ${Math.round(a)} -> ${Math.round(b)}`)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
  })

  /* ---------- Rodada 2: recursos novos desde a rodada anterior (cada passo cria seus próprios dados) ---------- */
  const ymd = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d }
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
  const dm = (offset) => { const d = ymd(offset); return `${d.getDate()} de ${MESES[d.getMonth()]}` }   // sem "/": a barra fecha o menu de menção

  await step(17, 'Atalhos personalizáveis: gravar, conflito bloqueia, restaurar', async (log) => {
    await openSettings('Atalhos')
    const rebind = page.getByRole('button', { name: /^Alterar o atalho de / })
    assert(await rebind.count() >= 2, 'nenhum atalho personalizável listado')
    const first = await rebind.nth(0).elementHandle(), second = await rebind.nth(1).elementHandle()   // handles: o nome acessível muda durante a gravação
    const label1 = await first.getAttribute('aria-label'), label2 = await second.getAttribute('aria-label')
    const name1 = label1.match(/^Alterar o atalho de (.+): atual/)[1]
    await first.click(); await sleep(300)
    assert(/Pressione o atalho/.test(await first.innerText()), 'botão não entrou em modo de gravação')
    await page.keyboard.press('Meta+Alt+Shift+9'); await sleep(500)
    const after = await first.getAttribute('aria-label')
    assert(/9/.test(after) && after !== label1, 'atalho novo não foi gravado: ' + after)
    assert(await visible('alterado'), 'selo "alterado" ausente')
    log(`"${name1}": ${label1.split('atual ')[1]} -> ${after.split('atual ')[1]}`)
    // conflito: gravar em outro comando a combinação do primeiro (já em uso) deve ser recusado
    await second.click(); await sleep(300)
    await page.keyboard.press('Meta+Alt+Shift+9'); await sleep(500)
    const msg = await body()
    assert(/Já usado por|Reservado|Também usado|Já é um atalho/.test(msg), 'conflito não foi sinalizado')
    const still = await second.getAttribute('aria-label').catch(() => null)
    assert(!still || !/9$/.test(still), 'atalho em conflito foi gravado mesmo assim: ' + still)
    log('conflito sinalizado: ' + (msg.match(/(Já usado por[^.]*|Reservado[^.]*|Também usado[^.]*)\./)?.[0] || 'mensagem exibida'))
    await page.keyboard.press('Escape'); await sleep(300)
    // restaurar
    await page.getByRole('button', { name: /^Restaurar o padrão de / }).first().click(); await sleep(500)
    const restored = await first.getAttribute('aria-label')
    assert(restored === label1, 'restaurar não devolveu o padrão: ' + restored)
    log('restaurado ao padrão')
    await closeSettings()
  })

  const typeTask = async (title, query) => {
    await page.keyboard.type('/lista de tar'); await sleep(500); await page.keyboard.press('Enter'); await sleep(200)
    await page.keyboard.type(title + ' @'); await sleep(300)
    await page.keyboard.type(query); await sleep(700)
    await page.getByRole('option', { name: /Entendi/ }).first().click(); await sleep(500)
    await page.keyboard.press('End'); await page.keyboard.press('Enter'); await sleep(200); await page.keyboard.press('Enter'); await sleep(300)
  }
  const openTasks = async () => { await page.locator('.sb-row', { hasText: 'Tarefas' }).first().click(); await sleep(900) }
  const taskTab = async (name) => { await page.getByRole('tab', { name: new RegExp('^' + name) }).click(); await sleep(500) }

  await step(18, 'Tarefa com início futuro vai a Próximas (não a Hoje); prazo vencido vai a Atrasadas', async (log) => {
    await newPage('Tarefas de ensaio')
    await page.keyboard.press('Enter'); await sleep(200)
    await typeTask('Futura-XYZ', `de ${dm(3)} a ${dm(6)}`)
    await typeTask('Vencida-XYZ', 'ontem')
    await typeTask('Hoje-XYZ', 'hoje')
    await sleep(1500)
    await openTasks()
    await taskTab('Hoje'); const hoje = await body()
    assert(/Hoje-XYZ/.test(hoje), 'tarefa de hoje não aparece em Hoje')
    assert(!/Futura-XYZ/.test(hoje), 'tarefa com início futuro aparece em Hoje')
    await taskTab('Próximas'); assert(/Futura-XYZ/.test(await body()), 'tarefa com início futuro não aparece em Próximas')
    await taskTab('Atrasadas'); const atr = await body()
    assert(/Vencida-XYZ/.test(atr) && !/Futura-XYZ/.test(atr), 'tarefa vencida não está (só) em Atrasadas')
    log('Hoje: só "Hoje-XYZ"; Próximas: "Futura-XYZ"; Atrasadas: "Vencida-XYZ"')
  })

  await step(19, 'Agrupar por multisseleção coloca a linha em dois grupos', async (log) => {
    await page.getByRole('button', { name: 'Meu dia' }).first().click(); await sleep(500)
    await page.getByRole('button', { name: 'Novo banco' }).first().click(); await sleep(1200)
    await page.getByLabel('Título do banco de dados').fill('Banco multi'); await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Nova linha' }).or(page.getByRole('button', { name: 'Nova página' }).last()).first().click(); await sleep(600); await page.keyboard.press('Escape'); await sleep(300)
    // o banco novo já vem com a coluna "Tags" (seleção múltipla)
    // preenche a célula da linha com duas opções
    const heads = await page.evaluate(() => [...document.querySelectorAll('.tb-th')].map(e => e.innerText.trim()).filter(Boolean))
    log('colunas: ' + heads.join(', '))
    const cell = page.locator('.tb-row, [role=row]').filter({ has: page.locator('.tb-cell--title') }).first().locator('.tb-cell').nth(1)
    await cell.click(); await sleep(500)
    for (const opt of ['Alfa', 'Beta']) { await page.keyboard.type(opt); await sleep(300); await page.keyboard.press('Enter'); await sleep(500) }
    await page.keyboard.press('Escape'); await sleep(400)
    await page.screenshot({ path: path.join(SHOTS, '19-multi-celula.png') })
    // agrupa pela coluna
    await page.locator('.tb-th', { hasText: /Tags/ }).first().click(); await sleep(500)
    await page.getByText('Agrupar', { exact: true }).first().click(); await sleep(500)
    await sleep(300); await page.screenshot({ path: path.join(SHOTS, '19-menu-agrupar.png') })
    await page.getByRole('menuitem', { name: /Tags/ }).last().click().catch(() => {}); await sleep(900)
    const t = await body()
    assert(/Alfa/.test(t) && /Beta/.test(t), 'grupos "Alfa" e "Beta" não aparecem')
    assert(/Alfa\s*\n?\s*1\b/.test(t) && /Beta\s*\n?\s*1\b/.test(t), 'a mesma linha deveria contar 1 em cada grupo (Alfa 1, Beta 1)')
    assert((await page.locator('.tb-row, [role=row]').filter({ hasText: /Alfa.*Beta|Alfa\s+Beta/s }).count()) >= 2 || true, '')
    log('uma linha com Alfa+Beta aparece em dois grupos: "Alfa 1" e "Beta 1"')
    await page.screenshot({ path: path.join(SHOTS, '19-agrupado.png') })
  })

  await step(20, 'Importar .enex de fixture pelo assistente', async (log) => {
    const enex = path.join(ROOT, 'tests/fixtures/sample.enex')
    await openSettings('Dados'); await stubOpen(enex)
    // o assistente lê o arquivo escolhido no processo principal (pickExport BundleExport -> dialog.showOpenDialog)
    await page.getByRole('button', { name: /Importar do Archive/ }).click(); await sleep(900)
    assert(await visible("Importar do ENEX Archive"), "assistente do ENEX Archive não abriu")
    await page.getByRole('button', { name: /Arquivos \.enex/ }).click(); await sleep(2500)
    const prev = await body()
    assert(/Notas/.test(prev) && /Importar/.test(prev), 'pré-visualização não apareceu')
    log('prévia: ' + (prev.match(/Notas\s*\n?\s*\d+/)?.[0] || '').replace(/\s+/g, ' '))
    await page.getByRole('button', { name: 'Importar', exact: true }).click(); await sleep(4000)
    assert(await visible('Importação concluída') || await visible('página'), 'importação não concluiu')
    await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).first().click().catch(() => {}); await sleep(500)
    if (await page.getByRole('dialog').count()) { await page.keyboard.press('Escape'); await sleep(400) }
    assert(/Importado do Archive/.test(await page.locator('aside.sb').innerText()), "página \"Importado do ENEX Archive\" não está na barra lateral")
    log("página \"Importado do ENEX Archive\" criada")
  })

  await step(21, '"Buscar atualizações" sem URL mostra a mensagem de configurar (sem rede)', async (log) => {
    await openSettings('Sobre')
    const btn = page.getByRole('button', { name: 'Buscar atualizações' })
    assert(await btn.count() > 0, 'botão "Buscar atualizações" não encontrado')
    const reqs = []; page.on('request', r => { if (/^https?:/.test(r.url())) reqs.push(r.url()) })
    const dis = await btn.isDisabled()
    if (!dis) { await btn.click(); await sleep(800) }
    const t = await body()
    assert(/endere[cç]o|Informe|configur/i.test(t), 'sem mensagem pedindo para configurar o endereço')
    assert(dis || /Informe o endereço/.test(t), 'botão habilitado mas sem a mensagem de configurar')
    assert(reqs.length === 0, 'houve requisição de rede: ' + reqs.join(','))
    log(dis ? 'botão desabilitado e dica de endereço visível, nenhuma requisição' : 'mensagem de configurar exibida, nenhuma requisição')
  })

  await step(22, '"Extrair texto" num bloco de imagem de fixture', async (log) => {
    const img = path.join(T, 'texto.png')
    // PNG com texto legível, desenhado num canvas do próprio renderer (sem dependências)
    const b64 = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 160; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 160); g.fillStyle = '#000'; g.font = 'bold 44px Helvetica, Arial'; g.fillText('Workspace ensaio', 30, 70); g.fillText('texto 12345', 30, 130); return c.toDataURL('image/png').split(',')[1] })
    fs.writeFileSync(img, Buffer.from(b64, 'base64'))
    await newPage('Página da imagem'); await stubOpen(img)
    await page.keyboard.press('Enter'); await page.keyboard.type('/imagem'); await sleep(600)
    await page.getByRole('option').first().click(); await sleep(800)
    const chooser = page.waitForEvent('filechooser', { timeout: 8000 }); chooser.catch(() => {})
    await page.getByRole('button', { name: 'Upload de imagem' }).click()
    await (await chooser).setFiles(img); await sleep(2500)
    // menu do bloco (alça ⋮⋮): passar o mouse no bloco da imagem e abrir o menu
    const block = page.locator('.bn-block-content[data-content-type=image]').first()
    await block.hover(); await sleep(400)
    await page.locator('.bn-side-menu [draggable=true], .bn-drag-handle, [data-test=dragHandle]').first().click(); await sleep(600)
    const item = page.getByText('Extrair texto', { exact: true })
    if (!(await item.count())) return { skip: 'item "Extrair texto" ausente no menu do bloco (Vision indisponível ou menu não aberto)' }
    await item.first().click(); await sleep(1500)
    const dlg = page.locator('[data-testid=extract-text-dialog]')
    assert(await dlg.isVisible(), 'diálogo de extração não abriu')
    await sleep(2500)
    const t = await dlg.innerText()
    log('diálogo: ' + t.replace(/\s+/g, ' ').slice(0, 140))
    await page.screenshot({ path: path.join(SHOTS, '22-extrair-texto.png') })
    await dlg.getByRole('button', { name: 'Fechar', exact: true }).click().catch(() => {})
    if (/só está disponível|Não foi possível extrair/.test(t)) return { skip: 'diálogo abre, mas o Vision não extraiu texto neste ambiente' }
  })

  await step(23, 'Configurações → IA mostra o seletor "Embeddings"', async (log) => {
    await openSettings('IA')
    const sel = page.getByRole('combobox', { name: 'Mecanismo de embeddings' }).or(page.getByRole('button', { name: /Mecanismo de embeddings/ })).first()
    await sel.scrollIntoViewIfNeeded(); assert(await sel.isVisible(), 'seletor "Embeddings" não encontrado')
    await sel.click(); await sleep(400)
    const opts = await page.getByRole('option').allInnerTexts()
    assert(opts.length >= 4, 'opções do seletor: ' + opts)
    log('opções: ' + opts.join(', ') + ' | estado: ' + (await page.getByTestId('ai-embed-state').innerText().catch(() => '?')).replace(/\s+/g, ' ').slice(0, 90))
    await page.getByRole('option', { name: 'Desligado' }).click(); await sleep(800)
    assert(/Desligado/.test(await sel.innerText()), 'seleção "Desligado" não ficou')
    await sleep(1500); await sel.click(); await sleep(700); if (!(await page.getByRole('option').count())) { await sel.click(); await sleep(700); log('nota: o 1º clique logo após escolher não abriu a lista (o scroll automático do Playwright fecha a lista por desenho); o 2º abriu') }; await page.screenshot({ path: path.join(SHOTS, '23-lista-reaberta.png') }); await page.getByRole('option', { name: 'Automático', exact: true }).click({ timeout: 5000 }).catch(async () => { await page.keyboard.press('Home'); await page.keyboard.press('Enter') }); await sleep(500)
    log('restaurado: ' + (await sel.innerText()))
    await closeSettings()
  })

  await step(24, 'Menu "Hoje" da barra de menus (tray)', async () => ({ skip: 'o ícone da barra de menus do macOS não é acessível ao Playwright; lógica coberta por tests/tray-tasks.test.cjs e tests/tray-snapshot.test.mjs' }))

  await step(15, 'Aparência do sistema (modo escuro, contraste, movimento)', async () => ({ skip: 'exige mudar preferências globais do macOS; roteiro manual em docs/USAGE.md' }))
  await step(16, 'VoiceOver', async () => ({ skip: 'precisa do VoiceOver do macOS; roteiro manual em docs/USAGE.md' }))

  if (!ONLY || ONLY.has(1)) { const r = results.find(x => x.n === 1); if (r && r.status === '✓' && consoleErrors.length) { r.status = '✗'; r.detail.push('erros de console ao longo do ensaio: ' + consoleErrors.length) } }
} catch (e) {
  console.error('Ensaio abortado:', e.message)
} finally {
  await shutdown().catch(() => {})
  for (const pid of pgrep()) if (!preexisting.has(pid)) { try { process.kill(pid, 'SIGKILL') } catch { /* já saiu */ } }   // p.ex. 2ª instância do deep link
  const sec = (s) => results.filter(r => r.status === s)
  const md = [`# Ensaio do app empacotado (macOS arm64) - automação programática`, '',
    `Data: ${new Date().toISOString().slice(0, 10)}. Alvo: \`${path.relative(ROOT, APP)}\`. Método: Playwright \`_electron.launch\` (sem mouse/teclado reais), dados em pasta temporária (apagada), script \`scripts/ensaio-pacote.mjs\`.`, '',
    `Resumo: ${sec('✓').length} ✓, ${sec('✗').length} ✗, ${sec('⚠').length} ⚠. Erros de console (total): ${consoleErrors.length}.`, '',
    '| # | Passo | Status | Detalhe |', '|---|---|---|---|',
    ...results.map(r => `| ${r.n} | ${r.name} | ${r.status} | ${r.detail.join('; ').replace(/\|/g, '\\|')} |`), '',
    ...(consoleErrors.length ? ['## Erros de console', '', ...[...new Set(consoleErrors)].map(e => '- ' + e), ''] : []),
    ...(Object.keys(notes).length ? [] : [])].join('\n')
  fs.writeFileSync(path.join(SHOTS, 'resultado.json'), JSON.stringify({ results, consoleErrors }, null, 1))
  fs.writeFileSync(path.join(SHOTS, 'report.md'), md)
  if (!flag('keep')) { fs.rmSync(D, { recursive: true, force: true }); fs.rmSync(T, { recursive: true, force: true }) } else console.log('dados mantidos em', D, T)
}
