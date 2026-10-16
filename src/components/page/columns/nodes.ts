// Colunas do editor — nós ProseMirror/Tiptap e especificações de bloco (`columnList` e `column`).
//
// CÓDIGO PRÓPRIO do aplicativo. Escrito de forma independente (clean room) a partir da API pública
// MPL-2.0 do @blocknote/core (esquema de grupos descrito em pm-nodes/README.md, createExtension,
// propsToAttributes). Não usa nem copia código GPL. Ver docs/LICENSING.md.
//
// Estrutura no documento:  columnList > column+ (mín. 2) > blockContainer+
// Tipos e props idênticos aos já gravados: `columnList` (sem props) e `column` ({ width }, padrão 1).
import { Node as TiptapNode, mergeAttributes } from '@tiptap/core'
import { propsToAttributes, type BlockSpec } from '@blocknote/core'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { KEY_STEP, columnWeight, equalWidths, percentOf, resizeBoundary, setPairSplit, snapBoundary } from './model.ts'

export interface ColumnLabels {
  list(): string
  column(index: number, count: number): string
  resize(index: number, count: number): string
}
export const DEFAULT_LABELS: ColumnLabels = {
  list: () => 'Colunas',
  column: (index, count) => `Coluna ${index} de ${count}`,
  resize: (index) => `Redimensionar colunas ${index} e ${index + 1}`,
}

export const columnPropSchema = { width: { default: 1 } } as const
const columnAttributes = propsToAttributes(columnPropSchema as never)

const weightOf = (node: PMNode) => columnWeight(node.attrs.width)
const flexOf = (weight: number) => `${weight} 1 0%`

function applyId(dom: HTMLElement, node: PMNode) {
  const id = node.attrs.id
  if (id) dom.setAttribute('data-id', String(id)); else dom.removeAttribute('data-id')
}

function matchesType(type: string) {
  return (element: string | HTMLElement) => typeof element !== 'string' && element.getAttribute('data-node-type') === type ? null : false
}

