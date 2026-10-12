/**
 * A lab's camera on a world, set up the same way on every world screen: the rig held inside the world
 * (never under the ground or the water, never out past the sea), free flight on `F` or the corner
 * chip's toggle, and `?cam=free` starting in it. `ui=0` leaves the chip out for clean shots.
 */
import type { Stage, World } from "@guildhall/render"
import { type CamKeys, createCamChip } from "./camKeys.ts"

export interface WorldCamera {
  /**
   * The world is in: holds the rig inside `world` (or the one already set, as the town controller
   * does), shows the chip, and enters free flight when the link asked for it.
   */
  start(world?: World): void
  dispose(): void
}

export function worldCamera(stage: Stage, host: HTMLElement, query: URLSearchParams): WorldCamera {
  let chip: CamKeys | null = null
  let started = false
  return {
    start(world) {
      if (world) stage.rig.setWorld(world)
      if (started || !stage.rig.world()) return
      started = true
      if (query.get("ui") !== "0") chip = createCamChip(host, stage.rig)
      if (query.get("cam") === "free") stage.rig.setMode("free")
    },
    dispose() {
      chip?.dispose()
      chip = null
    },
  }
}
