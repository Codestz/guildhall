import { createGrid, createStage } from "@guildhall/render"
import type { Screen } from "../screens.ts"

/**
 * The M0 skeleton scene: a 20 m grid in 1 m cells. The 2.2 m hero silhouette and the 1/2/3 m test
 * boxes join it once render exports a helper that builds them (apps never import three).
 */
export const m0: Screen = {
  id: "m0",
  title: "M0 skeleton",
  mount(host, ctx) {
    const stage = createStage(host)
    ctx.attach(stage)
    stage.setCamera({ target: [2.5, 1, 0], azimuth: 25, elevation: 22, distance: 16 })
    const grid = createGrid(stage, { size: 20, cell: 1 })
    return () => {
      grid.dispose()
      stage.dispose()
    }
  },
}
