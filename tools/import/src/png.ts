/**
 * Self-contained PNG reading and writing (8-bit grey/RGB/palette/RGBA, not interlaced), ported from
 * legacy/scripts/palette.ts, so the importer samples texture atlases without an image library.
 */
import { deflateSync, inflateSync } from "node:zlib"

export interface Raster {
  width: number
  height: number
  /** RGBA, 8 bits a channel, row after row. */
  data: Uint8Array
}

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
/** Channels per PNG colour type: 0 grey, 2 RGB, 3 palette, 4 grey + alpha, 6 RGBA. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

export const isPng = (bytes: Uint8Array): boolean => SIGNATURE.every((b, i) => bytes[i] === b)

export function decodePng(bytes: Uint8Array): Raster {
  if (!isPng(bytes)) throw new Error("png: not a PNG file")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = SIGNATURE.length
  let width = 0
  let height = 0
  let colour = 6
  let swatches: Uint8Array | undefined
  let alphas: Uint8Array | undefined
  const parts: Uint8Array[] = []
  while (at < bytes.length) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (type === "IHDR") {
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      const depth = body[8]
      colour = body[9] ?? -1
      if (depth !== 8 || CHANNELS[colour] === undefined || body[12] !== 0)
        throw new Error(`png: only 8-bit, not interlaced (depth ${depth}, colour ${colour})`)
    } else if (type === "PLTE") swatches = body
    else if (type === "tRNS") alphas = body
    else if (type === "IDAT") parts.push(body)
    at += 12 + length
  }
  const channels = CHANNELS[colour] ?? 4
  const raw = inflateSync(Buffer.concat(parts))
  const stride = width * channels
  const rows = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0
      const left = x >= channels ? (rows[y * stride + x - channels] ?? 0) : 0
      const up = y > 0 ? (rows[(y - 1) * stride + x] ?? 0) : 0
      const corner = x >= channels && y > 0 ? (rows[(y - 1) * stride + x - channels] ?? 0) : 0
      let guess = 0
      if (filter === 1) guess = left
      else if (filter === 2) guess = up
      else if (filter === 3) guess = (left + up) >> 1
      else if (filter === 4) {
        const p = left + up - corner
        const [pl, pu, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)]
        guess = pl <= pu && pl <= pc ? left : pu <= pc ? up : corner
      }
      rows[y * stride + x] = (value + guess) & 255
    }
  }
  const out = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const px = rows.subarray(i * channels, i * channels + channels)
    if (colour === 3) {
      const index = px[0] ?? 0
      for (let c = 0; c < 3; c++) out[i * 4 + c] = swatches?.[index * 3 + c] ?? 0
      out[i * 4 + 3] = alphas?.[index] ?? 255
    } else if (colour === 0 || colour === 4) {
      out.fill(px[0] ?? 0, i * 4, i * 4 + 3)
      out[i * 4 + 3] = colour === 4 ? (px[1] ?? 255) : 255
    } else {
      out.set(px.subarray(0, 3), i * 4)
      out[i * 4 + 3] = colour === 6 ? (px[3] ?? 255) : 255
    }
  }
  return { width, height, data: out }
}

const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (bytes: Uint8Array): number => {
  let c = 0xffffffff
  for (const byte of bytes) c = (CRC[(c ^ byte) & 255] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** RGBA PNG, filter 0. The fixture script uses it to build tiny textures. */
export function encodePng({ width, height, data }: Raster): Uint8Array {
  const rows = new Uint8Array((width * 4 + 1) * height)
  for (let y = 0; y < height; y++)
    rows.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
  const chunk = (type: string, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + body.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, body.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(body, 8)
    view.setUint32(8 + body.length, crc(out.subarray(4, 8 + body.length)))
    return out
  }
  const head = new Uint8Array(13)
  const view = new DataView(head.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  head.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ])
}
