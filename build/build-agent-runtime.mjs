// Empacota src/agent/runtime.ts (tarefas, consultas, notas diárias) num único módulo ESM para o processo
// principal e a CLI: electron/gen/agent-runtime.mjs. O app empacotado não leva `src/`, só este arquivo.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundle = await rolldown({ input: path.join(root, 'src', 'agent', 'runtime.ts'), platform: 'node', logLevel: 'warn' })
await bundle.write({ file: path.join(root, 'electron', 'gen', 'agent-runtime.mjs'), format: 'esm', minify: false, sourcemap: false })
await bundle.close()
console.log('[agent] electron/gen/agent-runtime.mjs gerado')
