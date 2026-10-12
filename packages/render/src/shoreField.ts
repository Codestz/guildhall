/**
 * How far each point of the water is from the land, as a texture the water reads (water.ts `field`):
 * the depth colour, the foam rim and the wave lines rolling in all key off it, as V1's baked shore mask
 * did (legacy/packages/hall/src/scene/nature/shoreBake.ts), but from a plain land test instead of a GPU
 * bake, so it works for any ground the caller can answer "is this land?" for.
 */
import { ClampToEdgeWrapping, DataTexture, LinearFilter, RedFormat, UnsignedByteType, Vector4 } from "three"

export interface ShoreFieldOpts {
  /** World [x, z] of the field's corner. */
  min: [number, number]
  /** Metres across (the field is square). */
  size: number
  /** Texels a side. */
  res: number
  /** Distances are stored up to this, metres (the open sea past it reads as `reach`). */
  reach: number
  isLand(x: number, z: number): boolean
}

export interface ShoreField {
  texture: DataTexture
  /** x0, z0, 1 / size, 1 / size: world xz to field uv. */
  window: Vector4
  reach: number
  dispose(): void
}

const INF = 1e20

/** Felzenszwalb's exact 1D squared distance transform of `f` (length n) into `d` (as mapbox's tiny-sdf). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1, k = 0, s = 0; q < n; q++) {
    const fq = f[q] as number
    do {
      const r = v[k] as number
      s = (fq - (f[r] as number) + q * q - r * r) / (q - r) / 2
    } while (s <= (z[k] as number) && --k > -1)
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  for (let q = 0, k = 0; q < n; q++) {
    while ((z[k + 1] as number) < q) k++
    const r = v[k] as number
    d[q] = (q - r) * (q - r) + (f[r] as number)
  }
}

/**
 * Metres from each texel centre to the nearest land texel (0 on land), row-major from `min`, as
 * a pure function: the exact Euclidean distance transform of the land mask.
 */
export function shoreDistances(opts: Omit<ShoreFieldOpts, "reach">): Float32Array {
  const { min, size, res, isLand } = opts
  const texel = size / res
  const grid = new Float64Array(res * res)
  for (let j = 0; j < res; j++) {
    const z = min[1] + (j + 0.5) * texel
    for (let i = 0; i < res; i++) grid[j * res + i] = isLand(min[0] + (i + 0.5) * texel, z) ? 0 : INF
  }
  const f = new Float64Array(res)
  const d = new Float64Array(res)
  const v = new Int32Array(res)
  const zz = new Float64Array(res + 1)
  for (let i = 0; i < res; i++) {
    for (let j = 0; j < res; j++) f[j] = grid[j * res + i] as number
    edt1d(f, res, d, v, zz)
    for (let j = 0; j < res; j++) grid[j * res + i] = d[j] as number
  }
  const out = new Float32Array(res * res)
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) f[i] = grid[j * res + i] as number
    edt1d(f, res, d, v, zz)
    for (let i = 0; i < res; i++) out[j * res + i] = Math.sqrt(d[i] as number) * texel
  }
  return out
}

/** The field as a linear-filtered R8 texture (0..reach metres). */
export function bakeShoreField(opts: ShoreFieldOpts): ShoreField {
  const metres = shoreDistances(opts)
  const data = new Uint8Array(metres.length)
  for (let k = 0; k < metres.length; k++)
    data[k] = Math.round(Math.min(1, (metres[k] as number) / opts.reach) * 255)
  const texture = new DataTexture(data, opts.res, opts.res, RedFormat, UnsignedByteType)
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.unpackAlignment = 1
  texture.needsUpdate = true
  const window = new Vector4(opts.min[0], opts.min[1], 1 / opts.size, 1 / opts.size)
  return { texture, window, reach: opts.reach, dispose: () => texture.dispose() }
}
