import type { OrthographicCamera as Ortho, PerspectiveCamera as Persp, Vector3 as Vec3 } from "three"
import { Vector3 } from "three"
import type { IslandView } from "../../guild/islandView.ts"
import type { Archipelago } from "../../world/archipelagoSource.ts"
import { HOME, type Stop } from "../../world/islandRing.ts"
import { easeInOut } from "../cameraMath.ts"
import { flightSeconds, flightSize, frameOf } from "./view.ts"

/**
 * A flight between islands (the camera rig's, scene/CameraRig.tsx): a crane over the sea. The shot
 * rises (pulls back) as the camera crosses along a gentle arc and settles onto the target framing,
 * 1.4–1.8 s, ease in-out, keeping the angle you look from. With reduced motion it is a quick cut
 * under a cross-fade instead (hud/Islands.tsx draws the fade; the cut lands at its darkest).
 * Motion only — which flight, and what to do about the Bard and the pick, is the rig's call.
 */

/**
 * Where a flight is, read by the scene without rendering (module state, like islandView): the stop
 * it is bound for and how far along it is (0–1). A far island promotes itself to its near tier
 * while the camera is still on the way (scene/archipelago/ArchipelagoLayer.tsx).
 */
export const travel: { heading: Stop | null; progress: number } = { heading: null, progress: 0 }

/** The sizes a shot can take, from the rig: orthographic zoom (`wide`, `mapZoom`) and perspective distance. */
export interface Sizes {
  /** An island's overview zoom (orthographic). */
  wide: number
  mapZoom: number
  mapDistance: number
  /** The least perspective distance of an island's overview. */
  far: number
  /** How close in a followed adventurer is shot: zoom (orthographic) or distance (perspective). */
  follow: number
}

export interface Trip {
  to: Vector3
  /** Shot size now and at the end: orthographic zoom or perspective distance. */
  sizeFrom: number
  sizeTo: number
  /** How far the shot pulls out halfway (0: not at all). */
  pull: number
  /** How far the path bows sideways, world units. */
  bow: number
  seconds: number
}

/** A long flight pulls out this much halfway (a short one less). */
const ISLAND_PULL = 0.45
/** A path bows sideways by this share of its length. */
const BOW = 0.12
/** Reduced motion: the cut lands this long after the request, s (the cross-fade's darkest moment). */
export const FADE_CUT_S = 0.18

/**
 * Plans the trip a request asks for from where the camera is: to the island's overview, to the map's,
 * or (with `at`) to a spot on the island, close in if the shot is not already. `size` is the camera's
 * zoom (orthographic) or distance from its target (perspective).
 */
export function planTrip(
  request: IslandView,
  archipelago: Archipelago,
  from: Vec3,
  size: number,
  isOrtho: boolean,
  sizes: Sizes,
): Trip {
  const map = request.stop === "map"
  const frame = frameOf(request.stop, archipelago)
  const to = new Vector3(request.at?.[0] ?? frame.x, 1, request.at?.[1] ?? frame.z)
  const length = from.distanceTo(to)
  const overview = isOrtho ? sizes.wide : Math.max(sizes.far, frame.radius * 1.3)
  const fitted = map ? (isOrtho ? sizes.mapZoom : sizes.mapDistance) : overview
  return {
    to,
    sizeFrom: size,
    sizeTo: request.at ? (isOrtho ? Math.max(size, sizes.follow) : Math.min(size, sizes.follow)) : fitted,
    pull: map ? 0 : Math.min(ISLAND_PULL, length / 600),
    bow: map ? 0 : length * BOW,
    seconds: flightSeconds(length + (map ? 200 : 0)),
  }
}

export class Flight {
  /** The request flown last (view.ts counts them): a new one is a new trip. */
  n = 0
  flying = false
  /** The stop it is going to is home: the Bard gets the camera back on landing. */
  home = false
  private t = 0
  private wait = 0
  private seconds = 1
  private sizeFrom = 1
  private sizeTo = 1
  private pull = 0
  private readonly from = new Vector3()
  private readonly to = new Vector3()
  private readonly bend = new Vector3()
  private readonly side = new Vector3()
  private readonly dir = new Vector3()

  /** Start `trip` from `from`. `cut`: arrive at once; `fade`: arrive at once, after the cross-fade's dark. */
  begin(from: Vec3, trip: Trip, stop: Stop, how: { cut: boolean; fade: boolean }): void {
    this.from.copy(from)
    this.to.copy(trip.to)
    // The path's one bend: the midpoint pushed sideways, so the crossing is an arc seen from above.
    this.side.set(-(trip.to.z - from.z), 0, trip.to.x - from.x).normalize()
    this.bend.copy(this.from).lerp(this.to, 0.5).addScaledVector(this.side, trip.bow)
    this.sizeFrom = trip.sizeFrom
    this.sizeTo = trip.sizeTo
    this.pull = trip.pull
    this.seconds = trip.seconds
    this.t = how.cut || how.fade ? 1 : 0
    this.wait = how.fade && !how.cut ? FADE_CUT_S : 0
    this.home = stop === HOME
    this.flying = true
    travel.heading = stop
    travel.progress = 0
  }

  /**
   * Moves the camera along the flight by `delta` seconds; false when none is under way. `back` is how
   * far an orthographic camera stands from its target; `fallback` the direction to use if it is on it.
   */
  step(
    delta: number,
    camera: Ortho | Persp,
    control: { target: Vec3 },
    isOrtho: boolean,
    back: number,
    fallback: Vec3,
  ): boolean {
    if (!this.flying) return false
    if (this.wait > 0) {
      this.wait -= delta
      return true
    }
    this.t = Math.min(1, this.t + delta / this.seconds)
    const p = easeInOut(this.t)
    const q = 1 - p
    // A quadratic Bézier: from, through the bend, to.
    control.target
      .copy(this.from)
      .multiplyScalar(q * q)
      .addScaledVector(this.bend, 2 * q * p)
      .addScaledVector(this.to, p * p)
    const dir = this.dir.copy(camera.position).sub(control.target)
    if (dir.lengthSq() < 1e-6) dir.copy(fallback)
    dir.normalize()
    const size = flightSize(this.sizeFrom, this.sizeTo, p, this.pull, isOrtho)
    if (isOrtho) {
      ;(camera as Ortho).zoom = size
      camera.position.copy(control.target).addScaledVector(dir, back)
    } else {
      camera.position.copy(control.target).addScaledVector(dir, size)
    }
    camera.updateProjectionMatrix()
    travel.progress = this.t
    if (this.t >= 1) {
      this.flying = false
      travel.heading = null
    }
    return true
  }
}
