// "Colar já formatado": decide como tratar o conteúdo da área de transferência e insere o
// resultado como UMA colagem do ProseMirror (um passo de desfazer). Ver docs/USAGE.md.
import { closeHistory } from '@tiptap/pm/history'
import type { InlineNode } from "../../../importers/bundle/blocks.ts"
import { looksLikeMarkdown, parseTsv } from './detect.ts'
import { EQ_BLOCK, EQ_INLINE, cleanPastedHtml, htmlHasRichContent } from './html.ts'
import { markdownToPasteBlocks, splitMarkdownChunks, tsvToTableBlock, type PasteBlock, type SchemaSupport } from './markdown.ts'

export interface ClipboardLike {
  types: readonly string[]
  getData(type: string): string
  files?: { length: number }
}

export type PastePlan =
  | { kind: 'default' }
  | { kind: 'plain'; text: string }
  | { kind: 'html'; html: string; text: string }
  | { kind: 'markdown'; markdown: string; text: string }
  | { kind: 'tsv'; rows: string[][]; text: string }

export interface PlanOptions {
  /** Configuração "Converter Markdown ao colar" (padrão ligado). */
  convert: boolean
  /** ⌘⇧V: colar como texto simples. */
  plain?: boolean
  /** Cursor dentro de bloco de código (sempre texto). */
  inCode?: boolean
  /** Cursor dentro de célula de tabela (só conteúdo inline). */
  inTable?: boolean
}

/** Colagens acima deste tamanho convertem em fatias, sem travar a digitação. */
export const LARGE_PASTE = 2 * 1024 * 1024
export const CHUNK_SIZE = 192 * 1024
/** Acima disto a colagem não passa pelo autolink (que varre todo o trecho colado). */
const AUTOLINK_LIMIT = 20_000

/** Decide o caminho da colagem. Puro: testável sem editor. */
export function planPaste(data: ClipboardLike, options: PlanOptions): PastePlan {
  const types = Array.from(data.types)
  const text = types.includes('text/plain') ? data.getData('text/plain') : ''
  if (types.includes('blocknote/html')) return { kind: 'default' }
  if (options.inCode) return text ? { kind: 'plain', text } : { kind: 'default' }
  if (options.plain) return text ? { kind: 'plain', text } : { kind: 'default' }
  if (types.includes('vscode-editor-data')) {
    let mode = ''
    try { mode = String(JSON.parse(data.getData('vscode-editor-data'))?.mode ?? '') } catch { /* dado inválido */ }
    if (!/^markdown$/i.test(mode) || !options.convert || !text) return { kind: 'default' }
    return options.inTable ? { kind: 'plain', text } : { kind: 'markdown', markdown: text, text }
  }
  if (types.includes('text/markdown') && options.convert) {
    const markdown = data.getData('text/markdown')
    if (markdown.trim()) return options.inTable ? { kind: 'plain', text: text || markdown } : { kind: 'markdown', markdown, text: text || markdown }
  }
  if (types.includes('text/html')) {
    if (options.inTable) return { kind: 'default' }
    const html = data.getData('text/html')
    if (htmlHasRichContent(html)) return { kind: 'html', html, text }
  }
  // Sem texto (imagem/arquivo copiado): fluxo existente do BlockNote.
  if (!text) return { kind: 'default' }
  if (options.convert && !options.inTable) {
    const rows = parseTsv(text)
    if (rows && !looksLikeMarkdown(text)) return { kind: 'tsv', rows, text }
    if (looksLikeMarkdown(text)) return { kind: 'markdown', markdown: text, text }
  }
  return { kind: 'plain', text }
}

// ---------------------------------------------------------------- editor

export interface SmartPasteEditor {
  prosemirrorView: { state: { tr: unknown; doc: unknown; selection: { from: number; $from: { parent: { type: { name: string; spec: { code?: boolean } } }; node: (depth: number) => { type: { name: string } }; depth: number } } }; dispatch: (tr: never) => void; dom?: HTMLElement; coordsAtPos: (pos: number) => { left: number; bottom: number } } | undefined
  schema: { blockSchema: Record<string, unknown>; inlineContentSchema: Record<string, unknown> }
  isEditable: boolean
  pasteHTML: (html: string, raw?: boolean) => void
  pasteText: (text: string) => unknown
  blocksToFullHTML: (blocks: never[]) => string
  tryParseHTMLToBlocks: (html: string) => unknown[]
  undo: () => boolean
}

export function schemaSupport(editor: Pick<SmartPasteEditor, 'schema'>): SchemaSupport {
  return { block: (type) => type in editor.schema.blockSchema, inline: (type) => type in editor.schema.inlineContentSchema }
}

