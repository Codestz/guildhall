import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat } from "three"

/**
 * Baked, tileable noise for the water and the grass (docs/perf-budget.md: no noise maths per
 * pixel). One 256² RGBA8 texture: R/G the slope of a soft fbm height field (a ripple normal),
 * B the height itself, A a second, finer, independent field (foam breakup, sparkle).
 */
export function noiseTexels(size = 256, seed = 11): Uint8Array {
  const height = fbm(size, seed, [4, 8, 16, 32], [1, 0.5, 0.28, 0.14])
  const fine = fbm(size, seed + 97, [16, 32, 64], [1, 0.5, 0.25])
  const out = new Uint8Array(size * size * 4)
  // Slopes: central differences, wrapped; scaled so a typical slope fills the byte range.
  const slope = size / 10
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const at = (dx: number, dy: number) =>
        height[((y + dy + size) % size) * size + ((x + dx + size) % size)] as number
      const sx = (at(1, 0) - at(-1, 0)) * slope
      const sy = (at(0, 1) - at(0, -1)) * slope
      const i = (y * size + x) * 4
      out[i] = byte(0.5 + 0.5 * sx)
      out[i + 1] = byte(0.5 + 0.5 * sy)
      out[i + 2] = byte(height[y * size + x] as number)
      out[i + 3] = byte(fine[y * size + x] as number)
    }
  return out
}

export function noiseTexture(): DataTexture {
  const size = 256
  const texture = new DataTexture(noiseTexels(size), size, size, RGBAFormat)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

const byte = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255)

/** Periodic value-noise fbm in [0, 1]: each octave a lattice of `cells` that wraps at `size`. */
function fbm(
  size: number,
  seed: number,
  octaves: readonly number[],
  weights: readonly number[],
): Float32Array {
  const out = new Float32Array(size * size)
  let total = 0
  octaves.forEach((cells, octave) => {
    const weight = weights[octave] ?? 0
    total += weight
    const lattice = new Float32Array(cells * cells)
    for (let i = 0; i < lattice.length; i++) lattice[i] = hash(seed * 7919 + octave * 104729 + i)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells
        const fy = (y / size) * cells
        const x0 = Math.floor(fx)
        const y0 = Math.floor(fy)
        const tx = fade(fx - x0)
        const ty = fade(fy - y0)
        const v = (cx: number, cy: number) => lattice[(cy % cells) * cells + (cx % cells)] as number
        const top = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * tx
        const bottom = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * tx
        out[y * size + x] = (out[y * size + x] as number) + (top + (bottom - top) * ty) * weight
      }
  })
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) / total
  return out
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)

function hash(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}
