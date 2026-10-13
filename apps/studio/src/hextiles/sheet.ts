/**
 * One tile's review shot (`/lab/hextiles?tile=<id>&sheet=1`): the tile alone, with every neighbour its
 * footprint covers, on a muted ring of plain hexes, a knight on the hex in front of it for scale, from
 * one fixed 3/4 camera (pulled back only as far as a bigger footprint needs), its name burned into the
 * corner, its nature as the island grows it (NATURE_CHOSEN). `bun shots prefabs` shoots every tile
 * this way and composes the shots into contact sheets.
 */
import { log } from "@guildhall/core"
import {
  type BatchInstance,
  createHexGround,
  createSky,
  createStage,
  createStaticBatch,
  createSun,
  createSurface,
  type HexPrism,
  loadPiece,
  type StaticBatch,
  type TerrainMesh,
} from "@guildhall/render"
import {
  BUILDING_REACH,
  CHARACTER_SCALE,
  growNature,
  HEX_TILE_SIZE,
  isBuildingPiece,
  NATURE_CHOSEN,
  natureOdds,
  placeTile,
  tilePrefabs,
  worldSide,
} from "@guildhall/world"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import type { ScreenCtx } from "../screens.ts"
import { worldCamera } from "../shell/worldCamera.ts"
import { loadTiles } from "../tiles.ts"
import { CHARACTER, FACE, GROUND, pathStrips, SIDE, TURN } from "./look.ts"

const logger = log("studio:hextiles:sheet")

const R = HEX_TILE_SIZE
/** Centre to centre of two neighbouring hexes. */
const STEP = R * Math.sqrt(3)
/** The ring round the scene: plain, a little lower and duller than the tile, so the tile reads alone. */
const RING: [number, number, number] = [128, 156, 104]
const RING_SIDE: [number, number, number] = [104, 92, 76]
/** The camera every shot shares: a 3/4 view onto the tile's front. */
const AZIMUTH = 25
const ELEVATION = 34
/** The distance that frames one tile; a footprint's extent scales it. */
const DISTANCE = 14

/** The centre of the neighbour across world side d (60°·d from +x, toward −z) of a hex at (x, z). */
const across = ([x, z]: [number, number], d: number): [number, number] => {
  const a = (Math.PI / 180) * (60 * d)
  return [x + Math.cos(a) * STEP, z - Math.sin(a) * STEP]
}
const keyOf = ([x, z]: [number, number]) => `${x.toFixed(2)},${z.toFixed(2)}`

