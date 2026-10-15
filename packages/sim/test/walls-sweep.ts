/**
 * The walls sweep (decisions.md 10-14, user: "characters and townsfolk sometimes walk through walls to
 * take a shorter path, visible in the castle"): every townsperson's day and every hero's walks on an
 * island, sampled every 10 cm along the way, against the collision layer's hard solids (buildings,
 * walls, towers, fences, a stair's cheeks, a bridge's rails). Counted per source: what made the bit of
 * way that cuts in. The heroes: every demo story's (`SWEPT_STORIES`), their strikes at the graveyard
 * among them, and every grave's strike spot from the gathering and every place and back (decisions.md
 * 10-14: "Warden in the graveyard walked out where there's no gate and then through walls").
 *
 *   bun packages/sim/test/walls-sweep.ts [seeds=1-6] [files=4000,12000]   prints the table
 *
 * A walk's own ends are not counted against what they stand in (a door's last metre when it goes in or
 * comes out, a seat, a gate's post a guard leans on), and a shoulder brushing a wall (`BRUSH`) is not a
 * cut; a thin one (a fence, a curtain's face: thinner than two brushes) is a cut when a way is half
 * through it. A ghost's drift (a walk marked `ghost`) passes through walls and is not swept.
 */
import {
  boardReaders,
  graveStrikeSpot,
  guildhallZone,
  HARD,
  HEX_TILE_SIZE,
  type HexWalk,
  heroRoute,
  hexAt,
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  type LifeSpot,
  type LifeStep,
  type LifeWalk,
  lifePlaces,
  lifePose,
  NATURE_CHOSEN,
  ownRoom,
  petitionLane,
  planFolk,
  routineSample,
  type Solid,
  solidDistance,
  spotFrame,
  type WalkBlocker,
  workTiles,
} from "@guildhall/world"
import { type LifeKit, type StoryId, story } from "../src/index.ts"
import { installTiles, itineraries } from "./life-choreo-fixtures.ts"
import { played } from "./stories-fixtures.ts"

/** A body's shoulder brushing a wall's foot or a gate's post (not its feet), metres. */
export const BRUSH = 0.15
/** How far a walk's end in a doorway may run in its house: the threshold, metres. */
const DOOR = 1.0
/** How far a tipsy weave sways off its way (life.ts WEAVE_M), with room to spare, metres. */
const WEAVE = 0.3
/** Samples along a way, metres. */
const STEP = 0.1

export const SOURCES = [
  "raw edge (not walked)",
  "raw castle edge",
  "raw postern edge",
  "walk-graph edge",
  "spot leave",
  "spot approach",
  "detour (clearWay)",
  "carry trip",
  "tipsy weave",
  "chat/wave stop",
  "routine shift",
  "stay spot",
  "petitioner lane",
  "board reader spot",
  "hero route",
  "hero direct",
  "hero stay",
  "hero to a grave",
  "hero from a grave",
] as const

/** The stories whose heroes are swept: the demos the island opens (their walks, their strikes at the graves). */
export const SWEPT_STORIES: readonly StoryId[] = ["saga", "events", "party", "solo", "rush"]

/**
 * A walk a ghost drifts (decisions.md 10-14 "Fallen hero": a pale ghost drifts to the graveyard): a ghost
 * passes through fences and walls, so its walks are not swept. Only a walk marked `ghost` is let off.
 */
const ghostly = (s: LifeStep): boolean => (s as { ghost?: boolean }).ghost === true
export type Source = (typeof SOURCES)[number]

export interface Tally {
  /** Samples (10 cm apart) more than BRUSH inside a hard solid. */
  samples: number
  /** Segments (or stays) with any such sample. */
  cuts: number
  /** Segments looked at. */
  seen: number
}
export type Table = Record<Source, Tally>
export const emptyTable = (): Table =>
  Object.fromEntries(SOURCES.map((s) => [s, { samples: 0, cuts: 0, seen: 0 }])) as unknown as Table

