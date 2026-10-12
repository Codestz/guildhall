import { log } from "@guildhall/core"
import { GridHelper } from "three"
import type { Stage } from "./stage.ts"

export interface Disposable {
  dispose(): void
}

const logger = log("render:grid")

/** A ground grid of `size` metres a side in 1 m cells, centred on the origin. */
export function createGrid(stage: Stage, opts: { size: number; cell: 1 }): Disposable {
  const grid = new GridHelper(opts.size, Math.round(opts.size / opts.cell), "#8a8172", "#b3aa99")
  grid.name = "grid"
  stage.scene.add(grid)
  logger.debug("grid", opts)
  return {
    dispose() {
      grid.removeFromParent()
      grid.dispose()
    },
  }
}
