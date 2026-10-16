export type Locale = 'pt-BR' | 'en-US'

export function translate(locale: Locale, pt: string, en: string, vars?: Record<string, string | number>): string {
  const message = locale === 'en-US' ? en : pt
  return message.replace(/\{(\w+)\}/g, (match, key: string) => vars?.[key] === undefined ? match : String(vars[key]))
}

export function localeName(locale: Locale): string { return locale === 'en-US' ? 'English (United States)' : 'Português (Brasil)' }
