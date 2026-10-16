// Texto de anexos: PDFs (pdf.js local, em segundo plano) e imagens (OCR do macOS, opcional).
// Resultados ficam em cache pelo SHA-256 do arquivo, então cada anexo é processado uma vez.
import { cacheGet, cachePut } from './cache.ts'

export const PDF_PAGE_LIMIT = 500
const PDF_BYTES_LIMIT = 60 * 1024 * 1024

export function dataUrlBytes(data: string): Uint8Array | null {
  const comma = data.indexOf(',')
  if (!/^data:/i.test(data) || comma < 0) return null
  const meta = data.slice(5, comma), payload = data.slice(comma + 1)
  try {
    if (/;base64$/i.test(meta)) {
      const binary = atob(payload.replace(/\s/g, ''))
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return bytes
    }
    return new TextEncoder().encode(decodeURIComponent(payload))
  } catch { return null }
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Texto por página (índice 0 = pág. 1). `null` quando o PDF não pode ser lido. */
export async function pdfPages(data: string): Promise<string[] | null> {
  const bytes = dataUrlBytes(data)
  if (!bytes || !bytes.length || bytes.length > PDF_BYTES_LIMIT) return null
  const hash = await sha256(bytes)
  const cached = await cacheGet<{ pages: string[] | null }>('pdf', hash)
  if (cached) return cached.pages
  let pages: string[] | null = null
  try {
    const { loadPdfjs } = await import('../pdfWorker.ts')
    const pdfjs = await loadPdfjs()
    const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true })
    try {
      const document = await task.promise
      pages = []
      for (let index = 1; index <= Math.min(document.numPages, PDF_PAGE_LIMIT); index++) {
        const page = await document.getPage(index)
        const content = await page.getTextContent()
        pages.push(content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').replace(/[ \t]+/g, ' ').trim())
        page.cleanup()
        // Cede a thread entre páginas: a extração é de fundo.
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    } finally { await task.destroy() }
  } catch { pages = null }
  await cachePut('pdf', hash, { pages })
  return pages
}

type OcrApi = { ocrImage?: (dataUrl: string) => Promise<{ ok: boolean; text: string; reason?: string }> }
export const ocrAvailable = () => typeof window !== 'undefined' && typeof (window.api as OcrApi | undefined)?.ocrImage === 'function'

/** Texto reconhecido numa imagem (macOS Vision via processo principal). */
export async function imageText(data: string): Promise<string | null> {
  if (!ocrAvailable() || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(data)) return null
  const bytes = dataUrlBytes(data)
  if (!bytes) return null
  const hash = await sha256(bytes)
  const cached = await cacheGet<{ text: string | null }>('ocr', hash)
  if (cached) return cached.text
  const result = await (window.api as OcrApi).ocrImage!(data).catch(() => ({ ok: false, text: '' }))
  if (!result.ok) return null
  await cachePut('ocr', hash, { text: result.text })
  return result.text
}
