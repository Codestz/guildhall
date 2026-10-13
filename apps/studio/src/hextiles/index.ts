/**
 * Tile gallery (`/lab/hextiles`): every hex tile prefab at scale B, each on its own hex with a KayKit
 * character beside it for scale and its name under it; `?tile=<id>` shows one large, `?group=` one group,
 * and `?tile=<id>&sheet=1` the review shot of one tile (sheet.ts: alone, its whole footprint, a fixed
 * 3/4 camera, its name burned in), which `bun shots prefabs` composes into contact sheets.
 * The prefabs are the authored data (data/tiles, edited in the tile composer at `/composer/<id>`).
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
  createSurface,
  type HexPrism,
  loadPiece,
  type StaticBatch,
  type TerrainMesh,
  toScreen,
} from "@guildhall/render"
import { CHARACTER_SCALE, HEX_TILE_SIZE, placeTile, tilePrefabs } from "@guildhall/world"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import type { Screen } from "../screens.ts"
import { worldCamera } from "../shell/worldCamera.ts"
import { loadTiles } from "../tiles.ts"
import { CHARACTER, GROUND, pathStrips, SIDE, TURN } from "./look.ts"
import { mountSheet } from "./sheet.ts"

const logger = log("studio:hextiles")

export const hexTiles: Screen = {
  id: "hextiles",
  title: "Tile prefabs",
  mount(host, ctx) {
    const sheet = ctx.query.get("tile")
    if (sheet && ctx.query.get("sheet") === "1") return mountSheet(host, ctx, sheet)
    const stage = createStage(host)
    ctx.attach(stage)
    const cam = worldCamera(stage, host, ctx.query)
    let disposed = false
    let batch: StaticBatch | null = null
    const meshes: TerrainMesh[] = []
    const cleanup: (() => void)[] = []
    const one = ctx.query.get("tile")
    const group = ctx.query.get("group")

    const build = async () => {
      const [catalog] = await Promise.all([loadCatalog(), loadTiles()])
      if (!catalog || disposed) return
      const all = tilePrefabs()
      const shown = one ? all.filter((t) => t.id === one) : group ? all.filter((t) => t.group === group) : all
      const R = HEX_TILE_SIZE
      const gap = R * 2.9
      const cols = Math.min(7, shown.length)
      const at = (k: number): [number, number] => [(k % cols) * gap, Math.floor(k / cols) * gap * 1.25]
      const tiles: HexPrism[] = []
      const pieces: BatchInstance[] = []
      const paths: number[] = []
      shown.forEach((t, k) => {
        const [x, z] = at(k)
        tiles.push({ x, z, top: t.ground === "water" ? 0.15 : 0.5, color: GROUND[t.ground], side: SIDE })
        pieces.push(...placeTile(t, [x, z], 0.5, TURN, k + 1, false).filter((q) => catalog.get(q.piece)))
        pathStrips(t, x, z, paths)
      })
      meshes.push(createHexGround(stage, { size: R, base: -0.5, tiles }))
      if (paths.length) meshes.push(createSurface(stage, new Float32Array(paths), "#d9c08c"))
      const w = (cols - 1) * gap
      const h = Math.floor((shown.length - 1) / cols) * gap * 1.25
      const sun = createSun(stage, { town: { min: [-R * 2, -1, -R * 2], max: [w + R * 2, 12, h + R * 2] } })
      createSky(stage, { sun, hour: 15.5, reach: Math.max(40, w) })
      const pose: CameraPose = one
        ? { target: [0, 1.2, 0], azimuth: 25, elevation: 32, distance: 13 }
        : { target: [w / 2, 1, h / 2], azimuth: 0, elevation: 42, distance: Math.max(w, h) * 1.15 + 12 }
      stage.setCamera(pose)
      cam.start({ centre: [w / 2, h / 2], half: Math.max(w, h) + 20, water: null, free: true })
      batch = await createStaticBatch(stage, pieces, async (id) => {
        const entry = catalog.get(id)
        if (!entry) throw new Error(`hextiles: unknown piece "${id}"`)
        return loadPiece(libraryUrl(entry.files.glb))
      })
      if (disposed) return
      const knight = catalog.get(CHARACTER)
      for (const [k, t] of shown.entries()) {
        const [x, z] = at(k)
        if (knight) {
          const root = await loadPiece(libraryUrl(knight.files.glb))
          if (disposed) return
          // beside the tile, level with its middle: the same distance from the camera as what stands on it
          root.position.set(x + R * 0.45, 0.5, z + 1.4)
          root.rotation.y = 0
          root.scale.setScalar(CHARACTER_SCALE)
          stage.scene.add(root)
          cleanup.push(() => root.removeFromParent())
        }
        const el = document.createElement("div")
        el.textContent = t.name
        el.style.cssText =
          "position:absolute;z-index:2;padding:3px 8px;border-radius:4px;background:rgba(21,17,13,0.82);color:#f3e9d4;font:12px ui-monospace,Menlo,monospace;transform:translate(-50%,0);pointer-events:none"
        host.append(el)
        cleanup.push(() => el.remove())
        cleanup.push(
          stage.onFrame(() => {
            const s = toScreen(stage, [x, 0.4, z + R * 1.05])
            el.style.display = s ? "" : "none"
            if (!s) return
            el.style.left = `${s[0]}px`
            el.style.top = `${s[1]}px`
          }),
        )
      }
      sun.markDirty()
      logger.info("tiles", { tiles: shown.length, pieces: pieces.length })
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
  },
}
