import type { Mood } from "../../world/moods.ts"

/**
 * Mood LUTs (docs/research/gpu-techniques.md V5): each mood's film stock, as a 3D colour table the
 * post pass looks every pixel up in after tone mapping (MoodLut.ts). The grade before it (exposure,
 * saturation, split tone, contrast: GradeEffect.ts, sky.ts) still sets the levels; the LUT adds
 * what a per-pixel formula can't cheaply do — moves by hue band: the lime and mustard of sunlit
 * grass pulled towards a deeper green, firelight kept saturated while the blue shade calms, an
 * orange/teal separation, a soft S-curve, a film toe.
 *
 * Generated in code, not authored as .cube files: a look is a handful of numbers (`LutLook`), so
 * each mood's day stock and the golden-hour, night and storm variants blend smoothly as *numbers*,
 * and one small table (16³, 16 KB) is re-baked only when the blend has moved. Values live in a
 * perceptual domain (√ of linear light): the table is indexed by √c and stores √ of the result.
 */
export interface LutLook {
  /** Per-channel slope, offset and power (ASC CDL), in the √ domain. */
  slope: [number, number, number]
  offset: [number, number, number]
  power: [number, number, number]
  /** S-curve round mid-grey: 0 none, ~0.3 firm. */
  curve: number
  /** Black lift towards `fadeColour` (film toe), 0–~0.05. */
  fade: number
  fadeColour: [number, number, number]
  /** Yellow-green band (lime grass, mustard meadow at sunset): hue shift towards green (+, in turns) and saturation. */
  foliageHue: number
  foliageSat: number
  /** Saturation of the warm band (fire, roofs, skin) and of the cool band (sky, sea, blue shade). */
  warmSat: number
  coolSat: number
  /** Orange/teal separation: warm tones pushed warmer, cool ones cooler, 0–~0.3. */
  split: number
}

/** A look being blended (the same numbers, written in place: no allocations per frame). */
export type Mutable = LutLook

/** Numbers that blend by adding a weighted difference from neutral, and those that multiply. */
const ADD = ["curve", "fade", "foliageHue", "split"] as const
const MUL = ["foliageSat", "warmSat", "coolSat"] as const

export const NEUTRAL: LutLook = {
  slope: [1, 1, 1],
  offset: [0, 0, 0],
  power: [1, 1, 1],
  curve: 0,
  fade: 0,
  fadeColour: [0, 0, 0],
  foliageHue: 0,
  foliageSat: 1,
  warmSat: 1,
  coolSat: 1,
  split: 0,
}

const look = (partial: Partial<LutLook>): LutLook => ({ ...NEUTRAL, ...partial })

/** Each mood's daylight stock. */
export const DAY_STOCK: Record<Mood["id"], LutLook> = {
  // Clean storybook: lime grass to a fresh green, rich sky and sea, a crisp curve.
  keep: look({
    curve: 0.12,
    fade: 0.008,
    fadeColour: [0.12, 0.14, 0.24],
    foliageHue: 0.018,
    foliageSat: 0.96,
    coolSat: 1.06,
    warmSat: 1.04,
    split: 0.06,
  }),
  // Amber film: warm highlights, brown toe, blues pulled to deep teal, greens to olive.
  hearth: look({
    slope: [1.03, 1.0, 0.94],
    offset: [0.008, 0.0, -0.008],
    curve: 0.14,
    fade: 0.025,
    fadeColour: [0.26, 0.16, 0.1],
    foliageHue: -0.006,
    foliageSat: 0.88,
    warmSat: 1.1,
    coolSat: 0.86,
    split: 0.14,
  }),
  // Silver stock: calm cool colour, blue-green foliage, warm lights survive.
  moonstone: look({
    slope: [0.97, 1.0, 1.04],
    offset: [0, 0.004, 0.01],
    curve: 0.1,
    fade: 0.014,
    fadeColour: [0.1, 0.14, 0.24],
    foliageHue: 0.04,
    foliageSat: 0.84,
    warmSat: 1.02,
    coolSat: 0.86,
    split: 0.08,
  }),
  // Violet shade, cyan highlights, foliage leaning teal.
  arcane: look({
    slope: [1.0, 0.99, 1.03],
    offset: [0.004, -0.002, 0.01],
    curve: 0.16,
    fade: 0.012,
    fadeColour: [0.22, 0.1, 0.3],
    foliageHue: 0.05,
    foliageSat: 0.94,
    warmSat: 1.04,
    coolSat: 1.04,
    split: 0.08,
  }),
}

