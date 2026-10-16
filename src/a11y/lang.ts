// `lang` do <html> segue o idioma escolhido no app (leitores de tela trocam de voz/pronúncia por ele).
import type { Locale } from '../localization.ts'

export function htmlLang(locale: Locale | undefined): 'pt-BR' | 'en-US' { return locale === 'en-US' ? 'en-US' : 'pt-BR' }

/** Aplica o idioma ao documento; devolve true quando mudou. */
export function syncDocumentLang(locale: Locale | undefined, doc: Pick<Document, 'documentElement'> = document): boolean {
  const lang = htmlLang(locale)
  if (doc.documentElement.lang === lang) return false
  doc.documentElement.lang = lang
  return true
}