export interface Cut {
  source: Source
  who: string
  x: number
  z: number
  depth: number
  piece?: string
  a: [number, number]
  b: [number, number]
  castle?: boolean
  /** In or beside the graveyard's tiles. */
  graveyard?: boolean
}

type Near = (x: number, z: number, r: number) => Solid[]

/** Whether a solid at a point is a walk's end's own there (its house by the doorway, its seat). */
type Skip = (s: Solid, x: number, z: number) => boolean

/** A walk's end: where it stands, how near a solid counts as its own, and (a doorway) the way out. */
export interface End {
  at: readonly number[]
  slack: number
  /** A doorway's end: the walk from it outward, its house left the way the walk leaves it. */
  door?: readonly (readonly number[])[]
  /** How far off that way a body sways (a tipsy weave), metres. */
  sway?: number
}

/** The points (every 5 cm) of `line` from its start while it is in `o`: a doorway's run out of its house. */
function runIn(o: Solid, line: readonly (readonly number[])[]): [number, number][] {
  const out: [number, number][] = []
  for (let k = 0; k + 1 < line.length; k++) {
    const a = line[k]!
    const b = line[k + 1]!
    const n = Math.max(1, Math.ceil(Math.hypot(b[0]! - a[0]!, b[2]! - a[2]!) / 0.05))
    for (let j = 0; j <= n; j++) {
      const x = a[0]! + ((b[0]! - a[0]!) * j) / n
      const z = a[2]! + ((b[2]! - a[2]!) * j) / n
      out.push([x, z])
      if (solidDistance(o, x, z) > 0) return out
    }
  }
  return out
}

/**
 * What a walk's ends stand in, near them (decisions.md "door thresholds excepted"): what an end stands
 * in (within `slack`: its seat, its house by the doorway, a neighbour's wall by the door) as far as it
 * takes to leave it (walk.ts `ownRoom`), and a house a doorway's end stands in along the walk's run out
 * of it too (under a forge's porch, out to the street). Further on, it is walked round like anything else (a spot set
 * against the butts is not reached through them).
 */
export function endsOwn(ends: readonly End[]): Skip {
  const runs = ends.map(() => new Map<Solid, [number, number][]>())
  return (o, x, z) =>
    ends.some((e, k) => {
      const d = solidDistance(o, e.at[0]!, e.at[2]!)
      if (d >= e.slack) return false
      if (Math.hypot(x - e.at[0]!, z - e.at[2]!) <= ownRoom(d)) return true
      if (e.door && d < 0) {
        let run = runs[k]!.get(o)
        if (!run) {
          run = runIn(o, e.door)
          runs[k]!.set(o, run)
        }
        const r = 0.06 + (e.sway ?? 0)
        return run.some(([px, pz]) => Math.hypot(px - x, pz - z) < r)
      }
      return false
    })
}

const isHard = (o: Solid) => HARD(o.kind)
/** How deep a point is in a hard solid (≤ 0: out), the ones `skip` lists aside. */
function depthAt(near: Near, x: number, z: number, skip: Skip): [number, Solid | null] {
  let worst = 0
  let by: Solid | null = null
  for (const o of near(x, z, 0.05)) {
    if (!isHard(o) || skip(o, x, z)) continue
    const d = -solidDistance(o, x, z)
    if (d > worst) {
      worst = d
      by = o
    }
  }
  return [worst, by]
}

export interface Sweep {
  table: Table
  cuts: Cut[]
  /** Strikes the swept stories planned at the graves (their walks there and back are swept). */
  struck: number
}

