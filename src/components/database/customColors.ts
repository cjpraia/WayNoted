// Cores livres de opções (#rrggbb): calcula fundo/texto/ponto legíveis para os temas claro e escuro.
// O fundo é a cor misturada com o fundo do tema; o texto é escurecido/clareado até contraste ≥ 4,5:1.

export function normalizeHex(value: string): string | null {
  const text = value.trim().toLowerCase()
  const short = text.match(/^#?([0-9a-f])([0-9a-f])([0-9a-f])$/)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  const long = text.match(/^#?([0-9a-f]{6})$/)
  return long ? `#${long[1]}` : null
}

type Rgb = [number, number, number]
const toRgb = (hex: string): Rgb => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as Rgb
const toHex = (rgb: Rgb) => `#${rgb.map((channel) => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, '0')).join('')}`
const mix = (a: Rgb, b: Rgb, amount: number): Rgb => [0, 1, 2].map((index) => a[index] * amount + b[index] * (1 - amount)) as Rgb

function luminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => { const value = channel / 255; return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(toRgb(a)), luminance(toRgb(b))].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

const LIGHT_BG: Rgb = [255, 255, 255]
const DARK_BG: Rgb = [25, 25, 25]

function readableText(color: Rgb, background: Rgb, towards: Rgb): string {
  for (let step = 0; step <= 20; step++) {
    const candidate = toHex(mix(towards, color, step / 20))
    if (contrastRatio(candidate, toHex(background)) >= 4.5) return candidate
  }
  return toHex(towards)
}

export interface CustomColorTokens { lightBg: string; lightText: string; darkBg: string; darkText: string; dot: string }

export function customColorTokens(hex: string): CustomColorTokens | null {
  const normalized = normalizeHex(hex)
  if (!normalized) return null
  const color = toRgb(normalized)
  // Fundo claro nunca escuro demais e fundo escuro nunca claro demais, para o texto caber em 4,5:1.
  let lightAmount = 0.28, darkAmount = 0.45
  while (lightAmount > 0.05 && luminance(mix(color, LIGHT_BG, lightAmount)) < 0.55) lightAmount -= 0.03
  while (darkAmount > 0.05 && luminance(mix(color, DARK_BG, darkAmount)) > 0.08) darkAmount -= 0.03
  const lightBg = mix(color, LIGHT_BG, lightAmount)
  const darkBg = mix(color, DARK_BG, darkAmount)
  return {
    lightBg: toHex(lightBg),
    lightText: readableText(color, lightBg, [20, 20, 20]),
    darkBg: toHex(darkBg),
    darkText: readableText(color, darkBg, [250, 250, 250]),
    dot: normalized,
  }
}

/** Variáveis CSS para `.db-color-custom` (ver db-tokens.css). */
export function customColorStyle(hex: string | undefined): Record<string, string> | undefined {
  const tokens = hex ? customColorTokens(hex) : null
  if (!tokens) return undefined
  return { '--cc-light-bg': tokens.lightBg, '--cc-light-text': tokens.lightText, '--cc-dark-bg': tokens.darkBg, '--cc-dark-text': tokens.darkText, '--cc-dot': tokens.dot }
}
