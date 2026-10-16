// pdf.js carregado sob demanda com um worker de módulo criado a partir de um arquivo do próprio app.
// Sem isto, quando a origem da página é opaca ("null") o pdf.js embrulha o worker num `blob:`,
// que a CSP (script-src 'self') bloqueia; aí ele cai num "fake worker" na thread principal.
// Criando o Worker diretamente da URL local nunca há blob, e a CSP continua sem `blob:` para scripts.
type PdfJs = typeof import('pdfjs-dist')

const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)
let port: Worker | null = null

export async function loadPdfjs(): Promise<PdfJs> {
  const pdfjs = await import('pdfjs-dist')
  if (!port && !pdfjs.GlobalWorkerOptions.workerPort && typeof Worker !== 'undefined') {
    try {
      port = new Worker(workerUrl, { type: 'module' })
      pdfjs.GlobalWorkerOptions.workerPort = port
    } catch {
      port = null
    }
  }
  if (!pdfjs.GlobalWorkerOptions.workerPort) pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.toString()
  return pdfjs
}
