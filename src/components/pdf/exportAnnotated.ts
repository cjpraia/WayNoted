// "Exportar com anotações": gera um PDF NOVO com as anotações desenhadas como conteúdo visual da página.
// O arquivo original (bytes guardados no bloco) nunca é tocado. Roda no renderer (pdf-lib é empacotado pelo Vite),
// e o diálogo de salvar do sistema é o do IPC existente `np:exportBinaryFile`.
import type { PDFFont, PDFPage } from 'pdf-lib'
import { ANN_HEX, ANN_MARKER_HEX, TEXT_SIZE, displayToPdf, type AnnColor, type Annotation } from './annotations.ts'

const hexToRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]

/** Troca por "?" o que a fonte padrão (WinAnsi) não consegue codificar, para a exportação nunca falhar por causa de um caractere. */
export function safeText(font: Pick<PDFFont, 'encodeText'>, value: string): string {
  let out = ''
  for (const ch of value.replace(/\t/g, '  ')) {
    if (ch === '\n') { out += ch; continue }
    try { font.encodeText(ch); out += ch } catch { out += '?' }
  }
  return out
}

export function wrapText(font: Pick<PDFFont, 'widthOfTextAtSize'>, value: string, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of value.split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) { lines.push(line); line = word } else line = candidate
    }
    lines.push(line)
  }
  return lines
}

export interface ExportResult { bytes: Uint8Array; drawn: number; skipped: number }

export async function exportAnnotatedPdf(source: Uint8Array, annotations: Annotation[]): Promise<ExportResult> {
  const { PDFDocument, StandardFonts, rgb, degrees, BlendMode, LineCapStyle } = await import('pdf-lib')
  const doc = await PDFDocument.load(source, { updateMetadata: false })
  const font = await doc.embedStandardFont(StandardFonts.Helvetica)
  const pages = doc.getPages()
  let drawn = 0, skipped = 0
  const color = (c: AnnColor, marker = false) => { const [r, g, b] = hexToRgb((marker ? ANN_MARKER_HEX : ANN_HEX)[c]); return rgb(r, g, b) }

  for (const a of annotations) {
    const page: PDFPage | undefined = pages[a.page - 1]
    if (!page) { skipped++; continue }
    const box = page.getCropBox()
    const rotate = page.getRotation().angle
    const odd = Math.abs(rotate) % 180 === 90
    const dw = odd ? box.height : box.width, dh = odd ? box.width : box.height
    const at = (x: number, y: number) => { const [px, py] = displayToPdf(x, y, rotate, box); return { x: px, y: py } }
    if (a.rects?.length && (a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strike')) {
      for (const r of a.rects) {
        const p1 = at(r.x, r.y), p2 = at(r.x + r.w, r.y + r.h)
        if (a.kind === 'highlight') {
          page.drawRectangle({ x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), width: Math.abs(p1.x - p2.x), height: Math.abs(p1.y - p2.y), color: color(a.color, true), opacity: 0.55, blendMode: BlendMode.Multiply })
        } else {
          const lineY = a.kind === 'underline' ? r.y + r.h * 0.92 : r.y + r.h * 0.55
          page.drawLine({ start: at(r.x, lineY), end: at(r.x + r.w, lineY), thickness: Math.max(0.8, dh * 0.0018), color: color(a.color) })
        }
      }
      drawn++
    } else if (a.kind === 'pen' && a.points && a.points.length > 1) {
      const thickness = Math.max(0.5, (a.size ?? 0.004) * dw)
      for (let i = 1; i < a.points.length; i++) page.drawLine({ start: at(a.points[i - 1][0], a.points[i - 1][1]), end: at(a.points[i][0], a.points[i][1]), thickness, color: color(a.color), lineCap: LineCapStyle.Round })
      drawn++
    } else if (a.kind === 'note' && a.x !== undefined && a.y !== undefined) {
      const radius = dw * 0.011
      const top = at(a.x, a.y - 0.02)
      page.drawLine({ start: at(a.x, a.y), end: top, thickness: 1, color: color(a.color) })
      page.drawCircle({ ...top, size: radius, color: color(a.color), borderColor: rgb(1, 1, 1), borderWidth: 0.8 })
      page.drawCircle({ ...top, size: radius * 0.35, color: rgb(1, 1, 1) })
      drawn++
    } else if (a.kind === 'text' && a.x !== undefined && a.y !== undefined && a.w && a.h) {
      const size = (a.size ?? TEXT_SIZE) * dw
      const lines = wrapText(font, safeText(font, a.text ?? ''), size, a.w * dw - size)
      const [c1, c2] = [at(a.x, a.y), at(a.x + a.w, a.y + a.h)]
      page.drawRectangle({ x: Math.min(c1.x, c2.x), y: Math.min(c1.y, c2.y), width: Math.abs(c1.x - c2.x), height: Math.abs(c1.y - c2.y), color: rgb(1, 1, 1), opacity: 0.85, borderColor: color(a.color), borderWidth: 1 })
      lines.slice(0, Math.max(1, Math.floor((a.h * dh) / (size * 1.25)))).forEach((line, i) => {
        if (!line) return
        const base = at(a.x! + (size * 0.5) / dw, a.y! + ((i + 1) * size * 1.25) / dh)
        page.drawText(line, { x: base.x, y: base.y, size, font, color: rgb(0.12, 0.11, 0.1), rotate: degrees(rotate) })
      })
      drawn++
    } else skipped++
  }
  return { bytes: await doc.save(), drawn, skipped }
}
