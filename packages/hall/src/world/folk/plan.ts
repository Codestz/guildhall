import { seeded, seedOf } from "../behaviours.ts"
import type { Tier } from "../gen/plan/tier.ts"
import { tierOf } from "../gen/plan/tier.ts"
import type { Home } from "../homes.ts"
import type { Spot } from "../layout.ts"
import type { World } from "../world.ts"
import { type Anchors, anchorsOf } from "./anchors.ts"
import { crittersOf } from "./critters.ts"
import { Ground } from "./spots.ts"
import {
  farmerWork,
  fisherWork,
  guardWork,
  homeStops,
  innStops,
  type Kit,
  minerWork,
  plazaStops,
  traderWork,
  villagerWork,
} from "./stops.ts"
import { type Folk, type Population, ROLES, type Role, type Stop } from "./types.ts"

/**
 * Who lives on a gen 2 island (the folk, types.ts): as many as its size calls for, in the houses of
 * its town, each with a trade the island has a place for. Deterministic: the island's repo names
 * the seed. The plan is made once, at the most the island ever shows (Ultra); a lower quality tier
 * shows its first few (`shown`), and the order keeps every trade in step with the rest.
 */

/** The most folk an island of each size holds (the quality tiers show a share of them). */
export const FOLK_MOST: Readonly<Record<Tier, number>> = { hamlet: 6, village: 20, town: 40, city: 70 }
/** Of those, what Low, Medium, High and Ultra show. */
export const FOLK_SHARE: Readonly<Record<0 | 1 | 2 | 3, number>> = { 0: 0.3, 1: 0.6, 2: 0.85, 3: 1 }

/** The share of the folk each trade has, when the island has the place for it. */
const WEIGHT: Readonly<Record<Role, number>> = {
  villager: 0.4,
  guard: 0.14,
  farmer: 0.14,
  fisher: 0.1,
  trader: 0.08,
  miner: 0.1,
}
/** Dealt out in this order, so any first few folk are a mix of trades. */
const DEAL: readonly Role[] = ["villager", "guard", "farmer", "villager", "trader", "fisher", "miner"]

/** Muted homespun, and the trades' own colours. */
const HOMESPUN = ["#8d8577", "#7f8a72", "#9c7b55", "#7d8590", "#a08a6c", "#8a7f95"] as const
const LOOK: Readonly<Record<Role, { models: readonly string[]; tints: readonly string[]; speed: number }>> = {
  villager: { models: ["rogue", "mage", "ranger", "barbarian", "rogue-hooded"], tints: HOMESPUN, speed: 1.5 },
  farmer: { models: ["barbarian", "ranger"], tints: ["#b59a5b", "#a88f55"], speed: 1.4 },
  miner: { models: ["barbarian", "knight"], tints: ["#7b6f66", "#6c6760"], speed: 1.5 },
  fisher: { models: ["ranger", "rogue-hooded"], tints: ["#5f8a8f", "#6d8f7a"], speed: 1.5 },
  trader: { models: ["mage", "rogue"], tints: ["#a8503f", "#b0653f"], speed: 1.7 },
  guard: { models: ["knight"], tints: ["#6b7a99", "#5f6f8f"], speed: 1.3 },
}

const EMPTY: Population = { folk: [], critters: [] }
const made = new WeakMap<World, Population>()

/** The island's island tier, by its files. */
export const islandTier = (world: World): Tier =>
  tierOf((world.repo?.districts ?? []).reduce((sum, district) => sum + district.files, 0))

/** Does this world have folk at all? A generator 2 island with a town. */
export const hasFolk = (world: World): boolean =>
  world.kind === "repo" && world.repo?.gen === 2 && (world.homes?.length ?? 0) > 0

/** The island's folk and animals at the most it ever shows. Nobody on the hand lands or a first-generator island. */
export function populationOf(world: World): Population {
  if (!hasFolk(world)) return EMPTY
  let population = made.get(world)
  if (!population) {
    population = plan(world)
    made.set(world, population)
  }
  return population
}

/** Keeps a population made elsewhere (a Web Worker's, world/gen/grow.ts) as this world's, so it is not planned again here. */
export function primePopulation(world: World, population: Population): void {
  made.set(world, population)
}

/** How many of the plan's `count` a quality tier shows. */
export const shown = (count: number, quality: 0 | 1 | 2 | 3): number => Math.ceil(count * FOLK_SHARE[quality])

