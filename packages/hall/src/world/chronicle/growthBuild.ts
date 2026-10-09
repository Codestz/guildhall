import { cellAt, key } from "../gen/hex.ts"
import type { LandPlacement } from "../lands.ts"
import type { Chronicle } from "./format.ts"
import { dayAt, EPILOGUE_S, type GrowthPlan, PROLOGUE_S, RISE_S } from "./growth.ts"
import { hexOf } from "./growthFrame.ts"
import { roleOf } from "./growthPieces.ts"
import { angleGap } from "./growthSpans.ts"
import { type Kind, SPAN } from "./growthStages.ts"
import { contributorsAt, filesAt, type People } from "./growthStory.ts"
import { town2Buildings } from "./growthTown2.ts"

/**
 * Growth film v2's build schedule (ADR 0021, world-gen v2 §4 (d)), pure: when each building of a
 * gen 2 island is begun, and which construction stages it runs (growthStages.ts). Read off the
 * island's pieces and the growth plan alone (no prefab metadata: a piece's name and place say what
 * it is), so what the venues agent adds to the catalogue is picked up as it is named.
 *
 *   town2     a second-kit building (growthTown2.ts) is one lot: its ground floor rises together, its
 *             roofs and upper pieces pop in order once the walls are up
 *   lots      a building is begun when its hex is up, and no sooner than the district has grown to
 *             need the hexes its lot-mates stand on (a denser lot fills in later as the district
 *             grows by files), a beat later the farther it is from the district's plaza
 *   castle    four phases paced by the repo's growth (files and contributors, from the chronicle):
 *             1 curtain wall, in loop order from the gate  2 gate and towers  3 the keep, in thirds
 *             4 flags and banners
 *   props     pop once the building they stand by is done; alone, a beat after their hex
 *   trees     spread outward from the district's square: the farther, the later
 */

export interface Site {
  kind: Kind
  /** Film time it may begin (its hex is up by then too). */
  born: number
  /** Seconds after that, on top of the hex's own age, it waits. */
  delay: number
  /** One of several pieces of a building (a second-kit wall panel): no stack of planks of its own. */
  follower?: boolean
}

export interface Moment {
  /** Film time. */
  t: number
  text: string
}

export interface BuildPlan {
  /** Every building, prop and wall of the island, by `siteKey`. */
  sites: ReadonlyMap<string, Site>
  /** Per hex: film seconds a tree or rock there waits after its land is up. */
  lag: Float32Array
  /** Film times the four castle phases begin (empty: the island has no castle). */
  castle: readonly number[]
  moments: Moment[]
}

export const siteKey = (piece: string, x: number, z: number): string => `${piece}|${x}|${z}`

/** How old a site is at film time `t`: held back by its birth and by its hex's own age (growthFrame's `built`). */
export const ageOf = (site: Site, t: number, hexAge: number): number =>
  Math.min(t - site.born, hexAge) - site.delay

/** A castle phase starts at least this long after the one before (walls, gate and towers, keep). */
const GAPS = [3.4, 2.6, 4.4] as const
/** Where, in the repo's growth past the castle threshold, each phase begins (0: when it is crossed). */
const SHARES = [0, 0.08, 0.2, 0.4] as const
/**
 * When the repo is big enough to raise a castle: a town's worth of files and a castle's worth of
 * contributors (gen/dress/civic.ts, plan/tier.ts), both at once, so a castle never stands over a hamlet.
 */
const CASTLE_FILES = 1000
const CASTLE_PEOPLE = 150
/** The curtain wall closes over this long, gate outward. */
const WALL_S = 2.6
/** A district's lots finish filling in over this much film after their hexes are up. */
const SPREAD_S = 6
/** A piece within this of its building's middle is the building's. */
const NEAR = 6.5
const CASTLE_NEAR = 14

