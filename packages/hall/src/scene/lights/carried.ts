import { type Material, Matrix4, type Mesh, type MeshStandardMaterial, type Object3D, Vector3 } from "three"
import { FRAME } from "../frame.ts"

/**
 * Carried lanterns (the user: "the lamps on the characters, why they don't have light?"): every
 * lantern in a hand — an adventurer's after dark, a guard's, the night watchman's — registers here
 * while it is held. Once a frame, after the pose, `track()` finds where each flame is in the world;
 * scene/lights/CarriedLights draws a halo and a ground pool there, and scene/lights/NearLights lets
 * the nearest of them carry one of its two real point lights. Their glass wears one shared lit
 * copy of the kit's glass (`LitGlass`), glowing with the night.
 *
 * A carrier drawn by the baked crowd (scene/body.ts) has its rig out of the scene: its glass has no
 * world matrix worth reading. While it is, its body names a stand-in (`standIn`) that says where
 * the crowd draws the glass — the crowd's baked hand (crowd/Crowd.ts `held`) — and the light follows that.
 */

/** After every pose and levelling (characters animate at WORLD), before the frame is drawn (RENDER). */
export const AFTER_POSE = FRAME.WORLD + 0.5

/** A lantern in someone's hand. */
export interface Carried {
  /** The glass pane: its world matrix places the flame. */
  readonly glass: Mesh
  /** The flame in the glass's own space: the middle of the pane's box. */
  readonly center: Vector3
  /** The body that carries it: the ground under the lantern is at its height. */
  readonly body: Object3D
  /** Where the flame is, world space; written by `track()`, valid while `lit`. */
  readonly at: Vector3
  /** The ground's height under it, written by `track()`. */
  ground: number
  /** Held and seen this frame (every ancestor visible, in a scene). */
  lit: boolean
  /** Flicker phase, so no two lanterns breathe in step. */
  readonly phase: number
}

/** Every lantern held right now, in the order they were taken up. */
export const carried: Carried[] = []

/** Where a body drawn by something other than its rig (a crowd member) draws what it holds. */
export interface StandIn {
  /** `glass`'s world matrix as drawn now, into `target`; false when it isn't drawn. */
  place(glass: Mesh, target: Matrix4): boolean
  /** The ground's height under the body. */
  ground(): number
}

const standIns = new WeakMap<Object3D, StandIn>()

/** `body`'s lanterns are where `stand` says from now on; null: where its own rig has them again. */
export function standIn(body: Object3D, stand: StandIn | null): void {
  if (stand) standIns.set(body, stand)
  else standIns.delete(body)
}

let taken = 0

/**
 * `held` (a kit lantern, or the grip pivot it hangs from) is carried by `body` from now until the
 * returned function is called: its glass wears the lit copy, and it joins `carried`. A piece with
 * no glass is left alone (the returned function does nothing).
 */
export function carryLantern(held: Object3D, body: Object3D): () => void {
  const glass = glassOf(held)
  if (!glass) return () => {}
  const own = glass.material as Material
  glass.material = litGlass.take(own)
  if (!glass.geometry.boundingBox) glass.geometry.computeBoundingBox()
  const box = glass.geometry.boundingBox
  const entry: Carried = {
    glass,
    center: box ? box.getCenter(new Vector3()) : new Vector3(),
    body,
    at: new Vector3(),
    ground: 0,
    lit: false,
    phase: (taken++ * 2.39) % (Math.PI * 2),
  }
  carried.push(entry)
  return () => {
    const index = carried.indexOf(entry)
    if (index < 0) return
    carried.splice(index, 1)
    if (glass.material === litGlass.material) glass.material = own
    litGlass.give()
  }
}

/** The lantern's glass pane: its transparent mesh. */
export function glassOf(held: Object3D): Mesh | null {
  let found: Mesh | null = null
  held.traverse((child) => {
    const mesh = child as Mesh
    if (found || !mesh.isMesh || Array.isArray(mesh.material)) return
    if ((mesh.material as Material).transparent) found = mesh
  })
  return found
}

/**
 * Once a frame, after the pose: which lanterns are seen, and where their flames are. Each glass's
 * world matrix is brought up to date through its bones first (the renderer would only do it later);
 * a stand-in's body is asked instead. No allocation.
 */
