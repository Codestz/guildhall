/**
 * The nature scale board (`/lab/hexscale`, plan-hex "Nature pass"): every nature family the tiles use
 * (leaf trees, pines, bushes, rocks, grass, flowers), each beside a scale-B cottage, a house and a KayKit
 * character at CHARACTER_SCALE, at three candidate sizes A (today), B and C, as multipliers on the sizes
 * the tile prefabs author. The nature knobs (`?tree= ?pine= ?bush= ?rock= ?grass= ?flower=`, as on
 * `/town/<seed>`) add a fourth column at those sizes; `?family=pine` shows one family's row up close.
 * The label under each cell gives the heights in metres.
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
import {
  CHARACTER_SCALE,
  HEX_TILE_SIZE,
  type HexNature,
  KENNEY_WOOD,
  LEAF_TONES,
  NATURE_FAMILIES,
  type NatureFamily,
  natureScale,
  SCALE_B,
} from "@guildhall/world"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import { natureOf } from "../hexworld/job.ts"
import type { ScreenCtx } from "../screens.ts"
import { worldCamera } from "../shell/worldCamera.ts"

const logger = log("studio:hexscale")

/** What each family's row shows: pieces at the scale the tile prefabs author them (data/tiles), and where. */
const ITEMS: Record<NatureFamily, { piece: string; scale: number; from: string }[]> = {
  tree: [
    { piece: "kaykit-forest/tree-1-b-color1", scale: 0.6, from: "woods" },
    { piece: "kaykit-forest/tree-2-c-color1", scale: 0.51, from: "woods" },
    { piece: "kaykit-forest/tree-3-b-color1", scale: 0.54, from: "woods" },
    { piece: "kaykit-forest/tree-3-a-color1", scale: 0.37, from: "orchard" },
  ],
  pine: [
    { piece: "kaykit-forest/tree-4-a-color1", scale: 0.6, from: "woods-dense" },
    { piece: "kaykit-forest/tree-4-b-color1", scale: 0.57, from: "woods-dense" },
    { piece: "kaykit-forest/tree-4-c-color1", scale: 0.42, from: "woods-dense" },
  ],
  bush: [
    { piece: "kaykit-forest/bush-1-c-color1", scale: 0.65, from: "woods" },
    { piece: "kaykit-forest/bush-2-c-color1", scale: 0.65, from: "woods" },
    { piece: "kaykit-forest/bush-2-c-color1", scale: 0.8, from: "hunter" },
  ],
  rock: [
    { piece: "kaykit-forest/rock-3-e-color1", scale: 0.62, from: "woods" },
    { piece: "kaykit-forest/rock-3-g-color1", scale: 0.6, from: "hillside" },
    { piece: "kaykit-forest/rock-3-m-color1", scale: 0.42, from: "rocky" },
  ],
  grass: [
    { piece: "kaykit-forest/grass-2-c-color1", scale: 0.8, from: "woods-light" },
    { piece: "kaykit-forest/grass-2-d-color1", scale: 0.8, from: "pasture" },
    { piece: "kaykit-forest/grass-2-a-color1", scale: 1.3, from: "reeds" },
  ],
  flower: [
    { piece: "kenney-nature/flower-red-a", scale: 1, from: "meadow" },
    { piece: "kenney-nature/flower-yellow-a", scale: 1, from: "meadow" },
    { piece: "kenney-nature/flower-purple-a", scale: 1, from: "meadow" },
  ],
}

const NAMES: Record<NatureFamily, string> = {
  tree: "leaf trees",
  pine: "pines",
  bush: "bushes",
  rock: "rocks",
  grass: "grass",
  flower: "flowers",
}

/**
 * The candidate sizes, multipliers on today's: trees and pines grow (an oak about 2–3× a cottage's eave,
 * a pine taller), bushes, grass and flowers shrink toward knee-to-waist of a character, rocks vary up.
 */
export const NATURE_CANDIDATES: Record<NatureFamily, [number, number, number]> = {
  tree: [1, 1.3, 1.6],
  pine: [1, 1.3, 1.6],
  bush: [1, 0.8, 0.65],
  rock: [1, 1.25, 1.5],
  grass: [1, 0.75, 0.55],
  flower: [1, 0.7, 0.5],
}

