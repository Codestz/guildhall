import { createGrid, createStage, disposeObject, heroSilhouette, testBox } from "@guildhall/render"
import type { Screen } from "../screens.ts"

/** Test boxes beside the hero, so a 1, 2 and 3 m cube can be read against the 1 m grid. */
const BOXES = [
  { size: 1, colour: "#b5523b", x: 2 },
  { size: 2, colour: "#c99a3c", x: 4 },
  { size: 3, colour: "#4f7a8c", x: 7 },
] as const

/** The M0 skeleton scene: a 20 m grid in 1 m cells, a 2.2 m hero silhouette and three test boxes. */
export const m0: Screen = {
  id: "m0",
  title: "M0 skeleton",
  mount(host, ctx) {
    const stage = createStage(host)
    ctx.attach(stage)
    stage.setCamera({ target: [2.5, 1, 0], azimuth: 25, elevation: 22, distance: 16 })
    const grid = createGrid(stage, { size: 20, cell: 1 })
    const hero = heroSilhouette(2.2)
    const boxes = BOXES.map(({ size, colour, x }) => {
      const box = testBox(size, colour)
      box.position.x = x
      return box
    })
    stage.scene.add(hero, ...boxes)
    return () => {
      for (const object of [hero, ...boxes]) disposeObject(object)
      grid.dispose()
      stage.dispose()
    }
  },
}