function tallySegment(
  out: Sweep,
  near: Near,
  source: Source,
  who: string,
  a: readonly number[],
  b: readonly number[],
  skip: Skip,
  offset?: (f: number) => [number, number],
): void {
  const t = out.table[source]
  t.seen++
  const len = Math.hypot(b[0]! - a[0]!, b[2]! - a[2]!)
  const n = Math.max(1, Math.ceil(len / STEP))
  let hit = false
  let deepest: Cut | null = null
  for (let j = 0; j <= n; j++) {
    const f = j / n
    let x = a[0]! + (b[0]! - a[0]!) * f
    let z = a[2]! + (b[2]! - a[2]!) * f
    if (offset) {
      const [dx, dz] = offset(f)
      x += dx
      z += dz
    }
    const [d, by] = depthAt(near, x, z, skip)
    if (d <= BRUSH) continue
    t.samples++
    hit = true
    if (!deepest || d > deepest.depth)
      deepest = {
        source,
        who,
        x,
        z,
        depth: d,
        ...(by?.piece ? { piece: by.piece } : {}),
        a: [a[0]!, a[2]!],
        b: [b[0]!, b[2]!],
      }
  }
  // a thin wall (a fence, a rail: thinner than two brushes) is never a brush deep: the way through it is
  // looked for along the segment instead, a cut when it is more than half into it, its ends' own aside
  if (!offset)
    for (const o of near((a[0]! + b[0]!) / 2, (a[2]! + b[2]!) / 2, len / 2 + 0.1)) {
      // (a stair's cheeks and a bridge's rails, pieces of no piece, are walked along on their stairs)
      if (!isHard(o) || !o.piece) continue
      const half = thickness(o)
      if (half >= BRUSH + 0.05) continue
      const m = Math.max(1, Math.ceil(len / 0.01))
      let worst = 0
      let wx = 0
      let wz = 0
      for (let j = 0; j <= m; j++) {
        const x = a[0]! + ((b[0]! - a[0]!) * j) / m
        const z = a[2]! + ((b[2]! - a[2]!) * j) / m
        const d = -solidDistance(o, x, z)
        if (d > worst && !skip(o, x, z)) {
          worst = d
          wx = x
          wz = z
        }
      }
      if (worst < half * 0.8) continue
      t.samples++
      hit = true
      if (!deepest || worst > deepest.depth)
        deepest = {
          source,
          who,
          x: wx,
          z: wz,
          depth: worst,
          piece: o.piece,
          a: [a[0]!, a[2]!],
          b: [b[0]!, b[2]!],
        }
    }
  if (hit) {
    t.cuts++
    if (deepest) out.cuts.push(deepest)
  }
}

const thick = new WeakMap<Solid, number>()
/** How far in a solid's middle is from its outline (half a fence's thickness), metres. */
function thickness(o: Solid): number {
  let d = thick.get(o)
  if (d === undefined) {
    d = Math.max(0, -solidDistance(o, o.cx, o.cz))
    thick.set(o, d)
  }
  return d
}

/** Whether a point is (within 0.6 m of) a walk node: a laned way's corner. */
function nodeish(walk: HexWalk, grid: Map<string, number[]>, x: number, z: number): boolean {
  const k = `${Math.floor(x / 4)},${Math.floor(z / 4)}`
  for (const i of grid.get(k) ?? []) {
    const n = walk.nodes[i]!
    if (Math.hypot(n.x - x, n.z - z) < 0.6) return true
  }
  return false
}

/** Whether a point is one of the graves' strike spots (a hero's walk there or from there). */
const atGrave = (graves: readonly (readonly number[])[], p: readonly number[]): boolean =>
  graves.some((g) => Math.hypot(g[0]! - p[0]!, g[2]! - p[2]!) < 0.05)

