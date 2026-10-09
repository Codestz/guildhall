/**
 * Cascaded shadows for a gen 2 island, as pure geometry (no three, no GPU): where each cascade's
 * orthographic light camera stands and how big it is. The island is too big for one map to be crisp
 * near the camera and still reach the far coast, so the key light draws several maps of one shape:
 * nested discs of ground, centred on what the camera looks at, each `ratio` times wider than the one
 * inside it. The last is the whole island and never moves. The shader (cascadeChunk.ts) takes the
 * tightest map that holds a pixel and blends into the next at the edge.
 *
 * A cascade is a cylinder (a disc of ground, from the sea floor to the tallest roof or peak), fitted
 * exactly: its light camera is as wide as the disc and as tall and deep as the cylinder's shadow
 * is, plus the stretch upstream where a tall caster outside the disc still throws into it. At a
 * low sun the box is wide and shallow, so a 55-unit mountain at golden hour casts its full length.
 */

/** Directions are the key light's, unit length, pointing from the ground towards the light. */
export type Direction = readonly [number, number, number]

/** One cascade's light camera: where it stands, what it looks at, and its box. */
export interface Fit {
  position: [number, number, number]
  target: [number, number, number]
  /** Half-width across (always the disc's radius) and half-height up the light camera's y axis. */
  half: number
  halfUp: number
  near: number
  far: number
  /** World units one shadow texel covers across, for the bias. */
  texel: number
}

/** The ground's lowest and highest point a cascade must hold, world units. */
export interface Span {
  floor: number
  ceiling: number
}

/** How far upstream a caster can throw into a cascade, at most (a long shadow at a very low sun). */
const UPSTREAM_MAX = 160
/** The light never sits flatter than this over the horizon (rad): a grazing sun would stretch the box without end. */
const MIN_ELEVATION = 0.12

/** The near cascade's radius for a view that needs `need` units of ground crisp, in steps (so a zoom redraws rarely). */
const STEPS = [14, 20, 28, 40, 56, 80]
export function nearRadius(need: number, far: number, count: number): number {
  const cap = count > 1 ? far / 1.8 : far
  let radius = STEPS[STEPS.length - 1] as number
  for (const step of STEPS) {
    if (step >= need) {
      radius = step
      break
    }
  }
  return Math.max(STEPS[0] as number, Math.min(radius, cap))
}

/** Radii of `count` cascades from `near` to `far`: even ratios, so each map is as much coarser as the last. */
export function cascadeRadii(count: number, near: number, far: number): number[] {
  if (count <= 1) return [far < near ? far : near]
  const radii: number[] = []
  for (let i = 0; i < count; i++) radii.push(near * (far / near) ** (i / (count - 1)))
  return radii
}

/** The grid a cascade's centre snaps to: the last never moves, the others a quarter-radius at a time. */
export function cellOf(radius: number, last: boolean): number {
  return last ? Number.POSITIVE_INFINITY : Math.max(2, radius / 4)
}

/** Snap a coordinate to the cell (an infinite cell is the origin). */
export function snap(value: number, cell: number): number {
  return Number.isFinite(cell) ? Math.round(value / cell) * cell : 0
}

/**
 * The light camera for the disc of ground of `radius` round (cx, cz). Its x axis runs level across
 * the light, its y axis is the light's own up, its z the way back to the light: the extents of a
 * cylinder along each follow from the axis's horizontal and vertical parts.
 */
export function fitCascade(
  dir: Direction,
  cx: number,
  cz: number,
  radius: number,
  span: Span,
  map: number,
): Fit {
  let [dx, dy, dz] = dir
  const length = Math.hypot(dx, dy, dz) || 1
  dx /= length
  dy /= length
  dz /= length
  // Keep the sun off the horizon for the box (the light's own direction is untouched elsewhere).
  const flat = Math.hypot(dx, dz)
  if (dy < Math.sin(MIN_ELEVATION)) {
    const k = Math.cos(MIN_ELEVATION) / (flat || 1)
    dx = flat ? dx * k : Math.cos(MIN_ELEVATION)
    dz *= flat ? k : 1
    dy = Math.sin(MIN_ELEVATION)
  }
  const horizontal = Math.hypot(dx, dz)
  const half = (span.ceiling - span.floor) / 2
  const centreY = (span.ceiling + span.floor) / 2
  // y axis = d × (up × d) normalised: its horizontal part is the sun's elevation, its vertical the rest.
  const upHorizontal = dy
  const upVertical = horizontal
  const halfUp = radius * upHorizontal + half * upVertical
  const halfDeep = radius * horizontal + half * dy
  // Where a caster beyond the disc still reaches it: a taller thing is further away along the ground.
  const upstream = Math.min(UPSTREAM_MAX, span.ceiling / Math.max(Math.tan(Math.asin(dy)), 0.05))
  const stand = halfDeep + upstream + 1
  return {
    position: [cx + dx * stand, centreY + dy * stand, cz + dz * stand],
    target: [cx, centreY, cz],
    half: radius,
    halfUp,
    near: 1,
    far: stand + halfDeep + 1,
    texel: (2 * radius) / map,
  }
}

/** Shadow biases that follow a cascade's texel: a coarse map needs a wider berth (three reads bias as a share of depth). */
export function biasOf(fit: Fit): { bias: number; normalBias: number } {
  const range = fit.far - fit.near
  return { bias: -(0.01 + 0.3 * fit.texel) / range, normalBias: 0.01 + 0.4 * fit.texel }
}
