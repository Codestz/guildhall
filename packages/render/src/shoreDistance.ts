/**
 * The shore field's numbers (shoreField.ts makes the texture of them): how far each texel of a square
 * window is from the land, as metres or as the bytes the texture holds. No three here, so a worker can
 * bake them (`@guildhall/render/worker`) and hand the main thread the bytes to upload.
 */

export interface ShoreWindow {
  /** World [x, z] of the field's corner. */
  min: [number, number]
  /** Metres across (the field is square). */
  size: number
  /** Texels a side. */
  res: number
  isLand(x: number, z: number): boolean
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
export function shoreDistances(opts: ShoreWindow): Float32Array {
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

/** The distances as the texture's bytes: 0..255 for 0..`reach` metres (the open sea past it is 255). */
export function shoreBytes(opts: ShoreWindow & { reach: number }): Uint8Array {
  const metres = shoreDistances(opts)
  const data = new Uint8Array(metres.length)
  for (let k = 0; k < metres.length; k++)
    data[k] = Math.round(Math.min(1, (metres[k] as number) / opts.reach) * 255)
  return data
}
