/**
 * A lab's camera on a world, set up the same way on every world screen: the rig held inside the world
 * (never under the ground or the water, never out past the sea), free flight on `F` or the corner
 * chip's toggle, and `?cam=free` starting in it. `ui=0` leaves the chip out for clean shots.
 */
import type { Stage, World } from "@guildhall/render"
import { param } from "../params.ts"
import { type CamKeys, createCamChip } from "./camKeys.ts"

export interface WorldCamera {
  /**
   * The world is in: holds the rig inside `world` (or the one already set, as the town controller
   * does), shows the chip, and enters free flight when the link asked for it.
   */
  start(world?: World): void
  dispose(): void
}

/**
 * The camera's limits on an island of half side `span` (metres, the farthest land from the middle plus
 * a margin): the farthest zoom frames the island with a band of sea round it (no empty sea, no sea
 * edge, `maxReach` of the island's own box seen from above), the tilt far out stays above `highFloor` (38°, near V1's angle) (the rig's
 * `highFloor`), and the target is leashed near the middle as the view pulls back (`hold`). Free flight
 * roams a wider box; the horizon haze hides the sea's end from anywhere in it.
 */
export const ISLAND_CAMERA = {
  /** The orbit's target box, as a share of `span`. */
  half: 0.9,
  /** The farthest zoom, as a share of the box filling the frame from above. */
  maxReach: 0.85,
  /** At the farthest zoom the target stays within this share of the box's half side of the middle. */
  hold: 0.35,
  /** Free flight's box, as a share of `span`. */
  roam: 1.6,
} as const

export function islandWorld(span: number, heightAt: (x: number, z: number) => number, water: number): World {
  return {
    centre: [0, 0],
    half: span * ISLAND_CAMERA.half,
    maxReach: ISLAND_CAMERA.maxReach,
    hold: ISLAND_CAMERA.hold,
    roam: span * ISLAND_CAMERA.roam,
    heightAt,
    water,
    free: true,
  }
}

export function worldCamera(stage: Stage, host: HTMLElement, query: URLSearchParams): WorldCamera {
  let chip: CamKeys | null = null
  let started = false
  return {
    start(world) {
      if (world) stage.rig.setWorld(world)
      if (started || !stage.rig.world()) return
      started = true
      if (param(query, "ui")) chip = createCamChip(host, stage.rig)
      if (param(query, "cam") === "free") stage.rig.setMode("free")
    },
    dispose() {
      chip?.dispose()
      chip = null
    },
  }
}
