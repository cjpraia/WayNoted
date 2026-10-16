import type { Node as PMNode } from '@tiptap/pm/model'
import { parseLooseUrl } from '../../input/liberal.ts'
import { localPageLink } from './links.ts'
import { blocksToText } from './util.ts'
import { parseVideoUrl } from './videoEmbed.ts'

export type PasteChoice = 'mention' | 'video' | 'bookmark' | 'url' | 'embed'
export interface UrlPasteCapture { url: string; from: number; to: number; blockId: string; localFrom: number; localTo: number; doc: PMNode }

export function singlePastedUrl(event: Pick<ClipboardEvent, 'clipboardData'>): string | null {
  const data = event.clipboardData
  if (!data || data.types.includes('text/markdown') || data.types.includes('blocknote/html') || data.files.length) return null
  const raw = data.getData('text/plain')
  const value = raw.trim()
  if (!value || /^\[.*\]\(.*\)$/.test(value)) return null
  if (localPageLink.test(value)) return value
  // Postel: aceita espaços nas pontas, <url>, "www." e domínio sem https://; a saída é sempre a URL canônica.
  const loose = parseLooseUrl(value)
  if (!loose || !/^https?:/.test(loose.url)) return null
  if (data.types.includes('text/html')) {
    const markup = data.getData('text/html')
    const body = new DOMParser().parseFromString(markup, 'text/html').body
    const anchor = body.children.length === 1 && body.firstElementChild?.tagName === 'A' ? body.firstElementChild : null
    if (!anchor || anchor.textContent?.trim() !== value || anchor.getAttribute('href') !== value) return null
  }
  return loose.url
}

/** Link de um provedor da lista fechada (YouTube, Vimeo, Loom, Dailymotion, Spotify) que vira player. */
export function pastedUrlIsVideo(value: string): boolean {
  return parseVideoUrl(value) !== null
}

/** Opções do menu "Colar como", só as pertinentes ao endereço: um link vira UM bloco. */
export function pasteChoicesFor(value: string): PasteChoice[] {
  if (localPageLink.test(value)) return ['mention', 'url']
  return pastedUrlIsVideo(value) ? ['mention', 'video', 'bookmark', 'url'] : ['mention', 'url', 'bookmark', 'embed']
}

export interface PasteEditor {
  pasteText: (text: string) => unknown
  getTextCursorPosition: () => { block: { id: string } }
  prosemirrorState: { doc: PMNode; selection: { from: number } }
  _tiptapEditor: { commands: { setTextSelection: (range: { from: number; to: number }) => boolean } }
  createLink: (url: string, text?: string) => unknown
  getBlock: (id: string) => { id: string; type: string; content: unknown; children: unknown[] } | undefined
  updateBlock: (id: string, update: unknown) => unknown
  insertBlocks: (blocks: unknown[], referenceBlock: string, placement: 'after') => unknown
  replaceBlocks: (blocks: string[], replacements: unknown[]) => unknown
}

/** The default text is committed before the menu appears, so Escape never loses it. */
export function pasteUrlAndCapture(editor: PasteEditor, url: string): UrlPasteCapture | null {
  editor.pasteText(url)
  const { doc, selection } = editor.prosemirrorState
  const to = selection.from, from = to - url.length
  const blockId = editor.getTextCursorPosition().block.id
  let blockTextStart = -1
  doc.descendants((node, pos) => { if (node.type.name === 'blockContainer' && node.attrs.id === blockId) { blockTextStart = pos + 2; return false } })
  return from >= blockTextStart && blockTextStart >= 0 && doc.textBetween(from, to, '') === url ? { url, from, to, blockId, localFrom: from - blockTextStart, localTo: to - blockTextStart, doc } : null
}

function removeInlineSpan(content: unknown, from: number, to: number): unknown[] | null {
  if (!Array.isArray(content)) return null
  let offset = 0
  const result: unknown[] = []
  for (const raw of content) {
    if (!raw || typeof raw !== 'object') return null
    const item = raw as Record<string, unknown>
    if (typeof item.text === 'string') {
      const text = item.text, end = offset + text.length
      const kept = text.slice(0, Math.max(0, from - offset)) + text.slice(Math.max(0, to - offset))
      if (kept) result.push({ ...item, text: kept })
      offset = end
    } else if (Array.isArray(item.content)) {
      const nestedLength = blocksToText([{ type: 'paragraph', content: item.content, children: [] }]).length
      const nested = removeInlineSpan(item.content, from - offset, to - offset)
      if (!nested) return null
      if (nested.length) result.push({ ...item, content: nested })
      offset += nestedLength
    } else {
      if (from <= offset && to > offset) return null
      result.push(item); offset += 1
    }
  }
  return result
}

export function applyPastedUrlChoice(editor: PasteEditor, capture: UrlPasteCapture, choice: PasteChoice, title?: string): boolean {
  if (!isPastedUrlCaptureCurrent(editor, capture)) return false
  const block = editor.getBlock(capture.blockId)
  if (!block) return false
  if (choice === 'mention' || choice === 'url') {
    editor._tiptapEditor.commands.setTextSelection({ from: capture.from, to: capture.to })
    const label = choice === 'url' ? capture.url : title || (localPageLink.test(capture.url) ? 'Page' : new URL(capture.url).hostname.replace(/^www\./, ''))
    editor.createLink(capture.url, label)
    return true
  }
  const video = choice === 'video' ? parseVideoUrl(capture.url) : null
  const payload = choice === 'bookmark'
    ? { type: 'bookmark', props: { url: capture.url, title: '' } }
    : video
      ? { type: 'onlineVideo', props: { url: video.watchUrl, title: '' } }
      : { type: 'externalReference', props: { provider: choice === 'video' ? 'Video' : 'Embed', url: capture.url, title: '' } }
  const alone = blocksToText([block]).trim() === capture.url && !block.children.length
  if (alone) editor.updateBlock(block.id, payload)
  else {
    const content = removeInlineSpan(block.content, capture.localFrom, capture.localTo)
    if (!content) return false
    editor.replaceBlocks([block.id], [{ ...block, content }, payload])
  }
  return true
}

export function isPastedUrlCaptureCurrent(editor: PasteEditor, capture: UrlPasteCapture): boolean {
  const { doc } = editor.prosemirrorState
  return doc.eq(capture.doc) && doc.textBetween(capture.from, capture.to, '') === capture.url && !!editor.getBlock(capture.blockId)
}
