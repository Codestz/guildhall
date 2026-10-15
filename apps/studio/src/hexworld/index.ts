/**
 * The hex island in 3D (`/town/<seed>` and `/lab/hexworld`): the hex map built tile by tile from the tile
 * prefabs at scale B, on stepped hex ground with thick sides, under the live sky and clouds, with a clock.
 * V1's look over it: the sea and the inland water read a baked shore field (depth colour, foam, waves),
 * the post pipeline grades it (bloom, ink, mood LUT, vignette, SMAA), and the opening camera sees the sun
 * from the side so the shadows read.
 * The island is built in a worker (job.ts) and arrives in stages: the ground first (drawn at once), the
 * shore field and the water next, the pieces, while their models load, and last the life plan (everyone's
 * day: a second of path searches that never blocks this thread). This thread only uploads and draws.
 * `?files=` sizes the island like a repo of that many files; `?hour=`, `?shadow=`, `?fill=`,
 * `?post=0`, `?aa=msaa|none` and `?ground=hex|soft` are for comparisons; `?step=` tries another height per
 * level (metres, default LEVEL_STEP) and `?detail=0` shows the ground without its painted small hexes and
 * speckle. The nature knobs (plan-hex "Nature pass", world nature.ts), all multipliers, 1 today:
 * `?tree=` / `?pine=` / `?bush=` / `?rock=` / `?grass=` / `?flower=` size each family (nothing grows into
 * a road or a building), `?woods=` thins or fills the trees of wooded tiles, `?wild=` moves the open
 * country's share of woods.
 */
import { inStyle } from "@guildhall/assets"
import type { CameraPose } from "@guildhall/core"
import { log } from "@guildhall/core"
import {
  createFieldWater,
  createHexGround,
  createNight,
  createPost,
  createSky,
  createSkyDrive,
  createStage,
  createStaticBatch,
  createSun,
  createSurface,
  createVertexMesh,
  FRAME,
  GATE_PIECES,
  gateFrame,
  loadClips,
  loadPiece,
  type Night,
  type Post,
  type PostAa,
  pieceVertices,
  prefetchPrograms,
  prewarmStocksPrograms,
  type Stage,
  type StaticBatch,
  type Sun,
  setLod,
  setRegionField,
  shoreFieldTexture,
  type TerrainMesh,
  type VertexMeshData,
  vertexMeshData,
  type Water,
  warmBatchPrograms,
  warmCrowdPrograms,
  warmScene,
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
  type PlaceSpec,
} from "@guildhall/world"
import { mountSound } from "../audio/mount.ts"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import type { HallCamera } from "../hall/camera.ts"
import type { HallSession } from "../hall/feeds/session.ts"
import { hasParam, param } from "../params.ts"
import type { Screen, ScreenCtx } from "../screens.ts"
import { current } from "../shell/router.ts"
import { mountViewer } from "../shell/viewer.ts"
import { islandWorld, worldCamera } from "../shell/worldCamera.ts"
import { loadTiles } from "../tiles.ts"
import { atmoKnobs, createIslandAir, type IslandAir } from "./atmo.ts"
import type { Chips } from "./chips.ts"
import { type DocketMount, mountDocket } from "./docket.ts"
import { createDoors, type Doors } from "./doors.ts"
import { type Fx, fxOf, mountFx, mountWorkFx, type WorkFxMount } from "./fx.ts"
import { type HallRepo, hallBuild, hallSubtitle, placeRows } from "./hall.ts"
import { type HarvestMount, mountHarvest } from "./harvest.ts"
import {
  type BuiltPlace,
  batchSets,
  type FromWorker,
  type GroundMode,
  type GroundStage,
  type HexJobSpec,
  heightsAt,
  type MapStage,
  natureOf,
  type PackedHarvest,
  type PackedPieces,
  runHexJob,
  SEA_LEVEL,
  type ShoreStage,
  shapeOf,
  type ToWorker,
} from "./job.ts"
import { clock, DEFAULT_FILES, islandKnobs } from "./knobs.ts"
import { createLife, type Life } from "./life.ts"
import { agentFeedOf, agentSource } from "./lifeAgents.ts"
import type { AgentDesk, AgentDeskReply, AgentDeskRequest, LifePlan } from "./lifePlan.ts"
import { HALL_STEPS, LINES, loadPlan, PITCH, STEPS, type Step } from "./loading.ts"
import { createPlaceLabels, kindWord, labelsOn, type PlaceLabels } from "./places.ts"
import { loaderOn, publishWorld, settle } from "./ready.ts"
import { residentAgents, residentsOf } from "./residents.ts"
import { mountSea, type SeaMount, seaOf, seaOn } from "./sea.ts"
import { mountSeason, type SeasonMount, timelineSeason } from "./season.ts"
import { mountSeasonFx, type SeasonFx } from "./seasonFx.ts"
import { sessionAgents } from "./sessionAgents.ts"
import { mountShows } from "./shows.ts"
import { graveBlockers, mountUndead, type UndeadMount } from "./undead.ts"

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
  /** The autumn harvest's pieces (last: after the life plan). */
  harvest: Promise<PackedHarvest>
  shore: Promise<ShoreStage>
  /** Settles only when the spec asked for life (`?life=0` leaves it pending; disposing fails it). */
  life: Promise<LifePlan>
  /**
   * A session's heroes planned where the walk graph is (the worker's life desk, after the `life` stage):
   * its events since the last call in, every hero's itinerary out (null: no desk, or it failed).
   */
  planAgents(req: AgentDeskRequest): Promise<AgentDeskReply | null>
  dispose(): void
}

