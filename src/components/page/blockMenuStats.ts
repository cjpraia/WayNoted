import { blocksToText } from './util.ts'

export function blockMenuText(block: { content?: unknown; type?: string; props?: unknown }): string {
  return blocksToText([{ ...block, children: [] }]).trim()
}

/** Export Bundle counts URL segments as words (the reference URL is 8 words). */
export function blockMenuWordCount(text: string): number { return text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0 }

export function blockMenuCharacterCount(text: string): number { return Array.from(text).length }
