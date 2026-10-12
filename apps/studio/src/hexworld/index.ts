/**
 * The hex island in 3D (`/town/<seed>` and `/lab/hexworld`): the hex map built tile by tile from the tile
 * prefabs at scale B, on stepped hex ground with thick sides, under the live sky and clouds, with a clock.
 * V1's look over it: the sea and the inland water read a baked shore field (depth colour, foam, waves),
 * the post pipeline grades it (bloom, ink, mood LUT, vignette, SMAA), and the opening camera sees the sun
 * from the side so the shadows read.
 * The island is built in a worker (job.ts) and arrives in stages: the ground first (drawn at once), the
 * shore field and the water next, the pieces last, while their models load. This thread only uploads.
 * `?files=` sizes the island like a repo of that many files; `?hour=`, `?az=`, `?shadow=`, `?fill=`,
 * `?post=0`, `?aa=msaa|none` and `?ground=hex|soft` are for comparisons; `?step=` tries another height per
 * level (metres, default LEVEL_STEP) and `?detail=0` shows the ground without its painted small hexes and
 * speckle. The nature knobs (plan-hex "Nature pass", world nature.ts), all multipliers, 1 today:
 * `?tree=` / `?pine=` / `?bush=` / `?rock=` / `?grass=` / `?flower=` size each family (nothing grows into
 * a road or a building), `?woods=` thins or fills the trees of wooded tiles, `?wild=` moves the open
 * country's share of woods.
 */
import type { CameraPose } from "@guildhall/core"
import { log } from "@guildhall/core"
import {
  type Atmosphere,
  createAtmosphere,
  createFieldWater,
  createHexGround,
  createNight,
  createPost,
  createSky,
  createStage,
  createStaticBatch,
  createSun,
  createSurface,
  createVertexMesh,
  loadPiece,
  type Night,
  type Post,
  type PostAa,
  type StaticBatch,
  shoreFieldTexture,
  type TerrainMesh,
  type Water,
} from "@guildhall/render"
import { HEX_TILE_SIZE, hexIsland, hexWorld, hexZones, LEVEL_STEP } from "@guildhall/world"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import type { Screen } from "../screens.ts"
import { worldCamera } from "../shell/worldCamera.ts"
import { loadTiles } from "../tiles.ts"
import {
  batchSets,
  type FromWorker,
  type GroundMode,
  type GroundStage,
  type HexJobSpec,
  heightsAt,
  type MapStage,
  natureOf,
  type PackedPieces,
  runHexJob,
  SEA_LEVEL,
  type ShoreStage,
  type ToWorker,
} from "./job.ts"
import { createLife, type Life } from "./life.ts"

const logger = log("studio:hexworld")

const aaOf = (v: string | null): PostAa => (v === "msaa" || v === "none" ? v : "smaa")
const groundOf = (v: string | null): GroundMode => (v === "hex" || v === "soft" ? v : "fine")
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

interface Stages {
  map: Promise<MapStage>
  ground: Promise<GroundStage>
  pieces: Promise<PackedPieces>
  shore: Promise<ShoreStage>
  dispose(): void
}

