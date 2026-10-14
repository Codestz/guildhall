/**
 * The crowd round the notice board (lifePlan `readers`, world `boardReaders`): when a quest is pinned,
 * the townsfolk standing about near it walk over, read and talk it over, and walk back to their stay.
 * Each goes only where the straight way there keeps out of the walls, the buildings and the fences
 * (what they stand at aside, as far as it takes to leave it: world `ownRoom`), so nobody reading walks
 * through a wall (decisions.md 10-14). Pure: life.ts asks it who reads and where they are; the walls
 * sweep runs it headless.
 */
import { hash } from "@guildhall/core"
import {
  type BoardReader,
  type LifePose,
  type LifeStep,
  lifePose,
  ownRoom,
  type Solid,
} from "@guildhall/world"

/** Townsfolk this near the notice board (metres) come to read a quest just pinned, at most one per reader spot. */
export const READ_REACH = 20
/** Seconds they read it (and a few more by their seed), their pace there and back (m/s), between gatherings. */
export const READ_S = 11
export const READ_MPS = 0.85
export const READ_AGAIN_S = 40
/** How far the way there keeps from a wall, a building or a fence (a body's core), metres. */
const READ_CLEAR = 0.2

/** What the readers need of the world: the collision layer's solids. */
export interface ReadersWorld {
  solidsNear(x: number, z: number, r: number): readonly Solid[]
  solidDistance(s: Solid, x: number, z: number): number
}

/** Someone standing about who may come to read: where they are drawn, and their day. */
export interface ReaderCandidate {
  id: number
  x: number
  z: number
  y: number
  steps: readonly LifeStep[]
  /** Their pose now (at a stay). */
  since?: number
}

interface Reader {
  from: [number, number, number]
  spot: BoardReader
  go: number
  arrive: number
  leave: number
  back: number
  seed: number
}

export interface Readers {
  /** A quest pinned at `t` (seconds), the day at `day` (hours): the nearest few of `crowd` come to the board. */
  gather(t: number, day: number, crowd: readonly ReaderCandidate[], speedup: number): void
  /** Reader `id`'s pose at `secs`, or null when they are at their own stay. */
  pose(id: number, secs: number, day: number, secPerHour: number): LifePose | null
  /** Who reads now (or is on the way there or back). */
  readonly ids: readonly number[]
  readonly size: number
  /** Forgets the last gathering's time (the next pin gathers at once). */
  reset(): void
}

/** Whether a solid stands across the straight way a→b (by a: what one stands at, as far as leaving it takes). */
export function readWayClear(world: ReadersWorld, ax: number, az: number, bx: number, bz: number): boolean {
  const len = Math.hypot(bx - ax, bz - az)
  const n = Math.max(1, Math.ceil(len / 0.1))
  for (let k = 1; k < n; k++) {
    const x = ax + ((bx - ax) * k) / n
    const zz = az + ((bz - az) * k) / n
    const off = (len * k) / n
    for (const o of world.solidsNear(x, zz, READ_CLEAR + 0.1)) {
      if (o.kind === "seat" || o.kind === "prop" || o.soft) continue
      const d = world.solidDistance(o, x, zz)
      if (d >= READ_CLEAR) continue
      // (where one stands at a stall's counter or a wall: as far as it takes to step off it, no further)
      const own = world.solidDistance(o, ax, az)
      if (own < READ_CLEAR && off <= ownRoom(own) && d >= Math.min(READ_CLEAR, own) - 0.01) continue
      return false
    }
  }
  return true
}

export function createReaders(spots: readonly BoardReader[], world: ReadersWorld, seed: number): Readers {
  const reading = new Map<number, Reader>()
  let gathered = Number.NEGATIVE_INFINITY
  const gather = (t: number, day: number, crowd: readonly ReaderCandidate[], speedup: number) => {
    if (!spots.length || t - gathered < READ_AGAIN_S) return
    gathered = t
    reading.clear()
    const cx = spots.reduce((m, r) => m + r.at[0], 0) / spots.length
    const cz = spots.reduce((m, r) => m + r.at[2], 0) / spots.length
    const near: { c: ReaderCandidate; d: number }[] = []
    for (const c of crowd) {
      const d = Math.hypot(c.x - cx, c.z - cz)
      if (d > READ_REACH) continue
      // still at the same stay when they would be back
      const away = READ_S + 6 + (2 * d) / READ_MPS + 4
      const later = lifePose(c.steps, (day + (away * speedup) / 3600) % 24, 24)
      if (later.act === "walk" || later.since !== c.since) continue
      near.push({ c, d })
    }
    near.sort((a, b) => a.d - b.d || a.c.id - b.c.id)
    const free = [...spots]
    for (const { c } of near) {
      if (!free.length) break
      let k = 0
      for (let j = 1; j < free.length; j++)
        if (
          Math.hypot(free[j]!.at[0] - c.x, free[j]!.at[2] - c.z) <
          Math.hypot(free[k]!.at[0] - c.x, free[k]!.at[2] - c.z)
        )
          k = j
      const spot = free[k]!
      // there and back by the straight way: one a wall stands across stays put
      if (!readWayClear(world, c.x, c.z, spot.at[0], spot.at[2])) continue
      free.splice(k, 1)
      const go = t + 0.8 + reading.size * 0.7
      const arrive = go + Math.hypot(spot.at[0] - c.x, spot.at[2] - c.z) / READ_MPS
      const s = hash(`read:${seed}:${c.id}:${Math.round(t)}`)
      const leave = arrive + READ_S + (s % 5)
      reading.set(c.id, {
        from: [c.x, c.y, c.z],
        spot,
        go,
        arrive,
        leave,
        back: leave + (arrive - go),
        seed: s,
      })
    }
    // they read it together: everyone stays until the last has had a look, then they go a few apart
    const last = Math.max(...[...reading.values()].map((r) => r.arrive))
    for (const r of reading.values()) {
      r.leave = last + READ_S + (r.seed % 4)
      r.back = r.leave + (r.arrive - r.go)
    }
  }
  const walking = (a: readonly number[], b: readonly number[], f: number): LifePose => ({
    at: [a[0]! + (b[0]! - a[0]!) * f, a[1]! + (b[1]! - a[1]!) * f, a[2]! + (b[2]! - a[2]!) * f],
    facing: Math.atan2(b[0]! - a[0]!, b[2]! - a[2]!),
    act: "walk",
    indoors: false,
    ground: true,
    from: [a[0]!, a[1]!, a[2]!],
    to: [b[0]!, b[1]!, b[2]!],
  })
  const pose = (id: number, secs: number, day: number, secPerHour: number): LifePose | null => {
    const r = reading.get(id)
    if (!r) return null
    if (secs < gathered) {
      // the clock went back before the pin: nobody has gone
      reading.clear()
      return null
    }
    if (secs < r.go || secs >= r.back) {
      if (secs >= r.back) reading.delete(id)
      return null
    }
    if (secs < r.arrive) return walking(r.from, r.spot.at, (secs - r.go) / (r.arrive - r.go))
    if (secs >= r.leave) return walking(r.spot.at, r.from, (secs - r.leave) / (r.back - r.leave))
    return {
      at: r.spot.at,
      facing: r.spot.facing,
      act: "idle",
      indoors: false,
      ground: true,
      routine: { id: "notice", seed: r.seed },
      since: day - (secs - r.arrive) / secPerHour,
    }
  }
  return {
    gather,
    pose,
    get ids() {
      return [...reading.keys()]
    },
    get size() {
      return reading.size
    },
    reset() {
      gathered = Number.NEGATIVE_INFINITY
    },
  }
}
