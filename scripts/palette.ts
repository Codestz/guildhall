/**
 * Palette bake for the Kenney kits (scripts/assets.ts `town2`): every colormap texel is moved toward
 * the nearest colour of KayKit's hexagon palette, so a Fantasy Town wall stands beside a KayKit home
 * without looking like another game's. Kenney's colormaps are flat colours with a soft vertical
 * gradient, KayKit's the same idea in warmer, earthier hues, so a snap in Lab space keeps each
 * swatch's shading and only changes its hue family.
 *
 * Self-contained PNG reading and writing (8-bit RGB/RGBA, not interlaced: what both packs ship), so
 * the pipeline needs no image library.
 */
import { deflateSync, inflateSync } from "node:zlib"

export interface Raster {
  width: number
  height: number
  /** RGBA, 8 bits a channel, row after row. */
  data: Uint8Array
}

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)

export function decodePng(bytes: Uint8Array): Raster {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = SIGNATURE.length
  let width = 0
  let height = 0
  let channels = 4
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
      const colour = body[9]
      if (depth !== 8 || (colour !== 2 && colour !== 3 && colour !== 6) || body[12] !== 0)
        throw new Error(`png: only 8-bit palette/RGB/RGBA, not interlaced (depth ${depth}, colour ${colour})`)
      channels = colour === 6 ? 4 : colour === 2 ? 3 : 1
    } else if (type === "PLTE") swatches = body
    else if (type === "tRNS") alphas = body
    else if (type === "IDAT") parts.push(body)
    at += 12 + length
  }
  const raw = inflateSync(Buffer.concat(parts))
  const stride = width * channels
  const out = new Uint8Array(width * height * 4)
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
  for (let i = 0; i < width * height; i++) {
    if (channels === 1) {
      const index = rows[i] ?? 0
      for (let c = 0; c < 3; c++) out[i * 4 + c] = swatches?.[index * 3 + c] ?? 0
      out[i * 4 + 3] = alphas?.[index] ?? 255
      continue
    }
    for (let c = 0; c < 3; c++) out[i * 4 + c] = rows[i * channels + c] ?? 0
    out[i * 4 + 3] = channels === 4 ? (rows[i * 4 + 3] ?? 255) : 255
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

type Lab = [number, number, number]

/** sRGB bytes → CIE Lab (D65). */
function lab(r: number, g: number, b: number): Lab {
  const lin = (v: number): number => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)]
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  const x = f((0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047)
  const y = f(0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb)
  const z = f((0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

/** The palette's colours: eight rows down the middle of every swatch (an 8 × 4 sheet of gradients). */
export function paletteOf(sheet: Raster): Uint8Array[] {
  const cell = [sheet.width / 8, sheet.height / 4] as const
  const out: Uint8Array[] = []
  for (let sy = 0; sy < 4; sy++)
    for (let sx = 0; sx < 8; sx++)
      for (let row = 0; row < 8; row++) {
        const x = Math.floor((sx + 0.5) * cell[0])
        const y = Math.floor((sy + (row + 0.5) / 8) * cell[1])
        out.push(sheet.data.slice((y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 3))
      }
  return out
}

/** How far a texel is pulled onto its palette colour: the whole way (1) or not at all (0). */
const PULL = 0.85
/** Lightness counts for less than hue in the match: it is the gradient's, and the lit scene's, to keep. */
const L_WEIGHT = 0.6

export interface Baked {
  raster: Raster
  /** Mean distance (ΔE, Lab) from each opaque texel to its nearest palette colour, before and after. */
  before: number
  after: number
}

/** `source` with every texel pulled toward its nearest colour of `palette`. */
export function bakeToPalette(source: Raster, palette: readonly Uint8Array[]): Baked {
  const labs = palette.map(([r = 0, g = 0, b = 0]) => lab(r, g, b))
  const data = new Uint8Array(source.data)
  const cache = new Map<number, [Uint8Array, number, number]>()
  let before = 0
  let after = 0
  let count = 0
  const nearest = (color: Lab): number => {
    let best = 0
    let bestD = Number.POSITIVE_INFINITY
    labs.forEach((candidate, i) => {
      const d =
        (L_WEIGHT * (color[0] - candidate[0])) ** 2 +
        (color[1] - candidate[1]) ** 2 +
        (color[2] - candidate[2]) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    return best
  }
  for (let i = 0; i < source.width * source.height; i++) {
    if ((source.data[i * 4 + 3] ?? 0) < 8) continue
    const [r = 0, g = 0, b = 0] = source.data.subarray(i * 4, i * 4 + 3)
    const id = (r << 16) | (g << 8) | b
    let hit = cache.get(id)
    if (!hit) {
      const color = lab(r, g, b)
      const best = nearest(color)
      const target = palette[best] as Uint8Array
      // The pull is a lerp in sRGB bytes; the distances are Lab's.
      const pulled = Uint8Array.from([r, g, b].map((v, k) => Math.round(v + ((target[k] ?? 0) - v) * PULL)))
      const goal = labs[best] as Lab
      const gap = (a: Lab): number => Math.hypot(a[0] - goal[0], a[1] - goal[1], a[2] - goal[2])
      hit = [pulled, gap(color), gap(lab(pulled[0] ?? 0, pulled[1] ?? 0, pulled[2] ?? 0))]
      cache.set(id, hit)
    }
    data.set(hit[0], i * 4)
    before += hit[1]
    after += hit[2]
    count++
  }
  return {
    raster: { width: source.width, height: source.height, data },
    before: before / count,
    after: after / count,
  }
}
