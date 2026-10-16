// Comparação divertida com livros famosos (contagens aproximadas de palavras, tabela local).

export interface Book { pt: string; en: string; words: number }

export const BOOKS: Book[] = [
  { pt: 'O Pequeno Príncipe', en: 'The Little Prince', words: 17000 },
  { pt: 'A Metamorfose', en: 'The Metamorphosis', words: 22000 },
  { pt: 'O Alquimista', en: 'The Alchemist', words: 39000 },
  { pt: 'Dom Casmurro', en: 'Dom Casmurro', words: 66000 },
  { pt: 'Harry Potter e a Pedra Filosofal', en: "Harry Potter and the Philosopher's Stone", words: 77000 },
  { pt: '1984', en: '1984', words: 89000 },
  { pt: 'O Hobbit', en: 'The Hobbit', words: 95000 },
  { pt: 'Orgulho e Preconceito', en: 'Pride and Prejudice', words: 122000 },
  { pt: 'Moby Dick', en: 'Moby-Dick', words: 206000 },
  { pt: 'Dom Quixote', en: 'Don Quixote', words: 430000 },
  { pt: 'Guerra e Paz', en: 'War and Peace', words: 587000 },
]

/** Maior livro já "alcançado" (razão ≥ 1) ou, se ainda nenhum, a fração do menor. null sem palavras. */
export function bookComparison(words: number): { book: Book; ratio: number } | null {
  if (!(words > 0)) return null
  const reached = BOOKS.filter(book => words >= book.words)
  const book = reached.at(-1) ?? BOOKS[0]
  return { book, ratio: words / book.words }
}

export function bookSentence(words: number, locale: string): string | null {
  const match = bookComparison(words)
  if (!match) return null
  const en = locale.startsWith('en'), title = en ? match.book.en : match.book.pt
  const format = (value: number, digits: number) => value.toLocaleString(locale, { maximumFractionDigits: digits })
  if (match.ratio < 1) {
    const percent = Math.max(1, Math.round(match.ratio * 100))
    return en ? `You've written about ${percent}% of the length of “${title}”.` : `Você já escreveu cerca de ${percent}% do tamanho de “${title}”.`
  }
  const times = format(match.ratio, match.ratio < 10 ? 1 : 0)
  return en ? `You've written ~${times}× the length of “${title}”.` : `Você escreveu ~${times}× o tamanho de “${title}”.`
}
