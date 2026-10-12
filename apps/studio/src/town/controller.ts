/**
 * The town screen's engine room: the generation worker, the main-thread compile and dress, the staged
 * 3D build and the camera presets, publishing one small state the panels render from. A setting that
 * changes the town (seed, tier, harbour, walls) regrows it; the hour and the camera only move light
 * and view.
 */
import type { Catalog, PrefabRecipe } from "@guildhall/assets"
import { log } from "@guildhall/core"
import type { BatchCluster, LodCounts, Stage } from "@guildhall/render"
import { normalizeSpec, type TownReport, type TownSpecInput, townMetrics } from "@guildhall/world"
import type { JobLib } from "../planner/job.ts"
import { FAR, heroPose, LENS, poseFor, townWorld } from "./camera.ts"
import { createCompiler, type Dressed, dress } from "./dress.ts"
import { type FromWorker, runTownJob, type ToWorker, type TownJob } from "./job.ts"
import { type Cam, type TownQuery, townSpec } from "./query.ts"
import { type BuildTimes, createTownScene } from "./scene.ts"

const logger = log("studio:town")

export interface TownState {
  query: TownQuery
  /** The spec the town on screen was grown from (a preset's, or the query's). */
  spec: TownSpecInput | null
  job: TownJob | null
  report: TownReport | null
  dressed: Pick<Dressed, "compiled" | "compileMs" | "dressMs"> | null
  /** Pieces per streamed stage: houses, walls and props, plants. */
  stagePieces: number[]
  build: BuildTimes | null
  /** Regrowing (worker), dressing or streaming the batch. */
  busy: "growing" | "dressing" | "streaming" | null
  error: string | null
  /** Worker time plus the hop, ms. */
  genMs: number
}

export interface TownLib {
  job: JobLib
  catalog: Catalog
  recipes: readonly PrefabRecipe[]
}

export interface TownController {
  state(): TownState
  subscribe(fn: () => void): () => void
  /** Changes the query; a new spec regrows the town. `spec` overrides the query's (a preset). */
  set(patch: Partial<TownQuery>, spec?: TownSpecInput | null): void
  /** Puts the camera at the current preset's pose again. */
  frame(): void
  /** What the last frame drew per LOD tier (null before the first town). */
  lod(): LodCounts | null
  /** Resolves once the town on screen matches the query and every stage is drawn. */
  settled(): Promise<void>
  dispose(): void
}

const parts = (clusters: readonly BatchCluster[]) => clusters.reduce((n, c) => n + c.parts.length, 0)
const specKey = (s: TownSpecInput) => JSON.stringify(s)

