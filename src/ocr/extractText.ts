// "Extrair texto" (B6a): imagem -> OCR do macOS (Vision); PDF -> camada de texto e, nas páginas sem texto
// (escaneadas), Vision página a página. Tudo local; o resultado vira texto editável antes de virar blocos.
import { dataUrlBytes, imageText, ocrAvailable } from '../search/attachments.ts'

/** Um PDF escaneado de 100 páginas já leva minutos de Vision: limite explícito, avisado na interface. */
export const OCR_PDF_PAGE_LIMIT = 100
/** Página com menos que isto na camada de texto é tratada como imagem (escaneada). */
export const MIN_TEXT_LAYER_CHARS = 20
const MAX_PARAGRAPHS = 500, MAX_PARAGRAPH_CHARS = 4000

export interface ExtractProgress { page: number; total: number; phase: 'text' | 'ocr' }
export interface PdfPageSource { numPages: number; textOf(page: number): Promise<string>; renderPng(page: number): Promise<string | null>; destroy(): Promise<void> | void }
export interface ExtractResult { text: string; pages: number; ocrPages: number; truncated: boolean; cancelled: boolean }
export interface ExtractDeps {
  openPdf?: (data: string) => Promise<PdfPageSource | null>
  recognize?: (dataUrl: string) => Promise<string | null>
  canOcr?: () => boolean
}

const BULLET = /^\s*([-*•·▪◦‣–—]|\d{1,3}[.)]|[a-z][.)])\s+/i
const ENDS_SENTENCE = /[.!?…:;)"”»]\s*$/

/** Linhas do OCR/PDF -> parágrafos: junta linhas quebradas pela largura da página e separa em fim de frase de linha curta, listas e linhas em branco. */
export function textToParagraphs(text: string): string[] {
  const out: string[] = []
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = block.split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean)
    if (!lines.length) continue
    const longest = Math.max(...lines.map(line => line.length))
    let current = '', last = ''
    for (const line of lines) {
      if (!current) { current = last = line; continue }
      const startsItem = BULLET.test(line)
      const shortEnd = ENDS_SENTENCE.test(last) && last.length < longest * 0.75 // última linha curta que fecha frase = fim de parágrafo
      if (startsItem || shortEnd) { out.push(current); current = line }
      else if (/[a-zà-ÿ]-$/i.test(current) && /^[a-zà-ÿ]/.test(line)) current = current.slice(0, -1) + line // hifenização de fim de linha
      else current += ' ' + line
      last = line
    }
    if (current) out.push(current)
  }
  return out.map(paragraph => paragraph.slice(0, MAX_PARAGRAPH_CHARS)).slice(0, MAX_PARAGRAPHS)
}

/** Texto editado no diálogo (parágrafos separados por linha em branco) -> parágrafos para inserir. */
export function paragraphsFromEditedText(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(part => part.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).slice(0, MAX_PARAGRAPHS)
}
/** Parágrafos -> texto do diálogo. */
export const paragraphsToText = (paragraphs: string[]) => paragraphs.join('\n\n')

export const isImageData = (data: string) => /^data:image\/[a-z0-9.+-]+;base64,/i.test(data)
export const isPdfData = (data: string) => /^data:application\/pdf/i.test(data)

/** Abre o PDF com o pdf.js local (worker do app) para ler texto e rasterizar páginas. */
export async function openPdfWithPdfjs(data: string): Promise<PdfPageSource | null> {
  const bytes = dataUrlBytes(data)
  if (!bytes?.length) return null
  try {
    const { loadPdfjs } = await import('../pdfWorker.ts')
    const pdfjs = await loadPdfjs()
    const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true })
    const doc = await task.promise
    return {
      numPages: doc.numPages,
      async textOf(index) {
        const page = await doc.getPage(index)
        try { const content = await page.getTextContent(); return content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('') } finally { page.cleanup() }
      },
      async renderPng(index) {
        const page = await doc.getPage(index)
        try {
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: Math.min(3, 2400 / Math.max(base.width, base.height, 1)) }) // lado maior ≈ 2400 px: legível para o Vision, leve no disco
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
          const context = canvas.getContext('2d')
          if (!context) return null
          context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
          await page.render({ canvas, canvasContext: context, viewport }).promise
          return canvas.toDataURL('image/png')
        } finally { page.cleanup() }
      },
      async destroy() { await task.destroy() },
    }
  } catch { return null }
}

