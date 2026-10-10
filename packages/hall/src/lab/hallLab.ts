import { Group, type Object3D } from "three"
import { mergePlacements } from "../scene/Kit.tsx"
import { KIT_URL } from "../world/cast.ts"
import { buildHall, sizeOf } from "../world/hall/build.ts"
import { STYLES } from "../world/hall/styles.ts"
import type { HallStyle } from "../world/hall/types.ts"
import { createStage, load } from "./stage.ts"

/**
 * The hall lab (dev and probe only, `?lab=halls&style=workshop`): a far island's hall (world/hall)
 * alone from four sides, as the floor plan builds it. `size` is the island's file count (the hall
 * grows with it: 5 an islet, 40, 120, 400, 1500), `walls` which walls stand: `back` (default: the
 * landmark's, so the floor is open to the camera), `all` or `none`. `window.lab.show(style, files, walls)`.
 */
export async function start(root: HTMLElement, params: URLSearchParams): Promise<void> {
  const stage = createStage(root)
  const kit = await load(KIT_URL)
  const nodes: Record<string, Object3D> = {}
  kit.scene.traverse((node) => {
    if (node !== kit.scene && node.name) nodes[node.name] = node
  })
  const group = new Group()
  stage.scene.add(group)

  function show(style: string, files = 400, walls: "back" | "all" | "none" = "back"): string {
    if (!Object.hasOwn(STYLES, style)) return `no style "${style}": ${Object.keys(STYLES).join(", ")}`
    const { w, d } = sizeOf(files, 2)
    const hall = buildHall(style as HallStyle, [0, 0], 0, w, d, [0, 0])
    const pieces = [
      ...hall.floor,
      ...hall.props,
      ...hall.walls
        .filter((wall) => walls === "all" || (walls === "back" && wall.side === "back"))
        .flatMap((wall) => wall.pieces),
    ]
    group.clear()
    group.add(...mergePlacements(nodes, pieces))
    stage.fit(group)
    stage.caption(`${STYLES[style as HallStyle].label} · ${w}×${d} · ${hall.spots.length} seats and stations`)
    return "ok"
  }

  const wanted = params.get("walls")
  show(
    params.get("style") ?? "workshop",
    Number(params.get("size") ?? 400),
    wanted === "all" || wanted === "none" ? wanted : "back",
  )
  stage.run()
  Object.assign(window, { lab: { show, styles: () => Object.keys(STYLES) } })
}