/** The steps' walks and stays, each bit of way by what made it. */
function sweepSteps(
  out: Sweep,
  near: Near,
  walk: HexWalk,
  grid: Map<string, number[]>,
  steps: readonly LifeStep[],
  who: string,
  hero: boolean,
  secPerHour: number,
  heroSource?: Source,
  graves?: readonly (readonly number[])[],
): void {
  for (let si = 0; si < steps.length; si++) {
    const s = steps[si]!
    if (s.kind === "stay") {
      if (s.indoors) continue
      // where it stands (its own seat, its post: what it stands in at the spot is the spot's own)
      tallySegment(out, near, hero ? "hero stay" : "stay spot", who, s.at, s.at, () => false)
      if (s.routine && !hero) {
        // a routine's part standing off the spot (a step down a row, to a basket, a move): a cycle's shifts
        const own = new Set(
          near(s.at[0], s.at[2], 0.05).filter((o) => solidDistance(o, s.at[0], s.at[2]) < 0.05),
        )
        const span = Math.min(600, (s.to - s.from) * secPerHour)
        for (let u = 0; u < span; u += 1.5) {
          const f = routineSample(s.routine, u)
          if (!f.shift) continue
          const [px, pz] = spotFrame(s.at[0], s.at[2], s.facing, f.shift[0], f.shift[1])
          tallySegment(out, near, "routine shift", who, [px, 0, pz], [px, 0, pz], (o) => own.has(o))
        }
      }
      continue
    }
    if (ghostly(s)) continue
    const w = s as LifeWalk
    const prev = steps[si - 1] ?? steps[steps.length - 1]
    const next = steps[si + 1] ?? steps[0]
    const fromIn = prev?.kind === "stay" && !!prev.indoors
    const toIn = next?.kind === "stay" && !!next.indoors
    const a0 = w.pts[0]!
    const b0 = w.pts[w.pts.length - 1]!
    // a chat or a wave's stop cuts a walk in two: the halves' ends at the stop stand where it was walked
    const chatBefore =
      prev?.kind === "stay" &&
      !prev.indoors &&
      prev.at === a0 &&
      /chat|wave|reel|slump/.test(prev.routine?.id ?? "")
    const skip = endsOwn([
      fromIn ? { at: a0, slack: DOOR, door: w.pts } : { at: a0, slack: 0.05 },
      toIn ? { at: b0, slack: DOOR, door: [...w.pts].reverse() } : { at: b0, slack: 0.05 },
    ])
    const last = w.pts.length - 2
    for (let k = 0; k + 1 < w.pts.length; k++) {
      const a = w.pts[k]!
      const b = w.pts[k + 1]!
      let src: Source
      if (w.carry) src = "carry trip"
      else if (hero && heroSource) src = heroSource
      else if (hero && graves && atGrave(graves, b0)) src = "hero to a grave"
      else if (hero && graves && atGrave(graves, a0)) src = "hero from a grave"
      else if (hero) {
        const direct =
          w.pts.length <= 3 &&
          !w.pts.some((p, j) => j > 0 && j < w.pts.length - 1 && nodeish(walk, grid, p[0], p[2]))
        src = direct && !nodeish(walk, grid, a0[0], a0[2]) ? "hero direct" : "hero route"
      } else if (chatBefore && k === 0) src = "chat/wave stop"
      else if (k === 0) src = "spot leave"
      else if (k === last) src = "spot approach"
      else if (nodeish(walk, grid, a[0], a[2]) && nodeish(walk, grid, b[0], b[2])) src = "walk-graph edge"
      else src = "detour (clearWay)"
      tallySegment(out, near, src, who, a, b, skip)
    }
  }
}

export interface Island {
  seed: number
  files: number
}

