// Extração de trechos pesquisáveis a partir dos blocos BlockNote de uma página.
// Cada trecho guarda o bloco de origem (para rolar até ele) e o caminho de contêineres
// (toggle, coluna, callout, bloco sincronizado…) para mostrar "em Toggle › Detalhes".
import type { SyncedBlockRecord } from '../types.ts'
import { canvasSegments } from '../canvas/model.ts'

export type SegmentKind = 'block' | 'caption' | 'file' | 'pdf' | 'image' | 'comment' | 'property' | 'body'
export interface SegmentContext { type: string; label: string }
export interface SearchSegment {
  text: string
  kind: SegmentKind
  blockId?: string
  path?: SegmentContext[]
  /** Nome do anexo (arquivo, PDF ou imagem). */
  file?: string
  /** Página do PDF (1-based). */
  pdfPage?: number
  commentId?: string
  propertyName?: string
}
/** Anexo encontrado no documento: o indexador extrai texto (PDF/OCR) em segundo plano. */
export interface DocumentAttachment {
  blockId?: string
  name: string
  kind: 'pdf' | 'image' | 'file'
  /** Data URL local (nunca buscamos endereços remotos). */
  data: string
  path?: SegmentContext[]
}

type AnyBlock = { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: unknown[] }

function inlineText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!content) return ''
  if (Array.isArray(content)) return content.map(inlineText).join('')
  if (typeof content === 'object') {
    const value = content as { type?: string; text?: string; content?: unknown; rows?: { cells?: unknown[] }[]; props?: Record<string, unknown> }
    if (value.type === 'tableContent' && Array.isArray(value.rows)) return value.rows.map(row => (row.cells ?? []).map(inlineText).join(' ')).join('\n')
    if (typeof value.text === 'string') return value.text
    if (value.content !== undefined) return inlineText(value.content)
  }
  return ''
}
const str = (value: unknown) => typeof value === 'string' ? value : ''
const isData = (value: string) => /^data:/i.test(value)

/** Texto "próprio" de um bloco (sem filhos), igual ao usado em `page.text`. */
export function blockOwnText(block: AnyBlock): string {
  const props = block.props ?? {}
  if (block.type === 'bookmark' || block.type === 'externalReference' || block.type === 'onlineVideo') return [props.title, props.description, props.caption, props.url].filter(value => typeof value === 'string').join('\n')
  if (block.type === 'mermaid') return str(props.source)
  if (block.type === 'query') return str(props.text)
  if (block.type === 'htmlSandbox') return str(props.html).replace(/<[^>]*>/g, ' ')
  if (block.type === 'aiBlock' || block.type === 'aiMeetingNotes') return [props.prompt, props.context, props.output].filter(value => typeof value === 'string').join('\n')
  if (block.type === 'tabs' && typeof props.tabsJson === 'string') {
    try { const tabs = JSON.parse(props.tabsJson); if (Array.isArray(tabs)) return tabs.flatMap(tab => [tab?.title, tab?.body]).filter(value => typeof value === 'string').join('\n') } catch { /* Invalid tabs stay recoverable. */ }
  }
  return inlineText(block.content)
}

/** Legenda e nome de arquivo de blocos de mídia/anexo (já incluídos em `page.text`). */
export function blockAttachmentText(block: AnyBlock): string {
  const props = block.props ?? {}
  if (!['image', 'video', 'audio', 'file', 'pdfPreview', 'localAttachment'].includes(block.type ?? '')) return ''
  const name = str(props.name)
  return [name, str(props.caption)].filter(Boolean).join('\n')
}

const CONTAINER_LABEL_MAX = 48
function containerLabel(block: AnyBlock): SegmentContext | null {
  const type = block.type ?? ''
  const own = blockOwnText(block).replace(/\s+/g, ' ').trim()
  const label = own.length > CONTAINER_LABEL_MAX ? own.slice(0, CONTAINER_LABEL_MAX - 1) + '…' : own
  if (type === 'toggleListItem') return { type: 'toggle', label }
  if (type === 'heading' && block.props?.isToggleable) return { type: 'toggleHeading', label }
  if (type === 'callout') return { type: 'callout', label }
  if (type === 'column') return { type: 'column', label: '' }
  if (type === 'quote') return { type: 'quote', label }
  if (Array.isArray(block.children) && block.children.length && own) return { type: type === 'heading' ? 'heading' : 'block', label }
  return null
}
const pdfName = (name: string, data: string) => /\.pdf$/i.test(name) || /^data:application\/pdf/i.test(data)
const imageName = (name: string, data: string) => /^data:image\//i.test(data) || /\.(png|jpe?g|gif|webp|heic|tiff?|bmp)$/i.test(name)

