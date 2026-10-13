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
  FRAME,
  GATE_PIECES,
  gateFrame,
  loadPiece,
  type Night,
  type Post,
  type PostAa,
  type Stage,
  type StaticBatch,
  type Sun,
  setLod,
  shoreFieldTexture,
  type TerrainMesh,
  type VertexMeshData,
  vertexMeshData,
  type Water,
} from "@guildhall/render"
import type { Viewer } from "@guildhall/ui"
import { roman } from "@guildhall/ui"
import {
  HEX_TILE_SIZE,
  type HexIsland,
  type HexWorld,
  hexIsland,
  hexWorld,
  hexZones,
  LEVEL_STEP,
} from "@guildhall/world"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import type { Screen, ScreenCtx } from "../screens.ts"
import { current } from "../shell/router.ts"
import { mountViewer } from "../shell/viewer.ts"
import { islandWorld, worldCamera } from "../shell/worldCamera.ts"
import { loadTiles } from "../tiles.ts"
import { atmoKnobs, createIslandAir, type IslandAir } from "./atmo.ts"
import { createDoors, type Doors } from "./doors.ts"
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
  shapeOf,
  type ToWorker,
} from "./job.ts"
import { clock, islandKnobs } from "./knobs.ts"
import { createLife, type Life } from "./life.ts"
import { LINES, loadPlan, PITCH, STEPS } from "./loading.ts"
import { loaderOn, publishWorld, settle } from "./ready.ts"

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

/** The road strips' colour (`createSurface`). */
export const ROAD_COLOR = "#d9c08c"

/**
 * What another screen lays over the island as it is built (the history replay, `replay/`): it draws the
 * island's triangle soups its own way, is handed the built parts, and may take the transport.
 */
export interface WorldHooks {
  /** Draws the ground, the stairs and bridges, or the road strips (their normals and linear colours ready). */
  mesh(stage: Stage, data: VertexMeshData, kind: "ground" | "structures" | "roads"): TerrainMesh
  /** The transport is the hook's (the day's clock is still set by `ext.clock`). */
  transport?: boolean
  /** Once the island is drawn and its pure parts are built on this thread. */
  built(parts: {
    island: HexIsland
    world: HexWorld
    batch: StaticBatch
    life: Life | null
    doors: Doors
    water: Water | null
    sun: Sun
    stage: Stage
    viewer: Viewer
    groundAt(x: number, z: number): number
    land: number
  }): void
}

export const hexWorldScreen: Screen = {
  id: "hexworld",
  title: "Hex island",
  mount: (outer, ctx) => mountHexWorld(outer, ctx),
}

/** The hex island screen; `hooks` lets another screen draw and drive parts of it (`WorldHooks`). */
export const mountHexWorld = (outer: HTMLElement, ctx: ScreenCtx, hooks?: WorldHooks): (() => void) =>
  world.mount(outer, ctx, hooks)

