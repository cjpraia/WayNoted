import { spawn } from 'node:child_process'
import electron from 'electron'
const dev = process.argv.includes('--dev')
const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, ...(dev ? { WORKSPACE_DEV: '1' } : {}) } })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (!child.killed) child.kill(signal) })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