/**
 * What the time of day adds, the same for every mood (each mood's character stays in its day
 * stock). Golden hour: the warm light against a cooler shade, a firmer curve, and the sunlit grass
 * taken out of mustard into olive-green. Night: the blue kept rich, everything but firelight a
 * little calmer, a faint blue toe so silhouettes read. Storm: steel — cooler, firmer, less colour.
 */
export const TIME_STOCK = {
  golden: look({
    slope: [1.02, 1.0, 0.98],
    offset: [0, 0, 0.006],
    curve: 0.12,
    foliageHue: 0.035,
    foliageSat: 1.0,
    warmSat: 1.06,
    coolSat: 1.04,
    split: 0.1,
  }),
  night: look({
    offset: [0, 0.002, 0.008],
    curve: 0.06,
    fade: 0.01,
    fadeColour: [0.06, 0.1, 0.24],
    foliageHue: 0.03,
    foliageSat: 0.9,
    warmSat: 1.08,
    coolSat: 1.0,
  }),
  storm: look({
    slope: [0.98, 1.0, 1.03],
    offset: [0, 0.002, 0.008],
    curve: 0,
    foliageHue: 0.03,
    foliageSat: 0.9,
    warmSat: 1.0,
    coolSat: 0.98,
  }),
} as const

export function createLook(): Mutable {
  return copyLook(
    { ...NEUTRAL, slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1], fadeColour: [0, 0, 0] },
    NEUTRAL,
  )
}

export function copyLook(out: Mutable, from: LutLook): Mutable {
  for (let i = 0; i < 3; i++) {
    out.slope[i] = from.slope[i] as number
    out.offset[i] = from.offset[i] as number
    out.power[i] = from.power[i] as number
    out.fadeColour[i] = from.fadeColour[i] as number
  }
  for (const key of ADD) out[key] = from[key]
  for (const key of MUL) out[key] = from[key]
  return out
}

/** Adds what `delta` does relative to neutral, weighted. */
function addDelta(out: Mutable, delta: LutLook, weight: number): void {
  if (weight <= 0) return
  for (let i = 0; i < 3; i++) {
    out.slope[i] = (out.slope[i] as number) * (1 + ((delta.slope[i] as number) - 1) * weight)
    out.offset[i] = (out.offset[i] as number) + (delta.offset[i] as number) * weight
    out.power[i] = (out.power[i] as number) * (1 + ((delta.power[i] as number) - 1) * weight)
  }
  // The toe's colour moves towards the delta's as far as the delta brings its own toe.
  const toe = delta.fade * weight
  const share = toe / Math.max(out.fade + toe, 1e-6)
  for (let i = 0; i < 3; i++)
    out.fadeColour[i] = lerp(out.fadeColour[i] as number, delta.fadeColour[i] as number, share)
  for (const key of ADD) out[key] += (delta[key] - NEUTRAL[key]) * weight
  for (const key of MUL) out[key] *= 1 + (delta[key] - 1) * weight
}

/** The look for this moment: the mood's day stock, with golden hour, night and storm added. */
export function lookFor(
  out: Mutable,
  mood: Mood["id"],
  weights: { golden: number; night: number; storm: number },
): Mutable {
  copyLook(out, DAY_STOCK[mood])
  addDelta(out, TIME_STOCK.golden, weights.golden)
  addDelta(out, TIME_STOCK.night, weights.night)
  addDelta(out, TIME_STOCK.storm, weights.storm)
  return out
}

/** How far apart two looks are (largest change of any number): re-bake only past a threshold. */
export function lookDistance(a: LutLook, b: LutLook): number {
  let d = 0
  for (const key of ADD) d = Math.max(d, Math.abs(a[key] - b[key]))
  for (const key of MUL) d = Math.max(d, Math.abs(a[key] - b[key]))
  for (let i = 0; i < 3; i++)
    d = Math.max(
      d,
      Math.abs((a.slope[i] as number) - (b.slope[i] as number)),
      Math.abs((a.offset[i] as number) - (b.offset[i] as number)),
      Math.abs((a.power[i] as number) - (b.power[i] as number)),
      Math.abs((a.fadeColour[i] as number) - (b.fadeColour[i] as number)) * 0.2,
    )
  return d
}