/** Logical cores from which a screen plans life in a worker of its own beside the build's. */
const SPLIT_CORES = 4
/** Under the loading cover the stage draws on every this-many-th vsync (15 Hz on a 60 Hz display). */
const COVER_PACE = 4

/** The job's stages as they arrive: from the worker(s), or inline (a tick later) where there is none. */
function startJob(spec: Promise<HexJobSpec>): Stages {
  const waiting: { take(stage: unknown): void; fail(e: Error): void }[] = []
  const stage = <T>() =>
    new Promise<T>((take, fail) => {
      waiting.push({ take: take as (stage: unknown) => void, fail })
    })
  const map = stage<MapStage>()
  const ground = stage<GroundStage>()
  const pieces = stage<PackedPieces>()
  const harvest = stage<PackedHarvest>()
  const shore = stage<ShoreStage>()
  const life = stage<LifePlan>()
  const [onMap, onGround, onPieces, onHarvest, onShore, onLife] = waiting as [
    (typeof waiting)[0],
    (typeof waiting)[0],
    (typeof waiting)[0],
    (typeof waiting)[0],
    (typeof waiting)[0],
    (typeof waiting)[0],
  ]
  const fail = (e: Error) => {
    for (const w of waiting) w.fail(e)
  }
  // a screen torn down mid-build drops the stages it no longer waits on quietly
  for (const p of [map, ground, pieces, harvest, shore, life]) p.catch(() => {})
  // the agents' planning, after the build: requests answered in turn, by id
  const asked = new Map<number, (reply: AgentDeskReply | null) => void>()
  let nextAsk = 1
  let desk: AgentDesk | null = null
  const take = (msg: FromWorker) => {
    if (msg.type === "agents") {
      asked.get(msg.id)?.(msg.reply)
      asked.delete(msg.id)
    } else if (msg.type === "map") onMap.take(msg.map)
    else if (msg.type === "ground") onGround.take(msg.ground)
    else if (msg.type === "pieces") onPieces.take(msg.pieces)
    else if (msg.type === "harvest") onHarvest.take(msg.harvest)
    else if (msg.type === "shore") onShore.take(msg.shore)
    else if (msg.type === "life") onLife.take(msg.life)
    else fail(new Error(msg.message))
  }
  let worker: Worker | null = null
  /**
   * A second worker that plans life beside the first (job.ts `only: "life"`): the plan is the reveal's
   * long pole (1.8 s at 4k, 3 s on a hall the size of react, in V8), and the one worker could only start
   * it after the ground, the pieces and the shore. Two workers both build the island's pure world (the
   * same world from the same spec: the same plan), so only where the machine has the cores for it.
   */
  let lifeWorker: Worker | null = null
  const spawn = () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
  try {
    worker = spawn()
    if ((navigator.hardwareConcurrency ?? 2) >= SPLIT_CORES)
      try {
        lifeWorker = spawn()
      } catch {
        lifeWorker = null
      }
  } catch (error) {
    logger.warn("no worker, building inline", { error: String(error) })
  }
  if (worker) {
    worker.onmessage = (e: MessageEvent<FromWorker>) => take(e.data)
    worker.onerror = (e) => fail(new Error(e.message))
    if (lifeWorker) {
      lifeWorker.onmessage = (e: MessageEvent<FromWorker>) => take(e.data)
      lifeWorker.onerror = (e) => fail(new Error(e.message))
    }
    // the workers boot while the spec (the authored tiles) loads
    const w = worker
    spec.then((s) => {
      if (lifeWorker && s.life) {
        lifeWorker.postMessage({ type: "job", spec: { ...s, only: "life" } } satisfies ToWorker)
        w.postMessage({ type: "job", spec: { ...s, life: false } } satisfies ToWorker)
      } else {
        lifeWorker?.terminate()
        lifeWorker = null
        w.postMessage({ type: "job", spec: s } satisfies ToWorker)
      }
    }, fail)
  } else
    spec.then((s) => {
      try {
        desk = runHexJob(s, take)
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    }, fail)
  return {
    map,
    ground,
    pieces,
    harvest,
    shore,
    life,
    planAgents(req) {
      // the desk lives where life was planned
      const planner = lifeWorker ?? worker
      if (!planner) return Promise.resolve(desk?.plan(req) ?? null)
      const id = nextAsk++
      return new Promise((answer) => {
        asked.set(id, answer)
        planner.postMessage({ type: "agents", id, req } satisfies ToWorker)
      })
    },
    dispose() {
      for (const answer of asked.values()) answer(null)
      asked.clear()
      worker?.terminate()
      lifeWorker?.terminate()
      // a stage still awaited settles (a settled one ignores this), so nothing waits on a dead job
      fail(new Error("disposed"))
    },
  }
}

/** The road strips' colour (`createSurface`). */
export const ROAD_COLOR = "#d9c08c"

/**
 * What another screen lays over the island as it is built (a hall's history, `hall/history.ts`): it
 * sees the island's pure map first, draws the island's triangle soups its own way, is handed the built
 * parts, and may take the transport.
 */
export interface WorldHooks {
  /** The island's pure map (the one the worker builds from), before anything of it is drawn. */
  prepare?(island: HexIsland): void
  /**
   * Draws the ground, the stairs and bridges, or the road strips (their normals and linear colours
   * ready); null leaves it to the island's own drawing.
   */
  mesh(stage: Stage, data: VertexMeshData, kind: "ground" | "structures" | "roads"): TerrainMesh | null
  /** The transport is the hook's (the day's clock is still set by `ext.clock`). */
  transport?: boolean
  /**
   * Lays the island out as it was at `at` (epoch ms) for one synchronous draw (an era's still,
   * hall/eraShots.ts) and returns the undo; null before the island is built.
   */
  still?(at: number): (() => void) | null
  /** Once the island is drawn and its pure parts are built on this thread (behind the cover, before it settles). */
  built(parts: {
    island: HexIsland
    batch: StaticBatch
    life: Life | null
    doors: Doors
    water: Water | null
    night: Night | null
    /** The places' plates (none off a hall, or with `?labels=0`). */
    labels: PlaceLabels | null
    sun: Sun
    stage: Stage
    viewer: Viewer
    groundAt(x: number, z: number): number
    land: number
    /**
     * Today's props laid on the island in season (the autumn harvest's heaps): `hide(at)` takes out those
     * standing where `at` says is not there now (null: all there); one that lands later is told too.
     */
    props: { hide(at: ((x: number, z: number) => boolean) | null): void }
  }): void
}

/** What a hall adds to the island (hall.ts): the repo whose chronicle sizes it and names its places. */
export interface HexWorldExtra {
  /** Resolves to the repo once its chronicle is read (null: the island's own, as `/town`); the build waits for it. */
  repo?: Promise<HallRepo | null>
  /** The event FX (fx.ts: weather, ships, scaffolds) for the hall to drive; on with `?fx=` too. */
  fx?: boolean
  /**
   * A hall's HUD (hall/hud), mounted into the Viewer's HUD regions once the island is built, under the
   * cover (it shows as the cover lifts). Returns its unmount.
   */
  hud?: (parts: HudParts) => () => void
  /**
   * The island has no repo but plays a session (the site's home: a demo guild or a told story): its
   * heroes are that session's, planned as its log grows. Returns the session once its HUD has started it.
   */
  session?: () => HallSession | null
  /** The date the island is at (epoch ms; season.ts): a hall's timeline; null or left out: today's. */
  seasonDate?: () => number | null
}

/** What the island hands a hall's HUD. */
export interface HudParts {
  viewer: Viewer
  stage: Stage
  repo: HallRepo | null
  /** The repo's places as built, in zone order (none on a sketch). */
  places: BuiltPlace[]
  /** Their plates (null with `?labels=0`): shown or hidden, one marked open. */
  labels: PlaceLabels | null
  /** A plate was clicked or tapped: its place's index in `places`. */
  onPick(fn: (index: number) => void): void
  /** The day's clock, hours: as the time-of-day drag sets it. */
  clock: { get(): number; set(hour: number): void }
  /** What each zone is, by index (`job.ts` `zoneKinds`): where a story's folders go on an island with no repo. */
  zoneKinds: readonly string[]
  /** The event FX (with `extra.fx` or `?fx=`), else null. */
  fx: Fx | null
  /** The work FX (sparks, chips, splashes, dust: `workfx.beat(beat, at, sample)`); null with `?workfx=0`. */
  workfx?: WorkFxMount["fx"] | null
  /** Where a session's hero is drawn now (its feet, metres; null: not on the island, or no life). */
  heroAt(id: string): [number, number, number] | null
  /** How a session's hero is drawn (its figure's look, life's `heroLook`): its HUD portrait. */
  heroLook?(id: string): ReturnType<Life["heroLook"]>
  /** The heroes' chips (null: no life, no agents): the one followed, a plea mark tapped. */
  chips: Pick<Chips, "select" | "onPlea" | "hit" | "extent"> | null
  /** The hall's camera (hall/camera.ts: follow a hero, the director), set by the hall's HUD as it mounts. */
  camera?: HallCamera
  /** The season (season.ts): a story sets its own, Settings pins one. */
  season?: SeasonMount | null
  /** The post pipeline (null with `?post=0`): stills of the island through it (render still.ts). */
  post?: Post | null
  /** The island as it was at a date, for one draw (`WorldHooks.still`; a hall's history), else null. */
  still?: ((at: number) => (() => void) | null) | null
}

/** What `window.guildhall.ext.hall` tells the shots: how long each part took, and the places built. */
export interface HallStats {
  repo: HallRepo | null
  /** ms to fetch and decode the chronicle (0 off a hall). */
  chronicleMs: number
  /** ms from the mount to the island settled (built, compiled, drawn calm). */
  buildMs: number
  /** ms from the mount to the cover gone. */
  revealMs: number
  places: MapStage["places"]
}

export const hexWorldScreen: Screen = {
  id: "hexworld",
  title: "Hex island",
  mount: (outer, ctx) => mountHexWorld(outer, ctx),
}

/**
 * The hex island screen; `hooks` lets another screen draw and drive parts of it (`WorldHooks`), and a
 * hall (`extra.repo`) reads the repo's chronicle first and builds from it: the island's size is the
 * repo's files, its places the repo's units, named on their plates.
 */
export const mountHexWorld = (
  outer: HTMLElement,
  ctx: ScreenCtx,
  hooks?: WorldHooks,
  extra: HexWorldExtra = {},
): (() => void) => world.mount(outer, ctx, hooks, extra)

// A method, so the mount's body keeps the depth it had as the screen's own `mount` (its diffs stay small).
const world = {
  mount(outer: HTMLElement, ctx: ScreenCtx, hooks?: WorldHooks, extra: HexWorldExtra = {}): () => void {
    const t0 = performance.now()
    const since = () => Math.round(performance.now() - t0)
    const num = (k: "seed" | "files" | "step" | "hour" | "shadow" | "fill", d: number) =>
      param(ctx.query, k) ?? d
    const seed = num("seed", Number(param(ctx.query, "town")) || 1)
    // the island's size: the query's (`?files=`, default 4,000), or, in a hall, the repo's once its chronicle is read
    let files = num("files", DEFAULT_FILES)
    let places: PlaceSpec[] | undefined
    const hall = extra.repo !== undefined
    const stats: HallStats = { repo: null, chronicleMs: 0, buildMs: 0, revealMs: 0, places: [] }
    // the worker starts first: it builds while the stage, its context and the catalog get ready
    const step = num("step", LEVEL_STEP)
    const detail = param(ctx.query, "detail")
    // `?lod=0`: every piece at full detail at any distance, the reference a LOD change is judged against
    setLod(param(ctx.query, "lod"))
    // the nature knobs (?tree= ?pine= ?bush= ?rock= ?grass= ?flower= ?woods= ?wild=), for side-by-sides
    const nature = natureOf(ctx.query)
    // the hex map's shape knobs (?coast= ?hills= ?rain= ?forest=): `/lab/hexmap`'s island in 3D
    const shape = shapeOf(ctx.query)
    // the collision overlay (`?collide=1`, `?spots=1`) builds the map again on this thread for its walk graph;
    // `?heroSpots=1` marks the heroes' spots (world heroes.ts) over the scene, alone
    const heroSpots = param(ctx.query, "heroSpots")
    const overlay = param(ctx.query, "collide") || param(ctx.query, "spots") || heroSpots
    const lifeOn = param(ctx.query, "life")
    // the event FX (fx.ts): off unless a hall asks for them or `?fx=` shows them; off, nothing of them exists
    const fxSpec = fxOf(ctx.query)
    const fxOn = extra.fx === true || fxSpec !== null
    const catalogLoad = loadCatalog()
    // `?name=`: the island's own name (the site's `/` is "Guildhall", a hall its repo), else the seed's
    const name = param(ctx.query, "name") || `Island ${roman(seed)}`
    // the chrome: the Viewer's corners and Inspector round the stage (shell/viewer.ts); the seed is the
    // path's on `/town/<seed>`, so its knob writes `town`
    const seedKey = current().screen === "town" ? "town" : "seed"
    const viewQuery = new URLSearchParams(ctx.query)
    viewQuery.set(seedKey, String(seed))
    const viewer = mountViewer(outer, { ...ctx, query: viewQuery }, "town", {
      title: name,
      subtitle: hall
        ? "Reading the chronicle…"
        : `Seed ${seed}, grown for a repo of ${files.toLocaleString("en-US")} files`,
      sections: islandKnobs(seedKey),
    })
    const host = viewer.stage
    // The loading screen (loading.ts, ready.ts): the cover stays until the whole island is built, compiled and
    // drawn calm, then lifts once. `?loader=0` lifts at the ground, as before the loader.
    const cover = loaderOn(ctx.query)
    const steps = viewer.loading(name, hall ? HALL_STEPS : STEPS, PITCH)
    const go = (name: Step, to: number) => {
      steps.step(name)
      steps.line(LINES[name])
      steps.progress(to, loadPlan(files)[name])
    }
    publishWorld("loading")
    // A hall: the chronicle first, and only then the island from it (its size and its places). The
    // island's own (`/town`) has nothing to wait for.
    if (hall) go("Chronicle", 0.04)
    const tChronicle = performance.now()
    const read = (extra.repo ?? Promise.resolve(null)).then((repo) => {
      stats.chronicleMs = Math.round(performance.now() - tChronicle)
      stats.repo = repo
      const built = hallBuild(repo, files)
      files = built.files
      places = built.places
      if (repo) viewer.setInfo({ subtitle: hallSubtitle(repo) })
      go("Map", 0.07)
    })
    // the authored tile prefabs (data/tiles) before anything is built from them in the worker
    // the agents life plans with (lifeAgents.ts): the demo story; `?agents=0` none; a hall playing a
    // session (`?feed=`) none at first, then its session's heroes (sessionAgents.ts, once its HUD is up);
    // a hall with no session its resident guild (residents.ts, once life is up), not the demo's
    const session = extra.session !== undefined || (hall && hasParam(ctx.query, "feed"))
    const residing = hall && !session && !hasParam(ctx.query, "agents")
    const agentsFeed =
      lifeOn && !session && !residing ? agentFeedOf(param(ctx.query, "agents")) : Promise.resolve(null)
    const job = startJob(
      Promise.all([read, loadTiles(), agentsFeed]).then(([, tiles, agents]) => ({
        agents,
        ...(stats.repo?.kind === "chronicled" ? { repo: stats.repo.name } : {}),
        seed,
        files,
        ground: groundOf(param(ctx.query, "ground")),
        step,
        paint: detail,
        tiles: tiles.length ? tiles : null,
        nature,
        shape,
        life: lifeOn,
        ...(places ? { places } : {}),
      })),
    )
    // a screen torn down mid-settle: no frame will come, so the wait ends here
    let tornDown = () => {}
    const torn = new Promise<void>((done) => {
      tornDown = done
    })
    // the post pipeline anti-aliases its own target (SMAA); the canvas's MSAA is for `?post=0` alone
    const stage = createStage(host, { antialias: !param(ctx.query, "post") })
    // Under the cover nothing drawn is seen: the stage draws on every COVER_PACE-th vsync and the thread
    // goes to the build (the pieces' bake, the crowd's), until the settle, which needs the frames at
    // their own rate to see them calm.
    if (cover) stage.throttle(COVER_PACE)
    ctx.attach(stage)
    viewer.attachStage(stage)
    const cam = worldCamera(stage, viewer.camera, ctx.query)
    let disposed = false
    let batch: StaticBatch | null = null
    let water: Water | null = null
    let air: IslandAir | null = null
    let night: Night | null = null
    let season: SeasonMount | null = null
    let seasonFx: SeasonFx | null = null
    let harvest: HarvestMount | null = null
    /** Where a hook (a hall's history) says today's props are not there now (`WorldHooks.built` `props`). */
    let propsGone: ((x: number, z: number) => boolean) | null = null
    let unTick = () => {}
    let post: Post | null = null
    let disposeField = () => {}
    let life: Life | null = null
    let doors: Doors | null = null
    let labels: PlaceLabels | null = null
    let island: HexIsland | null = null
    let unHud = () => {}
    let fx: Fx | null = null
    let seaLife: SeaMount | null = null
    let undead: UndeadMount | null = null
    let docket: DocketMount | null = null
    let workfx: WorkFxMount | null = null
    let shows: ReturnType<typeof mountShows> | null = null
    let unAgents = () => {}
    let unSound = () => {}
    let pick: ((index: number) => void) | null = null
    let dayClock: HudParts["clock"] = { get: () => 0, set: () => {} }
    const meshes: TerrainMesh[] = []

    const build = async () => {
      // The map: the sky, the sun, the night, the post and the camera are set up (and their shaders
      // compiled by the frames drawn meanwhile) while the worker still builds the ground.
      const m = await job.map
      if (disposed) return
      // the island's regions: the ground's green turned, snow on the peaks, mist on the marsh (render regionTint.ts)
      setRegionField(m.regions)
      // a hook sees the pure map first (~0.1 s, behind the cover): life plans on the same one below
      if (hooks) {
        island = hexIsland({ ...shape, seed, files })
        hooks.prepare?.(island)
      }
      steps.progress(0.08, 150)
      go("Ground", 0.28)
      const R = HEX_TILE_SIZE
      if (m.paths.length)
        meshes.push(
          hooks?.mesh(stage, vertexMeshData(m.paths, new Float32Array(m.paths.length)), "roads") ??
            createSurface(stage, m.paths, ROAD_COLOR),
        )
      // stone stairs where roads step down, plank bridges over the rivers: built like the ground
      if (m.structures)
        meshes.push(hooks?.mesh(stage, m.structures, "structures") ?? createVertexMesh(stage, m.structures))
      const span = m.span
      const hour = num("hour", 15.5)
      const sun = createSun(stage, { town: { min: [-span, -3, -span], max: [span, 20, span] } })
      const daySky = createSky(stage, {
        sun,
        hour,
        reach: span * 1.4,
        shadow: num("shadow", 1),
        fill: num("fill", 0.75),
      })
      // with the FX, the weather lays itself over the sky: everything that reads the light reads it through the drive
      const drive = fxOn
        ? createSkyDrive(stage, {
            sky: daySky,
            retint: () => night?.setHour(now),
            strikeAt: m.sites.castle,
            seed,
            lamps: fxSpec?.lamps === true,
          })
        : null
      const sky = drive?.sky ?? daySky
      // the night: a light in every lantern the tiles hold
      const lamps = m.lamps.map((at) => ({ kind: "street" as const, at, radius: 6 }))
      night = createNight(stage, { points: lamps, windows: [] }, { sky, hour })
      // the season (season.ts): `?season=`, else the screen's own (a hall's date), else today's
      season = mountSeason({ stage, query: ctx.query })
      const seasonDate = extra.seasonDate
      if (seasonDate) season.setSource(() => timelineSeason(seasonDate()), true)
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
      dayClock = {
        get: () => now,
        set: (h: number) => {
          day?.set(h)
          show(h)
        },
      }
      const ext = window.guildhall?.ext
      if (ext) {
        ext.clock = dayClock
        // for probes (tools/shots): the stage itself, its scene and renderer
        ext.stage = stage
      }
      // the sea reaches the far plane: the horizon haze (atmo.ts) melts its rim into the sky
      const sea = Math.max(span * 3, stage.camera.far * 0.95)
      air = createIslandAir(stage, { light: () => sky.light(), span, seed, sea, knobs: atmoKnobs(ctx.query) })
      drive?.attach(air.atmosphere)
      if (param(ctx.query, "post"))
        post = createPost(stage, { light: () => sky.light(), aa: aaOf(param(ctx.query, "aa")) })
      // The programs of all that (the dome, the clouds, the lamps, the post passes) link in the
      // background while the worker still builds the ground, and nothing is drawn until they have (the
      // cover is up): drawn before, that frame linked them one by one, 0.1–1.1 s on the main thread.
      // The batch's programs start now too (~1.4 s in the GPU process): they compile while the pieces
      // load and bake, and the batch finds them made.
      stage.hold(Promise.all([warmScene(stage), post?.warm()]))
      void warmBatchPrograms(stage)
      // the crowd's as well (~1 s), for the rigs the house style's bodies ride, once the catalog is in;
      // and those rigs' clips (the biggest file on the wire) start loading now, in parallel with the
      // pieces, instead of once the batch is built and the crowd asks for them
      if (lifeOn)
        void catalogLoad.then((catalog) => {
          if (!catalog || disposed) return
          const bones = new Set<number>()
          const rigs = new Set<string>()
          for (const entry of catalog.all()) {
            const rig =
              entry.character && inStyle(entry.id.split("/")[0] ?? "")
                ? catalog.rig(entry.character.rig)
                : null
            if (!rig) continue
            bones.add(rig.bones)
            rigs.add(rig.file)
          }
          for (const count of bones) void warmCrowdPrograms(stage, count)
          for (const file of rigs) loadClips(libraryUrl(file)).catch(() => undefined)
        })
      const azimuth = sideLit(sky.light().sunDir)
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
          hooks?.mesh(stage, g.mesh, "ground") ??
            createVertexMesh(stage, g.mesh, undefined, { speckle: detail }),
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
      // for the bench: when the first frame landed (ms from navigation), so long tasks after it can be told apart
      if (window.guildhall?.ext)
        window.guildhall.ext.build = { first, firstAt: Math.round(performance.now()) }
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
      // the work FX (fx.ts): ready for life's beats, nothing drawn until one comes
      workfx = mountWorkFx({
        stage,
        query: ctx.query,
        light: () => sky.light(),
        pieces: () => loose,
        sea: SEA_LEVEL,
      })
      // the season's particles (seasonFx.ts): leaves, petals, chimney smoke near the camera, in the work FX's draw
      const seasonOn = season
      if (workfx && seasonOn)
        seasonFx = mountSeasonFx({
          stage,
          workfx: workfx.fx,
          pieces: loose,
          weights: () => seasonOn.weights(),
          heightOf: (id) => catalog.get(id)?.size[1] ?? 4,
          vertices: async (id) => pieceVertices(await load(id)),
        })
      if (seasonFx && window.guildhall?.ext) window.guildhall.ext.seasonFx = seasonFx
      // the autumn harvest (harvest.ts): hay, pumpkins, crates on the farms, one draw in autumn, none otherwise
      if (seasonOn)
        void mountHarvest({
          stage,
          catalog,
          packed: job.harvest,
          weights: () => seasonOn.weights(),
          gone: () => disposed,
        })
          .then((made) => {
            harvest = made
            made?.hide(propsGone)
            if (made && window.guildhall?.ext) window.guildhall.ext.harvest = made
          })
          .catch(() => undefined)
      // the sky and town shows (shows.ts): nothing in the scene until one plays
      shows = mountShows({
        stage,
        sites: m.sites,
        span,
        light: () => sky.light(),
        ground: (x, z) => Math.max(SEA_LEVEL, groundAt(x, z)),
        session: extra.session ?? session,
      })
      // every show's programs linked and kept now, under the cover (render shows/index.ts `prewarm`):
      // without the cover (`?loader=0`) a show's first start links its own
      const prewarmed = cover ? shows.prewarm().catch(() => undefined) : Promise.resolve()
      // the graveyard's undead (undead.ts): a session's graves, or `?undead=`; nothing loads until one stands.
      // Mounted here, before the shore and the life wait: where skeletons may rise (a hall, the FX)
      // their rig, bake and programs load now under the cover, as a first rise would in view (46 ms
      // frames), waited for with the shows' before the settle
      const graves = m.graveyard?.graves ?? []
      undead = mountUndead({
        stage,
        graveyard: m.graveyard,
        // what stands round the graves (a pine), for the camera to film a rise past
        blockers: graveBlockers(graves, loose, (id) => catalog.get(id)?.size),
        library: { catalog, url: libraryUrl },
        workfx: workfx?.fx ?? null,
        query: ctx.query,
        itinerary: (id) => life?.itinerary(id),
        hall: fxOn || session,
        ...(extra.session ? { session: extra.session } : {}),
      })
      const undeadWarmed =
        cover && undead && (fxOn || session)
          ? undead.undead.prewarm().catch(() => undefined)
          : Promise.resolve()
      steps.progress(0.74, 150)
      go("Water", 0.8)
      await shoreDone
      if (disposed) {
        batch.dispose()
        return
      }
      steps.progress(0.8, 150)
      sun.markDirty()
      // the repo's places, named on their plates (places.ts); `?labels=0` leaves them off
      stats.places = m.places
      if (m.places.length && labelsOn(ctx.query))
        labels = createPlaceLabels(
          stage,
          viewer.labels,
          m.places.map((p) => ({
            id: p.id,
            label: p.label,
            detail: `${p.files.toLocaleString("en-US")} files · ${kindWord(p.kind)}`,
            kind: kindWord(p.kind),
            at: p.at,
            weight: p.files,
            tier: p.tier,
          })),
          extra.hud ? (k) => pick?.(k) : undefined,
          // heroes before hamlets: the chips' boxes as the declutter last laid them
          () => life?.chips()?.boxes() ?? [],
        )
      // ---- life (track B): townsfolk and agents on the walk graph; `?life=0` turns it off ----
      // Another screen drives parts of the island (a hall's history): the pure map, built once for it
      // (~0.1 s, at `prepare`). Life takes its plan from the worker (below). (The world itself was built
      // here too, 2 s on this thread for a repo the size of react, and nothing read it: the worker's is
      // the one the island is built from.)
      if (hooks) island ??= hexIsland({ ...shape, seed, files })
      if (lifeOn) {
        go("Townsfolk", 0.92)
        // the plan arrives from the worker (job.life); the overlay alone rebuilds the map here
        life = createLife(stage, {
          host,
          plan: job.life,
          // the agents: the guild the worker planned (the demo story); a session's come later
          agents: job.life.then((plan) => (plan.agents ? agentSource(plan.agents) : null)),
          agentPool: session || residing,
          // a hero's work beats make the work FX's bursts (sparks off a hammer, pages, motes)
          beat: (b, at, sample) => workfx?.fx.beat(b, at, sample),
          // the heroes' chips, in the labels layer with the plates; a repo's hall with
          // no session names its residents (their day in a word: no session's calls)
          chips: viewer.labels,
          debug: overlay
            ? () => {
                const island = hexIsland({ ...shape, seed, files })
                const zones = hexZones(island, { wild: nature.wild, ...(places ? { places } : {}) })
                return { island, zones, world: hexWorld(island, zones, { step, nature }) }
              }
            : undefined,
          groundAt,
          hour: () => now,
          seed,
          workfx: workfx?.fx ?? null,
          sea: SEA_LEVEL,
          overlay,
          heroSpots,
        })
        await life.ready
        // a hall with no session: its resident guild, the repo's busiest hands at home on its island
        const repo = stats.repo
        if (residing && life && repo?.kind === "chronicled" && repo.hands?.length) {
          const residents = residentsOf(repo.hands, m.places, repo.places)
          if (residents.length) {
            const own = life
            const agents = residentAgents(
              residents,
              (req) => job.planAgents(req),
              () => own.clock(),
            )
            own.setAgents(agents)
            unAgents = agents.dispose
          }
        }
        // the lamps the lamplighters light at dusk come up one by one as each is reached (the plan's)
        void job.life.then((plan) => {
          if (!disposed) night?.schedule(plan.lamps)
        })
      }
      steps.progress(0.93, 150)
      // doors that open: the gates by day and for whoever comes, the buildings' doors for whoever goes in
      if (disposed) return
      doors = await createDoors(stage, {
        gates,
        load,
        doorways: life?.doorways() ?? [],
        life,
        hour: () => now,
      })
      if (disposed) {
        doors.dispose()
        return
      }
      if (drive) fx = mountFx({ stage, drive, sites: m.sites, water, load, spec: fxSpec, workfx: workfx?.fx })
      // the sea's life (sea.ts): with the FX or `?sea=`; a session drives it once its HUD is up
      const seaSpec = seaOf(ctx.query)
      if (seaOn(seaSpec, fxOn))
        seaLife = mountSea({
          stage,
          sites: m.sea,
          events: m.sites,
          load,
          light: () => sky.light(),
          spec: seaSpec,
          water,
          ghostNear: m.graveyard ? [m.graveyard.gate[0], m.graveyard.gate[2]] : null,
          session: extra.session ?? session,
        })
      // the docket (docket.ts): the open issues' plates over the quay and their petitioners queueing on it
      if (life)
        docket = mountDocket({
          stage,
          life,
          layer: viewer.labels,
          workfx: workfx?.fx ?? null,
          query: ctx.query,
          hall: fxOn || session,
          ...(extra.session ? { session: extra.session } : {}),
        })
      // a hook's parts (a hall's history reveal) go in before the light, so their shaders compile behind the cover
      if (hooks && island)
        hooks.built({
          island,
          batch,
          life,
          doors,
          water,
          night,
          labels,
          sun,
          stage,
          viewer,
          groundAt,
          land: m.stats.land,
          props: {
            hide(at) {
              propsGone = at
              harvest?.hide(at)
            },
          },
        })
      // The light: shaders compiled and a calm run of frames drawn with all of it in, behind the cover.
      go("Light", 0.99)
      // the shows' programs, linked and kept now (their links' waits land here, under the cover, not
      // at a dragon's first beat); and the sea's and the weather's wait for the same reason
      // (and the stocks' see-through palette, theirs alone: the stocks land after the reveal)
      await Promise.all([prewarmed, undeadWarmed, lifeOn ? prewarmStocksPrograms(stage) : Promise.resolve()])
      // and every program compiled ahead but never read (the lamps', the windows': first drawn at dusk)
      prefetchPrograms(stage)
      stage.throttle(1)
      const ready = await settle(stage, {
        until: torn,
        onCalm: (share) => steps.progress(0.93 + 0.06 * share, 200),
      })
      if (disposed) return
      const made = doors
      if (window.guildhall?.ext)
        window.guildhall.ext.doors = {
          stats: () => ({
            open: made.open,
            gates: made.gates?.count ?? 0,
            gate: made.gates?.opening(0) ?? null,
          }),
          // for shots: the doorways and the passes through them (a burst frames a door as someone goes in)
          doorways: () => life?.doorways() ?? [],
          passes: () => life?.passes() ?? [],
        }
      const grown = m.stats.nature
      stats.buildMs = since()
      if (window.guildhall?.ext) window.guildhall.ext.hall = stats
      viewer.setInfo({
        figures: [
          { label: "Land tiles", value: m.stats.land },
          ...(m.places.length ? [{ label: "Places", value: m.places.length }] : []),
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
            ...(hall ? [{ label: "Chronicle read", value: stats.chronicleMs, unit: "ms" }] : []),
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
        ...(m.places.length
          ? [
              {
                title: "Places",
                meta: `${m.places.length} of the repo`,
                folded: true,
                rows: placeRows(m.places),
              },
            ]
          : []),
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
      // the island's sound (audio/): muted by default, nothing of it runs until the viewer turns it on
      unSound = mountSound({
        stage,
        life,
        plan: job.life,
        light: () => sky.light(),
        sites: m.sites,
        pools: m.pools,
        shore: job.shore,
        fx: () => fx,
        session,
      })
      if (extra.hud)
        unHud = extra.hud({
          viewer,
          stage,
          repo: stats.repo,
          places: m.places,
          zoneKinds: m.zoneKinds,
          labels,
          onPick: (fn) => {
            pick = fn
          },
          clock: dayClock,
          fx,
          workfx: workfx?.fx ?? null,
          heroAt: (id) => life?.heroAt(id) ?? null,
          heroLook: (id) => life?.heroLook(id) ?? null,
          chips: life?.chips() ?? null,
          season,
          post,
          still: hooks?.still ? (at) => hooks.still?.(at) ?? null : null,
        })
      // a hall's session drives its heroes: planned in the worker as its log grows (the HUD starts the
      // session as it mounts, which may be a moment after this: looked for until it is there)
      if (session && life)
        void (
          extra.session
            ? Promise.resolve(extra.session)
            : import("../hall/hud/mount.tsx").then((m) => m.hallSession)
        ).then((hallSession) => {
          const look = (tries: number) => {
            const playing = hallSession()
            if (disposed || !life) return
            if (!playing) {
              if (tries > 0) setTimeout(() => look(tries - 1), 100)
              return
            }
            // (the desk hears the hour life shows, so heroes at rest keep the island's evening and night)
            const agents = sessionAgents(
              playing,
              (req) => job.planAgents(req),
              Date.now,
              () => life?.clock() ?? now,
            )
            life.setAgents(agents)
            unAgents = agents.dispose
          }
          look(300)
        })
      if (cover) {
        publishWorld("ready")
        // the one reveal: the cover fades, and the island under it has been drawn calm for a while
        await steps.done()
        stats.revealMs = since()
        publishWorld("revealed")
      } else {
        stats.revealMs = since()
        void steps.done()
      }
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
      seaLife?.dispose()
      undead?.dispose()
      docket?.dispose()
      batch?.dispose()
      water?.dispose()
      disposeField()
      setRegionField(null)
      air?.dispose()
      night?.dispose()
      seasonFx?.dispose()
      harvest?.dispose()
      season?.dispose()
      unAgents()
      unSound()
      life?.dispose()
      doors?.dispose()
      fx?.dispose()
      seaLife?.dispose()
      workfx?.dispose()
      shows?.dispose()
      labels?.dispose()
      unHud()
      unTick()
      post?.dispose()
      for (const m of meshes) m.dispose()
      stage.dispose()
      host.replaceChildren()
      viewer.dispose()
    }
  },
}