export function createTownController(
  stage: Stage,
  libReady: Promise<TownLib>,
  initial: TownQuery,
  initialSpec: Promise<TownSpecInput>,
  onQuery: (q: TownQuery) => void,
): TownController {
  let state: TownState = {
    query: initial,
    spec: null,
    job: null,
    report: null,
    dressed: null,
    stagePieces: [],
    build: null,
    busy: "growing",
    error: null,
    genMs: 0,
  }
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<TownState>) => {
    state = { ...state, ...patch }
    for (const fn of listeners) fn()
  }

  let worker: Worker | null = null
  try {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
  } catch (error) {
    logger.warn("no worker, generating inline", { error: String(error) })
  }
  let nextId = 1
  const pending = new Map<number, (r: TownJob | Error) => void>()
  if (worker)
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const done = pending.get(e.data.id)
      pending.delete(e.data.id)
      done?.(e.data.type === "done" ? e.data.job : new Error(e.data.message))
    }
  let libSent = false
  const grow = (spec: TownSpecInput, lib: JobLib): Promise<TownJob> =>
    new Promise((resolve, reject) => {
      const finish = (r: TownJob | Error) => (r instanceof Error ? reject(r) : resolve(r))
      if (!worker) {
        setTimeout(() => {
          try {
            finish(runTownJob(spec, lib))
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)))
          }
        }, 0)
        return
      }
      if (!libSent) {
        worker.postMessage({ type: "lib", lib } satisfies ToWorker)
        libSent = true
      }
      const id = nextId++
      pending.set(id, finish)
      worker.postMessage({ type: "job", id, spec } satisfies ToWorker)
    })

  let scene: ReturnType<typeof createTownScene> | null = null
  let compiler: ReturnType<typeof createCompiler> | null = null
  let disposed = false
  /** The spec being (or last) grown, and the work that settles when it is drawn. */
  let wanted: TownSpecInput | null = null
  let work: Promise<void> = Promise.resolve()

  const aspect = () => {
    const c = stage.renderer.domElement
    return Math.max(0.1, c.clientWidth / Math.max(1, c.clientHeight))
  }
  /** The preset free flight was entered from: Escape hands the camera back to it. */
  let before: Exclude<Cam, "free"> = initial.cam === "free" ? "hero" : initial.cam
  /** The preset on screen, and the town the camera was last framed on. */
  let shown: Cam = initial.cam
  let framed: TownJob | null = null
  const lens = (map: boolean, distance: number) => {
    stage.camera.fov = map ? LENS.map : LENS.perspective
    stage.camera.far = map ? FAR.map(distance) : FAR.perspective
    stage.camera.updateProjectionMatrix()
  }
  const hero = (job: TownJob) =>
    heroPose(job.layout, normalizeSpec(job.layout.spec).radius, { aspect: aspect() })
  /**
   * Free flight is taking off from the preset on screen: Escape comes back to it. Flight uses the
   * perspective lens, so from the map it comes back to the hero shot instead.
   */
  const takeOff = (job: TownJob | null) => {
    if (shown !== "free") before = shown === "map" ? "hero" : shown
    if (shown === "map") {
      lens(false, 0)
      if (job) stage.rig.setHome(hero(job))
    }
    shown = "free"
  }
  const frame = () => {
    const job = state.job
    if (!job) return
    stage.rig.setWorld(townWorld(job.layout))
    const cam = state.query.cam
    const first = framed !== job
    framed = job
    if (cam === "free") {
      // A new town keeps a flight going; a first frame takes off from the hero shot, the button from
      // wherever the orbit is.
      if (stage.rig.mode() === "free") return
      if (first) {
        lens(false, 0)
        stage.setCamera(hero(job))
        shown = "hero"
      }
      takeOff(job)
      stage.rig.setMode("free")
      return
    }
    const pose = poseFor(cam, job.layout, normalizeSpec(job.layout.spec).radius, { aspect: aspect() })
    // The map looks through a narrower lens from further off: the camera's lens and far plane follow.
    lens(cam === "map", pose.distance)
    shown = cam
    if (stage.rig.mode() === "free") stage.rig.glide(pose)
    else stage.setCamera(pose)
  }
  // F and Escape switch the rig itself: the query (the link, the Camera buttons) follows it.
  const offRig = stage.rig.subscribe(() => {
    const free = stage.rig.mode() === "free"
    if (free === (state.query.cam === "free")) return
    if (free) takeOff(state.job)
    else shown = before
    const query: TownQuery = { ...state.query, cam: free ? "free" : before }
    publish({ query })
    onQuery(query)
  })

  const regrow = async (spec: TownSpecInput) => {
    const t0 = performance.now()
    publish({ busy: "growing", error: null })
    const lib = await libReady
    scene ??= createTownScene(stage, lib.catalog, state.query.hour)
    compiler ??= createCompiler(lib.recipes, lib.catalog)
    const job = await grow(spec, lib.job)
    if (disposed || wanted !== spec) return
    const genMs = performance.now() - t0
    publish({ busy: "dressing" })
    const dressed = dress(job.layout, compiler, lib.job.town)
    const report = townMetrics(job.layout, {
      draw: dressed.draw,
      tris: (lib.job.town as { tris?: Record<string, number> }).tris,
      ms: job.times,
    })
    publish({
      job,
      spec,
      report,
      genMs,
      dressed: { compiled: dressed.compiled, compileMs: dressed.compileMs, dressMs: dressed.dressMs },
      stagePieces: [parts(dressed.houses), dressed.loose.length, parts(dressed.plants)],
      build: null,
      busy: "streaming",
    })
    frame()
    const build = await scene.show(job, dressed)
    if (disposed || wanted !== spec) return
    publish({ build, busy: null })
  }

  const request = (spec: TownSpecInput) => {
    wanted = spec
    work = regrow(spec).catch((error: unknown) => {
      if (disposed || wanted !== spec) return
      logger.error("town failed", { error: String(error) })
      publish({ busy: null, error: error instanceof Error ? error.message : String(error) })
    })
  }

  const queryKey = (q: TownQuery) => JSON.stringify([q.seed, q.tier, q.harbour, q.walls])
  void initialSpec.then(
    (spec) => {
      if (!disposed && wanted === null) request(spec)
    },
    (error: unknown) => publish({ busy: null, error: String(error) }),
  )
  // Ready waits on the first town as well, so a deep link's first shot is the whole town.
  const first = initialSpec.then(() => work)

  return {
    state: () => state,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    set(patch, spec) {
      const before = state.query
      const query = { ...before, ...patch }
      if (patch.seed !== undefined || patch.tier !== undefined) query.preset = spec ? query.preset : null
      publish({ query })
      onQuery(query)
      if (query.hour !== before.hour) scene?.setHour(query.hour)
      if (query.cam !== before.cam) frame()
      const next: TownSpecInput | null =
        spec ??
        (queryKey(query) !== queryKey(before) || query.preset !== before.preset ? townSpec(query) : null)
      if (next && (!wanted || specKey(next) !== specKey(wanted))) request(next)
    },
    frame,
    lod: () => scene?.lod() ?? null,
    async settled() {
      await first
      // A set() during the wait replaces `work`: keep waiting until the latest one has settled.
      for (;;) {
        const w = work
        await w
        if (w === work) return
      }
    },
    dispose() {
      disposed = true
      offRig()
      worker?.terminate()
      for (const done of pending.values()) done(new Error("town closed"))
      pending.clear()
      scene?.dispose()
    },
  }
}
