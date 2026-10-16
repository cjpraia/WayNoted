// Ponte entre o parser de datas naturais e a menção de data do editor (inline `dateMention`).
import { describeNaturalDate, mentionRepeatOf, parseNaturalDate, parsedInstant, type NaturalLocale } from './dates.ts'

export interface MentionFromText {
  /** Instante ISO salvo em `dateMention.props.date` (sem hora: meio-dia local). */
  date: string
  /** Dia de início (AAAA-MM-DD) quando o texto descreve um intervalo; '' = só prazo. `date` é o prazo. */
  startDate: string
  /** 'HH:MM' quando o texto tinha hora; '' caso contrário. */
  time: string
  /** Preset de repetição da menção ('' = não repete). */
  repeat: string
  /** "8 de outubro de 2026 09:00 · Todo mês no dia 5". */
  label: string
  /** A regra pedida não cabe nos presets da menção (ex.: "toda segunda e quarta"). */
  repeatUnsupported: boolean
}

export function mentionFromText(text: string, locale: NaturalLocale = 'pt-BR', now: number = Date.now(), timeZone?: string): MentionFromText | null {
  const parsed = parseNaturalDate(text, { now, locale, timeZone })
  if (!parsed) return null
  // Intervalo: a menção guarda o PRAZO em `date` e o início em `startDate`.
  const instant = parsed.end ? parsedInstant({ start: parsed.end, time: parsed.endTime }, timeZone) : parsedInstant(parsed, timeZone)
  if (instant === null) return null
  const repeat = mentionRepeatOf(parsed)
  return { date: new Date(instant).toISOString(), startDate: parsed.end ? parsed.start : '', time: (parsed.end ? parsed.endTime : parsed.time) ?? '', repeat: repeat ?? '', label: describeNaturalDate(parsed, locale), repeatUnsupported: repeat === null }
}

/** Rótulo da menção: data (e hora, se foi informada) no idioma da interface. */
export function mentionLabel(date: string, time: string, locale: string): string {
  const at = new Date(date)
  if (!Number.isFinite(at.getTime())) return date
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(at)
  if (!time) return day
  return `${day} ${new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(at)}`
}

/** Menções recém-inseridas por "/Data" abrem o painel com o campo de texto livre. */
const autoOpen = new Set<string>()
export function requestMentionAutoOpen(id: string) { autoOpen.add(id); if (autoOpen.size > 20) autoOpen.delete(autoOpen.values().next().value!) }
export function consumeMentionAutoOpen(id: string): boolean { return autoOpen.delete(id) }
