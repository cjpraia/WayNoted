// Reuse the original PNG artwork inside the existing ICNS; no separate brand asset.
import fs from 'node:fs'
const source = fs.readFileSync(new URL('./icon.icns', import.meta.url))
const images = new Map()
for (let offset = 8; offset + 8 <= source.length;) {
  const length = source.readUInt32BE(offset + 4)
  if (length < 8 || offset + length > source.length) throw new Error('Invalid ICNS resource')
  const png = source.subarray(offset + 8, offset + length)
  if (png.length > 24 && png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20)
    if (width === height && width <= 256) images.set(width, png)
  }
  offset += length
}
if (!images.has(256)) throw new Error('A 256px PNG icon is required')
const entries = [...images].sort(([a], [b]) => a - b)
const header = Buffer.alloc(6 + 16 * entries.length)
header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4)
let offset = header.length
entries.forEach(([size, png], index) => {
  const i = 6 + 16 * index
  header[i] = header[i + 1] = size === 256 ? 0 : size
  header.writeUInt16LE(1, i + 4); header.writeUInt16LE(32, i + 6)
  header.writeUInt32LE(png.length, i + 8); header.writeUInt32LE(offset, i + 12); offset += png.length
})
fs.writeFileSync(new URL('./icon.ico', import.meta.url), Buffer.concat([header, ...entries.map(([, png]) => png)]))