export function selectionContext(editor: SmartPasteEditor): { inCode: boolean; inTable: boolean } {
  const view = editor.prosemirrorView
  if (!view) return { inCode: false, inTable: false }
  const { $from } = view.state.selection
  let inTable = false
  for (let depth = $from.depth; depth > 0; depth--) if (/^table(Cell|Header|Paragraph)?$/.test($from.node(depth).type.name)) inTable = true
  return { inCode: !!$from.parent.type.spec.code, inTable }
}

/** Fecha o grupo do histórico: a colagem vira um passo próprio de ⌘Z. */
function separateHistory(editor: SmartPasteEditor) {
  const view = editor.prosemirrorView
  if (view) view.dispatch(closeHistory(view.state.tr as never) as never)
}

function splitEquations(nodes: InlineNode[], support: SchemaSupport): InlineNode[] {
  const out: InlineNode[] = []
  for (const node of nodes) {
    if (node.type !== 'text' || !node.text.includes(EQ_INLINE)) { out.push(node); continue }
    node.text.split(EQ_INLINE).forEach((part, index) => {
      if (!part) return
      if (index % 2 === 1) out.push(support.inline('inlineEquation') ? { type: 'inlineEquation', props: { id: crypto.randomUUID(), latex: part } } : { type: 'text', text: part, styles: { code: true } })
      else out.push({ ...node, text: part })
    })
  }
  return out
}

/** Pós-processa blocos vindos do HTML: equações do KaTeX, títulos ≤ 3. */
export function finishHtmlBlocks(blocks: PasteBlock[], support: SchemaSupport): PasteBlock[] {
  const out: PasteBlock[] = []
  for (const block of blocks) {
    block.children = finishHtmlBlocks(block.children ?? [], support)
    if (block.type === 'heading') block.props = { ...block.props, level: Math.min(3, Number(block.props?.level) || 1) }
    if (Array.isArray(block.content)) {
      const text = block.content.map((node) => node.type === 'text' ? node.text : '').join('').trim()
      const display = new RegExp(`^${EQ_BLOCK}([\\s\\S]+)${EQ_BLOCK}$`).exec(text)
      if (display && block.type === 'paragraph') {
        out.push(support.block('equation')
          ? { id: block.id, type: 'equation', props: { latex: display[1].trim() }, children: [] }
          : { id: block.id, type: 'codeBlock', props: { language: 'text' }, content: [{ type: 'text', text: display[1].trim(), styles: {} }], children: [] })
        continue
      }
      block.content = splitEquations(block.content.map((node) => node.type === 'text' && node.text.includes(EQ_BLOCK) ? { ...node, text: node.text.split(EQ_BLOCK).join(EQ_INLINE) } : node), support)
    } else if (block.content && block.type === 'table') {
      block.content.rows = block.content.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => Array.isArray(cell) ? splitEquations(cell, support) : cell && typeof cell === 'object' && Array.isArray((cell as { content?: unknown }).content) ? { ...(cell as object), content: splitEquations((cell as unknown as { content: InlineNode[] }).content, support) } as never : cell) }))
    }
    out.push(block)
  }
  return out
}

/** Converte o plano em blocos (síncrono). */
export function planToBlocks(editor: SmartPasteEditor, plan: PastePlan): PasteBlock[] {
  const support = schemaSupport(editor)
  if (plan.kind === 'markdown') return markdownToPasteBlocks(plan.markdown, support)
  if (plan.kind === 'tsv') return [tsvToTableBlock(plan.rows)]
  if (plan.kind === 'html') return finishHtmlBlocks(editor.tryParseHTMLToBlocks(cleanPastedHtml(plan.html)) as PasteBlock[], support)
  return []
}

/**
 * O autolink do BlockNote serve para URLs digitadas e varre todo o trecho alterado; numa
 * colagem de milhares de blocos custava segundos. Links do conteúdo colado já vêm prontos.
 */
function withoutAutolink(editor: SmartPasteEditor, size: number, run: () => void) {
  if (size < AUTOLINK_LIMIT) { run(); return }
  const view = editor.prosemirrorView as unknown as { dispatch: (tr: { setMeta: (key: string, value: unknown) => unknown }) => void } | undefined
  if (!view) { run(); return }
  const own = Object.prototype.hasOwnProperty.call(view, 'dispatch')
  const original = view.dispatch
  view.dispatch = (tr) => original.call(view, tr.setMeta('preventAutolink', true) as never)
  try { run() } finally { if (own) view.dispatch = original; else delete (view as { dispatch?: unknown }).dispatch }
}

