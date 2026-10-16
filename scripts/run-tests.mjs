// Executa cada arquivo de teste num processo próprio, com teto de memória e de tempo.
// Motivo: um teste com falha pode fazer o Node inspecionar objetos do jsdom e consumir
// dezenas de GB fora do heap do V8 (--max-old-space-size não segura). Em 07/10/2026 isso
// esgotou a memória do Mac. Aqui o processo é encerrado antes de afetar o sistema.
import { spawn, execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { cpus } from 'node:os'

const MAX_MB = Number(process.env.TEST_MAX_MB ?? 2048)
const MAX_S = Number(process.env.TEST_MAX_S ?? 180)
const JOBS = Number(process.env.TEST_JOBS ?? Math.max(1, Math.min(4, Math.floor(cpus().length / 3))))
const files = (process.argv.slice(2).length ? process.argv.slice(2) : readdirSync('tests').filter(f => /\.test\.(mjs|cjs|mts|js|ts)$/.test(f)).map(f => `tests/${f}`)).sort()

function treeRssMb(root) {
  if (process.platform === 'win32') {
    try {
      const output = execFileSync('tasklist.exe', ['/FI', `PID eq ${root}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
      const row = output.trim().split('\n').find(line => line.includes(`\"${root}\"`))
      return row ? Number(row.split('\",\"').at(-1).replace(/[^0-9]/g, '')) / 1024 : 0
    } catch { return 0 }
  }
  let out
  try { out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' }) } catch { return 0 }
  const rows = out.trim().split('\n').map(l => l.trim().split(/\s+/).map(Number))
  const tree = new Set([root])
  for (let grew = true; grew;) {
    grew = false
    for (const [pid, ppid] of rows) if (tree.has(ppid) && !tree.has(pid)) { tree.add(pid); grew = true }
  }
  return rows.filter(([pid]) => tree.has(pid)).reduce((sum, [, , rss]) => sum + rss, 0) / 1024
}

function runFile(file) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--experimental-strip-types', '--test', file], { detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', d => { output += d })
    child.stderr.on('data', d => { output += d })
    const started = Date.now()
    let killed = null
    const kill = reason => { killed = reason; try { if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); else process.kill(-child.pid, 'SIGKILL') } catch {} }
    const timer = setInterval(() => {
      const mb = treeRssMb(child.pid)
      if (mb > MAX_MB) kill(`memória ${Math.round(mb)} MB > ${MAX_MB} MB`)
      else if (Date.now() - started > MAX_S * 1000) kill(`tempo > ${MAX_S}s`)
    }, process.platform === 'win32' ? 1000 : 250)
    child.on('close', code => {
      clearInterval(timer)
      const num = key => Number(output.match(new RegExp(`^ℹ ${key} (\\d+)`, 'm'))?.[1] ?? 0)
      resolve({ file, code, killed, output, tests: num('tests'), pass: num('pass'), fail: num('fail') })
    })
  })
}

const queue = [...files]
const results = []
await Promise.all(Array.from({ length: JOBS }, async () => {
  while (queue.length) {
    const r = await runFile(queue.shift())
    results.push(r)
    if (r.killed || r.code !== 0) process.stdout.write(`\n✖ ${r.file}${r.killed ? ` — ENCERRADO (${r.killed})` : ''}\n${r.output.split('\n').filter(l => /✖|Error|expected|actual|at .*tests\//.test(l)).slice(0, 25).join('\n')}\n`)
  }
}))
const sum = key => results.reduce((n, r) => n + r[key], 0)
const failedFiles = results.filter(r => r.killed || r.code !== 0)
console.log(`\nℹ files ${results.length}\nℹ tests ${sum('tests')}\nℹ pass ${sum('pass')}\nℹ fail ${sum('fail') + failedFiles.filter(r => r.killed).length}`)
if (failedFiles.length) { console.log(`✖ arquivos com falha: ${failedFiles.map(r => r.file).join(', ')}`); process.exit(1) }
