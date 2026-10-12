/**
 * The crowd bench's controlled scenes, for the spike comparison: `plaza` (sim.ts: people walking loops
 * round a plaza and working at its stations, the same n every time) and `line` (everyone in a row,
 * working, facing the camera). With path `both` the bake group stands left and the merged one right.
 */
import type { Catalog, NpcLook, NpcRecipe } from "@guildhall/assets"
import { resolveNpc } from "@guildhall/assets"
import type { CameraPose } from "@guildhall/core"
import {
  createGround,
  createSky,
  createStaticBatch,
  createSun,
  type Ground,
  loadPiece,
  type Sky,
  type Stage,
  type StaticBatch,
  setGlow,
} from "@guildhall/render"
import { libraryUrl } from "../catalog.ts"
import type { CrowdPath, CrowdQuery } from "./query.ts"
import type { FolkGroup, FolkScene } from "./scene.ts"
import { planFolk, plazaRadius, sampleFolk, stationAt, stationPiece } from "./sim.ts"

/** Metres between people in the `line` layout, and person i's place along it. */
export const LINE_GAP = 1.5
const lineX = (i: number, n: number) => (i - (n - 1) / 2) * LINE_GAP

const circle = (x: number, r: number): [number, number][] =>
  Array.from({ length: 40 }, (_, i) => {
    const a = (i / 40) * Math.PI * 2
    return [x + Math.sin(a) * r, Math.cos(a) * r]
  })

export async function buildBench(
  stage: Stage,
  q: CrowdQuery,
  catalog: Catalog,
  roles: readonly NpcRecipe[],
  clock: () => number,
  duration: (clip: string) => number,
): Promise<FolkScene> {
  const r = plazaRadius(q.n)
  const paths: CrowdPath[] = q.path === "both" ? ["bake", "merged"] : q.path === "none" ? [] : [q.path]
  const line = q.layout === "line"
  const shift = line ? (q.n * LINE_GAP) / 2 + 1 : r * 1.3 + 4
  const offsets = paths.length > 1 ? [-shift, shift] : [0]
  const half = r * 1.9 + shift + 20

  const sun = createSun(stage, { town: { min: [-half, 0, -half], max: [half, 12, half] }, radii: [24, 90] })
  const sky: Sky = createSky(stage, { sun, hour: q.hour, reach: half })
  setGlow(sky.light().lamps)
  const ground: Ground = createGround(
    stage,
    {
      land: [
        [-half, -half],
        [half, -half],
        [half, half],
        [-half, half],
      ],
      holes: [],
      overlays: offsets.map((dx) => ({ kind: "plaza" as const, poly: circle(dx, r * 1.12) })),
      footprints: [],
    },
    { seed: q.seed },
  )

  const byRole = new Map(roles.map((recipe) => [recipe.id, recipe]))
  const roleIds = [...byRole.keys()].sort()
  const folk = planFolk(q.n, roleIds, q.seed)
  const looks = folk.map((f) => resolveNpc(byRole.get(f.role) as NpcRecipe, f.seed, catalog))

  // Stations in front of the workers (also for `none`: it is the baseline scene).
  const pieces = line
    ? []
    : offsets.flatMap((dx) =>
        folk.flatMap((f, i) => {
          if (f.task.kind !== "work") return []
          const [x, z] = stationAt(f.task)
          const piece = stationPiece(looks[i]?.clips.work ?? "")
          return [{ piece, x: x + dx, y: 0, z, rot: f.task.heading, scale: 1 }]
        }),
      )
  const stations: StaticBatch = await createStaticBatch(stage, pieces, async (id) => {
    const entry = catalog.get(id)
    if (!entry) throw new Error(`crowd: unknown piece "${id}"`)
    return loadPiece(libraryUrl(entry.files.glb))
  })
  sun.markDirty()

  const groups: FolkGroup[] = paths.map((path, k) => {
    const dx = offsets[k] as number
    const name = path === "bake" ? "A · baked bone texture" : path === "merged" ? "B · merged skinned" : null
    return {
      path,
      actors: folk.map((f, i) => ({ id: f.id, look: looks[i] as NpcLook })),
      clips: [],
      labels: [
        ...(name && paths.length > 1
          ? [{ text: name, at: [dx, line ? 2.6 : 0, line ? 0 : -r * 1.4] as const }]
          : []),
        ...(line
          ? folk.map((f, i) => ({ text: f.role, at: [dx + lineX(i, q.n), -0.05, 0.6] as const, small: true }))
          : []),
      ],
      sample(id) {
        const look = looks[id] as NpcLook
        if (line) {
          const clip = look.clips.work
          const phase = look.phase + clock() / duration(clip)
          return { position: [dx + lineX(id, q.n), 0, 0], heading: 0, clip, phase: phase - Math.floor(phase) }
        }
        const s = sampleFolk(folk[id] as (typeof folk)[number], look, clock(), duration)
        s.position[0] += dx
        return s
      },
    }
  })

  const across = offsets.length * q.n * LINE_GAP
  const camera: CameraPose = line
    ? { target: [0, 0.9, 0], azimuth: 0, elevation: 6, distance: 2 + across * 0.92 }
    : q.cam === "close"
      ? { target: [offsets[0] as number, 0.9, r], azimuth: 18, elevation: 12, distance: 9 }
      : {
          target: [0, 0, 0],
          azimuth: 30,
          elevation: 32,
          distance: paths.length > 1 ? r * 4.6 + 10 : r * 2.6 + 8,
        }

  return {
    groups,
    camera,
    advance() {},
    dispose() {
      stations.dispose()
      ground.dispose()
      sky.dispose()
      sun.dispose()
    },
  }
}
