/**
 * Maths that gives the same bits on every platform. `Math.sin`, `cos`, `tan`, `atan`, `atan2`,
 * `log2`, `exp`, `pow` and even `hypot` are left to the system's libm (or the engine's own
 * rounding), and they differ in the last digit between macOS arm64 and Linux x64. The generators
 * ladder those digits up through ties and thresholds into whole different islands, so what they draw
 * from uses these instead: only `+ − × ÷` and `sqrt`, which IEEE 754 fixes exactly, in a fixed order.
 * Accuracy is about 1e-16 (as good as libm's within an ulp or two), which is all a layout needs.
 */

/** π/2 split so `k·HALF_PI_HI` is exact for small `k` (fdlibm's pio2_1, pio2_1t). */
const HALF_PI_HI = 1.5707963267341256
const HALF_PI_LO = 6.077100506506192e-11
const HALF_PI = Math.PI / 2
const TWO_OVER_PI = 2 / Math.PI
const LN2 = Math.LN2

/** Series terms: enough that the last one is under 1e-20 over each series' range. */
const TERMS = 14

/** Taylor series of sin over |r| ≤ π/4. */
function sinKernel(r: number): number {
  const r2 = r * r
  let term = r
  let sum = r
  for (let n = 1; n <= TERMS; n++) {
    term = (-term * r2) / (2 * n * (2 * n + 1))
    sum += term
  }
  return sum
}

/** Taylor series of cos over |r| ≤ π/4. */
function cosKernel(r: number): number {
  const r2 = r * r
  let term = 1
  let sum = 1
  for (let n = 1; n <= TERMS; n++) {
    term = (-term * r2) / ((2 * n - 1) * (2 * n))
    sum += term
  }
  return sum
}

/** `x` reduced to a remainder within π/4 of zero and the quadrant (0–3) it came from. */
function reduce(x: number): { r: number; quadrant: number } {
  const k = Math.round(x * TWO_OVER_PI)
  return { r: x - k * HALF_PI_HI - k * HALF_PI_LO, quadrant: ((k % 4) + 4) % 4 }
}

export function sin(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN
  const { r, quadrant } = reduce(x)
  return quadrant === 0
    ? sinKernel(r)
    : quadrant === 1
      ? cosKernel(r)
      : quadrant === 2
        ? -sinKernel(r)
        : -cosKernel(r)
}

export function cos(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN
  const { r, quadrant } = reduce(x)
  return quadrant === 0
    ? cosKernel(r)
    : quadrant === 1
      ? -sinKernel(r)
      : quadrant === 2
        ? -cosKernel(r)
        : sinKernel(r)
}

export function tan(x: number): number {
  return sin(x) / cos(x)
}

/** Series of atan over |t| ≤ tan(π/16) ≈ 0.2. */
function atanKernel(t: number): number {
  const t2 = t * t
  let power = t
  let sum = t
  for (let n = 1; n <= 12; n++) {
    power = -power * t2
    sum += power / (2 * n + 1)
  }
  return sum
}

export function atan(x: number): number {
  if (Number.isNaN(x)) return x
  const a = Math.abs(x)
  // Beyond 1, the complement; then the half-angle twice to bring the argument under 0.2.
  const big = a > 1
  const b = big ? 1 / a : a
  const h1 = b / (1 + Math.sqrt(1 + b * b))
  const h2 = h1 / (1 + Math.sqrt(1 + h1 * h1))
  const angle = 4 * atanKernel(h2)
  const out = big ? HALF_PI - angle : angle
  return x < 0 ? -out : out
}

/** The angle of the point (x, y) from the positive x axis, in (−π, π], as `Math.atan2(y, x)`. */
export function atan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN
  if (x === 0) {
    if (y !== 0) return y > 0 ? HALF_PI : -HALF_PI
    return Object.is(x, -0) ? (Object.is(y, -0) ? -Math.PI : Math.PI) : y
  }
  if (x > 0) return atan(y / x)
  return atan(y / x) + (y < 0 || Object.is(y, -0) ? -Math.PI : Math.PI)
}

/** √(x² + y²) with the sum taken in one fixed order. */
export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y)
}

/** Base-2 logarithm of a positive number. */
export function log2(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return x === 0 ? Number.NEGATIVE_INFINITY : Number.NaN
  let m = x
  let e = 0
  while (m >= 2) {
    m /= 2
    e++
  }
  while (m < 1) {
    m *= 2
    e--
  }
  if (m > Math.SQRT2) {
    m /= 2
    e++
  }
  // ln m = 2·atanh((m − 1)/(m + 1)), |s| ≤ 0.172.
  const s = (m - 1) / (m + 1)
  const s2 = s * s
  let power = s
  let sum = s
  for (let n = 1; n <= TERMS; n++) {
    power *= s2
    sum += power / (2 * n + 1)
  }
  return e + (2 * sum) / LN2
}

/** The maths the generators use, by name (`DMath.sin(x)`, as one would `Math.sin(x)`). */
export const DMath = { sin, cos, tan, atan, atan2, hypot, log2 } as const