// A method, so the mount's body keeps the depth it had as the screen's own `mount` (its diffs stay small).
const world = {
  mount(outer: HTMLElement, ctx: ScreenCtx, hooks?: WorldHooks): () => void {
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
    // `?lod=0`: every piece at full detail at any distance, the reference a LOD change is judged against
    setLod(ctx.query.get("lod") !== "0")
    // the nature knobs (?tree= ?pine= ?bush= ?rock= ?grass= ?flower= ?woods= ?wild=), for side-by-sides
    const nature = natureOf(ctx.query)
    // the hex map's shape knobs (?coast= ?hills= ?rain= ?forest=): `/lab/hexmap`'s island in 3D
    const shape = shapeOf(ctx.query)
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
        shape,
      })),
    )
    const catalogLoad = loadCatalog()
    // `?name=`: the island's own name (the site's `/` is "Guildhall", a hall its repo), else the seed's
    const name = ctx.query.get("name") || `Island ${roman(seed)}`
    // the chrome: the Viewer's corners and Inspector round the stage (shell/viewer.ts); the seed is the
    // path's on `/town/<seed>`, so its knob writes `town`
    const seedKey = current().screen === "town" ? "town" : "seed"
    const viewQuery = new URLSearchParams(ctx.query)
    viewQuery.set(seedKey, String(seed))
    const viewer = mountViewer(outer, { ...ctx, query: viewQuery }, "town", {
      title: name,
      subtitle: `Seed ${seed}, grown for a repo of ${files.toLocaleString("en-US")} files`,
      sections: islandKnobs(seedKey),
    })
    const host = viewer.stage
    // The loading screen (loading.ts, ready.ts): the cover stays until the whole island is built, compiled and
    // drawn calm, then lifts once. `?loader=0` lifts at the ground, as before the loader.
    const cover = loaderOn(ctx.query)
    const plan = loadPlan(files)
    const steps = viewer.loading(name, STEPS, PITCH)
    const go = (name: (typeof STEPS)[number], to: number) => {
      steps.step(name)
      steps.line(LINES[name])
      steps.progress(to, plan[name])
    }
    publishWorld("loading")
    go("Map", 0.07)
    // a screen torn down mid-settle: no frame will come, so the wait ends here
    let tornDown = () => {}
    const torn = new Promise<void>((done) => {
      tornDown = done
    })
    const stage = createStage(host)
    ctx.attach(stage)
    viewer.attachStage(stage)
    const cam = worldCamera(stage, viewer.camera, ctx.query)
    let disposed = false
    let batch: StaticBatch | null = null
    let water: Water | null = null
    let air: IslandAir | null = null
    let night: Night | null = null
    let unTick = () => {}
    let post: Post | null = null
    let disposeField = () => {}
    let life: Life | null = null
    let doors: Doors | null = null
    const meshes: TerrainMesh[] = []

    const build = async () => {
      // The map: the sky, the sun, the night, the post and the camera are set up (and their shaders
      // compiled by the frames drawn meanwhile) while the worker still builds the ground.
      const m = await job.map
      if (disposed) return
      steps.progress(0.08, 150)
      go("Ground", 0.28)
      const R = HEX_TILE_SIZE
      if (m.paths.length)
        meshes.push(
          hooks
            ? hooks.mesh(stage, vertexMeshData(m.paths, new Float32Array(m.paths.length)), "roads")
            : createSurface(stage, m.paths, ROAD_COLOR),
        )
      // stone stairs where roads step down, plank bridges over the rivers: built like the ground
      if (m.structures)
        meshes.push(
          hooks ? hooks.mesh(stage, m.structures, "structures") : createVertexMesh(stage, m.structures),
        )
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
      // the clock: the Viewer's transport; drag to set the hour, play runs the day at half an hour a second
      let now = hour
      const show = (h: number) => {
        now = (h + 24) % 24
        night?.setHour(now)
      }
      show(hour)
      const day = hooks?.transport
        ? null
        : viewer.transport({
            label: "Time of day",
            value: hour,
            min: 0,
            max: 24,
            step: 0.05,
            rate: 0.5,
            wrap: true,
            format: clock,
            onChange: show,
          })
      unTick = () => day?.dispose()
      // for shots: set the clock as a drag would
      const ext = window.guildhall?.ext
      if (ext)
        ext.clock = {
          get: () => now,
          set: (h: number) => {
            day?.set(h)
            show(h)
          },
        }
      // the sea reaches the far plane: the horizon haze (atmo.ts) melts its rim into the sky
      const sea = Math.max(span * 3, stage.camera.far * 0.95)
      air = createIslandAir(stage, { light: () => sky.light(), span, seed, sea, knobs: atmoKnobs(ctx.query) })
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
      else if (g.mesh)
        meshes.push(
          hooks
            ? hooks.mesh(stage, g.mesh, "ground")
            : createVertexMesh(stage, g.mesh, undefined, { speckle: detail }),
        )
      cam.start(islandWorld(span, (x, zz) => groundAt(x, zz), 0))
      // The first frame with the ground in it: timed once it has been drawn (a task after the frame).
      const firstFrame = new Promise<number>((done) => {
        const off = stage.onFrame(() => {
          off()
          setTimeout(() => done(since()), 0)
        })
      })
      const first = await firstFrame
      if (disposed) return
      // With the cover the island stays hidden until all of it is built (below). Without (`?loader=0`) the
      // ground is in view: the veil lifts and the rest builds in sight, its step on the title card.
      steps.progress(0.3, 150)
      if (!cover) {
        steps.step("Water")
        void steps.lift()
        publishWorld("revealed")
      }
      const shoreDone = job.shore.then((s) => {
        if (disposed) return
        const field = shoreFieldTexture(s)
        water = createFieldWater(stage, {
          field,
          sea: { level: SEA_LEVEL, half: sea },
          pools: { size: R * 1.01, tiles: m.pools },
        })
        disposeField = () => field.dispose()
        logger.info("shore field", { ms: s.ms, at: since() })
      })
      const catalog = await catalogLoad
      if (!catalog || disposed) return
      go("Pieces", 0.7)
      // the crop rows of each field as one cluster: its pieces near, one merged shell far
      const { loose, clusters } = batchSets(await job.pieces, (p) => catalog.get(p.piece) !== undefined)
      const placed = loose.length + clusters.reduce((n, c) => n + c.parts.length, 0)
      const load = (id: string) => {
        const entry = catalog.get(id)
        if (!entry) throw new Error(`hexworld: unknown piece "${id}"`)
        return loadPiece(libraryUrl(entry.files.glb))
      }
      // a gate's leaves swing (doors.ts): the batch draws its frame, the gates its leaves
      const gates = loose.filter((p) => GATE_PIECES.has(p.piece))
      batch = await createStaticBatch(
        stage,
        loose.map((p) => (GATE_PIECES.has(p.piece) ? { ...p, piece: p.piece + FRAME } : p)),
        async (id) => (id.endsWith(FRAME) ? gateFrame(await load(id.slice(0, -FRAME.length))) : load(id)),
        clusters,
      )
      steps.progress(0.74, 150)
      go("Water", 0.8)
      await shoreDone
      if (disposed) {
        batch.dispose()
        return
      }
      steps.progress(0.8, 150)
      sun.markDirty()
      // ---- life (track B): townsfolk and agents on the walk graph; `?life=0` turns it off ----
      let world: ReturnType<typeof hexWorld> | null = null
      let island: HexIsland | null = null
      const alive = ctx.query.get("life") !== "0"
      if (alive || hooks) {
        // Life plans on the map itself: its pure parts built again here (~0.1 s), once the island is drawn.
        island = hexIsland({ ...shape, seed, files })
        const zones = hexZones(island, { wild: nature.wild })
        world = hexWorld(island, zones, { step, nature })
      }
      if (alive && island && world) {
        go("Townsfolk", 0.92)
        const zones = hexZones(island, { wild: nature.wild })
        const built = world
        life = createLife(stage, {
          host,
          island,
          zones,
          world: built,
          groundAt,
          hour: () => now,
          seed,
          agentT: num("lifeT", 0),
          overlay: ctx.query.get("collide") === "1" || ctx.query.get("spots") === "1",
        })
        await life.ready
      }
      steps.progress(0.93, 150)
      // doors that open: the gates by day and for whoever comes, the buildings' doors for whoever goes in
      if (disposed) return
      doors = await createDoors(stage, {
        gates,
        load,
        doorways: world?.doorways ?? [],
        life,
        all: ctx.query.get("doors") === "open",
        hour: () => now,
      })
      if (disposed) {
        doors.dispose()
        return
      }
      // The light: shaders compiled and a calm run of frames drawn with all of it in, behind the cover.
      go("Light", 0.99)
      const ready = await settle(stage, {
        until: torn,
        onCalm: (share) => steps.progress(0.93 + 0.06 * share, 200),
      })
      if (disposed) return
      const made = doors
      if (hooks && island && world)
        hooks.built({
          island,
          world,
          batch,
          life,
          doors,
          water,
          sun,
          stage,
          viewer,
          groundAt,
          land: m.stats.land,
        })
      if (window.guildhall?.ext)
        window.guildhall.ext.doors = {
          stats: () => ({
            open: made.open,
            gates: made.gates?.count ?? 0,
            gate: made.gates?.opening(0) ?? null,
          }),
          // for shots: the doorways and the passes through them (a burst frames a door as someone goes in)
          doorways: () => world?.doorways ?? [],
          passes: () => life?.passes() ?? [],
        }
      const grown = m.stats.nature
      viewer.setInfo({
        figures: [
          { label: "Land tiles", value: m.stats.land },
          { label: "Pieces", value: placed },
          { label: "Built in", value: (since() / 1000).toFixed(1), unit: "s" },
        ],
      })
      viewer.setReadout([
        {
          title: "Build",
          rows: [
            { label: "Seed", value: seed },
            { label: "Repo files", value: files },
            { label: "Land tiles", value: m.stats.land },
            { label: "Pieces placed", value: placed },
            { label: "First frame", value: first, unit: "ms" },
            { label: "Whole build", value: since(), unit: "ms" },
            { label: "Shaders compiled", value: ready.compileMs, unit: "ms" },
            { label: "Settled", value: ready.ms, unit: "ms" },
            ...(grown
              ? [
                  { label: "Nature grown", value: grown.grown },
                  {
                    label: "Held back",
                    value: grown.held,
                    tone: grown.held > 0 ? ("warn" as const) : undefined,
                  },
                ]
              : []),
          ],
        },
        {
          title: "Tiles",
          meta: `${Object.keys(m.stats.prefabs).length} kinds`,
          folded: true,
          rows: Object.entries(m.stats.prefabs)
            .sort((a, b) => b[1] - a[1])
            .map(([label, value]) => ({ label, value })),
        },
      ])
      logger.info("settled", ready)
      if (cover) {
        publishWorld("ready")
        // the one reveal: the cover fades, and the island under it has been drawn calm for a while
        await steps.done()
        publishWorld("revealed")
      } else void steps.done()
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
    ctx.load(build()).catch((error: unknown) => {
      if (disposed) return
      steps.fail(`The island did not build: ${String(error)}`)
      logger.error("build failed", { error: String(error) })
    })
    return () => {
      disposed = true
      tornDown()
      publishWorld(null)
      job.dispose()
      cam.dispose()
      batch?.dispose()
      water?.dispose()
      disposeField()
      air?.dispose()
      night?.dispose()
      life?.dispose()
      doors?.dispose()
      unTick()
      post?.dispose()
      for (const m of meshes) m.dispose()
      stage.dispose()
      host.replaceChildren()
      viewer.dispose()
    }
  },
}
