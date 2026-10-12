/**
 * The hex island in 3D (`/town/<seed>` and `/lab/hexworld`): the hex map built tile by tile from the tile
 * prefabs at scale B, on stepped hex ground with thick sides, under the live sky and clouds, with a clock.
 * V1's look over it: the sea and the inland water read a baked shore field (depth colour, foam, waves),
 * the post pipeline grades it (bloom, ink, mood LUT, vignette, SMAA), and the opening camera sees the sun
 * from the side so the shadows read.
 * `?files=` sizes the island like a repo of that many files; `?hour=`, `?az=`, `?shadow=`, `?fill=`,
 * `?post=0` and `?aa=msaa|none` are for comparisons.
 */
import type { CameraPose } from "@guildhall/core"
import { log } from "@guildhall/core"
import {
  type Atmosphere,
  bakeShoreField,
  createAtmosphere,
  createFieldWater,
  createHexGround,
  createPost,
  createSky,
  createStage,
  createStaticBatch,
  createSun,
  createSurface,
  type HexPrism,
  loadPiece,
  type Post,
  type PostAa,
  type StaticBatch,
  type TerrainMesh,
  type Water,
} from "@guildhall/render"
import { HEX_TILE_SIZE, hexIsland, hexWorld, hexZones } from "@guildhall/world"
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
  // under the water surface: the lake and river bed
  water: [150, 128, 92],
}
const SIDE: Record<string, RGB> = {
  rock: [118, 110, 100],
  cliff: [118, 110, 100],
  sand: [178, 144, 98],
  water: [90, 120, 140],
}
const aaOf = (v: string | null): PostAa => (v === "msaa" || v === "none" ? v : "smaa")
/** Inland water: the bed sits this far under its tile's top, the surface this far. */
const BED_DROP = 0.55
const SURFACE_DROP = 0.14
/** The sea's level, and the shore field's reach (metres) and texel (metres). */
const SEA_LEVEL = -0.05
const SHORE_REACH = 9
const SHORE_TEXEL = 0.2
/**
 * The camera's azimuth (degrees) that sees the sun from the side and a little ahead, `SUN_SIDE`
 * degrees off the way it looks: shadows fall across the view toward the camera, as in V1.
 * A sun straight behind the camera (the old fixed 30° at 15:30) hides every shadow behind what casts it.
 */
const SUN_SIDE = 75
export function sideLit(sunDir: readonly [number, number, number]): number {
  const sun = Math.atan2(sunDir[2], sunDir[0])
  const look = sun - (SUN_SIDE * Math.PI) / 180
  // The rig looks along (-sin az, -cos az).
  const az = (Math.atan2(-Math.cos(look), -Math.sin(look)) * 180) / Math.PI
  return Math.round(((az % 360) + 360) % 360)
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
    let post: Post | null = null
    let disposeField = () => {}
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
      // Inland water (lakes, rivers, docks above the sea): a bed sunk under the tile and a surface over it.
      const pools = w.tiles.filter((t) => t.ground === "water" && t.top - SURFACE_DROP > SEA_LEVEL)
      const pooled = new Set(pools.map((t) => t.i))
      const tiles: HexPrism[] = w.tiles.map((t) => {
        const v = 0.95 + 0.1 * (((t.i * 2654435761) >>> 0) / 4294967296)
        const c = TOP[t.ground] ?? TOP.grass!
        return {
          x: t.x,
          z: t.z,
          top: pooled.has(t.i) ? t.top - BED_DROP : t.top,
          color: [c[0] * v, c[1] * v, c[2] * v],
          side: SIDE[t.ground] ?? SIDE_LAND,
        }
      })
      meshes.push(createHexGround(stage, { size: R, base: -2.5, tiles }))
      if (w.paths.length) meshes.push(createSurface(stage, new Float32Array(w.paths), "#d9c08c"))
      let span = 0
      for (const t of w.tiles) span = Math.max(span, Math.abs(t.x), Math.abs(t.z))
      span += R * 4
      // The shore field: how far every point of the water is from land (anything but a water tile).
      const land = new Set<string>()
      const axial = (x: number, zz: number) => {
        // pixel to axial (pointy top), cube rounding: the same as the world's heightAt
        const qf = ((Math.sqrt(3) / 3) * x - zz / 3) / R
        const rf = ((2 / 3) * zz) / R
        const sf = -qf - rf
        let q = Math.round(qf)
        let r = Math.round(rf)
        const s = Math.round(sf)
        const dq = Math.abs(q - qf)
        const dr = Math.abs(r - rf)
        if (dq > dr && dq > Math.abs(s - sf)) q = -r - s
        else if (dr > Math.abs(s - sf)) r = -q - s
        return `${q},${r}`
      }
      for (const t of w.tiles) if (t.ground !== "water") land.add(axial(t.x, t.z))
      const half = span
      const tf = performance.now()
      const field = bakeShoreField({
        min: [-half, -half],
        size: half * 2,
        res: Math.min(2048, Math.ceil((half * 2) / SHORE_TEXEL)),
        reach: SHORE_REACH,
        isLand: (x, zz) => land.has(axial(x, zz)),
      })
      logger.info("shore field", { ms: Math.round(performance.now() - tf) })
      water = createFieldWater(stage, {
        field,
        sea: { level: SEA_LEVEL, half: span * 3 },
        pools: { size: R * 1.01, tiles: pools.map((t) => ({ x: t.x, z: t.z, y: t.top - SURFACE_DROP })) },
      })
      disposeField = () => field.dispose()
      const hour = num("hour", 15.5)
      const sun = createSun(stage, { town: { min: [-span, -3, -span], max: [span, 20, span] } })
      const sky = createSky(stage, {
        sun,
        hour,
        reach: span * 1.4,
        shadow: num("shadow", 1),
        fill: num("fill", 0.75),
      })
      atmosphere = createAtmosphere(stage, { light: () => sky.light(), centre: [0, 0], reach: span, seed })
      if (ctx.query.get("post") !== "0")
        post = createPost(stage, { light: () => sky.light(), aa: aaOf(ctx.query.get("aa")) })
      const azimuth = num("az", sideLit(sky.light().sunDir))
      const heart = z.zones[0] ? w.tiles.find((t) => t.i === z.zones[0]!.tile) : undefined
      const pose: CameraPose = heart
        ? { target: [heart.x, heart.top, heart.z], azimuth, elevation: 38, distance: 70 }
        : { target: [0, 0, 0], azimuth, elevation: 45, distance: span * 1.6 }
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
      disposeField()
      atmosphere?.dispose()
      post?.dispose()
      for (const m of meshes) m.dispose()
      stage.dispose()
      host.replaceChildren()
    }
  },
}