function plan(world: World): Population {
  const repo = world.repo
  const homes = world.homes ?? []
  const anchors = anchorsOf(world)
  const random = seeded(seedOf(repo?.repo ?? "island"))
  const most = Math.min(FOLK_MOST[islandTier(world)], homes.length)
  const ground = new Ground(world)
  const roles = deal(counts(most, anchors))
  const free = new Set(homes)
  const folk: Folk[] = []
  const nth = new Map<Role, number>()
  for (const role of roles) {
    const home = homeFor(role, free, anchors, random)
    if (!home) continue
    free.delete(home)
    const n = nth.get(role) ?? 0
    nth.set(role, n + 1)
    const made = folkOf(role, n, folk.length, { world, anchors, ground, home }, random)
    if (made) folk.push(made)
  }
  return { folk, critters: crittersOf(world, anchors, ground, folk.length, random) }
}

/** How many of each trade: the weights of those the island has a place for, the rest villagers. */
function counts(total: number, anchors: Anchors): Map<Role, number> {
  const has: Record<Role, boolean> = {
    villager: true,
    guard: true,
    farmer: anchors.fields.length > 0,
    fisher: anchors.dock !== undefined,
    trader: anchors.markets.length > 0 && anchors.dock !== undefined,
    miner: anchors.mine !== undefined,
  }
  const out = new Map<Role, number>()
  let left = total
  for (const role of ROLES) {
    if (role === "villager") continue
    const want = has[role] ? Math.max(total >= 8 ? 1 : 0, Math.round(total * WEIGHT[role])) : 0
    const count = Math.min(left, role === "guard" && anchors.runs.length === 0 ? Math.min(want, 2) : want)
    out.set(role, count)
    left -= count
  }
  out.set("villager", left)
  return out
}

/** The roles dealt out in turn, so the first few of any number are a mix. */
function deal(left: Map<Role, number>): Role[] {
  const out: Role[] = []
  let any = true
  while (any) {
    any = false
    for (const role of DEAL) {
      const count = left.get(role) ?? 0
      if (count <= 0) continue
      left.set(role, count - 1)
      out.push(role)
      any = true
    }
  }
  return out
}

/** Their house: the nearest free one to where their trade is; a villager's, any. */
function homeFor(
  role: Role,
  free: ReadonlySet<Home>,
  anchors: Anchors,
  random: () => number,
): Home | undefined {
  const homes = [...free]
  if (homes.length === 0) return undefined
  const near = anchorOf(role, anchors)
  if (!near) return homes[Math.floor(random() * homes.length)]
  // One of the few nearest, so a trade does not crowd one street.
  const by = (home: Home): number => Math.hypot(home.door.step[0] - near[0], home.door.step[1] - near[1])
  const closest = homes.sort((a, b) => by(a) - by(b)).slice(0, NEAREST)
  return closest[Math.floor(random() * closest.length)]
}

/** A trade's homes are among this many of the nearest to its place of work. */
const NEAREST = 5

function anchorOf(role: Role, anchors: Anchors): Spot | undefined {
  switch (role) {
    case "guard":
      return anchors.gate
    case "farmer":
      return anchors.fields[0]
    case "fisher":
      return anchors.dock
    case "miner":
      return anchors.mine?.door.step
    case "trader":
      return anchors.markets[0]?.door.step
    default:
      return undefined
  }
}

function folkOf(role: Role, nth: number, index: number, kit: Kit, random: () => number): Folk | undefined {
  const { home } = kit
  const look = LOOK[role]
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T
  let work: readonly Stop[]
  let lift: Folk["lift"]
  switch (role) {
    case "farmer":
      work = farmerWork(kit, nth)
      break
    case "miner":
      work = minerWork(kit)
      break
    case "fisher":
      work = fisherWork(kit, nth)
      break
    case "trader":
      work = traderWork(kit, nth)
      break
    case "guard": {
      const guard = guardWork(kit, Math.floor(nth / 2))
      work = guard.stops
      lift = guard.lift
      break
    }
    default:
      work = villagerWork(kit)
  }
  if (work.length === 0) return undefined
  const social = role !== "villager" || random() < 0.7
  const plaza = plazaStops(kit, home.district)
  return {
    id: `folk:${index}`,
    role,
    model: pick(look.models),
    tint: pick(look.tints),
    district: home.district,
    home: home.id,
    stops: {
      home: homeStops(home),
      work,
      plaza,
      inn: social ? innStops(kit, home.district) : homeStops(home),
    },
    jitter: Math.round((random() - 0.5) * 100) / 100,
    night: role === "guard" && nth % 2 === 1,
    speed: look.speed,
    barrow: role === "trader",
    ...(lift ? { lift } : {}),
  }
}
