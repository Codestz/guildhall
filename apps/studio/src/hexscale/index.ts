/**
 * Scale board (`/lab/hexscale`): the hex world's proportions chosen by eye (decisions.md "Clean restart
 * on hex": in V1 the characters stand taller than the doors). Three options side by side, each the same
 * little cluster (a house, a tavern, a well, trees, a road, a field) on hex tiles sized to fit, with the
 * same KayKit characters standing in front: A as small as V1, B in between, C as the library imports
 * them today. A label under each gives the numbers. Scale B is chosen (decisions.md): this board is at
 * `?board=scale`; `/lab/hexscale` itself opens the nature board (nature.ts).
 */
import type { CameraPose } from "@guildhall/core"
import { log } from "@guildhall/core"
import {
  type BatchInstance,
  createHexGround,
  createSky,
  createStage,
  createStaticBatch,
  createSun,
  type HexPrism,
  loadPiece,
  type StaticBatch,
  type TerrainMesh,
  toScreen,
} from "@guildhall/render"
import { type KnobSection, placePlate, plate } from "@guildhall/ui"
import { hexCentre } from "@guildhall/world"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import { NATURE_SIZES } from "../hexworld/knobs.ts"
import type { Screen, ScreenCtx } from "../screens.ts"
import { mountViewer, type StudioViewer } from "../shell/viewer.ts"
import { worldCamera } from "../shell/worldCamera.ts"
import { mountNatureBoard } from "./nature.ts"

const logger = log("studio:hexscale")

/** An option: how much the buildings are scaled from today's import, trees too, and the tile that fits them. */
interface Option {
  key: string
  label: string
  building: number
  tree: number
}

const OPTIONS: Option[] = [
  { key: "A", label: "A · V1: characters tower over doors", building: 0.32, tree: 0.45 },
  { key: "B", label: "B · doors at a character's chest", building: 0.5, tree: 0.6 },
  { key: "C", label: "C · today: doors fit a character", building: 1, tree: 1 },
]

/** The cluster: which tile holds what (axial coords round the middle). */
const CLUSTER: {
  q: number
  r: number
  what: "house" | "tavern" | "well" | "trees" | "road" | "field" | "tower"
}[] = [
  { q: 0, r: 0, what: "house" },
  { q: 1, r: -1, what: "tavern" },
  { q: -1, r: 0, what: "trees" },
  { q: 0, r: -1, what: "trees" },
  { q: 1, r: 0, what: "well" },
  { q: -1, r: 1, what: "field" },
  { q: 0, r: 1, what: "road" },
  { q: 1, r: 1, what: "road" },
  { q: -1, r: -1, what: "tower" },
  { q: 2, r: -1, what: "field" },
  { q: -2, r: 1, what: "trees" },
]

const PIECE: Record<string, string> = {
  house: "kaykit-hexagon/building-home-b-red",
  tavern: "kaykit-hexagon/building-tavern-blue",
  well: "kaykit-hexagon/building-well-yellow",
  tower: "kaykit-hexagon/building-tower-a-green",
  tree: "kaykit-forest/tree-1-b-color1",
  tree2: "kaykit-forest/tree-3-b-color1",
  crop: "kenney-nature/crops-wheat-stage-b",
}
const CHARACTERS = ["kaykit-adventurers/knight", "kaykit-adventurers/mage", "kaykit-adventurers/rogue"]

const TOP: Record<string, [number, number, number]> = {
  grass: [143, 195, 86],
  road: [217, 192, 140],
  field: [217, 181, 79],
  trees: [110, 168, 72],
}

const FAMILIES = ["tree", "pine", "bush", "rock", "grass", "flower"] as const

/** The board's knobs: which board, which family up close, and the sizes of a fourth column. */
const SECTIONS: KnobSection[] = [
  {
    title: "Board",
    knobs: [
      {
        kind: "segment",
        key: "board",
        label: "Compare",
        default: "nature",
        options: [
          { value: "nature", label: "Nature sizes" },
          { value: "scale", label: "Building scale" },
        ],
        apply: "reload",
      },
      {
        kind: "select",
        key: "family",
        label: "Family",
        hint: "One family's row up close (nature board)",
        default: "all",
        options: [{ value: "all", label: "Every family" }, ...FAMILIES.map((f) => ({ value: f, label: f }))],
        apply: "reload",
      },
    ],
  },
  { title: "Fourth column sizes", open: false, knobs: NATURE_SIZES },
]

export const hexScale: Screen = {
  id: "hexscale",
  title: "Scale board",
  mount(outer, ctx) {
    const scale = ctx.query.get("board") === "scale"
    const viewer = mountViewer(outer, ctx, "hexscale", {
      title: scale ? "Building scale" : "Nature sizes",
      subtitle: scale
        ? "Scale A, B and C side by side: the same cluster, the same characters. B is chosen."
        : "Every nature family beside a scale-B cottage, a house and a character, at sizes A, B and C.",
      sections: SECTIONS,
    })
    if (!scale) {
      const off = mountNatureBoard(viewer, ctx)
      return () => {
        off()
        viewer.dispose()
      }
    }
    return mountScaleBoard(viewer, ctx)
  },
}

