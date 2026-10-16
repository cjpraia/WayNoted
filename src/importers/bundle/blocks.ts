// Tipos e construtores de blocos BlockNote (JSON persistido) usados pelos conversores do Export Bundle.
import { newId } from './util.ts'

export type Styles = Record<string, true | string>
export interface TextNode { type: 'text'; text: string; styles: Styles }
export interface LinkNode { type: 'link'; href: string; content: TextNode[] }
export interface EquationNode { type: 'inlineEquation'; props: { id: string; latex: string } }
export type InlineNode = TextNode | LinkNode | EquationNode
export interface Block { id: string; type: string; props?: Record<string, unknown>; content?: InlineNode[] | TableContent; children: Block[] }
export interface TableContent { type: 'tableContent'; headerRows?: number; rows: { cells: InlineNode[][] }[] }

export interface AssetRef { url: string; name: string; mime: string; size: number }

export type WarningCode =
  | 'broken-link' | 'missing-asset' | 'remote-media' | 'asset-too-large' | 'unsupported-block'
  | 'formula-static' | 'rollup-static' | 'relation-unresolved' | 'person-text' | 'unparsed-file'
  | 'duplicate-page' | 'remote-cover' | 'columns'

export interface ConvertContext {
  /** Arquivo de origem (caminho no VFS), base para links relativos. */
  file: string
  /** Id (UUID) da página importada correspondente ao link, ou null. */
  resolvePage(href: string): string | null
  /** A página alvo é filha direta da página que está sendo convertida? */
  isChild(pageId: string): boolean
  resolveAsset(href: string): AssetRef | null
  warn(code: WarningCode, detail?: string): void
  /** Ids de páginas filhas já referenciadas no corpo (preenchido pelo conversor). */
  referenced: Set<string>
}

export const pageHref = (id: string) => `workspace://page/${id}`

export function text(value: string, styles: Styles = {}): TextNode { return { type: 'text', text: value, styles: { ...styles } } }

export function block(type: string, props: Record<string, unknown> | undefined, content?: InlineNode[] | TableContent, children: Block[] = []): Block {
  const out: Block = { id: newId(), type, children }
  if (props) out.props = props
  if (content !== undefined) out.content = content
  return out
}

export const paragraph = (content: InlineNode[], children: Block[] = []) => block('paragraph', {}, content, children)

export function pageBlock(pageId: string, linked: boolean): Block {
  return block('page', { pageId, ownership: linked ? 'linked' : 'auto', display: 'inline' })
}

export function mediaBlock(asset: AssetRef, caption = ''): Block {
  const kind = asset.mime.startsWith('image/') ? 'image' : asset.mime.startsWith('video/') ? 'video' : asset.mime.startsWith('audio/') ? 'audio' : 'file'
  if (kind === 'file' && asset.mime === 'application/pdf' && asset.size <= 8 * 1024 * 1024) return block('pdfPreview', { data: asset.url, name: asset.name })
  return block(kind, { url: asset.url, name: asset.name, caption, ...(kind === 'image' ? { showPreview: true } : {}) })
}

/** Junta textos vizinhos com os mesmos estilos e descarta vazios. */
export function mergeInline(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = []
  for (const node of nodes) {
    if (node.type === 'text' && !node.text) continue
    if (node.type === 'link') { node.content = mergeInline(node.content) as TextNode[]; if (!node.content.length) continue }
    const last = out[out.length - 1]
    if (node.type === 'text' && last?.type === 'text' && JSON.stringify(last.styles) === JSON.stringify(node.styles)) { last.text += node.text; continue }
    out.push(node)
  }
  return out
}

export function inlineText(nodes: InlineNode[]): string {
  return nodes.map(node => node.type === 'text' ? node.text : node.type === 'link' ? node.content.map(part => part.text).join('') : node.props.latex).join('')
}

const LANGUAGES: Record<string, string> = {
  javascript: 'javascript', js: 'javascript', typescript: 'typescript', ts: 'typescript', tsx: 'tsx', jsx: 'jsx', json: 'json', html: 'html', xml: 'html', css: 'css', scss: 'css',
  bash: 'bash', shell: 'bash', sh: 'bash', zsh: 'bash', python: 'python', py: 'python', sql: 'sql', markdown: 'markdown', md: 'markdown', yaml: 'yaml', yml: 'yaml',
  java: 'java', rust: 'rust', go: 'go', c: 'c', 'c++': 'cpp', cpp: 'cpp', 'plain text': 'text', plaintext: 'text', text: 'text',
}
export function codeLanguage(raw: string): string { return LANGUAGES[raw.trim().toLowerCase()] ?? 'text' }

export const BUNDLE_COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const
