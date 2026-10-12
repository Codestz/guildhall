/**
 * Tile gallery (`/lab/hextiles`): every hex tile prefab at scale B, each on its own hex with a KayKit
 * character beside it for scale and its name under it; `?tile=<id>` shows one large. The prefabs are
 * world's TILE_PREFABS (code for the first look; the Composer takes them over once approved).
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
import { CHARACTER_SCALE, HEX_TILE_SIZE, placeTile, TILE_PREFABS, type TileGround } from "@guildhall/world"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import type { Screen } from "../screens.ts"
import { worldCamera } from "../shell/worldCamera.ts"

const logger = log("studio:hextiles")

const GROUND: Record<TileGround, [number, number, number]> = {
  grass: [143, 195, 86],
  soil: [150, 112, 70],
  dirt: [196, 160, 108],
  paved: [196, 186, 166],
  sand: [232, 210, 150],
  rock: [150, 140, 128],
  water: [79, 154, 214],
}
const SIDE: [number, number, number] = [122, 90, 60]
const CHARACTER = "kaykit-adventurers/knight"

export const hexTiles: Screen = {
  id: "hextiles",
  title: "Tile prefabs",
  mount(host, ctx) {
    const stage = createStage(host)
    ctx.attach(stage)
    const cam = worldCamera(stage, host, ctx.query)
    let disposed = false
    let batch: StaticBatch | null = null
    const meshes: TerrainMesh[] = []
    const cleanup: (() => void)[] = []
    const one = ctx.query.get("tile")
    const group = ctx.query.get("group")
    const shown = one
      ? TILE_PREFABS.filter((t) => t.id === one)
      : group
        ? TILE_PREFABS.filter((t) => t.group === group)
        : TILE_PREFABS

    const build = async () => {
      const catalog = await loadCatalog()
      if (!catalog || disposed) return
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
        pieces.push(...placeTile(t, [x, z], 0.5, 0, k + 1).filter((q) => catalog.get(q.piece)))
        // a dirt path from the centre out through each side the tile names (side d's middle sits at
        // 30° + 60°·d on a pointy-top hex), a round patch where they meet
        if (t.path) {
          const y = 0.53
          const w = 0.85
          const reach = R * (Math.sqrt(3) / 2) + 0.05
          for (const d of t.path) {
            const a = (Math.PI / 180) * (60 * d)
            const ex = Math.cos(a) * reach
            const ez = -Math.sin(a) * reach
            const nx = -ez / reach
            const nz = ex / reach
            const q = [
              [x + nx * w, z + nz * w],
              [x - nx * w, z - nz * w],
              [x + ex - nx * w, z + ez - nz * w],
              [x + ex + nx * w, z + ez + nz * w],
            ] as const
            for (const [a0, b0, c0] of [
              [0, 2, 1],
              [0, 3, 2],
              [0, 1, 2],
              [0, 2, 3],
            ] as const)
              paths.push(q[a0][0], y, q[a0][1], q[b0][0], y, q[b0][1], q[c0][0], y, q[c0][1])
          }
          for (let k = 0; k < 8; k++) {
            const a0 = (k / 8) * Math.PI * 2
            const a1 = ((k + 1) / 8) * Math.PI * 2
            paths.push(
              x,
              y,
              z,
              x + Math.cos(a1) * w,
              y,
              z + Math.sin(a1) * w,
              x + Math.cos(a0) * w,
              y,
              z + Math.sin(a0) * w,
            )
            paths.push(
              x,
              y,
              z,
              x + Math.cos(a0) * w,
              y,
              z + Math.sin(a0) * w,
              x + Math.cos(a1) * w,
              y,
              z + Math.sin(a1) * w,
            )
          }
        }
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