/** One island's sweep: its townsfolk's day, the saga's heroes, every place's hero spots from the gathering. */
export function sweepIsland(
  { seed, files }: Island,
  opts: { heroes?: boolean; stories?: readonly StoryId[] } = {},
): Sweep & { ms: number } {
  const t0 = performance.now()
  const h = hexIsland({ seed, files })
  const z = hexZones(h, { wild: NATURE_CHOSEN.wild })
  const w = hexWorld(h, z, { nature: NATURE_CHOSEN })
  const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
  const places = lifePlaces(h, z, w, walk, { heroSpots: 3 })
  const f = places.furniture
  const near: Near = (x, zz, r) => f.solidsNear(x, zz, r)
  const out: Sweep = { table: emptyTable(), cuts: [], struck: 0 }
  const grid = new Map<string, number[]>()
  for (const [i, n] of walk.nodes.entries())
    for (const dx of [-1, 0, 1])
      for (const dz of [-1, 0, 1]) {
        const k = `${Math.floor(n.x / 4) + dx},${Math.floor(n.z / 4) + dz}`
        const l = grid.get(k)
        if (l) l.push(i)
        else grid.set(k, [i])
      }
  const who = (s: string) => `s${seed}/${files}:${s}`

  // the walk graph's own edges (a door's edge is let into its house's threshold)
  const castle = new Set(z.castle?.tiles ?? [])
  const postern = new Set(z.castle && z.castle.postern >= 0 ? [z.castle.postern, z.castle.posternEntry] : [])
  for (const e of walk.edges) {
    const a = walk.nodes[e.a]!
    const b = walk.nodes[e.b]!
    const src: Source =
      postern.has(a.tile) || postern.has(b.tile)
        ? "raw postern edge"
        : castle.has(a.tile) || castle.has(b.tile)
          ? "raw castle edge"
          : "raw edge (not walked)"
    const door = a.kind === "door" || b.kind === "door"
    // (an edge with no way round its wall is in no route: not walked)
    if (e.walled) continue
    // along its way round, when it has one
    const line = [[a.x, a.y, a.z], ...(e.via ?? []).map(([x, z]) => [x, a.y, z]), [b.x, b.y, b.z]]
    for (let k = 0; k + 1 < line.length; k++)
      tallySegment(
        out,
        near,
        src,
        who(`edge ${e.a}-${e.b}`),
        line[k]!,
        line[k + 1]!,
        door
          ? endsOwn([
              { at: [a.x, 0, a.z], slack: DOOR, door: line },
              { at: [b.x, 0, b.z], slack: DOOR, door: [...line].reverse() },
            ])
          : endsOwn([
              { at: [a.x, 0, a.z], slack: 0.05 },
              { at: [b.x, 0, b.z], slack: 0.05 },
            ]),
      )
  }

  // the townsfolk's day (as the Studio plans it: lifePlan.ts)
  const SEC_PER_HOUR = 180
  const folk = planFolk(h, z, w, walk, { seed, pace: (0.8 * 3600) / 20, places, secPerHour: SEC_PER_HOUR })
  for (const p of folk)
    sweepSteps(out, near, walk, grid, p.day, who(`folk ${p.id} ${p.role}`), false, SEC_PER_HOUR)
  // the tipsy weave is sampled again by lifePose itself (its eased weave), every few seconds of a walk
  for (const p of folk)
    for (const [si, s] of p.day.entries()) {
      if (s.kind !== "walk" || !s.tipsy) continue
      const a0 = s.pts[0]!
      const b0 = s.pts[s.pts.length - 1]!
      const prev = p.day[si - 1] ?? p.day[p.day.length - 1]
      const next = p.day[si + 1] ?? p.day[0]
      // (the weave's sway off the way, by the doorways too)
      const skip = endsOwn([
        prev?.kind === "stay" && prev.indoors
          ? { at: a0, slack: DOOR, door: s.pts, sway: WEAVE }
          : { at: a0, slack: 0.05 },
        next?.kind === "stay" && next.indoors
          ? { at: b0, slack: DOOR, door: [...s.pts].reverse(), sway: WEAVE }
          : { at: b0, slack: 0.05 },
      ])
      for (let t = s.from; t < s.to; t += 2 / 3600) {
        const pose = lifePose(p.day, t, 24)
        if (pose.act !== "walk") continue
        tallySegment(out, near, "tipsy weave", who(`folk ${p.id} weave`), pose.at, pose.at, skip)
      }
    }

  // the petitioners' lane and the board's readers
  const lane = petitionLane({ world: w, walk, places, doorways: w.doorways })
  if (lane) {
    for (const way of [lane.approach, lane.exit]) {
      const a0 = way[0]!
      const b0 = way[way.length - 1]!
      const skip = endsOwn([
        { at: a0, slack: DOOR, door: way },
        { at: b0, slack: DOOR, door: [...way].reverse() },
      ])
      for (let k = 0; k + 1 < way.length; k++)
        tallySegment(out, near, "petitioner lane", who("petitions"), way[k]!, way[k + 1]!, skip)
    }
    for (const p of lane.places)
      tallySegment(out, near, "petitioner lane", who("queue"), p.at, p.at, () => false)
  }
  const board = places.heroSpots.board()
  if (board)
    for (const r of boardReaders(board, f))
      tallySegment(out, near, "board reader spot", who("reader"), r.at, r.at, () => false)

  if (opts.heroes !== false) {
    // the graveyard's strike spots, as the Studio gives them (lifePlan.ts `kitOf`)
    const gy = w.graveyard
    const gyNode = gy ? walk.at(gy.tile) : -1
    const kit: LifeKit = {
      walk,
      spots: (zi) => places.heroSpots(zi),
      home: guildhallZone(walk, z),
      near: places.walkNear,
      island: h,
      board,
      ...(gy && gyNode >= 0
        ? { graves: { strike: (slot: number) => graveStrikeSpot(gy, gyNode, slot) } }
        : {}),
    }
    const strikes = gy && gyNode >= 0 ? gy.graves.map((_, k) => graveStrikeSpot(gy, gyNode, k)!) : []
    const graves = strikes.map((s) => s.at)
    // the saga, its four units at four places (the castle's own court among them where it has one)
    const zones = z.zones.map((_, i) => i).filter((i) => i !== kit.home && places.heroSpots(i).length)
    const units = ["packages/world", "packages/render", "apps/studio", "packages/sim"]
    const pick = (k: number) => zones[(k * 7 + seed) % Math.max(1, zones.length)]
    const placeOf = (path: string) => {
      const u = units.findIndex((p) => path.includes(p))
      return u < 0 ? kit.home : pick(u)
    }
    for (const id of opts.stories ?? SWEPT_STORIES) {
      const told = story(id, { seed: 1 })
      const its = itineraries(played(told, placeOf), kit, { mps: 0.8 * 1.15, hurry: { within: 10, mps: 5 } })
      for (const it of its.values()) {
        sweepSteps(out, near, walk, grid, it.steps, who(`${id} hero ${it.id}`), true, 1, undefined, graves)
        out.struck += it.acts.filter((a) => a.play === "strike").length
      }
    }
    // every grave from the gathering and back, and from it to every place's spots (where a hero who
    // struck it goes back to its work)
    const homeSpots = kit.spots(kit.home)
    const firsts = [...z.zones.keys()].flatMap((zi) => kit.spots(zi).slice(0, 1))
    for (const [k, grave] of strikes.entries())
      for (const [a, b, src] of [
        ...homeSpots.map((s) => [s, grave, "hero to a grave"] as const),
        ...homeSpots.map((s) => [grave, s, "hero from a grave"] as const),
        ...firsts.map((s) => [grave, s, "hero from a grave"] as const),
        ...firsts.map((s) => [s, grave, "hero to a grave"] as const),
      ]) {
        const r = heroRouteOf(walk, a, b, places.walkNear)
        if (!r) continue
        const steps: LifeStep[] = [
          { kind: "stay", from: -1, to: 0, at: a.at, facing: 0, act: "idle", ground: true },
          r,
        ]
        sweepSteps(out, near, walk, grid, steps, who(`grave ${k}`), true, 1, src)
      }
    // every place's hero spots from the gathering and back (the routes any session may take)
    const home = kit.spots(kit.home)
    for (const zi of z.zones.keys()) {
      if (zi === kit.home) continue
      for (const [k, spot] of kit.spots(zi).entries()) {
        const from = home[(k + zi) % home.length]
        if (!from) continue
        for (const [a, b] of [
          [from, spot],
          [spot, from],
        ] as const) {
          const steps: LifeStep[] = []
          const r = heroRouteOf(walk, a, b, places.walkNear)
          if (!r) continue
          steps.push({ kind: "stay", from: -1, to: 0, at: a.at, facing: 0, act: "idle", ground: true }, r)
          sweepSteps(out, near, walk, grid, steps, who(`hero matrix ${zi}/${k}`), true, 1)
        }
      }
    }
  }
  // which cuts are in the castle (its site's tiles and the curtain's notches)
  const site = new Set([...(z.castle?.tiles ?? []), ...(z.castle?.foot ?? [])])
  // … and which in and round the graveyard (its two tiles and their neighbours)
  const yard = new Set<number>()
  for (const t of w.graveyard ? [w.graveyard.tile, ...w.graveyard.cover] : [])
    for (const j of [t, ...h.grid.neighbours(t)]) if (j >= 0) yard.add(j)
  for (const c of out.cuts) {
    const { q, r } = hexAt(c.x / HEX_TILE_SIZE, c.z / HEX_TILE_SIZE)
    if (site.has(h.grid.index(q, r))) c.castle = true
    if (yard.has(h.grid.index(q, r))) c.graveyard = true
  }
  return { ...out, ms: performance.now() - t0 }
}

