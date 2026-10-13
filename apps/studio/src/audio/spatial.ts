// From V1 hall (legacy/packages/hall/src/audio/spatial.ts), held to its goldens (test/audio.test.ts).
/**
 * Where sounds sit, cheaply: a stereo pan and a distance gain from the camera, not HRTF. The
 * listener is the point on the ground the camera looks at, its right-hand direction, and how wide
 * the view is there (`radius`, world units), so a zoomed-out island hears the whole of it and a
 * close view hears what is near.
 */
export interface Listener {
  x: number
  z: number
  /** Unit vector to the screen's right, on the ground. */
  rx: number
  rz: number
  /** Half the view's width at the focus, world units. */
  radius: number
}

export const NO_LISTENER: Listener = { x: 0, z: 0, rx: 1, rz: 0, radius: 60 }

/** Pan never goes fully to one ear: a hard-panned note sounds broken on headphones. */
const MAX_PAN = 0.8
/** Inside this many view radii a sound is at full level; it fades to the floor by `FAR`. */
const NEAR = 0.7
const FAR = 2.6

/**
 * Pan (−1 left … 1 right) and gain (`floor`…1) for a sound at (x, z). `floor` keeps distant notes
 * audible but soft (the guild's music); ambience spots pass 0 so they vanish when far.
 */
export function placeOf(
  x: number,
  z: number,
  listener: Listener,
  floor = 0.25,
): { pan: number; gain: number } {
  const dx = x - listener.x
  const dz = z - listener.z
  const radius = Math.max(1, listener.radius)
  const side = (dx * listener.rx + dz * listener.rz) / radius
  const pan = Math.max(-1, Math.min(1, side)) * MAX_PAN
  const distance = Math.hypot(dx, dz) / radius
  const near = 1 - smoothstep(NEAR, FAR, distance)
  return { pan: round(pan), gain: round(floor + (1 - floor) * near) }
}

/**
 * A camera as the listener reads it: what three's cameras carry (apps never import three: the
 * Stage's `camera` is passed in as is). Perspective: `fov`; orthographic: its frustum and zoom.
 */
export interface CameraLike {
  position: { x: number; y: number; z: number }
  matrixWorld: { elements: ArrayLike<number> }
  fov?: number
  isOrthographicCamera?: boolean
  left?: number
  right?: number
  zoom?: number
}

/**
 * The listener for a camera: where its view ray meets the ground, and how wide the view is there.
 * V1's `listenerOf` read three's `getWorldDirection` (the world matrix's −Z column, normalised) and
 * `setFromMatrixColumn(…, 0)` (its X column); the same columns, read off the matrix here.
 */
export function listenerOf(camera: CameraLike, aspect: number): Listener {
  const e = camera.matrixWorld.elements
  const zx = e[8] ?? 0
  const zy = e[9] ?? 0
  const zz = e[10] ?? 1
  const zl = Math.hypot(zx, zy, zz) || 1
  const dir = { x: -zx / zl, y: -zy / zl, z: -zz / zl }
  const right = { x: e[0] ?? 1, z: e[2] ?? 0 }
  const flat = Math.hypot(right.x, right.z) || 1
  const pos = camera.position
  // The ground hit; looking flat at the horizon, a point 40 units ahead.
  const t = dir.y < -0.05 ? -pos.y / dir.y : 40
  const x = pos.x + dir.x * t
  const z = pos.z + dir.z * t
  const radius = camera.isOrthographicCamera
    ? ((camera.right ?? 1) - (camera.left ?? -1)) / (2 * Math.max(1e-3, camera.zoom ?? 1))
    : t * Math.tan(((camera.fov ?? 40) * Math.PI) / 360) * aspect
  return { x, z, rx: right.x / flat, rz: right.z / flat, radius: Math.max(4, radius) }
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

const round = (value: number): number => Math.round(value * 1000) / 1000