export function mountSheet(host: HTMLElement, ctx: ScreenCtx, id: string): () => void {
  const stage = createStage(host)
  ctx.attach(stage)
  // a clean shot: no camera chip
  const query = new URLSearchParams(ctx.query)
  query.set("ui", "0")
  const cam = worldCamera(stage, host, query)
  let disposed = false
  let batch: StaticBatch | null = null
  const meshes: TerrainMesh[] = []
  const cleanup: (() => void)[] = []

  const build = async () => {
    const [catalog] = await Promise.all([loadCatalog(), loadTiles()])
    if (!catalog || disposed) return
    const t = tilePrefabs().find((p) => p.id === id)
    if (!t) throw new Error(`hextiles sheet: no tile "${id}"`)
    // the scene: the tile and every neighbour its footprint covers (their ground as world.ts lays it)
    const scene: [number, number][] = [
      [0, 0],
      ...(t.footprint ?? []).map((k) => across([0, 0], worldSide(k, FACE))),
    ]
    const part = t.ground === "dirt" || t.ground === "paved" ? t.ground : "grass"
    const top = (g: string) => (g === "water" ? 0.15 : 0.5)
    const tiles: HexPrism[] = scene.map(([x, z], k) => {
      const ground = k === 0 ? t.ground : part
      return { x, z, top: top(ground), color: GROUND[ground], side: SIDE }
    })
    const taken = new Set(scene.map(keyOf))
    for (const c of scene)
      for (let d = 0; d < 6; d++) {
        const n = across(c, d)
        if (taken.has(keyOf(n))) continue
        taken.add(keyOf(n))
        tiles.push({ x: n[0], z: n[1], top: 0.42, color: RING, side: RING_SIDE })
      }
    meshes.push(createHexGround(stage, { size: R, base: -0.5, tiles }))
    const paths: number[] = []
    pathStrips(t, 0, 0, paths)
    if (paths.length) meshes.push(createSurface(stage, new Float32Array(paths), "#d9c08c"))
    // at the island's nature (NATURE_CHOSEN, as the Studio builds it): a wood's trees thinned, every
    // nature piece grown or shrunk, a grown one held back from the buildings and from a built tile
    const placed = placeTile(t, [0, 0], 0.5, TURN, 1, false, natureOdds(NATURE_CHOSEN))
    const built = t.group === "town" || t.group === "landmark" || t.group === "road"
    const discs = placed
      .filter((q) => isBuildingPiece(q.piece))
      .map((q): [number, number, number] => [q.x, q.z, BUILDING_REACH * q.scale])
    growNature(placed, NATURE_CHOSEN, {
      hardNear: () => ({ own: built, tiles: [] }),
      buildingsNear: () => discs,
    })
    const pieces: BatchInstance[] = placed.filter((q) => catalog.get(q.piece))

    const cx = scene.reduce((s, [x]) => s + x, 0) / scene.length
    const cz = scene.reduce((s, [, z]) => s + z, 0) / scene.length
    const extent = Math.max(...scene.map(([x, z]) => Math.hypot(x - cx, z - cz))) + R
    const sun = createSun(stage, {
      town: { min: [cx - extent - R, -1, cz - extent - R], max: [cx + extent + R, 12, cz + extent + R] },
    })
    createSky(stage, { sun, hour: 15.5, reach: 60 })
    stage.setCamera({
      target: [cx, 1.1, cz],
      azimuth: AZIMUTH,
      elevation: ELEVATION,
      distance: (DISTANCE * extent) / R,
    })
    cam.start({ centre: [cx, cz], half: extent + 30, water: null, free: true })
    batch = await createStaticBatch(stage, pieces, async (piece) => {
      const entry = catalog.get(piece)
      if (!entry) throw new Error(`hextiles sheet: unknown piece "${piece}"`)
      return loadPiece(libraryUrl(entry.files.glb))
    })
    if (disposed) return
    // the knight on the ring hex in front of the tile, off to its left, facing the camera
    const knight = catalog.get(CHARACTER)
    if (knight) {
      const root = await loadPiece(libraryUrl(knight.files.glb))
      if (disposed) return
      const a = (Math.PI / 180) * (60 * FACE)
      const out = R * (Math.sqrt(3) / 2) + 0.7
      const fx = Math.cos(a)
      const fz = -Math.sin(a)
      root.position.set(fx * out - fz * 1.3, 0.42, fz * out + fx * 1.3)
      root.rotation.y = (Math.PI / 180) * AZIMUTH
      root.scale.setScalar(CHARACTER_SCALE)
      stage.scene.add(root)
      cleanup.push(() => root.removeFromParent())
    }
    const label = document.createElement("div")
    const facts = [
      t.id,
      t.group ?? "no group",
      t.footprint?.length ? `${t.footprint.length + 1} tiles` : null,
      t.tier ? `tier ${t.tier}` : null,
      `${t.pieces.length} pieces`,
      `${t.spots?.length ?? 0} spots`,
    ].filter(Boolean)
    label.innerHTML = `<b style="display:block;font:600 30px ui-sans-serif,system-ui,sans-serif;letter-spacing:.01em"></b><span style="font:15px ui-monospace,Menlo,monospace;opacity:.8"></span>`
    label.querySelector("b")!.textContent = t.name
    label.querySelector("span")!.textContent = facts.join(" · ")
    label.style.cssText =
      "position:absolute;z-index:2;left:18px;top:16px;padding:10px 14px;border-radius:6px;background:rgba(21,17,13,0.82);color:#f3e9d4;pointer-events:none"
    host.append(label)
    cleanup.push(() => label.remove())
    sun.markDirty()
    logger.info("sheet", { tile: t.id, pieces: pieces.length })
  }
  ctx.load(build()).catch((error: unknown) => logger.error("build failed", { error: String(error) }))
  return () => {
    disposed = true
    cam.dispose()
    batch?.dispose()
    for (const m of meshes) m.dispose()
    for (const c of cleanup) c()
    stage.dispose()
    host.replaceChildren()
  }
}