/** Insere blocos como uma única colagem (substitui a seleção; um passo de desfazer). */
export function insertBlocks(editor: SmartPasteEditor, blocks: PasteBlock[]): boolean {
  if (!blocks.length) return false
  // Colando no meio de um bloco com texto, o ProseMirror funde o 1º bloco colado ao atual
  // (um título viraria texto do parágrafo). Um parágrafo vazio na frente absorve a fusão.
  const parent = editor.prosemirrorView?.state.selection.$from.parent as { content?: { size: number } } | undefined
  if ((parent?.content?.size ?? 0) > 0 && blocks[0].type !== 'paragraph') blocks = [{ id: crypto.randomUUID(), type: 'paragraph', props: {}, content: [], children: [] }, ...blocks]
  const html = editor.blocksToFullHTML(blocks as never[])
  if (!html) return false
  separateHistory(editor)
  withoutAutolink(editor, html.length, () => editor.pasteHTML(html, true))
  separateHistory(editor)
  return true
}

export function insertPlain(editor: SmartPasteEditor, text: string): void {
  separateHistory(editor)
  // "Texto simples" de verdade: sem as regras de colagem do Tiptap (**negrito**, `código`, links),
  // que só rodam em transações marcadas como uiEvent 'paste'.
  const view = editor.prosemirrorView as unknown as { dispatch: (tr: { setMeta: (key: string, value: unknown) => unknown }) => void } | undefined
  if (!view) { editor.pasteText(text); separateHistory(editor); return }
  const own = Object.prototype.hasOwnProperty.call(view, 'dispatch')
  const original = view.dispatch
  view.dispatch = (tr) => original.call(view, tr.setMeta('uiEvent', 'paste-plain') as never)
  try { withoutAutolink(editor, text.length, () => editor.pasteText(text)) } finally { if (own) view.dispatch = original; else delete (view as { dispatch?: unknown }).dispatch }
  separateHistory(editor)
}

/** Executa um plano já convertido. Retorna true se houve conversão (bloco/estilo). */
export function applyPlan(editor: SmartPasteEditor, plan: PastePlan): boolean {
  if (plan.kind === 'plain') { insertPlain(editor, plan.text); return false }
  if (plan.kind === 'default') return false
  const blocks = planToBlocks(editor, plan)
  if (!blocks.length) { if (plan.text) insertPlain(editor, plan.text); return false }
  return insertBlocks(editor, blocks)
}

/** Colagem grande: converte em fatias ociosas e devolve os blocos. Cancelável. */
export async function convertMarkdownInSlices(markdown: string, support: SchemaSupport, onProgress: (done: number) => void, signal?: { cancelled: boolean }): Promise<PasteBlock[] | null> {
  const chunks = splitMarkdownChunks(markdown, CHUNK_SIZE)
  const blocks: PasteBlock[] = []
  for (let index = 0; index < chunks.length; index++) {
    await new Promise<void>((resolve) => {
      const idle = (globalThis as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }).requestIdleCallback
      if (idle) idle(() => resolve(), { timeout: 50 }); else setTimeout(resolve, 0)
    })
    if (signal?.cancelled) return null
    blocks.push(...markdownToPasteBlocks(chunks[index], support))
    onProgress((index + 1) / chunks.length)
  }
  return blocks
}

/** O plano é "conversão" que merece o aviso (estrutura ou estilos que o texto não teria)? */
export function planIsConversion(plan: PastePlan, blocks?: PasteBlock[]): boolean {
  if (plan.kind === 'markdown' || plan.kind === 'tsv') return true
  if (plan.kind !== 'html') return false
  return !!blocks && (blocks.length > 1 || blocks.some((block) => block.type !== 'paragraph'))
}

export interface SmartPasteResult { handled: boolean | undefined; plan: PastePlan; converted: boolean; large: boolean }

/**
 * Tratamento completo de um evento de colagem (sem React): usado pelo gancho do editor e
 * pelos testes de integração. Colagens grandes de Markdown voltam com `large: true` para o
 * chamador converter em fatias.
 */
export function runSmartPaste(event: Pick<ClipboardEvent, 'clipboardData'>, editor: SmartPasteEditor, defaultPasteHandler: () => boolean | undefined, options: { convert: boolean; plain?: boolean }): SmartPasteResult {
  const data = event.clipboardData
  if (!data) return { handled: defaultPasteHandler(), plan: { kind: 'default' }, converted: false, large: false }
  const plan = planPaste(data, { ...options, ...selectionContext(editor) })
  if (plan.kind === 'default') return { handled: defaultPasteHandler(), plan, converted: false, large: false }
  if (plan.kind === 'plain') { insertPlain(editor, plan.text); return { handled: true, plan, converted: false, large: false } }
  if (plan.kind === 'markdown' && plan.markdown.length > LARGE_PASTE) return { handled: true, plan, converted: false, large: true }
  const blocks = planToBlocks(editor, plan)
  if (!blocks.length) { if (plan.text) insertPlain(editor, plan.text); return { handled: true, plan, converted: false, large: false } }
  insertBlocks(editor, blocks)
  return { handled: true, plan, converted: planIsConversion(plan, blocks), large: false }
}
