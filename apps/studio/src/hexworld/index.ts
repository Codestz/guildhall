/**
 * The hex island in 3D (`/town/<seed>` and `/lab/hexworld`): the hex map built tile by tile from the tile
 * prefabs at scale B, on stepped hex ground with thick sides, under the live sky and clouds, with a clock.
 * `?files=` sizes the island like a repo of that many files.
 */
import type { CameraPose } from "@guildhall/core"
import { log } from "@guildhall/core"
import {
  type Atmosphere,
  createAtmosphere,
  createHexGround,
  createSky,
  createStage,
  createStaticBatch,
  createSun,
  createSurface,
  createVertexMesh,
  createWater,
  type HexPrism,
  loadPiece,
  type StaticBatch,
  type TerrainMesh,
  type Water,
} from "@guildhall/render"
import { HEX_TILE_SIZE, hexGroundFine, hexGroundMesh, hexIsland, hexWorld, hexZones } from "@guildhall/world"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import type { Screen } from "../screens.ts"
import { worldCamera } from "../shell/worldCamera.ts"

const logger = log("studio:hexworld")

type RGB = [number, number, number]
const TOP: Record<string, RGB> = {
  grass: [134, 190, 78],
  soil: [150, 112, 70],
  dirt: [196, 160, 108],
  paved: [196, 186, 166],
  sand: [232, 210, 150],
  rock: [150, 140, 128],
  cliff: [140, 128, 112],
  water: [79, 154, 214],
}
const SIDE: Record<string, RGB> = {
  rock: [118, 110, 100],
  cliff: [118, 110, 100],
  sand: [178, 144, 98],
  water: [90, 120, 140],
}
const SIDE_LAND: RGB = [122, 90, 60]

export const hexWorldScreen: Screen = {
  id: "hexworld",
  title: "Hex island",
  mount(host, ctx) {
    const stage = createStage(host)
    ctx.attach(stage)
    const cam = worldCamera(stage, host, ctx.query)
    const num = (k: string, d: number) => {
      const v = Number(ctx.query.get(k))
      return ctx.query.has(k) && Number.isFinite(v) ? v : d
    }
    const seed = num("seed", Number(ctx.query.get("town")) || 1)
    const files = num("files", 4000)
    let disposed = false
    let batch: StaticBatch | null = null
    let water: Water | null = null
    let atmosphere: Atmosphere | null = null
    const meshes: TerrainMesh[] = []
    const info = document.createElement("div")
    info.style.cssText =
      "position:absolute;left:12px;top:12px;z-index:2;padding:8px 12px;border-radius:4px;background:rgba(21,17,13,0.82);color:#f3e9d4;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre"
    host.append(info)

    const build = async () => {
      const t0 = performance.now()
      const h = hexIsland({ seed, files })
      const z = hexZones(h)
      const w = hexWorld(h, z)
      const R = HEX_TILE_SIZE
      let groundAt = (x: number, zz: number) => w.heightAt(x, zz)
      const tiles: HexPrism[] = w.tiles.map((t) => {
        const v = 0.95 + 0.1 * (((t.i * 2654435761) >>> 0) / 4294967296)
        const c = TOP[t.ground] ?? TOP.grass!
        return {
          x: t.x,
          z: t.z,
          top: t.top,
          color: [c[0] * v, c[1] * v, c[2] * v],
          side: SIDE[t.ground] ?? SIDE_LAND,
        }
      })
      // the soft ground: equal tiles merge, walls only at steps, sand slopes into the sea
      // (`?ground=hex` shows every tile as its own prism)
      if (ctx.query.get("ground") === "hex")
        meshes.push(createHexGround(stage, { size: R, base: -2.5, tiles }))
      else if (ctx.query.get("ground") === "soft") {
        const m = hexGroundMesh(h, w, { top: TOP, side: SIDE, sideLand: SIDE_LAND, slope: TOP.sand! })
        meshes.push(createVertexMesh(stage, m.position, m.color))
      } else {
        // fine ground: small hexes, low terraces on the hills, land falling to the shore; nature stands on it
        const m = hexGroundFine(h, w, { top: TOP, side: SIDE, sideLand: SIDE_LAND, slope: TOP.sand! })
        meshes.push(createVertexMesh(stage, m.position, m.color))
        for (const p of w.pieces) {
          const y = m.heightAt(p.x, p.z)
          if (y > 0 && Math.abs(y - p.y) < 3) p.y = y
        }
        groundAt = m.heightAt
      }
      if (w.paths.length) meshes.push(createSurface(stage, new Float32Array(w.paths), "#d9c08c"))
      let span = 0
      for (const t of w.tiles) span = Math.max(span, Math.abs(t.x), Math.abs(t.z))
      span += R * 4
      water = createWater(stage, {
        polys: [
          [
            [-span * 3, -span * 3],
            [span * 3, -span * 3],
            [span * 3, span * 3],
            [-span * 3, span * 3],
          ],
        ],
        level: -0.05,
        shore: [],
      })
      const hour = num("hour", 15.5)
      const sun = createSun(stage, { town: { min: [-span, -3, -span], max: [span, 20, span] } })
      const sky = createSky(stage, { sun, hour, reach: span * 1.4 })
      atmosphere = createAtmosphere(stage, { light: () => sky.light(), centre: [0, 0], reach: span, seed })
      const heart = z.zones[0] ? w.tiles.find((t) => t.i === z.zones[0]!.tile) : undefined
      const pose: CameraPose = heart
        ? { target: [heart.x, heart.top, heart.z], azimuth: 30, elevation: 38, distance: 70 }
        : { target: [0, 0, 0], azimuth: 30, elevation: 45, distance: span * 1.6 }
      stage.setCamera(pose)
      cam.start({
        centre: [0, 0],
        half: span * 1.2,
        heightAt: (x, zz) => w.heightAt(x, zz),
        water: 0,
        free: true,
      })
      const catalog = await loadCatalog()
      if (!catalog || disposed) return
      const pieces = w.pieces.filter((p) => catalog.get(p.piece))
      batch = await createStaticBatch(stage, pieces, async (id) => {
        const entry = catalog.get(id)
        if (!entry) throw new Error(`hexworld: unknown piece "${id}"`)
        return loadPiece(libraryUrl(entry.files.glb))
      })
      if (disposed) {
        batch.dispose()
        return
      }
      sun.markDirty()
      const top = Object.entries(w.stats.prefabs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k, n]) => `${k} ${n}`)
        .join(" · ")
      info.textContent = [
        `hex island · seed ${seed} · ${files} files`,
        `${h.stats.land} land tiles · ${pieces.length} pieces · ${Math.round(performance.now() - t0)} ms`,
        top,
      ].join("\n")
      logger.info("built", { tiles: w.tiles.length, pieces: pieces.length })
    }
    ctx.load(build()).catch((error: unknown) => logger.error("build failed", { error: String(error) }))
    return () => {
      disposed = true
      cam.dispose()
      batch?.dispose()
      water?.dispose()
      atmosphere?.dispose()
      for (const m of meshes) m.dispose()
      stage.dispose()
      host.replaceChildren()
    }
  },
}
