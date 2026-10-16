// MD5 (RFC 1321) só para casar <en-media hash="…"> com o anexo; o ENEX Archive identifica anexos por MD5.
const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0)

export function md5Hex(data: Uint8Array): string {
  const length = data.length
  const total = (((length + 8) >>> 6) + 1) << 6
  const view = new DataView(new ArrayBuffer(total))
  new Uint8Array(view.buffer).set(data)
  view.setUint8(length, 0x80)
  view.setUint32(total - 8, (length << 3) >>> 0, true)
  view.setUint32(total - 4, Math.floor(length / 0x20000000) >>> 0, true)
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
  const m = new Uint32Array(16)
  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) m[i] = view.getUint32(offset + i * 4, true)
    let a = a0, b = b0, c = c0, d = d0
    for (let i = 0; i < 64; i++) {
      let f: number, g: number
      if (i < 16) { f = (b & c) | (~b & d); g = i }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15 }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15 }
      else { f = c ^ (b | ~d); g = (7 * i) & 15 }
      const sum = (a + f + K[i] + m[g]) >>> 0
      const shift = S[(i >> 4) * 4 + (i & 3)]
      a = d; d = c; c = b
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0
  }
  const out = new DataView(new ArrayBuffer(16))
  out.setUint32(0, a0, true); out.setUint32(4, b0, true); out.setUint32(8, c0, true); out.setUint32(12, d0, true)
  return [...new Uint8Array(out.buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
