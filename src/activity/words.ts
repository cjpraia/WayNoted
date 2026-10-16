// Contagem de palavras e de tarefas marcadas num documento (puro; sem React).

const WORD = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu

/** Palavras de um texto: sequências de letras/números (contrações e hífens contam como uma). */
export function countWords(text: string): number {
  if (!text) return 0
  let count = 0
  WORD.lastIndex = 0
  while (WORD.exec(text)) count++
  return count
}

/** Itens de checklist marcados (blocos `checkListItem` com `props.checked`), em qualquer profundidade. */
export function countChecked(blocks: unknown): number {
  let count = 0
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return
    for (const block of list) {
      if (!block || typeof block !== 'object') continue
      const value = block as { type?: unknown; props?: { checked?: unknown }; children?: unknown }
      if (value.type === 'checkListItem' && (value.props?.checked === true || value.props?.checked === 'true')) count++
      walk(value.children)
    }
  }
  walk(blocks)
  return count
}

export interface DocStats { words: number; checked: number }

/** `toText` é o mesmo extrator usado pela busca (blocksToText), para as contagens baterem com o índice. */
export function docStats(blocks: unknown[], toText: (blocks: unknown[]) => string): DocStats {
  return { words: countWords(toText(blocks)), checked: countChecked(blocks) }
}