/**
 * Trechos e anexos de um documento. Blocos sincronizados contam para a página que os exibe:
 * o conteúdo de origem vira trechos com `blockId` do bloco hospedeiro.
 */
export function extractSegments(blocks: unknown[], syncedBlocks: Record<string, SyncedBlockRecord> = {}, syncedLabel: (record: SyncedBlockRecord) => string = () => ''): { segments: SearchSegment[]; attachments: DocumentAttachment[] } {
  const segments: SearchSegment[] = [], attachments: DocumentAttachment[] = []
  const walk = (list: unknown[], path: SegmentContext[], hostId: string | undefined, seen: Set<string>) => {
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue
      const block = raw as AnyBlock
      const blockId = hostId ?? (typeof block.id === 'string' ? block.id : undefined)
      const own = blockOwnText(block)
      const context = path.length ? path : undefined
      if (own.trim()) segments.push({ text: own, kind: 'block', blockId, path: context })
      const props = block.props ?? {}
      // Lousa: um trecho por objeto (blockId = id do objeto; a busca centraliza o quadro nele) e imagens para OCR.
      if (block.type === 'canvas') {
        for (const item of canvasSegments(props)) segments.push({ text: item.text, kind: item.type === 'file' || item.type === 'image' ? 'file' : 'block', blockId: item.id, file: item.type === 'file' || item.type === 'image' ? item.text : undefined })
        for (const object of Array.isArray(props.objects) ? props.objects as Record<string, unknown>[] : []) {
          if (object && object.type === 'image' && typeof object.src === 'string' && isData(object.src)) attachments.push({ blockId: String(object.id), name: str(object.name) || 'imagem', kind: 'image', data: object.src })
          if (object && object.type === 'file' && typeof object.data === 'string' && isData(object.data)) { const name = str(object.name); attachments.push({ blockId: String(object.id), name, kind: pdfName(name, object.data) ? 'pdf' : imageName(name, object.data) ? 'image' : 'file', data: object.data }) }
        }
      }
      if (['image', 'video', 'audio', 'file', 'pdfPreview', 'localAttachment'].includes(block.type ?? '')) {
        const data = str(props.data) || str(props.url)
        const name = str(props.name) || (data && !isData(data) ? data.split(/[/?#]/).filter(Boolean).pop() ?? '' : '')
        if (name) segments.push({ text: name, kind: 'file', blockId, path: context, file: name })
        if (str(props.caption).trim()) segments.push({ text: str(props.caption), kind: 'caption', blockId, path: context, file: name || undefined })
        if (data && isData(data)) {
          const kind = block.type === 'pdfPreview' || pdfName(name, data) ? 'pdf' : block.type === 'image' || imageName(name, data) ? 'image' : 'file'
          attachments.push({ blockId, name: name || (kind === 'pdf' ? 'documento.pdf' : 'imagem'), kind, data, path: context })
        }
      }
      if (block.type === 'syncedBlock' && typeof props.syncedId === 'string' && !seen.has(props.syncedId)) {
        const record = syncedBlocks[props.syncedId]
        if (record && Array.isArray(record.blocks)) {
          const next = new Set(seen).add(props.syncedId)
          walk(record.blocks, [...path, { type: 'synced', label: syncedLabel(record) }], blockId, next)
        }
      }
      if (Array.isArray(block.children) && block.children.length) {
        const label = containerLabel(block)
        walk(block.children, label ? [...path, label] : path, hostId, seen)
      }
    }
  }
  walk(Array.isArray(blocks) ? blocks : [], [], undefined, new Set())
  return { segments, attachments }
}

/** Anexos de arquivo em propriedades de banco (FileValue com data URL local). */
export function propertyAttachments(values: unknown): DocumentAttachment[] {
  const out: DocumentAttachment[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object') return
    const file = value as { name?: unknown; data?: unknown; mimeType?: unknown }
    if (typeof file.data === 'string' && isData(file.data) && typeof file.name === 'string') {
      const mime = typeof file.mimeType === 'string' ? file.mimeType : ''
      out.push({ name: file.name, data: file.data, kind: mime === 'application/pdf' || pdfName(file.name, file.data) ? 'pdf' : mime.startsWith('image/') || imageName(file.name, file.data) ? 'image' : 'file' })
    }
    else if (!('data' in file)) Object.values(value).forEach(visit)
  }
  visit(values)
  return out
}