/** The job's stages as they arrive: from the worker, or inline (a tick later) where there is none. */
function startJob(spec: Promise<HexJobSpec>): Stages {
  const waiting: { take(stage: unknown): void; fail(e: Error): void }[] = []
  const stage = <T>() =>
    new Promise<T>((take, fail) => {
      waiting.push({ take: take as (stage: unknown) => void, fail })
    })
  const map = stage<MapStage>()
  const ground = stage<GroundStage>()
  const pieces = stage<PackedPieces>()
  const shore = stage<ShoreStage>()
  const [onMap, onGround, onPieces, onShore] = waiting as [
    (typeof waiting)[0],
    (typeof waiting)[0],
    (typeof waiting)[0],
    (typeof waiting)[0],
  ]
  const fail = (e: Error) => {
    for (const w of waiting) w.fail(e)
  }
  // a screen torn down mid-build drops the stages it no longer waits on quietly
  for (const p of [map, ground, pieces, shore]) p.catch(() => {})
  const take = (msg: FromWorker) => {
    if (msg.type === "map") onMap.take(msg.map)
    else if (msg.type === "ground") onGround.take(msg.ground)
    else if (msg.type === "pieces") onPieces.take(msg.pieces)
    else if (msg.type === "shore") onShore.take(msg.shore)
    else fail(new Error(msg.message))
  }
  let worker: Worker | null = null
  try {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
  } catch (error) {
    logger.warn("no worker, building inline", { error: String(error) })
  }
  if (worker) {
    worker.onmessage = (e: MessageEvent<FromWorker>) => take(e.data)
    worker.onerror = (e) => fail(new Error(e.message))
    // the worker boots while the spec (the authored tiles) loads
    const w = worker
    spec.then((s) => w.postMessage({ type: "job", spec: s } satisfies ToWorker), fail)
  } else
    spec.then((s) => {
      try {
        runHexJob(s, take)
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    }, fail)
  return {
    map,
    ground,
    pieces,
    shore,
    dispose() {
      worker?.terminate()
      // a stage still awaited settles (a settled one ignores this), so nothing waits on a dead job
      fail(new Error("disposed"))
    },
  }
}

export const hexWorldScreen: Screen = {
  id: "hexworld",
  title: "Hex island",
  mount(host, ctx) {
    const t0 = performance.now()
    const since = () => Math.round(performance.now() - t0)
    const num = (k: string, d: number) => {
      const v = Number(ctx.query.get(k))
      return ctx.query.has(k) && Number.isFinite(v) ? v : d
    }
    const seed = num("seed", Number(ctx.query.get("town")) || 1)
    const files = num("files", 4000)
    // the worker starts first: it builds while the stage, its context and the catalog get ready
    const step = num("step", LEVEL_STEP)
    const detail = ctx.query.get("detail") !== "0"
    // the nature knobs (?tree= ?pine= ?bush= ?rock= ?grass= ?flower= ?woods= ?wild=), for side-by-sides
    const nature = natureOf(ctx.query)
    // the authored tile prefabs (data/tiles) before anything is built from them: here (life builds on
    // this thread too) and in the worker
    const job = startJob(
      loadTiles().then((tiles) => ({
        seed,
        files,
        ground: groundOf(ctx.query.get("ground")),
        step,
        paint: detail,
        tiles: tiles.length ? tiles : null,
        nature,
      })),
    )
    const catalogLoad = loadCatalog()
    const stage = createStage(host)
    ctx.attach(stage)
    const cam = worldCamera(stage, host, ctx.query)
    let disposed = false
    let batch: StaticBatch | null = null
    let water: Water | null = null
    let atmosphere: Atmosphere | null = null
    let night: Night | null = null
    let unTick = () => {}
    let post: Post | null = null
    let disposeField = () => {}
    let life: Life | null = null
    const meshes: TerrainMesh[] = []
    const info = document.createElement("div")
    info.style.cssText =
      "position:absolute;left:12px;top:12px;z-index:2;padding:8px 12px;border-radius:4px;background:rgba(21,17,13,0.82);color:#f3e9d4;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre"
    host.append(info)

    const build = async () => {
      // The map: the sky, the sun, the night, the post and the camera are set up (and their shaders
      // compiled by the frames drawn meanwhile) while the worker still builds the ground.
      const m = await job.map
      if (disposed) return
      const R = HEX_TILE_SIZE
      if (m.paths.length) meshes.push(createSurface(stage, m.paths, "#d9c08c"))
      // stone stairs where roads step down, plank bridges over the rivers: built like the ground
      if (m.structures) meshes.push(createVertexMesh(stage, m.structures))
      const span = m.span
      const hour = num("hour", 15.5)
      const sun = createSun(stage, { town: { min: [-span, -3, -span], max: [span, 20, span] } })
      const sky = createSky(stage, {
        sun,
        hour,
        reach: span * 1.4,
        shadow: num("shadow", 1),
        fill: num("fill", 0.75),
      })
      // the night: a light in every lantern the tiles hold
      const lamps = m.lamps.map((at) => ({ kind: "street" as const, at, radius: 6 }))
      night = createNight(stage, { points: lamps, windows: [] }, { sky, hour })
      // a clock: drag to set the hour, ▶ plays the day
      const clock = document.createElement("div")
      clock.style.cssText =
        "position:absolute;left:12px;bottom:12px;z-index:2;padding:6px 10px;border-radius:4px;background:rgba(21,17,13,0.82);color:#f3e9d4;font:12px ui-monospace,Menlo,monospace;display:flex;gap:8px;align-items:center;min-width:300px"
      const play = document.createElement("button")
      play.textContent = "▶"
      play.style.cssText =
        "font:inherit;color:inherit;background:#3a2f22;border:1px solid #6b5636;border-radius:3px;padding:1px 8px;cursor:pointer"
      const slider = document.createElement("input")
      slider.type = "range"
      slider.min = "0"
      slider.max = "24"
      slider.step = "0.05"
      slider.value = String(hour)
      slider.style.flex = "1"
      const label = document.createElement("span")
      let now = hour
      let playing = false
      const show = (h: number) => {
        now = (h + 24) % 24
        label.textContent = `${String(Math.floor(now)).padStart(2, "0")}:${String(Math.floor((now % 1) * 60)).padStart(2, "0")}`
        night?.setHour(now)
      }
      show(hour)
      slider.oninput = () => show(Number(slider.value))
      play.onclick = () => {
        playing = !playing
        play.textContent = playing ? "❚❚" : "▶"
      }
      unTick = stage.onFrame((dt) => {
        if (!playing) return
        show(now + dt * 0.5)
        slider.value = String(now)
      })
      clock.append(play, label, slider)
      host.append(clock)
      atmosphere = createAtmosphere(stage, { light: () => sky.light(), centre: [0, 0], reach: span, seed })
      if (ctx.query.get("post") !== "0")
        post = createPost(stage, { light: () => sky.light(), aa: aaOf(ctx.query.get("aa")) })
      const azimuth = num("az", sideLit(sky.light().sunDir))
      const pose: CameraPose = m.heart
        ? { target: m.heart, azimuth, elevation: 38, distance: 70 }
        : { target: [0, 0, 0], azimuth, elevation: 45, distance: span * 1.6 }
      stage.setCamera(pose)
      // The ground.
      const g = await job.ground
      if (disposed) return
      const arrived = since()
      const groundAt = heightsAt(g.heights)
      if (g.prisms) meshes.push(createHexGround(stage, { size: R, base: -2.5, tiles: g.prisms }))
      else if (g.mesh) meshes.push(createVertexMesh(stage, g.mesh, undefined, { speckle: detail }))
      cam.start({
        centre: [0, 0],
        half: span * 1.2,
        heightAt: (x, zz) => groundAt(x, zz),
        water: 0,
        free: true,
      })
      // The first frame with the ground in it: timed once it has been drawn (a task after the frame).
      const firstFrame = new Promise<number>((done) => {
        const off = stage.onFrame(() => {
          off()
          setTimeout(() => done(since()), 0)
        })
      })
      const first = await firstFrame
      if (disposed) return
      info.textContent = `hex island · seed ${seed} · ${files} files\nfirst frame ${first} ms · building…`
      const shoreDone = job.shore.then((s) => {
        if (disposed) return
        const field = shoreFieldTexture(s)
        water = createFieldWater(stage, {
          field,
          sea: { level: SEA_LEVEL, half: span * 3 },
          pools: { size: R * 1.01, tiles: m.pools },
        })
        disposeField = () => field.dispose()
        logger.info("shore field", { ms: s.ms, at: since() })
      })
      const catalog = await catalogLoad
      if (!catalog || disposed) return
      // the crop rows of each field as one cluster: its pieces near, one merged shell far
      const { loose, clusters } = batchSets(await job.pieces, (p) => catalog.get(p.piece) !== undefined)
      const placed = loose.length + clusters.reduce((n, c) => n + c.parts.length, 0)
      batch = await createStaticBatch(
        stage,
        loose,
        async (id) => {
          const entry = catalog.get(id)
          if (!entry) throw new Error(`hexworld: unknown piece "${id}"`)
          return loadPiece(libraryUrl(entry.files.glb))
        },
        clusters,
      )
      await shoreDone
      if (disposed) {
        batch.dispose()
        return
      }
      sun.markDirty()
      // ---- life (track B): townsfolk and agents on the walk graph; `?life=0` turns it off ----
      if (ctx.query.get("life") !== "0") {
        // Life plans on the map itself: its pure parts built again here (~0.1 s), once the island is drawn.
        const island = hexIsland({ seed, files })
        const zones = hexZones(island, { wild: nature.wild })
        const world = hexWorld(island, zones, { step, nature })
        life = createLife(stage, {
          host,
          island,
          zones,
          world,
          groundAt: (x: number, zz: number) => world.stairAt(x, zz) ?? groundAt(x, zz),
          hour: () => now,
          seed,
          agentT: num("lifeT", 0),
        })
        await life.ready
      }
      const top = Object.entries(m.stats.prefabs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k, n]) => `${k} ${n}`)
        .join(" · ")
      const knobs = Object.entries(nature)
        .map(([k, v]) => `${k} ×${v}`)
        .join(" · ")
      const grown = m.stats.nature
      info.textContent = [
        `hex island · seed ${seed} · ${files} files`,
        `${m.stats.land} land tiles · ${placed} pieces · first frame ${first} ms · all ${since()} ms`,
        top,
        ...(knobs
          ? [`nature ${knobs}${grown ? ` · ${grown.grown} grown, ${grown.held} held back` : ""}`]
          : []),
      ].join("\n")
      logger.info("built", {
        tiles: m.stats.tiles,
        pieces: placed,
        nature: grown,
        ground: arrived,
        first,
        ms: since(),
        times: g.times,
      })
    }
    ctx
      .load(build())
      .catch((error: unknown) => disposed || logger.error("build failed", { error: String(error) }))
    return () => {
      disposed = true
      job.dispose()
      cam.dispose()
      batch?.dispose()
      water?.dispose()
      disposeField()
      atmosphere?.dispose()
      night?.dispose()
      life?.dispose()
      unTick()
      post?.dispose()
      for (const m of meshes) m.dispose()
      stage.dispose()
      host.replaceChildren()
    }
  },
}