/** Alças de redimensionar vivem numa camada própria, fora do contentDOM, e acompanham o peso de cada coluna. */
function columnListView(labels: ColumnLabels) {
  return ({ node, view, getPos }: { node: PMNode; view: EditorView; getPos: () => number | undefined }) => {
    let current = node
    const dom = document.createElement('div')
    dom.className = 'pg-columns'
    dom.setAttribute('data-node-type', 'columnList')
    dom.setAttribute('role', 'group')
    dom.setAttribute('aria-label', labels.list())
    applyId(dom, node)
    const content = document.createElement('div')
    content.className = 'bn-block-column-list pg-columns-row'
    const layer = document.createElement('div')
    layer.className = 'pg-column-handles'
    layer.contentEditable = 'false'
    dom.append(content, layer)

    const weights = () => { const list: number[] = []; current.forEach((child) => list.push(weightOf(child))); return list }
    const indexOfHandle = (handle: Element) => Array.prototype.indexOf.call(layer.children, handle.parentElement)

    const commit = (next: number[]) => {
      const base = getPos()
      if (base === undefined) return
      const list = view.state.doc.nodeAt(base)
      if (!list) return
      let tr = view.state.tr
      let offset = base + 1
      list.forEach((child, _o, index) => {
        if (next[index] !== undefined && child.attrs.width !== next[index]) tr = tr.setNodeMarkup(offset, undefined, { ...child.attrs, width: next[index] })
        offset += child.nodeSize
      })
      if (tr.docChanged) view.dispatch(tr)
    }

    const paint = (list: readonly number[]) => {
      Array.from(content.children).forEach((column, index) => { if (list[index] !== undefined) (column as HTMLElement).style.flex = flexOf(list[index]) })
      Array.from(layer.children).forEach((spacer, index) => { if (list[index] !== undefined) (spacer as HTMLElement).style.flex = flexOf(list[index]) })
    }

    const handleFor = (): HTMLElement => {
      const handle = document.createElement('div')
      handle.className = 'pg-column-handle'
      handle.tabIndex = 0
      handle.setAttribute('role', 'separator')
      handle.setAttribute('aria-orientation', 'vertical')
      handle.setAttribute('aria-valuemin', '10')
      handle.setAttribute('aria-valuemax', '90')
      handle.addEventListener('keydown', (event) => {
        if (!view.editable) return
        const index = indexOfHandle(handle)
        const list = weights()
        let next: number[] | null | undefined
        if (event.key === 'ArrowLeft') next = resizeBoundary(list, index, -KEY_STEP)
        else if (event.key === 'ArrowRight') next = resizeBoundary(list, index, KEY_STEP)
        else if (event.key === 'Home') next = snapBoundary(list, index, 'start')
        else if (event.key === 'End') next = snapBoundary(list, index, 'end')
        else return
        event.preventDefault(); event.stopPropagation()
        if (next) commit(next)
      })
      handle.addEventListener('dblclick', (event) => {
        if (!view.editable) return
        event.preventDefault(); event.stopPropagation()
        commit(equalWidths(current.childCount))
      })
      handle.addEventListener('pointerdown', (event) => {
        if (!view.editable || event.button !== 0) return
        event.preventDefault(); event.stopPropagation()
        const index = indexOfHandle(handle)
        const columns = Array.from(content.children) as HTMLElement[]
        if (!columns[index] || !columns[index + 1]) return
        const left = columns[index].getBoundingClientRect().left
        const span = columns[index + 1].getBoundingClientRect().right - left
        const start = weights()
        let latest: number[] | null = null
        try { handle.setPointerCapture?.(event.pointerId) } catch { /* sem captura: os eventos seguem no documento */ }
        dom.classList.add('is-resizing')
        const finish = (apply: boolean) => {
          document.removeEventListener('pointermove', move, true)
          document.removeEventListener('pointerup', up, true)
          document.removeEventListener('pointercancel', cancel, true)
          document.removeEventListener('keydown', key, true)
          dom.classList.remove('is-resizing')
          if (apply && latest) commit(latest); else paint(weights())
        }
        const move = (moveEvent: PointerEvent) => {
          if (span <= 0) return
          const next = setPairSplit(start, index, (moveEvent.clientX - left) / span)
          latest = next
          paint(next ?? start)
        }
        const up = () => finish(true)
        const cancel = () => finish(false)
        const key = (keyEvent: KeyboardEvent) => { if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); finish(false) } }
        document.addEventListener('pointermove', move, true)
        document.addEventListener('pointerup', up, true)
        document.addEventListener('pointercancel', cancel, true)
        document.addEventListener('keydown', key, true)
      })
      return handle
    }

    const sync = () => {
      const list = weights()
      while (layer.children.length > list.length) layer.lastElementChild!.remove()
      while (layer.children.length < list.length) layer.append(document.createElement('div'))
      Array.from(layer.children).forEach((spacer, index) => {
        const element = spacer as HTMLElement
        element.className = 'pg-column-spacer'
        element.style.flex = flexOf(list[index])
        const last = index === list.length - 1
        const existing = element.querySelector('.pg-column-handle')
        if (last) { existing?.remove(); return }
        const handle = (existing as HTMLElement | null) ?? element.appendChild(handleFor())
        handle.setAttribute('aria-label', labels.resize(index + 1, list.length))
        handle.setAttribute('aria-valuenow', String(percentOf(list, index)))
      })
      Array.from(content.children).forEach((column, index) => {
        const element = column as HTMLElement
        element.setAttribute('aria-label', labels.column(index + 1, list.length))
      })
      dom.setAttribute('aria-label', labels.list())
    }
    sync()
    // Os filhos só existem depois que o ProseMirror termina de montar este nó.
    const later = () => queueMicrotask(sync)
    later()

    return {
      dom,
      contentDOM: content,
      update(next: PMNode) {
        if (next.type !== current.type) return false
        current = next
        applyId(dom, next)
        sync()
        later()
        return true
      },
      stopEvent: (event: Event) => event.target instanceof Node && layer.contains(event.target),
      ignoreMutation: (mutation: MutationRecord | { type: 'selection'; target: Node }) =>
        (mutation.target instanceof Node && layer.contains(mutation.target)) || (mutation.target === dom && mutation.type === 'attributes') || (mutation.type === 'attributes' && mutation.target === content),
    }
  }
}