function heroRouteOf(
  walk: HexWalk,
  a: LifeSpot,
  b: LifeSpot,
  near: (x: number, z: number, r: number) => readonly WalkBlocker[],
) {
  return heroRoute(walk, a, b, { mps: 1, near })
}

/** Tables summed. */
export function sumTables(ts: readonly Table[]): Table {
  const out = emptyTable()
  for (const t of ts)
    for (const s of SOURCES) {
      out[s].samples += t[s].samples
      out[s].cuts += t[s].cuts
      out[s].seen += t[s].seen
    }
  return out
}

export function printTable(t: Table): string {
  const rows = SOURCES.map(
    (s) =>
      `| ${s.padEnd(26)} | ${String(t[s].cuts).padStart(6)} | ${String(t[s].samples).padStart(8)} | ${String(t[s].seen).padStart(8)} |`,
  )
  return [
    `| ${"source".padEnd(26)} |   cuts |  samples |     seen |`,
    `|${"-".repeat(28)}|--------|----------|----------|`,
    ...rows,
  ].join("\n")
}

if (import.meta.main) {
  installTiles()
  const [seedArg = "1-6", filesArg = "4000,12000"] = process.argv.slice(2)
  const [s0, s1] = seedArg.split("-").map(Number) as [number, number?]
  const seeds = Array.from({ length: (s1 ?? s0) - s0 + 1 }, (_, k) => s0 + k)
  const sizes = filesArg.split(",").map(Number)
  const tables: Table[] = []
  const cuts: Cut[] = []
  for (const seed of seeds)
    for (const files of sizes) {
      const r = sweepIsland({ seed, files })
      tables.push(r.table)
      cuts.push(...r.cuts)
      const n = SOURCES.reduce((m, s) => m + r.table[s].cuts, 0)
      const yard = r.cuts.filter((c) => c.graveyard).length
      console.log(
        `seed ${seed} files ${files}: ${n} cuts, ${yard} by the graveyard, ${r.struck} strikes (${Math.round(r.ms)} ms)`,
      )
    }
  console.log(printTable(sumTables(tables)))
  if (process.env.CUTS) {
    cuts.sort((a, b) => b.depth - a.depth)
    for (const c of cuts.slice(0, Number(process.env.CUTS)))
      console.log(
        `${c.source} ${c.who} at ${c.x.toFixed(1)},${c.z.toFixed(1)} ${c.depth.toFixed(2)} m ${c.piece ?? ""} [${c.a.map((v) => v.toFixed(1))} → ${c.b.map((v) => v.toFixed(1))}]`,
      )
  }
  if (process.env.JSON) await Bun.write(process.env.JSON, JSON.stringify(cuts))
}
