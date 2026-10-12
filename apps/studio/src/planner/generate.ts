/**
 * The planner's generator: the same `@guildhall/world` stages the 3D town will run, timed one by one.
 * Later stages are found by name at runtime (plan §6 contracts: `lots`, `place`, `farms`, `nature`,
 * `harbour`, or the whole `generateTown`), so the map grows a layer the day its stage lands, with no
 * change here. A stage that throws is skipped and reported; the stages before it still draw. Pure.
 */
import { roll } from "@guildhall/core"
import type {
  Edge,
  Field,
  Lot,
  Placement,
  Station,
  StreetGraph,
  TownLibrary,
  TownPlan,
  TownSpecInput,
  Vec2,
} from "@guildhall/world"
import * as world from "@guildhall/world"

/** A stage's wall time, in the order it ran. */
export interface Timing {
  stage: string
  ms: number
}

/** Ground a later stage may hand back beside the plan (the harbour's quay and overlays). */
export interface Overlay {
  kind: string
  poly: Vec2[]
}

export interface Generated {
  plan: TownPlan
  timings: Timing[]
  /** Stages that ran, by name; `generateTown` when the whole generator did. */
  stages: string[]
  /** Stages that threw: name and message. */
  problems: { stage: string; message: string }[]
  overlays: Overlay[]
  /** Which stage drew each edge: the town's edge, the castle's curtain, or a farm's fence or hedge. */
  edgeRoles: Record<number, EdgeRole>
}

export type EdgeRole = "town" | "castle" | "farm"

type Fn = (...args: unknown[]) => unknown

/** A function the world package exports under `name`, or null until that stage lands. */
export function stageFn(name: string, mod: Record<string, unknown> = world): Fn | null {
  const f = mod[name]
  return typeof f === "function" ? (f as Fn) : null
}

/** The optional stages the map knows how to draw, in pipeline order, with whether they exist yet. */
export function detectStages(mod: Record<string, unknown> = world): Record<string, boolean> {
  const names = [
    "generateTown",
    "lots",
    "place",
    "farms",
    "nature",
    "harbour",
    "townMetrics",
    "prefabLibrary",
  ]
  return Object.fromEntries(names.map((n) => [n, stageFn(n, mod) !== null]))
}

const empty = (spec: TownSpecInput): TownPlan => ({
  spec: world.normalizeSpec(spec),
  bounds: [],
  water: [],
  plazas: [],
  streets: { nodes: [], edges: [] },
  blocks: [],
  lots: [],
  placements: [],
  edges: [],
  fields: [],
  nature: [],
  stations: [],
  hash: "",
})

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const listOf = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

/**
 * Generates a town for `spec`, stage by stage. `mod` is the world package (tests hand in a stand-in);
 * `now` is the clock.
 */
export function generate(
  spec: TownSpecInput,
  lib: TownLibrary,
  mod: Record<string, unknown> = world,
  now: () => number = () => performance.now(),
): Generated {
  const out: Generated = {
    plan: empty(spec),
    timings: [],
    stages: [],
    problems: [],
    overlays: [],
    edgeRoles: {},
  }
  const seed = spec.seed
  const salted = (stage: string) => (salt: string) => roll(seed, `${salt}:${stage}`)
  const time = <T>(stage: string, work: () => T): T | undefined => {
    const t0 = now()
    try {
      const value = work()
      out.timings.push({ stage, ms: now() - t0 })
      out.stages.push(stage)
      return value
    } catch (error) {
      out.timings.push({ stage, ms: now() - t0 })
      out.problems.push({ stage, message: error instanceof Error ? error.message : String(error) })
      return undefined
    }
  }

  // The whole generator, once it exists, is the truth the 3D town draws; take its plan as it is.
  const whole = stageFn("generateTown", mod)
  if (whole) {
    const times: Record<string, number> = {}
    const plan = time("generateTown", () => whole(spec, lib, times))
    if (isRecord(plan) && Array.isArray(plan.blocks)) {
      out.plan = plan as unknown as TownPlan
      // The generator reports its own per-stage ms; show those beside the total.
      for (const [stage, ms] of Object.entries(times)) out.timings.push({ stage, ms })
      return out
    }
  }

  const plan = out.plan
  const s = time("site", () => world.site(spec))
  if (!s) return out
  plan.bounds = s.bounds
  plan.water = s.water
  plan.plazas = [s.plaza]
  const graph = time("streets", () => world.streets(s, spec, salted("streets")))
  if (!graph) return out
  plan.streets = graph
  const b = time("blocks", () => world.blocks(graph, s, spec, salted("blocks")))
  if (b) {
    plan.blocks = b.blocks
    plan.streets = b.graph
  }

  const lots = stageFn("lots", mod)
  if (lots) {
    const got = time("lots", () =>
      lots(plan.blocks, plan.streets as StreetGraph, lib, salted("lots"), plan.spec.tier),
    )
    plan.lots = listOf<Lot>(got)
  }
  const place = stageFn("place", mod)
  if (place) {
    const got = time("place", () => place(plan.lots, lib, plan.spec, salted("place")))
    plan.placements.push(...listOf<Placement>(got))
  }

  const edges = time("walls", () => world.walls(plan, spec, salted("walls")))
  if (edges) plan.edges.push(...edges)
  const mark = (list: readonly Edge[], role: EdgeRole) => {
    for (const e of list) out.edgeRoles[e.id] = role
  }
  mark(edges ?? [], "town")
  const castle = time("landmark", () => world.landmark(plan, spec, lib, salted("landmark")))
  if (castle) {
    plan.edges.push(...castle.edges)
    mark(castle.edges, "castle")
    plan.placements.push(...castle.placements)
  }

  const harbour = stageFn("harbour", mod)
  if (harbour) {
    const got = time("harbour", () => harbour(plan, lib, salted("harbour")))
    if (isRecord(got)) {
      plan.placements.push(...listOf<Placement>(got.placements))
      for (const o of listOf<unknown>(got.overlays))
        if (isRecord(o) && Array.isArray(o.poly))
          out.overlays.push({ kind: String(o.kind), poly: o.poly as Vec2[] })
      for (const q of listOf<Vec2[]>(got.quay))
        if (Array.isArray(q) && q.length > 2) out.overlays.push({ kind: "quay", poly: q })
      plan.stations.push(...listOf<Station>(got.stations))
    }
  }
  const farms = stageFn("farms", mod)
  if (farms) {
    const got = time("farms", () => farms(plan, spec, lib, salted("farms")))
    if (isRecord(got)) {
      plan.fields.push(...listOf<Field>(got.fields))
      plan.placements.push(...listOf<Placement>(got.placements))
      plan.edges.push(...listOf<Edge>(got.edges))
      mark(listOf<Edge>(got.edges), "farm")
      plan.stations.push(...listOf<Station>(got.stations))
    }
  }
  const nature = stageFn("nature", mod)
  if (nature) {
    const got = time("nature", () => nature(plan, lib, salted("nature")))
    plan.nature.push(...listOf<Placement>(got))
  }
  return out
}