function columnView(labels: ColumnLabels) {
  return ({ node }: { node: PMNode }) => {
    let current = node
    const dom = document.createElement('div')
    dom.className = 'bn-block-column pg-column'
    dom.setAttribute('data-node-type', 'column')
    dom.setAttribute('role', 'group')
    dom.setAttribute('aria-label', labels.column(1, 1))
    const apply = () => { applyId(dom, current); dom.style.flex = flexOf(weightOf(current)); if (weightOf(current) !== 1) dom.setAttribute('data-width', String(weightOf(current))); else dom.removeAttribute('data-width') }
    apply()
    return {
      dom,
      contentDOM: dom,
      update(next: PMNode) {
        if (next.type !== current.type) return false
        current = next
        apply()
        return true
      },
      ignoreMutation: (mutation: MutationRecord | { type: 'selection'; target: Node }) => mutation.type === 'attributes' && mutation.target === dom,
    }
  }
}

export function createColumnListNode(labels: ColumnLabels = DEFAULT_LABELS) {
  return TiptapNode.create({
    name: 'columnList',
    group: 'childContainer bnBlock blockGroupChild',
    content: 'column column+',
    parseHTML: () => [{ tag: 'div', getAttrs: matchesType('columnList') }],
    renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { class: 'bn-block-column-list', 'data-node-type': 'columnList' }), 0],
    addNodeView: () => columnListView(labels) as never,
  })
}

export function createColumnNode(labels: ColumnLabels = DEFAULT_LABELS) {
  return TiptapNode.create({
    name: 'column',
    group: 'bnBlock childContainer',
    content: 'blockContainer+',
    defining: true,
    addAttributes: () => columnAttributes,
    parseHTML: () => [{ tag: 'div', getAttrs: matchesType('column') }],
    renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { class: 'bn-block-column', 'data-node-type': 'column' }), 0],
    addNodeView: () => columnView(labels) as never,
  })
}

type Rendered = { dom: HTMLElement; contentDOM: HTMLElement }
function containerRender(type: 'columnList' | 'column') {
  return (block: { id?: string; props?: Record<string, unknown> }): Rendered => {
    const dom = document.createElement('div')
    dom.className = type === 'column' ? 'bn-block-column' : 'bn-block-column-list'
    dom.setAttribute('data-node-type', type)
    if (block.id) dom.setAttribute('data-id', block.id)
    if (type === 'column' && columnWeight(block.props?.width) !== 1) dom.setAttribute('data-width', String(columnWeight(block.props?.width)))
    return { dom, contentDOM: dom }
  }
}

export type ColumnListSpec = BlockSpec<'columnList', Record<string, never>, 'none'>
export type ColumnSpec = BlockSpec<'column', typeof columnPropSchema, 'none'>

/** Blocos `columnList` e `column`, prontos para `BlockNoteSchema.create({ blockSpecs })`. */
export function columnBlockSpecs(labels: ColumnLabels = DEFAULT_LABELS): { columnList: ColumnListSpec; column: ColumnSpec } {
  const listRender = containerRender('columnList')
  const columnRender = containerRender('column')
  return {
    columnList: { config: { type: 'columnList', content: 'none', propSchema: {} }, implementation: { node: createColumnListNode(labels), render: listRender, toExternalHTML: listRender } } as unknown as ColumnListSpec,
    column: { config: { type: 'column', content: 'none', propSchema: columnPropSchema }, implementation: { node: createColumnNode(labels), render: columnRender, toExternalHTML: columnRender } } as unknown as ColumnSpec,
  }
}