/** The film times the castle's four phases begin, paced by contributors and files (growth, not stars: history has none). */
export function castleStarts(c: Chronicle, g: GrowthPlan, people: People): number[] {
  const score = (day: number): number =>
    Math.min(filesAt(c, day) / CASTLE_FILES, contributorsAt(people, day, c.end) / CASTLE_PEOPLE)
  const last = g.duration - EPILOGUE_S
  const finale = score(c.end)
  const times: number[] = []
  for (const share of SHARES) {
    const target = 1 + (finale - 1) * share
    let t = PROLOGUE_S
    // A repo that never crossed the threshold (a castle by fame) builds it in the closing years.
    while (finale > 1 && t < last && score(dayAt(g, t)) < target) t += 0.25
    times.push(finale > 1 ? t : last - 14 + times.length * 3)
  }
  const out = [times[0] as number]
  for (let i = 1; i < 4; i++)
    out.push(Math.max(times[i] as number, (out[i - 1] as number) + (GAPS[i - 1] as number)))
  // The flags must fly before the film ends.
  const over = (out[3] as number) + 0.6 - (g.duration - 1)
  return over > 0 ? out.map((t) => Math.max(PROLOGUE_S, t - over)) : out
}

const hexIndex = (g: GrowthPlan, x: number, z: number): number =>
  g.index.get(key(cellAt([x, z]))) ?? hexOf(g, x, z)

const salt = (x: number, z: number): number => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
  return s - Math.floor(s)
}

const near = (a: { x: number; z: number }, b: { x: number; z: number }, r: number): boolean =>
  Math.hypot(a.x - b.x, a.z - b.z) <= r

function lotKind(piece: string): Kind {
  if (/^building_(home|farmhouse|well)/.test(piece)) return "house"
  if (/^building_mine/.test(piece)) return "mine"
  if (/^building_bridge/.test(piece)) return "prop"
  return "hall"
}