/** Texto de uma imagem anexada (OCR com cache por hash do arquivo). */
export async function extractFromImage(data: string, deps: ExtractDeps = {}): Promise<ExtractResult> {
  const canOcr = deps.canOcr ?? ocrAvailable
  if (!canOcr()) throw new Error('OCR_UNAVAILABLE')
  const text = await (deps.recognize ?? imageText)(data)
  if (text === null) throw new Error('OCR_FAILED')
  return { text, pages: 1, ocrPages: 1, truncated: false, cancelled: false }
}

/** Texto de um PDF: camada de texto quando existe; Vision nas páginas escaneadas. `signal` interrompe entre páginas e devolve o parcial. */
export async function extractFromPdf(data: string, options: { signal?: AbortSignal; onProgress?: (progress: ExtractProgress) => void; limit?: number } & ExtractDeps = {}): Promise<ExtractResult> {
  const source = await (options.openPdf ?? openPdfWithPdfjs)(data)
  if (!source) throw new Error('PDF_UNREADABLE')
  const canOcr = (options.canOcr ?? ocrAvailable)()
  const recognize = options.recognize ?? (async (png: string) => imageTextNoCache(png))
  const limit = options.limit ?? OCR_PDF_PAGE_LIMIT
  const total = Math.min(source.numPages, limit)
  const parts: string[] = []
  let ocrPages = 0, cancelled = false, skippedScanned = 0
  try {
    for (let page = 1; page <= total; page++) {
      if (options.signal?.aborted) { cancelled = true; break }
      options.onProgress?.({ page, total, phase: 'text' })
      let text = (await source.textOf(page)).trim()
      if (text.length < MIN_TEXT_LAYER_CHARS) {
        if (!canOcr) { skippedScanned++; text = '' }
        else {
          options.onProgress?.({ page, total, phase: 'ocr' })
          const png = await source.renderPng(page)
          if (png) { text = ((await recognize(png)) ?? '').trim(); ocrPages++ }
          if (options.signal?.aborted) { cancelled = true; if (text) parts.push(text); break }
        }
      }
      if (text) parts.push(text)
      await new Promise(resolve => setTimeout(resolve, 0)) // cede a thread entre páginas
    }
  } finally { await source.destroy() }
  if (skippedScanned && !parts.length) throw new Error('OCR_UNAVAILABLE')
  return { text: parts.join('\n\n'), pages: total, ocrPages, truncated: source.numPages > total, cancelled }
}

/** OCR de uma página rasterizada: sem cache (as páginas são imagens temporárias grandes). */
async function imageTextNoCache(png: string): Promise<string | null> {
  const api = (typeof window !== 'undefined' ? (window as unknown as { api?: { ocrImage?: (data: string) => Promise<{ ok: boolean; text: string }> } }).api : undefined)
  if (!api?.ocrImage) return null
  const result = await api.ocrImage(png).catch(() => ({ ok: false, text: '' }))
  return result.ok ? result.text : null
}

export interface ExtractTarget { blockId: string; kind: 'image' | 'pdf'; data: string; name?: string }
/** Bloco de imagem/PDF com o arquivo embutido? Devolve o que extrair; senão `null` (o item do menu não aparece). */
export function extractTargetOf(block: { id?: string; type?: string; props?: Record<string, unknown> } | null | undefined): ExtractTarget | null {
  if (!block?.id) return null
  const props = block.props ?? {}
  const text = (value: unknown) => typeof value === 'string' ? value : ''
  const data = text(props.data) || text(props.url)
  if (!/^data:/i.test(data)) return null
  const name = text(props.name) || undefined
  if (block.type === 'pdfPreview' || isPdfData(data)) return { blockId: block.id, kind: 'pdf', data, name }
  if (block.type === 'image' || isImageData(data)) return isImageData(data) ? { blockId: block.id, kind: 'image', data, name } : null
  return null
}