/** The A/B/C building scale board (`?board=scale`): the decision's record (scale B is chosen). */
function mountScaleBoard(viewer: StudioViewer, ctx: ScreenCtx): () => void {
  const host = viewer.stage
  const stage = createStage(host)
  ctx.attach(stage)
  viewer.attachStage(stage)
  let disposed = false
  let batch: StaticBatch | null = null
  const meshes: TerrainMesh[] = []
  const labels: HTMLElement[] = []
  const extras: { removeFromParent(): void }[] = []
  const cam = worldCamera(stage, viewer.camera, ctx.query)
  let unFrame = () => {}

  const build = async () => {
    const catalog = await loadCatalog()
    if (!catalog || disposed) return
    const house = catalog.get(PIECE.house!)
    const houseW = house ? Math.max(house.size[0], house.size[2]) : 7
    const pieces: BatchInstance[] = []
    const tiles: HexPrism[] = []
    let x0 = 0
    const centres: [number, number, Option][] = []
    for (const opt of OPTIONS) {
      // the tile just fits the scaled house, with a little room round it
      const size = (houseW * opt.building) / Math.sqrt(3) + 0.35 * opt.building * 2 + 0.2
      const span = size * Math.sqrt(3) * 5
      const cx = x0 + span / 2
      centres.push([cx, 0, opt])
      x0 += span + 6
      for (const c of CLUSTER) {
        const [hx, hz] = hexCentre({ q: c.q, r: c.r })
        const x = cx + hx * size
        const z = hz * size
        const top =
          c.what === "road" ? "road" : c.what === "field" ? "field" : c.what === "trees" ? "trees" : "grass"
        tiles.push({ x, z, top: 0.5, color: TOP[top]!, side: [122, 90, 60] })
        const put = (piece: string, dx: number, dz: number, scale: number, rot = 0) =>
          pieces.push({ piece, x: x + dx, y: 0.5, z: z + dz, rot, scale })
        if (c.what === "house" || c.what === "tavern" || c.what === "well" || c.what === "tower")
          put(PIECE[c.what]!, 0, 0, opt.building, Math.PI)
        if (c.what === "trees") {
          put(PIECE.tree!, -size * 0.3, -size * 0.2, opt.tree)
          put(PIECE.tree2!, size * 0.3, size * 0.25, opt.tree * 0.8, 1)
        }
        if (c.what === "field")
          for (let a = -2; a <= 2; a++)
            for (let b = -1; b <= 1; b++)
              put(PIECE.crop!, a * size * 0.3, b * size * 0.4, Math.min(1, opt.tree * 1.2))
      }
    }
    // each option's tiles at its own size
    for (const [cx, , opt] of centres) {
      const size = (houseW * opt.building) / Math.sqrt(3) + 0.35 * opt.building * 2 + 0.2
      meshes.push(
        createHexGround(stage, {
          size,
          base: -1.5,
          tiles: tiles.filter((t) => Math.abs(t.x - cx) < size * Math.sqrt(3) * 2.6),
        }),
      )
    }
    const span = x0
    const sun = createSun(stage, { town: { min: [-10, -2, -40], max: [span + 10, 30, 40] } })
    createSky(stage, { sun, hour: 15.5, reach: span })
    const pose: CameraPose = {
      target: [span / 2 - 3, 1, 2],
      azimuth: 0,
      elevation: 32,
      distance: span * 0.78,
    }
    stage.setCamera(pose)
    cam.start({ centre: [span / 2, 0], half: span, water: null, free: true })
    batch = await createStaticBatch(stage, pieces, async (id) => {
      const entry = catalog.get(id)
      if (!entry) throw new Error(`hexscale: unknown piece "${id}"`)
      return loadPiece(libraryUrl(entry.files.glb))
    })
    if (disposed) return
    // the same three characters in front of each option, on the road
    for (const [cx, , opt] of centres) {
      const size = (houseW * opt.building) / Math.sqrt(3) + 0.35 * opt.building * 2 + 0.2
      for (const [k, id] of CHARACTERS.entries()) {
        const entry = catalog.get(id)
        if (!entry) continue
        const root = await loadPiece(libraryUrl(entry.files.glb))
        if (disposed) return
        root.position.set(cx + (k - 1) * Math.max(1.1, size * 0.5), 0.5, size * 1.7)
        root.rotation.y = 0.2
        stage.scene.add(root)
        extras.push(root)
      }
      const [, words = opt.label] = opt.label.split(" · ")
      const el = plate({
        title: `Scale ${opt.key}`,
        detail: `${words} · house ${(houseW * opt.building).toFixed(1)} m · tile ${(size * 2).toFixed(1)} m`,
        width: 400,
        kind: opt.key === "B" ? "head" : undefined,
        anchor: "translate(-50%, 0)",
      })
      labels.push(el)
      viewer.labels.append(el)
    }
    // each plate pinned under its cluster's front edge, so it moves with the camera
    const place = () => {
      centres.forEach(([cx, , opt], k) => {
        const el = labels[k]
        const size = (houseW * opt.building) / Math.sqrt(3) + 0.35 * opt.building * 2 + 0.2
        if (el) placePlate(el, toScreen(stage, [cx, 0, size * 2.6]))
      })
    }
    unFrame = stage.onFrame(place)
    sun.markDirty()
    logger.info("board", { pieces: pieces.length })
  }
  ctx.load(build()).catch((error: unknown) => logger.error("build failed", { error: String(error) }))
  return () => {
    disposed = true
    unFrame()
    cam.dispose()
    batch?.dispose()
    for (const m of meshes) m.dispose()
    for (const e of extras) e.removeFromParent()
    for (const l of labels) l.remove()
    stage.dispose()
    host.replaceChildren()
    viewer.dispose()
  }
}
