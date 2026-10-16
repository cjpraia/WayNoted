import COMPAT from '../../shared/compatibility.ts'
// Cena embutida em PNG/SVG exportados (como no Excalidraw): a imagem continua editável ao ser
// arrastada/colada de volta num quadro. PNG: bloco tEXt próprio; SVG: <metadata>. Puro, sem DOM.
import { normalizeObject, type CanvasObject } from './model.ts'

export const SCENE_KEYWORD = COMPAT.record025
const FORMAT = COMPAT.record026

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
function fromBase64(value: string): string {
  const binary = atob(value.replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export function encodeScene(objects: readonly CanvasObject[]): string { return toBase64(JSON.stringify({ format: FORMAT, version: 1, objects })) }
export function decodeScene(payload: string): CanvasObject[] | null {
  try {
    const value = JSON.parse(fromBase64(payload))
    if (!value || value.format !== FORMAT || !Array.isArray(value.objects)) return null
    return value.objects.map(normalizeObject).filter((o: CanvasObject | null): o is CanvasObject => !!o)
  } catch { return null }
}

// ---------- SVG ----------

export function embedInSvg(svg: string, objects: readonly CanvasObject[]): string {
  return svg.replace(/^(<svg\b[^>]*>)/, `$1<metadata id="${SCENE_KEYWORD}">${encodeScene(objects)}</metadata>`)
}
export function sceneFromSvg(text: string): CanvasObject[] | null {
  const match = new RegExp(`<metadata id="${SCENE_KEYWORD}">([A-Za-z0-9+/=\\s]+)</metadata>`).exec(text)
  return match ? decodeScene(match[1]) : null
}

// ---------- PNG ----------

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function crc32(bytes: Uint8Array): number { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
export const isPng = (bytes: Uint8Array) => bytes.length > 8 && SIGNATURE.every((b, i) => bytes[i] === b)

/** Inserts a tEXt chunk (keyword + base64 scene) before IEND. */
export function embedInPng(bytes: Uint8Array, objects: readonly CanvasObject[]): Uint8Array {
  if (!isPng(bytes)) return bytes
  const latin = new TextEncoder().encode(`${SCENE_KEYWORD}\0${encodeScene(objects)}`)
  const type = new TextEncoder().encode('tEXt')
  const chunk = new Uint8Array(12 + latin.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, latin.length)
  chunk.set(type, 4); chunk.set(latin, 8)
  view.setUint32(8 + latin.length, crc32(chunk.subarray(4, 8 + latin.length)))
  // IEND = últimos 12 bytes.
  const end = bytes.length - 12
  const out = new Uint8Array(bytes.length + chunk.length)
  out.set(bytes.subarray(0, end)); out.set(chunk, end); out.set(bytes.subarray(end), end + chunk.length)
  return out
}

export function sceneFromPng(bytes: Uint8Array): CanvasObject[] | null {
  if (!isPng(bytes)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (type === 'tEXt') {
      const data = bytes.subarray(offset + 8, offset + 8 + length)
      const zero = data.indexOf(0)
      if (zero > 0 && new TextDecoder().decode(data.subarray(0, zero)) === SCENE_KEYWORD) return decodeScene(new TextDecoder().decode(data.subarray(zero + 1)))
    }
    if (type === 'IEND') break
    offset += 12 + length
  }
  return null
}
