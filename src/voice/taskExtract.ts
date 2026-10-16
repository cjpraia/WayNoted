// Captura por voz → tarefas (B3) — parte pura: separa a transcrição em itens, extrai data/hora (src/nlp) e prioridade.
// Sem IA: heurística por pontuação e conectores ("e depois", "além disso", "lembrar de", "and then", "remind me to").
// Nada aqui usa rede, relógio implícito ou store.
import { foldPreservingLength, parseNaturalDate, type NaturalLocale } from '../nlp/dates.ts'

export type VoicePriority = 'high' | 'normal' | 'low'

export interface VoiceTask {
  id: string
  title: string
  /** AAAA-MM-DD ou null. */
  date: string | null
  /** HH:MM ou null. */
  time: string | null
  priority: VoicePriority
  /** Marcada para criar. */
  include: boolean
}

export interface ExtractOptions {
  now?: number
  locale?: NaturalLocale
  /** Gera ids estáveis nos testes. */
  makeId?: () => string
}

// Conectores que separam itens. Casam sobre o texto sem acentos e em minúsculas (mesmos índices do original).
const SEPARATORS = [
  // pt-BR
  'e depois(?!\\s+d[eoa]s?\\b)', 'e(?=\\s+depois\\s+de\\s+amanh)', 'depois disso', 'alem disso', 'e tambem', 'tambem', 'em seguida', 'logo depois', 'mais uma coisa', 'outra coisa',
  'me lembrar de', 'me lembra de', 'me lembre de', 'lembrar de', 'lembra de', 'lembre de', 'nao esquecer de', 'nao esqueca de', 'nao me deixe esquecer de',
  'eu preciso', 'preciso', 'eu tenho que', 'tenho que', 'tenho de', 'eu devo', 'devo',
  // en-US
  'and then', 'then', 'after that', 'also', 'plus', 'one more thing', 'remind me to', 'do not forget to', "don't forget to", 'dont forget to', 'i need to', 'i have to', 'i should', 'i must', 'i gotta',
]
const SEPARATOR_RE = new RegExp(`(?:[.!?;\\n]+|(?<![\\p{L}\\p{N}])(?:${SEPARATORS.join('|')})(?![\\p{L}\\p{N}]))`, 'gu')

// Palavras de enchimento no começo do item.
const LEAD_FILLERS = /^(?:(?:e|ai|aí|entao|então|bom|bem|ah|ahn|ahm|hmm|hm|uhm|hum|tipo|and|so|uh|well)\b[\s,.:;-]*)+/i

const HIGH = ['prioridade maxima', 'maxima prioridade', 'prioridade alta', 'alta prioridade', 'muito importante', 'urgentissimo', 'urgente', 'urgencia', 'importante', 'o quanto antes', 'o mais rapido possivel', 'asap', 'top priority', 'high priority', 'highest priority', 'very important', 'urgent', 'important']
const LOW = ['prioridade baixa', 'baixa prioridade', 'sem pressa', 'quando der', 'se der tempo', 'quando tiver tempo', 'low priority', 'no rush', 'when possible', 'when i have time', 'if there is time']

// Preposições que antecedem a data e saem junto com ela do título.
const DATE_PREPOSITIONS = new Set(['para', 'pra', 'na', 'no', 'ate', 'em', 'de', 'on', 'by', 'for', 'before', 'antes'])

const WORD = /\S+/g

function stripKeywords(text: string, keywords: readonly string[]): { text: string; found: boolean } {
  const folded = foldPreservingLength(text).toLowerCase()
  let out = text, outFolded = folded, found = false
  for (const keyword of [...keywords].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u')
    for (let guard = 0; guard < 4; guard++) {
      const match = re.exec(outFolded)
      if (!match) break
      found = true
      out = out.slice(0, match.index) + ' ' + out.slice(match.index + match[0].length)
      outFolded = outFolded.slice(0, match.index) + ' ' + outFolded.slice(match.index + match[0].length)
    }
  }
  return { text: out, found }
}

const tidy = (text: string) => text.replace(/\s+/g, ' ').replace(/^[\s,.:;!?-]+|[\s,.:;!?-]+$/g, '').trim()
const capitalize = (text: string) => (text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text)

/** Separa a transcrição em frases-candidatas a tarefa. */
export function splitTranscript(text: string): string[] {
  const source = text.replace(/\r/g, '\n')
  const folded = foldPreservingLength(source).toLowerCase()
  const pieces: string[] = []
  let last = 0
  for (const match of folded.matchAll(SEPARATOR_RE)) {
    pieces.push(source.slice(last, match.index))
    last = match.index! + match[0].length
  }
  pieces.push(source.slice(last))
  return pieces.map(piece => tidy(piece.replace(LEAD_FILLERS, ''))).filter(piece => /\p{L}{2}/u.test(piece))
}

/** Data/hora e prioridade de uma frase; o que foi reconhecido sai do título. */
export function parsePhrase(phrase: string, options: ExtractOptions = {}): Pick<VoiceTask, 'title' | 'date' | 'time' | 'priority'> {
  const locale = options.locale ?? 'pt-BR'
  let work = phrase
  let priority: VoicePriority = 'normal'
  const high = stripKeywords(work, HIGH)
  if (high.found) { priority = 'high'; work = high.text }
  const low = stripKeywords(work, LOW)
  if (low.found && !high.found) { priority = 'low'; work = low.text } else if (low.found) work = low.text
  work = tidy(work)

  // Janela mais longa (até 7 palavras) que o parser de datas aceita por inteiro; vale a mais cedo.
  const words = [...work.matchAll(WORD)].map(match => ({ text: match[0], index: match.index!, end: match.index! + match[0].length }))
  let date: string | null = null, time: string | null = null
  for (let i = 0; i < words.length && !date; i++) {
    for (let n = Math.min(7, words.length - i); n >= 1; n--) {
      const candidate = work.slice(words[i].index, words[i + n - 1].end).replace(/[.,;:!?]+$/, '')
      const parsed = parseNaturalDate(candidate, { now: options.now, locale })
      if (!parsed || parsed.repeat) continue
      date = parsed.start; time = parsed.time ?? null
      let from = words[i].index
      const before = i > 0 ? words[i - 1] : null
      const beforeFolded = before ? foldPreservingLength(before.text).toLowerCase().replace(/[^a-z]/g, '') : ''
      if (before && DATE_PREPOSITIONS.has(beforeFolded)) from = before.index
      work = work.slice(0, from) + ' ' + work.slice(words[i + n - 1].end)
      break
    }
  }
  return { title: capitalize(tidy(work)), date, time, priority }
}

/** Itens já separados (por IA local ou pelo usuário) → tarefas. */
export function itemsToVoiceTasks(items: readonly string[], options: ExtractOptions = {}): VoiceTask[] {
  const makeId = options.makeId ?? (() => crypto.randomUUID())
  const out: VoiceTask[] = []
  for (const item of items) {
    const parsed = parsePhrase(tidy(item), options)
    if (!/\p{L}{2}/u.test(parsed.title)) continue
    out.push({ id: makeId(), ...parsed, include: true })
  }
  return out.slice(0, 40)
}

/** Transcrição → lista editável de tarefas (no máximo 40). */
export function extractVoiceTasks(text: string, options: ExtractOptions = {}): VoiceTask[] {
  return itemsToVoiceTasks(splitTranscript(text), options)
}
