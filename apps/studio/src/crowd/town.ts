/**
 * The crowd bench's real town: the town screen's own build (generateTown in its worker, dressed and
 * lit at golden hour) and its townsfolk (world `populate`: workers at their stations, the night watch,
 * wanderers, each with a day of stays and walks on the walk graph). The day runs SPEEDUP times faster
 * than real time with the walking pace slowed as much, so people walk at a natural speed but their
 * routines visibly move on; people indoors are not drawn.
 */
import { type Catalog, type NpcLook, type NpcRecipe, type PrefabRecipe, resolveNpc } from "@guildhall/assets"
import { hash, log } from "@guildhall/core"
import type { Stage } from "@guildhall/render"
import { PACE, populate, poseAt, type Tier, type Townsperson } from "@guildhall/world"
import { type DataKind, list, load } from "../data.ts"
import { buildLibrary } from "../planner/library.ts"
import { heart } from "../town/camera.ts"
import { createTownController } from "../town/controller.ts"
import { DEFAULT_TOWN, townSpec } from "../town/query.ts"
import type { CrowdQuery } from "./query.ts"
import type { FolkScene } from "./scene.ts"
import { STRIDE } from "./sim.ts"

const logger = log("studio:crowd")

/** Day hours per real hour. */
export const SPEEDUP = 20

/** The recipe folders a town draws from (as the town screen). */
const RECIPE_KINDS: readonly DataKind[] = [
  "recipes/houses",
  "recipes/landmarks",
  "recipes/stalls",
  "recipes/docks",
  "recipes/farm",
]

async function prefabRecipes(): Promise<PrefabRecipe[]> {
  const folders = await Promise.all(
    RECIPE_KINDS.map(async (kind) => {
      const ids = await list(kind).catch(() => [] as string[])
      const files = await Promise.all(ids.map((id) => load(kind, id).catch(() => null)))
      return files.filter((f): f is PrefabRecipe => f !== null && typeof f === "object")
    }),
  )
  return folders.flat()
}

/** A town big enough for `n` people. */
export const tierFor = (n: number): Tier => (n <= 30 ? "town" : "city")

/** Every clip the townsfolk's days play. */
export function dayClips(people: readonly Townsperson[]): string[] {
  const clips = new Set<string>()
  for (const p of people)
    for (const step of p.day) {
      if (step.kind === "stay") clips.add(step.clip)
      else for (const clip of step.clips) clips.add(clip)
    }
  return [...clips].sort()
}

/** The point among `at` with the most others within 12 m: where a close camera finds people. */
export function busiest(
  at: readonly (readonly [number, number, number])[],
): readonly [number, number, number] | null {
  let best: readonly [number, number, number] | null = null
  let most = -1
  for (const a of at) {
    const n = at.filter((b) => Math.hypot(a[0] - b[0], a[2] - b[2]) < 12).length
    if (n > most) {
      most = n
      best = a
    }
  }
  return best
}

export async function buildTown(
  stage: Stage,
  q: CrowdQuery,
  catalog: Catalog,
  roles: readonly NpcRecipe[],
  duration: (clip: string) => number,
): Promise<FolkScene> {
  const tier = tierFor(q.n)
  const query = { ...DEFAULT_TOWN, seed: q.seed, tier, hour: q.hour, cam: "hero" as const }
  const lib = prefabRecipes().then((recipes) => ({ job: buildLibrary(recipes, catalog), catalog, recipes }))
  const town = createTownController(stage, lib, query, Promise.resolve(townSpec(query)), () => {})
  await town.settled()
  const layout = town.state().job?.layout
  if (!layout) throw new Error(`crowd: the town did not grow (${town.state().error ?? "no layout"})`)

  // populate (W7) throws for some large counts (the night watch's patrol runs out of lamps): fewer
  // people then, said in the log and the panel, rather than no town at all.
  let people: Townsperson[] = []
  for (let count = q.n; count > 0 && people.length === 0; count = Math.floor(count * 0.9))
    try {
      people = populate(layout, roles, q.seed, { count, pace: PACE / SPEEDUP, hour: q.hour })
      if (count < q.n)
        logger.warn("populate failed for the full count; fewer townsfolk", { asked: q.n, got: count })
    } catch (error) {
      if (count === q.n) logger.warn("populate failed", { count, error: String(error) })
    }
  const byRole = new Map(roles.map((r) => [r.id, r]))
  const kept = people.filter((p) => byRole.has(p.role))
  const looks: NpcLook[] = kept.map((p) => resolveNpc(byRole.get(p.role) as NpcRecipe, hash(p.id), catalog))

  // Per person: where they were last frame and how far through their clip they are.
  const last = kept.map(() => [Number.NaN, 0, 0] as [number, number, number])
  const phase = looks.map((l) => l.phase)
  let hour = q.hour
  /** The hour the town is lit at: it follows the sim clock, so sky and HUD agree (every 15 s of sim time: smooth at 20×). */
  let lit = q.hour
  let step = 0

  // Close and wide look at the busiest corner (the town camera, `cam=town`, sees the whole town).
  if (q.cam !== "town") {
    const [x, y, z] = busiest(
      kept
        .map((p) => poseAt(p, hour))
        .filter((p) => !p.indoors)
        .map((p) => p.at),
    ) ?? [...heart(layout), 0]
    const close = q.cam === "close"
    stage.setCamera({
      target: [x, y + 0.8, z],
      azimuth: 35,
      elevation: close ? 26 : 34,
      distance: close ? 20 : 62,
    })
  }

  return {
    camera: stage.getCamera(),
    groups:
      q.path === "none"
        ? []
        : [
            {
              path: q.path === "both" ? "crowd" : q.path,
              actors: kept.map((_, i) => ({ id: i, look: looks[i] as NpcLook })),
              clips: dayClips(kept),
              labels: [],
              sample(id) {
                const pose = poseAt(kept[id] as Townsperson, hour)
                const prev = last[id] as [number, number, number]
                const [x, y, z] = pose.at
                const moved = Number.isNaN(prev[0]) ? 0 : Math.hypot(x - prev[0], z - prev[2])
                prev[0] = x
                prev[1] = y
                prev[2] = z
                // Walking: the feet keep pace with the ground covered; standing: the clip's own time.
                phase[id] =
                  (phase[id] as number) + (pose.walking ? moved / STRIDE : step / duration(pose.clip))
                const p = phase[id] as number
                return {
                  position: [x, y, z],
                  heading: pose.facing,
                  clip: pose.clip,
                  phase: p - Math.floor(p),
                  hidden: pose.indoors,
                }
              },
            },
          ],
    advance(dt) {
      step = dt
      hour = (hour + (dt * SPEEDUP) / 3600) % 24
      if (Math.abs(hour - lit) >= 1 / 240) {
        lit = hour
        town.set({ hour })
      }
    },
    status: () => {
      const h = Math.floor(hour)
      const m = Math.floor((hour - h) * 60)
      return `${layout.spec.tier} seed ${q.seed} · ${kept.length} townsfolk · day ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} (${SPEEDUP}× real time)`
    },
    dispose: () => town.dispose(),
  }
}