const COTTAGE = "kaykit-hexagon/building-home-a-red"
const HOUSE = "kaykit-hexagon/building-home-b-blue"
const CHARACTERS = ["kaykit-adventurers/knight", "kaykit-adventurers/mage"]

const GRASS: [number, number, number] = [112, 156, 64]
const SIDE: [number, number, number] = [122, 90, 60]
/** A tile's width across its flats, metres: the board lays its tiles in rows of these. */
const STEP = HEX_TILE_SIZE * Math.sqrt(3)
const ROW = 11
const GAP = 5

const LABEL =
  "position:absolute;z-index:2;padding:4px 8px;border-radius:4px;background:rgba(21,17,13,0.85);color:#f3e9d4;font:11px/1.35 ui-monospace,Menlo,monospace;transform:translate(-50%,0);white-space:nowrap;text-align:center;pointer-events:none"

/** Mounts the nature board into `host`; returns its teardown. */
export function mountNatureBoard(host: HTMLElement, ctx: ScreenCtx): () => void {
  const stage = createStage(host)
  ctx.attach(stage)
  let disposed = false
  let batch: StaticBatch | null = null
  const meshes: TerrainMesh[] = []
  const extras: { removeFromParent(): void }[] = []
  const labels: { el: HTMLElement; at: [number, number, number] }[] = []
  const cam = worldCamera(stage, host, ctx.query)
  let unFrame = () => {}

  const query: HexNature = natureOf(ctx.query)
  const asked = NATURE_FAMILIES.some((f) => f in query || (f === "pine" && "tree" in query))
  const only = ctx.query.get("family") as NatureFamily | null
  const families = NATURE_FAMILIES.filter((f) => !only || !NATURE_FAMILIES.includes(only) || f === only)
  // columns: A, B, C and, with knobs, the query's sizes
  const columns: { key: string; scale(f: NatureFamily): number }[] = [0, 1, 2].map((k) => ({
    key: "ABC"[k]!,
    scale: (f: NatureFamily) => NATURE_CANDIDATES[f][k]!,
  }))
  if (asked) columns.push({ key: "?", scale: (f) => natureScale(query, f) })
  // `?col=B` (with `?family=`): that one cell up close, for contact sheets
  const col = ctx.query.get("col")
  const one = only && columns.some((c) => c.key === col)
  if (one) columns.splice(0, columns.length, ...columns.filter((c) => c.key === col))

  const build = async () => {
    const catalog = await loadCatalog()
    if (!catalog || disposed) return
    const height = (piece: string, scale: number) => (catalog.get(piece)?.size[1] ?? 0) * scale
    const pieces: BatchInstance[] = []
    const tiles: HexPrism[] = []
    const cellW = STEP * 4 + GAP
    const width = cellW * columns.length - GAP
    const rows = families.length
    // the shortest families in front, the trees at the back: nothing hides what stands behind it
    const order = [...families].reverse()
    const put = (piece: string, x: number, z: number, scale: number, rot = 0) => {
      const swatchMap = piece.startsWith("kaykit-forest/")
        ? LEAF_TONES.base
        : piece.startsWith("kenney-")
          ? KENNEY_WOOD
          : undefined
      pieces.push({ piece, x, y: 0.5, z, rot, scale, ...(swatchMap ? { swatchMap } : {}) })
    }
    const chars: [number, number, number][] = []
    order.forEach((fam, r) => {
      const z = -r * ROW
      columns.forEach((col, c) => {
        const x0 = c * cellW - width / 2 + STEP / 2
        // four tiles: the cottage, two of nature, the house
        for (let k = 0; k < 4; k++) tiles.push({ x: x0 + k * STEP, z, top: 0.5, color: GRASS, side: SIDE })
        put(COTTAGE, x0, z, SCALE_B.building, 0)
        put(HOUSE, x0 + 3 * STEP, z, SCALE_B.building, 0)
        const m = col.scale(fam)
        const items = ITEMS[fam]
        const span = STEP * 1.9
        items.forEach((it, k) => {
          const x = x0 + STEP * 0.55 + (items.length === 1 ? span / 2 : (k * span) / (items.length - 1))
          put(it.piece, x, z - 0.6, it.scale * m, k * 0.7)
        })
        chars.push([x0 + STEP * 1.2, z + 1.9, 0], [x0 + STEP * 2.2, z + 1.9, 1])
        const hs = items.map((it) => height(it.piece, it.scale * m).toFixed(1)).join(" / ")
        labels.push({
          el: label(`<b>${col.key}</b> ${NAMES[fam]} ×${m}<br>${hs} m`),
          at: [x0 + STEP * 1.5, 0.5, z + 3.2],
        })
      })
    })
    // the headers: what each column is, the buildings' and the character's heights
    const ref = `cottage ${height(COTTAGE, SCALE_B.building).toFixed(1)} m · house ${height(HOUSE, SCALE_B.building).toFixed(1)} m · character ${height(CHARACTERS[0]!, CHARACTER_SCALE).toFixed(2)} m`
    columns.forEach((col, c) => {
      const x = c * cellW - width / 2 + STEP * 2
      const tag = col.key === "?" ? "the query's sizes" : col.key === "A" ? "today" : "candidate"
      labels.push({ el: label(`<b>${col.key}</b> · ${tag}`), at: [x, 9, -(rows - 1) * ROW - 2] })
    })
    const head = document.createElement("div")
    head.style.cssText = `${LABEL};left:50%;top:10px`
    head.innerHTML = `<b>Nature scale board</b> · scale B · ${ref}`
    host.append(head)

    const depth = (rows - 1) * ROW
    meshes.push(createHexGround(stage, { size: HEX_TILE_SIZE, base: -1.5, tiles }))
    const reach = Math.max(width, depth) + 20
    const sun = createSun(stage, {
      town: { min: [-width / 2 - 10, -2, -depth - 10], max: [width / 2 + 10, 20, 10] },
    })
    createSky(stage, { sun, hour: 15.5, reach })
    const tall = only === "tree" || only === "pine"
    const pose: CameraPose = one
      ? { target: [0, tall ? 2.6 : 1.2, 0], azimuth: 0, elevation: 12, distance: tall ? 24 : 17 }
      : only
        ? { target: [0, 2.4, 0], azimuth: 0, elevation: 10, distance: width * 0.68 }
        : {
            target: [0, 1, -depth / 2 + 1],
            azimuth: 0,
            elevation: 38,
            distance: Math.max(width * 1.05, depth * 1.6),
          }
    stage.setCamera(pose)
    cam.start({ centre: [0, -depth / 2], half: reach, water: null, free: true })
    batch = await createStaticBatch(stage, pieces, async (id) => {
      const entry = catalog.get(id)
      if (!entry) throw new Error(`hexscale: unknown piece "${id}"`)
      return loadPiece(libraryUrl(entry.files.glb))
    })
    if (disposed) return
    // the characters, at the hex world's size, in front of each cell's nature
    for (const [x, z, k] of chars) {
      const entry = catalog.get(CHARACTERS[k]!)
      if (!entry) continue
      const root = await loadPiece(libraryUrl(entry.files.glb))
      if (disposed) return
      root.position.set(x, 0.5, z)
      root.scale.setScalar(CHARACTER_SCALE)
      root.rotation.y = 0.25
      stage.scene.add(root)
      extras.push(root)
    }
    for (const l of labels) host.append(l.el)
    const place = () => {
      for (const l of labels) {
        const p = toScreen(stage, l.at)
        l.el.style.display = p ? "" : "none"
        if (p) {
          l.el.style.left = `${p[0]}px`
          l.el.style.top = `${p[1]}px`
        }
      }
    }
    unFrame = stage.onFrame(place)
    sun.markDirty()
    logger.info("nature board", { pieces: pieces.length, columns: columns.length, rows })
  }
  ctx.load(build()).catch((error: unknown) => logger.error("build failed", { error: String(error) }))
  return () => {
    disposed = true
    unFrame()
    cam.dispose()
    batch?.dispose()
    for (const m of meshes) m.dispose()
    for (const e of extras) e.removeFromParent()
    stage.dispose()
    host.replaceChildren()
  }
}

function label(html: string): HTMLElement {
  const el = document.createElement("div")
  el.style.cssText = LABEL
  el.innerHTML = html
  return el
}
