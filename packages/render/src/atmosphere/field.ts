/**
 * Where the clouds are (pure): a seeded field of clouds, each a handful of puffs, drifting with the
 * wind across a square that wraps round the island, and how present each one is for a coverage (0
 * clear … 1 overcast). The cloud meshes, their shadows and their reflections all read the same field,
 * so what drifts overhead is what darkens the ground and what the water shows.
 */
import { roll } from "@guildhall/core"

export interface Puff {
  /** Offset from the cloud's centre, metres, in the cloud's own frame (x along its length). */
  x: number
  y: number
  z: number
  /** Radius, metres. */
  r: number
}

export interface Cloud {
  /** Where it starts, metres from the field's centre. */
  x: number
  z: number
  /** The height of its flat base, metres. */
  base: number
  /** Heading of its long axis, radians. */
  turn: number
  /** Size multiplier: its puffs grow with coverage on top of this. */
  size: number
  /** It appears once coverage passes this (0–1): the field fills in cloud by cloud. */
  threshold: number
  puffs: Puff[]
}

export interface FieldOpts {
  seed: number
  count: number
  /** Half side of the wrapping square, metres. */
  span: number
  /** The bases' height range, metres. */
  height: [number, number]
}

/**
 * A cloud's puffs, the KayKit way: low and wide, not a cotton ball. A long row of lumps of clearly
 * different sizes (the biggest off-centre, the ends tapering, so no two clouds are symmetric), a row
 * behind it and a shorter one in front for depth, all sitting on one flat base, and a single low lump
 * on top. Radii and offsets are in units of the swell (field.ts `swell`); the mesh squashes each lump
 * vertically too (clouds.ts).
 */
function puffsOf(r: (salt: string) => number): Puff[] {
  const puffs: Puff[] = []
  const count = 4 + Math.floor(r("count") * 4)
  const peak = 1 + Math.floor(r("peak") * (count - 2))
  let x = 0
  for (let k = 0; k < count; k++) {
    // Toward the ends the lumps get smaller: the cloud's outline tapers like a loaf.
    const end = Math.abs(k - peak) / Math.max(peak, count - 1 - peak)
    const radius = k === peak ? 1 : (0.5 + 0.3 * r(`${k}:r`)) * (1 - 0.35 * end)
    if (k > 0) x += 0.62 * (radius + (puffs[k - 1] as Puff).r) * (0.85 + 0.25 * r(`${k}:gap`))
    puffs.push({ x, y: 0.12 * (radius - 1), z: (r(`${k}:z`) - 0.5) * 0.3, r: radius })
  }
  // A row behind (one lump fewer) and a shorter one in front: z, how many fewer, radius.
  const rows: [number, number, number][] = [
    [-0.6, 1, 0.6],
    [0.55, 2, 0.5],
  ]
  for (const [z, fewer, size] of rows) {
    const n = Math.max(1, count - fewer)
    for (let k = 0; k < n; k++) {
      const next = puffs[Math.min(count - 1, k + Math.floor(fewer / 2))] as Puff
      puffs.push({
        x: next.x + (r(`${z}:${k}:x`) - 0.5) * 0.7,
        y: -0.08,
        z: z + (r(`${z}:${k}:z`) - 0.5) * 0.2,
        r: size + 0.2 * r(`${z}:${k}:r`),
      })
    }
  }
  const top = puffs[peak] as Puff
  puffs.push({ x: top.x + (r("tx") - 0.5) * 0.6, y: 0.42, z: -0.1, r: 0.62 + 0.15 * r("tr") })
  // Centred on its middle, so a cloud turns about itself.
  const mid = (puffs[count - 1] as Puff).x / 2
  return puffs.map((p) => ({ ...p, x: p.x - mid }))
}

/** The field: `count` clouds spread over the square, thresholds spread evenly so coverage fills smoothly. */
export function cloudField(opts: FieldOpts): Cloud[] {
  const { seed, count, span, height } = opts
  return Array.from({ length: count }, (_, i) => {
    // FNV mixes a salt's trailing characters poorly (core/hash.ts): the varying parts go first, and the
    // index is scrambled so neighbouring clouds share no digits.
    const key = Math.imul(i + 1, 0x9e3779b1) >>> 0
    const r = (salt: string) => roll(seed, `${salt}:${key}:cloud`)
    return {
      x: (2 * r("x") - 1) * span,
      z: (2 * r("z") - 1) * span,
      base: height[0] + (height[1] - height[0]) * r("h"),
      turn: Math.PI * r("turn"),
      size: 0.8 + 0.5 * r("size"),
      // Stratified, then shuffled by the seed: every coverage step adds about the same number of clouds.
      threshold: Math.min(0.98, (i + r("t")) / count),
      puffs: puffsOf(r),
    }
  })
}

/** `value` wrapped into [-span, span). */
export function wrap(value: number, span: number): number {
  const side = 2 * span
  return ((((value + span) % side) + side) % side) - span
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** How far a cloud is out (0–1) at `coverage`: it grows in over a short band past its threshold. */
export function presence(threshold: number, coverage: number): number {
  return smoothstep(threshold - 0.02, threshold + 0.1, coverage)
}

/** The puff radius scale at `coverage`: fair-weather clouds are small, overcast ones swell. */
export function swell(coverage: number): number {
  return 8 + 9 * clamp01(coverage)
}

/** Past this camera distance (metres) the near fade stops growing: a wide view keeps the clouds in front. */
export const VIEW_REACH = 330

/**
 * How visible a cloud's mesh is from the camera (0–1): gone near the eye, and, for close views, kept
 * off the focus (a disc round the camera's target), so a cloud never hangs between the hero view and
 * the town. A wide view (the whole island) keeps the clouds over it. Shadows and reflections are not
 * faded: only what would block the view is.
 */
export function viewFade(toCamera: number, toTarget: number, cameraDistance: number): number {
  const reach = Math.min(cameraDistance, VIEW_REACH)
  const near = smoothstep(0.55 * reach, 0.95 * reach, toCamera)
  const clear = smoothstep(0.35 * reach, 0.75 * reach, toTarget)
  return near * (1 + (clear - 1) * focusWeight(cameraDistance))
}

/** How much the clear disc round the target applies: fully for close views, not at all for wide ones. */
export function focusWeight(cameraDistance: number): number {
  return 1 - smoothstep(350, 550, cameraDistance)
}
