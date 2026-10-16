import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5310, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Página principal + janela flutuante de nota rápida (electron/quick-capture.cjs).
    rollupOptions: { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), quick: fileURLToPath(new URL('./quick.html', import.meta.url)) } },
  },
})