/**
 * The S-curve's still point (7% linear, in the √ domain): low enough that a dim scene (storm,
 * dusk, night) is not pushed darker; the curve mostly adds snap to the lit tones above it.
 */
const PIVOT = Math.sqrt(0.07)
const graded: [number, number, number] = [0, 0, 0]
const hsv: [number, number, number] = [0, 0, 0]

/** One colour through a look, in the √ domain (0–1 in, 0–1 out). Written into a shared triple. */
export function gradeColour(look: LutLook, r0: number, g0: number, b0: number): [number, number, number] {
  // 1. CDL.
  let r = Math.max(0, r0 * look.slope[0] + look.offset[0]) ** look.power[0]
  let g = Math.max(0, g0 * look.slope[1] + look.offset[1]) ** look.power[1]
  let b = Math.max(0, b0 * look.slope[2] + look.offset[2]) ** look.power[2]

  // 2. Hue bands. Foliage (yellow-green, hue ~0.13–0.3), warm (red-orange, ~0.97–0.11), cool
  // (cyan-blue, ~0.45–0.7); neutral greys have no hue and are left alone.
  toHsv(r, g, b)
  let [h, s] = hsv
  const v = hsv[2]
  const foliage = band(h, 0.18, 0.1)
  const warm = band(h, 0.04, 0.075)
  const cool = band(h, 0.58, 0.14)
  h = (h + look.foliageHue * foliage + 1) % 1
  s *= 1 + (look.foliageSat - 1) * foliage
  s *= 1 + (look.warmSat - 1) * warm
  s *= 1 + (look.coolSat - 1) * cool
  fromHsv(h, Math.min(1, s), v)
  ;[r, g, b] = hsv

  // 3. Orange/teal: warm tones a little warmer, cool ones cooler, by how much colour they carry.
  const chroma = Math.max(r, g, b) - Math.min(r, g, b)
  const push = look.split * chroma * (warm - cool)
  r += push * 0.5
  b -= push * 0.5

  // 4. S-curve round mid-grey (by luminance, so hues hold), then the film toe.
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
  if (look.curve !== 0 && l > 1e-4) {
    // A ratio that is 1 at black (no crushed toe), dips below the pivot, lifts above it.
    const k = Math.max(0, 1 + look.curve * 6 * l * (1 - l) * (l - PIVOT))
    r *= k
    g *= k
    b *= k
  }
  const f = look.fade
  graded[0] = clamp01(look.fadeColour[0] * f + r * (1 - f))
  graded[1] = clamp01(look.fadeColour[1] * f + g * (1 - f))
  graded[2] = clamp01(look.fadeColour[2] * f + b * (1 - f))
  return graded
}

/** Bakes a look into a size³ RGBA8 table (x = red fastest, then green, then blue: Data3DTexture). */
export function bakeLut(
  look: LutLook,
  size: number,
  out = new Uint8Array(size * size * size * 4),
): Uint8Array {
  let i = 0
  const n = size - 1
  for (let z = 0; z < size; z++)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const [r, g, b] = gradeColour(look, x / n, y / n, z / n)
        out[i++] = Math.round(r * 255)
        out[i++] = Math.round(g * 255)
        out[i++] = Math.round(b * 255)
        out[i++] = 255
      }
  return out
}

/** Weight of a hue (0–1, wrapping) in a band round `centre`, falling to 0 at ± `half`; 0 for greys. */
function band(h: number, centre: number, half: number): number {
  const d = Math.abs(((h - centre + 1.5) % 1) - 0.5)
  const t = clamp01(1 - d / half)
  return t * t * (3 - 2 * t) * smooth(0.04, 0.16, hsv[1])
}

function toHsv(r: number, g: number, b: number): void {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const c = max - min
  let h = 0
  if (c > 1e-6) {
    if (max === r) h = ((g - b) / c + 6) % 6
    else if (max === g) h = (b - r) / c + 2
    else h = (r - g) / c + 4
    h /= 6
  }
  hsv[0] = h
  hsv[1] = max > 1e-6 ? c / max : 0
  hsv[2] = max
}

function fromHsv(h: number, s: number, v: number): void {
  const k = (n: number) => (n + h * 6) % 6
  const f = (n: number) => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1))
  hsv[0] = f(5)
  hsv[1] = f(3)
  hsv[2] = f(1)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function smooth(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}
