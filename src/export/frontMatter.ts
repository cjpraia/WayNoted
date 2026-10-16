// Front-matter YAML legível. Valores complexos usam a forma de fluxo (JSON), que também é YAML válido.

type Value = unknown
const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/
const PLAIN_VALUE = /^[\p{L}\p{N}][\p{L}\p{N} ._,/()+-]*$/u
const RESERVED = /^(true|false|null|yes|no|on|off|~|[-+]?(\d|\.\d))/i

function key(name: string): string {
  return PLAIN_KEY.test(name) ? name : JSON.stringify(name)
}

function scalar(value: Value): string {
  if (typeof value === 'string') return PLAIN_VALUE.test(value) && !RESERVED.test(value) && !/\s$/.test(value) ? value : JSON.stringify(value)
  if (value === undefined) return 'null'
  return JSON.stringify(value)
}

/** `entries` preserva a ordem; objetos simples de 1 nível viram mapas indentados. */
export function stringifyFrontMatter(entries: [string, Value][]): string {
  const lines = ['---']
  for (const [name, value] of entries) {
    if (value === undefined) continue
    if (value && typeof value === 'object' && !Array.isArray(value) && (value as { __map?: boolean }).__map) {
      const map = Object.entries(value as Record<string, Value>).filter(([k]) => k !== '__map')
      if (!map.length) { lines.push(`${key(name)}: {}`); continue }
      lines.push(`${key(name)}:`)
      for (const [child, item] of map) lines.push(`  ${key(child)}: ${scalar(item)}`)
    } else lines.push(`${key(name)}: ${scalar(value)}`)
  }
  lines.push('---')
  return lines.join('\n')
}

/** Marca um objeto para ser escrito como mapa YAML indentado (mais legível que JSON). */
export function yamlMap(value: Record<string, Value>): Record<string, Value> {
  return Object.defineProperty({ ...value }, '__map', { value: true, enumerable: false }) as Record<string, Value>
}

function parseKey(line: string): [string, string] | null {
  if (line.startsWith('"')) {
    let end = 1
    while (end < line.length && line[end] !== '"') end += line[end] === '\\' ? 2 : 1
    try {
      const name = JSON.parse(line.slice(0, end + 1)) as string
      const rest = line.slice(end + 1)
      return rest.startsWith(':') ? [name, rest.slice(1).trim()] : null
    } catch { return null }
  }
  const index = line.indexOf(':')
  return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1).trim()] : null
}

function parseScalar(raw: string): Value {
  if (raw === '' || raw === '~' || raw === 'null') return null
  if (raw === 'true' || raw === 'false') return raw === 'true'
  if (/^[[{"]/.test(raw) || /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(raw)) {
    try { return JSON.parse(raw) } catch { /* texto livre */ }
  }
  if (/^'.*'$/.test(raw)) return raw.slice(1, -1).replace(/''/g, "'")
  return raw
}

/** Separa front-matter e corpo. Aceita o subconjunto produzido pelo aplicativo e YAML simples de chave/valor. */
export function parseFrontMatter(source: string): { data: Record<string, Value>; body: string } {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  if (!text.startsWith('---\n')) return { data: {}, body: text }
  const end = text.indexOf('\n---', 4)
  if (end < 0) return { data: {}, body: text }
  const block = text.slice(4, end).split('\n')
  const after = text.slice(end + 4)
  const body = after.startsWith('\n') ? after.slice(1) : after
  const data: Record<string, Value> = {}
  let current: Record<string, Value> | null = null
  for (const line of block) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (/^\s+/.test(line) && current) {
      const pair = parseKey(line.trim())
      if (pair) current[pair[0]] = parseScalar(pair[1])
      continue
    }
    const pair = parseKey(line)
    if (!pair) continue
    if (pair[1] === '') { current = {}; data[pair[0]] = current } else { current = null; data[pair[0]] = parseScalar(pair[1]) }
  }
  return { data, body }
}
