import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { captureSourceBuild, sourceStampFile, verifiedBuildInfo } from './build/source-build-info.mjs'

const sourceRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(({ command }) => {
  const source = command === 'build' ? captureSourceBuild(sourceRoot) : null
  return {
    plugins: [react(), {
      name: 'waynoted-build-source',
      apply: 'build',
      generateBundle() {
        const current = source ? captureSourceBuild(sourceRoot) : null
        const stamp = verifiedBuildInfo(source, current) ? current : null
        this.emitFile({ type: 'asset', fileName: sourceStampFile, source: JSON.stringify(stamp) })
      },
    }],
    base: './',
    server: { port: 5310, strictPort: true },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      // Página principal + janela flutuante de nota rápida (electron/quick-capture.cjs).
      rollupOptions: { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), quick: fileURLToPath(new URL('./quick.html', import.meta.url)) } },
    },
  }
})