export function track(): void {
  for (const entry of carried) {
    const stand = standIns.get(entry.body)
    if (stand) {
      entry.lit = stand.place(entry.glass, drawn)
      if (!entry.lit) continue
      entry.at.copy(entry.center).applyMatrix4(drawn)
      entry.ground = stand.ground()
      continue
    }
    entry.lit = shown(entry.glass)
    if (!entry.lit) continue
    entry.glass.updateWorldMatrix(true, false)
    entry.at.copy(entry.center).applyMatrix4(entry.glass.matrixWorld)
    entry.ground = entry.body.matrixWorld.elements[13] ?? 0
  }
}

const drawn = new Matrix4()

/** Every ancestor visible, up to a scene: hidden lanterns, hidden or dissolved-out carriers are not. */
export function shown(object: Object3D): boolean {
  let node: Object3D | null = object
  while (node) {
    if (!node.visible) return false
    if ((node as Object3D & { isScene?: boolean }).isScene) return true
    node = node.parent
  }
  return false
}

/** How lit the lanterns are from `sky.lamps`: nothing by day (the sky keeps a 0.12 floor), full at night. */
export function nightGlow(lamps: number): number {
  return Math.min(1, Math.max(0, (lamps - 0.3) / 0.7))
}

/** A candle's breath, 1 when still (reduced motion). */
export function flicker(t: number, phase: number, still: boolean): number {
  if (still) return 1
  return 0.88 + Math.sin(t * 9.1 + phase) * 0.06 + Math.sin(t * 15.7 + phase * 2) * 0.05
}

/**
 * The glass every carried lantern wears: one copy of the kit's glass (so no program or draw call
 * more), made when the first lantern is taken up and freed when the last is put down. Its glow is
 * set once a frame (`set`): clear by day, warm and bright enough at night for bloom to catch it.
 */
class LitGlass {
  material: MeshStandardMaterial | null = null
  private holders = 0
  /** The glass's own opacity, by day. */
  private base = 0.2

  take(source: Material): Material {
    this.holders++
    if (!this.material) {
      const copy = source.clone() as MeshStandardMaterial
      copy.name = "glass (lit)"
      this.material = copy
      this.base = copy.opacity
    }
    return this.material
  }

  give(): void {
    this.holders = Math.max(0, this.holders - 1)
    if (this.holders > 0 || !this.material) return
    this.material.dispose()
    this.material = null
  }

  /** `glow` 0 (day) to 1 (night), in the flame's colour. */
  set(glow: number, fire: { r: number; g: number; b: number }): void {
    const material = this.material
    if (!material?.emissive) return
    material.emissive.setRGB(fire.r, fire.g, fire.b)
    material.emissiveIntensity = glow * GLASS_GLOW
    material.opacity = this.base + (GLASS_LIT_OPACITY - this.base) * glow
  }
}

/** HDR: with the pane's opacity, ≈ 2.5× white at night, so bloom picks the glass out a little. */
const GLASS_GLOW = 4
/** A lit pane reads as filled with light, not as clear glass. */
const GLASS_LIT_OPACITY = 0.6

export const litGlass = new LitGlass()

/** A point to light: a fixed flame or a carried one. */
export type Flame = readonly [number, number, number] | Carried

/**
 * Up to `out.length` flames nearest (x, z), static `fixed` and lit `moving` alike, nearest first,
 * written into `out` (the rest left undefined). No allocation: a partial insertion sort.
 */
export function nearestFlames(
  x: number,
  z: number,
  fixed: readonly (readonly [number, number, number])[],
  moving: readonly Carried[],
  out: (Flame | undefined)[],
  distances: number[],
): void {
  const count = out.length
  for (let k = 0; k < count; k++) {
    out[k] = undefined
    distances[k] = Number.POSITIVE_INFINITY
  }
  for (const flame of fixed) insert(out, distances, flame, (flame[0] - x) ** 2 + (flame[2] - z) ** 2)
  for (const entry of moving)
    if (entry.lit) insert(out, distances, entry, (entry.at.x - x) ** 2 + (entry.at.z - z) ** 2)
}

/** Puts `flame` (squared distance `d`) in its place in the sorted `out`, dropping the farthest. */
function insert(out: (Flame | undefined)[], distances: number[], flame: Flame, d: number): void {
  let k = out.length - 1
  if (k < 0 || d >= (distances[k] ?? Number.POSITIVE_INFINITY)) return
  while (k > 0 && (distances[k - 1] ?? Number.POSITIVE_INFINITY) > d) {
    out[k] = out[k - 1]
    distances[k] = distances[k - 1] ?? Number.POSITIVE_INFINITY
    k--
  }
  out[k] = flame
  distances[k] = d
}

/** Is this flame a carried lantern (vs a fixed flame's [x, y, z])? */
export function isCarried(flame: Flame): flame is Carried {
  return !Array.isArray(flame)
}