export function planBuild(
  c: Chronicle,
  g: GrowthPlan,
  decor: readonly LandPlacement[],
  people: People,
): BuildPlan {
  const sites = new Map<string, Site>()
  const moments: Moment[] = []
  const put = (p: LandPlacement, kind: Kind, born: number, delay: number): Site => {
    // Whatever the schedule says, it is built by the last frame (today's island, exactly).
    const room = g.duration - 0.1 - SPAN[kind] - (born + RISE_S)
    const site = { kind, born, delay: Math.max(0, Math.min(delay, room)) }
    sites.set(siteKey(p.piece, p.x, p.z), site)
    return site
  }
  const firstOn = (h: number): number => Math.max(0, (g.own[h] as number[])[0] ?? 0)

  // Where each hex stands in its district's growth: its district and its rank among its hexes.
  const rank = new Map<number, [number, number]>()
  g.districts.forEach((d, di) => {
    d.hexes.forEach((h, k) => {
      rank.set(h, [di, k])
    })
  })
  const plaza = (di: number): { x: number; z: number } => {
    const h = g.districts[di]?.hexes[0]
    return h === undefined ? { x: 0, z: 0 } : { x: g.spots[h * 2] as number, z: g.spots[h * 2 + 1] as number }
  }

  const castle = decor.find((p) => p.piece.startsWith("building_castle"))
  const starts = castle ? castleStarts(c, g, people) : []
  const inCastle = (p: LandPlacement): boolean => castle !== undefined && near(p, castle, CASTLE_NEAR)

  // ---- the castle ----
  const walls = decor.filter((p) => /^wall_/.test(p.piece))
  if (castle && starts.length === 4) {
    const [t0, t1, t2, t3] = starts as [number, number, number, number]
    const mid = {
      x: walls.reduce((sum, p) => sum + p.x, 0) / Math.max(1, walls.length),
      z: walls.reduce((sum, p) => sum + p.z, 0) / Math.max(1, walls.length),
    }
    const gate = walls.find((p) => p.piece === "wall_straight_gate")
    const from = gate ? Math.atan2(gate.z - mid.z, gate.x - mid.x) : 0
    const loop = walls
      .filter((p) => p !== gate)
      .sort(
        (a, b) =>
          angleGap(Math.atan2(a.z - mid.z, a.x - mid.x), from) -
          angleGap(Math.atan2(b.z - mid.z, b.x - mid.x), from),
      )
    loop.forEach((p, k) => {
      put(p, "wall", t0, (k / Math.max(1, loop.length)) * WALL_S)
    })
    if (gate) put(gate, "gate", t1, 0)
    let towers = 0
    for (const p of decor) {
      if (!/^building_tower_[AB]/.test(p.piece)) continue
      if (inCastle(p)) put(p, "keep", t2, 0.5)
      else put(p, "tower", t1, 0.4 + 0.3 * towers++)
    }
    put(castle, "keep", t2, 0)
    for (const p of decor) {
      if (!p.piece.startsWith("flag_")) continue
      const tower = decor.some((q) => /^building_tower_[AB]/.test(q.piece) && near(p, q, NEAR))
      if (inCastle(p) || tower) put(p, "flag", t3, salt(p.x, p.z) * 0.4)
    }
    moments.push({ t: t0 + WALL_S + SPAN.wall, text: "The castle's walls close" })
    moments.push({ t: t2 + SPAN.keep, text: "The castle is raised" })
  }

  // ---- lots: houses and halls, by their hex ----
  const lots = new Map<number, LandPlacement[]>()
  const t2 = town2Buildings(decor, (p) => hexIndex(g, p.x, p.z))
  const t2Of = new Map(t2.map((b) => [b.lead, b]))
  const t2Rest = new Set(t2.flatMap((b) => b.parts.map((part) => part.piece).filter((p) => p !== b.lead)))
  for (const p of decor) {
    if (roleOf(p.piece) !== "build" || t2Rest.has(p) || sites.has(siteKey(p.piece, p.x, p.z))) continue
    const h = hexIndex(g, p.x, p.z)
    lots.set(h, [...(lots.get(h) ?? []), p])
  }
  const builders: { x: number; z: number; site: Site }[] = []
  for (const [h, list] of lots) {
    list.sort((a, b) => a.z - b.z || a.x - b.x)
    const at = rank.get(h)
    list.forEach((p, j) => {
      const building = t2Of.get(p)
      const kind = building?.kind ?? lotKind(p.piece)
      let site: Site
      if (at) {
        const [di, k] = at
        const hexes = g.districts[di]?.hexes ?? new Int32Array()
        const step = Math.max(2, Math.round(hexes.length * 0.15))
        const later = hexes[Math.min(hexes.length - 1, k + j * step)] ?? h
        const centre = plaza(di)
        // The lots fill outward from the plaza as the district grows: later the farther out.
        const fill =
          SPREAD_S * (k / Math.max(1, hexes.length)) + 0.012 * Math.hypot(p.x - centre.x, p.z - centre.z)
        site = put(p, kind, Math.max(firstOn(h), firstOn(later)), 0.5 * j + fill)
      } else {
        // On the keep block (an inn, a town hall): the harbour's first buildings.
        site = put(p, kind, 0.4, 0.8 + 0.02 * Math.hypot(p.x, p.z))
      }
      for (const { piece, level } of building?.parts ?? []) {
        if (piece === p) continue
        // The ground floor rises with the lead; roofs and upper pieces pop in after the walls.
        const part =
          level === 0
            ? put(piece, kind, site.born, site.delay)
            : put(piece, "prop", site.born, site.delay + SPAN[kind] * 0.7 + 0.2 * (level - 1))
        part.follower = true
      }
      builders.push({ x: p.x, z: p.z, site })
    })
  }
  // The first of each: the venue the film marks as a moment on the tape.
  for (const [piece, text] of [
    ["building_market", "The first market opens"],
    ["building_mine", "A mine is cut into the hills"],
  ] as const) {
    const done = decor
      .filter((p) => p.piece.startsWith(piece))
      .flatMap((p) => {
        const s = sites.get(siteKey(p.piece, p.x, p.z))
        return s ? [s.born + RISE_S + s.delay + SPAN[s.kind]] : []
      })
    if (done.length > 0) moments.push({ t: Math.min(...done), text })
  }

  // ---- props: with their building, else a beat after their hex ----
  for (const p of decor) {
    if (roleOf(p.piece) !== "prop" || sites.has(siteKey(p.piece, p.x, p.z))) continue
    const by = builders.find((b) => near(p, b, NEAR))
    if (by) put(p, "prop", by.site.born, by.site.delay + SPAN[by.site.kind])
    else put(p, "prop", firstOn(hexIndex(g, p.x, p.z)), 0.9 + salt(p.x, p.z) * 0.5)
  }

  // ---- trees: outward from the district's square ----
  const lag = new Float32Array(g.cells.length)
  for (let h = 0; h < lag.length; h++) {
    const centre = plaza(rank.get(h)?.[0] ?? g.district[h] ?? 0)
    lag[h] = Math.min(
      4,
      0.3 +
        0.045 * Math.hypot((g.spots[h * 2] as number) - centre.x, (g.spots[h * 2 + 1] as number) - centre.z),
    )
  }

  moments.sort((a, b) => a.t - b.t)
  return { sites, lag, castle: starts, moments }
}
