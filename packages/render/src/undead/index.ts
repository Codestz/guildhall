/**
 * The graveyard's undead (world events Task B): the skeletons that claw out of their graves when a
 * session fails, a package's tests fail or CI turns red, keep vigil, reel at the fixer's blow and die
 * back into the earth (pose.ts, from the graves' times), and a failed deed's minion that stands 5 s.
 *
 * Drawn through the crowd's baked rig (crowd/): KayKit's four skeletons on Rig_Medium, one figure for
 * each grave and kind (8 × 4, never more than the graves drawn at once), no heroes, no mixers; their
 * helmets, hats and hoods ride their bones (`boneRiders`). Nothing is loaded until a grave first
 * stands (`update` with a figure): an island where nobody failed never fetches a skeleton, draws
 * nothing and costs nothing. A dirt puff (work FX `dust` and `stone`) as one claws up and as it goes under.
 */
import type { NpcLook } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { CHARACTER_SCALE } from "@guildhall/world"
import { type ActorSample, type Crowd, type CrowdLibrary, createCrowd } from "../crowd/index.ts"
import type { Stage } from "../stage.ts"
import type { WorkFx } from "../workfx/index.ts"
import { UNDEAD_CLIPS, type UndeadFigure, undeadPose, undeadPuffs } from "./pose.ts"

export {
  BURIED,
  DIE_MS,
  DRIFT,
  SINK_DOWN_MS,
  STIR_MS,
  SUNK,
  UNDEAD_CLIP_SECONDS,
  UNDEAD_CLIPS,
  type UndeadFigure,
  type UndeadPose,
  undeadPose,
  undeadPuffs,
} from "./pose.ts"

const logger = log("render:undead")

/** A grave in the world: where its skeleton stands (its feet), and which way it faces (radians, 0 = +z). */
export interface UndeadGrave {
  x: number
  y: number
  z: number
  facing: number
}

export const SKELETONS = ["warrior", "mage", "rogue", "minion"] as const

export interface UndeadOpts {
  graves: readonly UndeadGrave[]
  library: CrowdLibrary
  /** The dirt puffs (none: no puffs). */
  workfx?: WorkFx | null
}

export interface UndeadStats {
  /** Skeletons drawn last update. */
  drawn: number
  /** Loaded (the skeletons fetched and baked), loading. */
  loaded: boolean
  loading: boolean
  /** Mean CPU ms per update (the last 120). */
  ms: number
  /** ms the first load took. */
  loadMs: number
}

export interface Undead {
  /**
   * The skeletons at run time `t` (ms), `dt` seconds since the last update (the clips' fades). Figures
   * past their end draw nothing; the first figure ever starts the load.
   */
  update(figures: readonly UndeadFigure[], t: number, dt: number): void
  /** Resolves once the skeletons are loaded (at once while none was ever wanted). */
  ready(): Promise<void>
  /** Where a grave's skeleton stands (its feet), for the camera; null for an unknown slot. */
  point(slot: number): [number, number, number] | null
  stats(): UndeadStats
  dispose(): void
}

const KIND_AT: Readonly<Record<UndeadFigure["kind"], number>> = { warrior: 0, mage: 1, rogue: 2, minion: 3 }
/** The puffs a jump (a seek) skips: one seen later than this after its moment is not thrown. */
const PUFF_LATE_MS = 900

function lookOf(kind: UndeadFigure["kind"]): NpcLook {
  return {
    recipe: "undead",
    seed: 0,
    body: `kaykit-skeletons/skeleton-${kind}`,
    hide: [],
    rampMap: {},
    mounts: [],
    clips: { work: "Skeletons_Idle", idle: "Skeletons_Idle", walk: "Skeletons_Idle" },
    scale: CHARACTER_SCALE,
    speed: 1,
    phase: 0,
  }
}

export function createUndead(stage: Stage, opts: UndeadOpts): Undead {
  const { graves } = opts
  let crowd: Crowd | null = null
  let loading: Promise<void> | null = null
  let disposed = false
  let loadMs = 0
  let drawn = 0
  let lastT = Number.NaN
  let shown = false
  const costs: number[] = []
  /** This frame's sample per crowd id (slot × 4 + kind). */
  const samples: (ActorSample | null)[] = []
  const hidden: ActorSample = {
    position: [0, -1000, 0],
    heading: 0,
    clip: "Skeletons_Idle",
    phase: 0,
    hidden: true,
  }

  const load = (): Promise<void> => {
    if (loading) return loading
    const start = performance.now()
    const actors = graves.flatMap((_, slot) =>
      SKELETONS.map((kind) => ({ id: slot * SKELETONS.length + KIND_AT[kind], look: lookOf(kind) })),
    )
    loading = createCrowd(stage, actors, opts.library, { heroes: 0, clips: UNDEAD_CLIPS })
      .then((made) => {
        if (disposed) {
          made.dispose()
          return
        }
        crowd = made
        loadMs = Math.round(performance.now() - start)
        logger.info("undead loaded", { figures: actors.length, ms: loadMs })
      })
      .catch((error: unknown) => {
        logger.warn("undead failed to load", { error: String(error) })
      })
    return loading
  }

  const puff = (grave: UndeadGrave, ago: number, seed: number) => {
    const fx = opts.workfx
    if (!fx) return
    const at: [number, number, number] = [grave.x, grave.y + 0.05, grave.z]
    fx.emit("dust", at, { scale: 0.55, seed, ago: ago / 1000 })
    fx.emit("stone", at, { scale: 0.8, seed: seed + 1, ago: ago / 1000 })
  }

  return {
    update(figures, t, dt) {
      if (disposed) return
      const begin = performance.now()
      if (figures.length > 0 && !loading) void load()
      const live = crowd
      if (!live) {
        lastT = t
        return
      }
      if (figures.length === 0 && !shown) {
        lastT = t
        return
      }
      samples.length = 0
      drawn = 0
      for (const f of figures) {
        const grave = graves[f.slot]
        if (!grave) continue
        // the puffs this frame passed (not on a jump: a seek throws none)
        if (!Number.isNaN(lastT) && t >= lastT && t - lastT < PUFF_LATE_MS)
          for (const at of undeadPuffs(f)) if (at > lastT && at <= t) puff(grave, t - at, f.slot * 7 + at)
        const pose = undeadPose(f, t)
        if (!pose) continue
        const id = f.slot * SKELETONS.length + KIND_AT[f.kind]
        const s = CHARACTER_SCALE
        const fwd = pose.forward * s
        samples[id] = {
          position: [
            grave.x + Math.sin(grave.facing) * fwd,
            grave.y + pose.y * s,
            grave.z + Math.cos(grave.facing) * fwd,
          ],
          heading: grave.facing,
          clip: pose.clip,
          phase: pose.phase,
        }
        drawn++
      }
      lastT = t
      live.update(dt, (id) => samples[id] ?? hidden)
      // once everyone has gone, one more update has hidden them all: then nothing until the next grave
      shown = drawn > 0
      costs.push(performance.now() - begin)
      if (costs.length > 120) costs.shift()
    },
    ready: () => loading ?? Promise.resolve(),
    point(slot) {
      const g = graves[slot]
      return g ? [g.x, g.y, g.z] : null
    },
    stats: () => ({
      drawn,
      loaded: crowd !== null,
      loading: loading !== null && crowd === null,
      ms: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0,
      loadMs,
    }),
    dispose() {
      disposed = true
      crowd?.dispose()
      crowd = null
    },
  }
}
