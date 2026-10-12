/**
 * Where each sun cascade's orthographic light camera stands (ADR 009), as pure maths: no three, no
 * GPU. A cascade is a square of `2 * radius` across in the light's own view plane, centred near what
 * the camera looks at. Its radius never changes, so zooming never rescales a map. Its centre is
 * snapped to whole shadow texels in light space, so a moving target only ever slides the map by whole
 * texels: every texel edge stays where it was in the world, and shadows never shimmer or swim.
 */

export type Vec3 = [number, number, number]

/** An axis-aligned world box. */
export interface Box {
  min: Vec3
  max: Vec3
}

/** The world heights a cascade must hold: the ground at the bottom, the tallest caster at the top. */
export interface Span {
  floor: number
  ceiling: number
}

/** One cascade's light camera. Three's `lookAt` from `position` to `target` gives the same axes as here. */
export interface CascadeFit {
  position: Vec3
  target: Vec3
  /** Half-width of the square ortho box, in metres: the cascade's radius. */
  half: number
  near: number
  far: number
  /** Metres one shadow texel covers. */
  texel: number
  /** The snapped centre in whole texels along the light's x, y and z: a new key means a new map. */
  key: string
}

/** The light camera's near plane is never closer than this (a near ≤ 0 clips casters; V1 M3-L3). */
export const MIN_NEAR = 1
/** The default heights: flat ground up to a tall tower. */
export const DEFAULT_SPAN: Span = { floor: 0, ceiling: 30 }
/** A sun lower than this (sine of its elevation) is treated as this high when sizing the depth range. */
const MIN_SINE = 0.1

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}
const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

/**
 * The light's axes for a sun direction (from the ground towards the sun): x level across the light,
 * y the light's up, z back towards the sun. The same as three's `Matrix4.lookAt` with world up +y.
 */
export function lightAxes(sunDir: Vec3): [Vec3, Vec3, Vec3] {
  const z = unit(sunDir)
  // A sun straight overhead has no "across": any level axis will do.
  const x = Math.hypot(z[0], z[2]) < 1e-9 ? ([1, 0, 0] as Vec3) : unit(cross([0, 1, 0], z))
  return [x, cross(z, x), z]
}

/** One cascade of `radius` round `centre`, snapped to whole texels of a `mapSize` map in light space. */
export function fitCascade(centre: Vec3, sunDir: Vec3, radius: number, mapSize: number, span = DEFAULT_SPAN) {
  const [x, y, z] = lightAxes(sunDir)
  const texel = (2 * radius) / mapSize
  const steps: Vec3 = [x, y, z].map((axis) => Math.round(dot(centre, axis) / texel)) as Vec3
  const target = add(add(scale(x, steps[0] * texel), scale(y, steps[1] * texel)), scale(z, steps[2] * texel))
  // How far along z, from the centre, the slab floor..ceiling reaches inside the box: a point at light
  // y = b and height h sits at z = (h - centre.y - b * y.y) / z.y.
  const sine = Math.max(z[1], MIN_SINE)
  const tall = radius * Math.abs(y[1])
  const toward = (span.ceiling - target[1] + tall) / sine
  const away = (span.floor - target[1] - tall) / sine
  // Back the light off so the nearest caster is MIN_NEAR in front of it.
  const back = Math.max(toward, 0) + MIN_NEAR
  const fit: CascadeFit = {
    position: add(target, scale(z, back)),
    target,
    half: radius,
    near: MIN_NEAR,
    far: back - Math.min(away, 0) + MIN_NEAR,
    texel,
    key: steps.join(","),
  }
  return fit
}

/** The cascades of fixed `radii` (smallest first) round the camera target. Zoom never changes them. */
export function fitCascades(
  target: Vec3,
  sunDir: Vec3,
  radii: readonly number[],
  mapSize: number,
  span = DEFAULT_SPAN,
): CascadeFit[] {
  return radii.map((radius) => fitCascade(target, sunDir, radius, mapSize, span))
}

/** The static cascade that holds the whole `box` (its bounding sphere), from any sun. */
export function fitBox(box: Box, sunDir: Vec3, mapSize: number): CascadeFit {
  const centre = scale(add(box.min, box.max), 0.5)
  const radius = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) / 2
  return fitCascade(centre, sunDir, radius, mapSize, { floor: box.min[1], ceiling: box.max[1] })
}
