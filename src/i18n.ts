import { getState, useStore } from './store.ts'
import { translate, type Locale } from './localization.ts'

export type { Locale } from './localization.ts'
export function getLocale(): Locale { return getState().settings.locale ?? 'en-US' }
export function t(pt: string, en: string, vars?: Record<string, string | number>): string { return translate(getLocale(), pt, en, vars) }
export function useI18n() {
  const locale = useStore().settings.locale ?? 'en-US'
  return { locale, t: (pt: string, en: string, vars?: Record<string, string | number>) => translate(locale, pt, en, vars) }
}
export function formatDate(value: number | string | Date, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(getLocale(), options).format(new Date(value))
}
export function formatNumber(value: number, options?: Intl.NumberFormatOptions) { return new Intl.NumberFormat(getLocale(), options).format(value) }
