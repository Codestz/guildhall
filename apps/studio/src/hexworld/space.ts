/**
 * The crowd's personal space on the hex island (track B), on the world's collision layer (world
 * `hex/collide.ts`): nobody is ever drawn inside anybody, a building, a wall or a fence, or off the step
 * their way is on.
 *
 *   rounds     everyone has a round as wide as they are drawn (a knight's shoulders, the mage's hat brim),
 *              and no two rounds overlap: each frame the overlaps are pushed apart (a walker gives way to
 *              whoever stands at a spot), a few passes, with each offset off the way moving at most a brisk
 *              step's pace so nobody jumps;
 *   queueing   a walker that comes up behind another going the same way slows down and follows a gap
 *              behind (its own clock runs late, `delay`), and catches up again once the way is clear;
 *              people meeting pass on their lanes (the world's walks keep to one side of the way);
 *   solids     a walker pushed off its way is kept out of every solid and on the walkable height its way is
 *              at: never beside a flight of stairs at the foot of its cheek, off a bridge's planks or up a
 *              terrace edge. A nudge that would still leave a body inside a wall, a house or a fence its
 *              way is not in is drawn back toward the way (which keeps out: the world's walls sweep) until
 *              it is out: nobody is drawn through a wall (decisions.md 10-14).
 *
 * Pure: the Studio's life draws people where `x`, `z` say, at their clock less `delay`.
 */
import type { Solid } from "@guildhall/world"

/** What the crowd needs of the world. */
export interface SpaceWorld {
  /** Where feet stand at a point (ground, stair tread, deck). */
  heightAt(x: number, z: number): number
  solidsNear(x: number, z: number, r: number): readonly Solid[]
  solidDistance(s: Solid, x: number, z: number, out?: [number, number]): number
}

/** One person this frame: where their way puts them and what they do. */
export interface SpacePose {
  at: readonly number[]
  facing: number
  act: string
  indoors: boolean
  /** Walking: where the walk starts and ends. */
  from?: readonly number[]
  to?: readonly number[]
}

/** How far apart two rounds keep beyond touching, metres. */
const MARGIN = 0.06
/** A walker follows this far behind the one ahead (between their rounds), metres. */
const GAP = 0.22
/** How fast an offset off the way may change, metres a second (a brisk side-step). */
const SIDESTEP = 1.6
/** The furthest a walker is pushed off its way, and a stayer off its spot, metres. */
const WALK_CAP = 1.1
const STAY_CAP = 0.45
/** The most a walker may lag its schedule queueing, seconds; it catches up this much faster. */
const MAX_DELAY = 12
const CATCH_UP = 0.3
/** How much of a push someone standing at a spot takes (they step aside a little for a passer-by). */
const STAYER = 0.3
/** A body's core against solids (the feet and the trunk; arms and hats may brush a wall), metres. */
const CORE = 0.2
/** Near a walk's ends a walker may cross what stands there (a doorway, its bench), metres. */
const DOOR = 1
/** How far from a walk's end a walker may be in what the end stands in (its doorway's house), metres. */
const DOOR_ROOM = 1.6
/** A prop this near a walk's end is what the end stands at (its bench, its stall), metres … */
const PROP_OWN = 0.25
/** … and a walker this near that end (more, out of one the end stands in) may still be in it, metres. */
const PROP_OFF = 0.4
/** A step up or down a walker may be pushed onto, metres. */
const STEP = 0.2
/** How far ahead a walker starts steering round someone standing in its way, metres. */
const LOOK = 0.7
/** A walker this near its walk's end is arriving at its spot, metres. */
const ARRIVE = 1.6
/** Offsets relax back onto the way over about this long, seconds. */
const RELAX = 0.9
/** The grid cell, metres: two rounds that can touch are in neighbouring cells. */
const CELL = 1.2

export interface Space {
  /** Puts everyone for this frame (poses at their delayed clocks), `dt` seconds after the last. */
  step(poses: readonly SpacePose[], dt: number): void
  /** Where person `id` is drawn. */
  x: Float32Array
  z: Float32Array
  /** How many seconds late each person's clock runs (queueing). */
  delay: Float32Array
}

/**
 * The crowd's space for `radii.length` people (each's round, metres). `walking(i)` is read from the
 * poses; `world` gives heights and solids.
 */
export function createSpace(radii: Float32Array, world: SpaceWorld): Space {
  const n = radii.length
  const x = new Float32Array(n)
  const z = new Float32Array(n)
  const offX = new Float32Array(n)
  const offZ = new Float32Array(n)
  const baseX = new Float32Array(n)
  const baseZ = new Float32Array(n)
  const baseY = new Float32Array(n)
  const delay = new Float32Array(n)
  const walk = new Uint8Array(n)
  const live = new Uint8Array(n)
  const dirX = new Float32Array(n)
  const dirZ = new Float32Array(n)
  /** Walking within ARRIVE of the walk's end: about to take its spot. */
  const arriving = new Uint8Array(n)
  const cells = new Map<number, number[]>()
  const pool: number[][] = []
  const dir: [number, number] = [0, 0]
  const key = (cx: number, cz: number) => (cx + 32768) * 65536 + cz + 32768
  /** The pairs that may touch this frame, flat (a, b, a, b …). */
  let pairs = new Int32Array(1024)
  let npairs = 0

  /** A plane distance (Math.hypot takes its arguments as a list: an allocation per call, in V8). */
  const hyp = (a: number, b: number): number => Math.sqrt(a * a + b * b)
  /** Whether a walker may stand at (px, pz): on its way's step and out of every solid. */
  const fits = (i: number, px: number, pz: number): boolean =>
    Math.abs(world.heightAt(px, pz) - baseY[i]!) <= STEP
  /** Whether walker `w` has room a side-step (`g` = ±1, `need` metres) off its way: no step, no solid. */
  const room = (w: number, g: number, need: number): boolean => {
    const px = x[w]! + dirZ[w]! * g * need
    const pz = z[w]! - dirX[w]! * g * need
    if (Math.abs(world.heightAt(px, pz) - world.heightAt(x[w]!, z[w]!)) > STEP) return false
    for (const o of world.solidsNear(px, pz, CORE)) if (world.solidDistance(o, px, pz) < CORE) return false
    return true
  }
  /**
   * A solid person `i` (at pose `p`, drawn at px, pz) may stand in: what their way stands in where they
   * are on it (a stayer's own seat, a doorway's porch the walk runs under), and by a walk's end what the
   * end stands in (its door, its bench), near that end only.
   */
  const own = (s: Solid, i: number, p: SpacePose, px: number, pz: number): boolean => {
    if (world.solidDistance(s, baseX[i]!, baseZ[i]!) < 0.02) return true
    if (!walk[i]) return false
    const hard = s.kind === "building" || s.kind === "wall"
    for (const e of [p.to, p.from]) {
      if (!e) continue
      const d = world.solidDistance(s, e[0]!, e[2]!)
      // a house or a wall by a door the walk goes in or out at, as far as its threshold; a prop only the
      // end stands at (the bench it gets up from), as far as it takes to step off it
      if (
        hard
          ? d < DOOR && hyp(px - e[0]!, pz - e[2]!) < DOOR_ROOM
          : d < PROP_OWN && hyp(px - e[0]!, pz - e[2]!) < PROP_OFF - Math.min(0, d)
      )
        return true
    }
    return false
  }
  /** Whether (px, pz) is inside a solid person `i` may not stand in (a wall, a house, a fence, a cart). */
  const inside = (i: number, p: SpacePose, px: number, pz: number): boolean => {
    for (const s of world.solidsNear(px, pz, 0.02))
      if (!s.soft && world.solidDistance(s, px, pz) < 0 && !own(s, i, p, px, pz)) return true
    return false
  }
  /** Per frame: how hard each walker brakes behind the one ahead (kept, not made, each frame). */
  const brake = new Float32Array(n)

  const step = (poses: readonly SpacePose[], dt: number) => {
    const relax = Math.exp(-dt / RELAX)
    for (const list of cells.values()) {
      list.length = 0
      pool.push(list)
    }
    cells.clear()
    for (let i = 0; i < n; i++) {
      const p = poses[i]!
      live[i] = p.indoors ? 0 : 1
      baseX[i] = p.at[0]!
      baseZ[i] = p.at[2]!
      x[i] = baseX[i]!
      z[i] = baseZ[i]!
      if (!live[i]) {
        offX[i] = 0
        offZ[i] = 0
        delay[i] = 0
        continue
      }
      walk[i] = p.act === "walk" ? 1 : 0
      dirX[i] = Math.sin(p.facing)
      dirZ[i] = Math.cos(p.facing)
      arriving[i] = walk[i] && p.to && hyp(p.to[0]! - baseX[i]!, p.to[2]! - baseZ[i]!) < ARRIVE ? 1 : 0
      offX[i] = offX[i]! * relax
      offZ[i] = offZ[i]! * relax
      x[i] = baseX[i]! + offX[i]!
      z[i] = baseZ[i]! + offZ[i]!
      const k = key(Math.floor(x[i]! / CELL), Math.floor(z[i]! / CELL))
      let list = cells.get(k)
      if (!list) {
        list = pool.pop() ?? []
        cells.set(k, list)
      }
      list.push(i)
    }
    // the pairs near enough to touch, once
    npairs = 0
    for (const [k, list] of cells) {
      const cx = Math.floor(k / 65536) - 32768
      const cz = (k % 65536) - 32768
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          const other = cells.get(key(cx + dx, cz + dz))
          if (!other) continue
          for (const a of list)
            for (const b of other) {
              if (b <= a) continue
              const reach = radii[a]! + radii[b]! + LOOK + 0.1
              if (Math.abs(x[a]! - x[b]!) > reach || Math.abs(z[a]! - z[b]!) > reach) continue
              if (npairs * 2 + 2 > pairs.length) {
                const grown = new Int32Array(pairs.length * 2)
                grown.set(pairs)
                pairs = grown
              }
              pairs[npairs * 2] = a
              pairs[npairs * 2 + 1] = b
              npairs++
            }
        }
    }
    // queueing: a walker close behind another going its way brakes (its clock falls behind)
    brake.fill(0)
    for (let q = 0; q < npairs; q++) {
      const a = pairs[q * 2]!
      const b = pairs[q * 2 + 1]!
      if (walk[a] !== walk[b]) {
        // one about to take a spot beside (or of) someone still standing there waits for room
        const w = walk[a] ? a : b
        const s = w === a ? b : a
        if (!arriving[w]) continue
        const d = hyp(x[s]! - x[w]!, z[s]! - z[w]!) - radii[w]! - radii[s]!
        if ((x[s]! - x[w]!) * dirX[w]! + (z[s]! - z[w]!) * dirZ[w]! > 0 && d < GAP)
          brake[w] = Math.max(brake[w]!, d <= 0 ? 1 : 1 - d / GAP)
        continue
      }
      if (!walk[a]) continue
      if (dirX[a]! * dirX[b]! + dirZ[a]! * dirZ[b]! < 0.4) continue
      // who is behind whom, along their mean way
      const mx = dirX[a]! + dirX[b]!
      const mz = dirZ[a]! + dirZ[b]!
      const ml = hyp(mx, mz) || 1
      const along = ((x[b]! - x[a]!) * mx + (z[b]! - z[a]!) * mz) / ml
      const side = Math.abs(((x[b]! - x[a]!) * -mz + (z[b]! - z[a]!) * mx) / ml)
      const r = radii[a]! + radii[b]!
      if (side > r) continue
      const back = along > 0 || (along === 0 && a > b) ? a : b
      const gap = Math.abs(along) - r - GAP
      const k = gap <= 0 ? 1 : gap < 0.35 ? 1 - gap / 0.35 : 0
      brake[back] = Math.max(brake[back]!, k)
    }
    for (let i = 0; i < n; i++) {
      if (!live[i]) continue
      if (walk[i] && brake[i]! > 0 && delay[i]! < MAX_DELAY) delay[i] = delay[i]! + dt * brake[i]!
      else delay[i] = Math.max(0, delay[i]! - dt * (walk[i] ? CATCH_UP : 1))
    }
    // a walker coming up on someone standing in its way steers round them ahead of time (side-on to
    // its way, away from them), not only once their rounds meet
    const steer = SIDESTEP * Math.max(dt, 1 / 120)
    for (let q = 0; q < npairs; q++) {
      const a = pairs[q * 2]!
      const b = pairs[q * 2 + 1]!
      if (walk[a] === walk[b]) continue
      const w = walk[a] ? a : b
      const s = w === a ? b : a
      const rx = x[s]! - x[w]!
      const rz = z[s]! - z[w]!
      const ahead = rx * dirX[w]! + rz * dirZ[w]!
      if (ahead <= 0 || arriving[w]) continue
      const need = radii[w]! + radii[s]! + MARGIN
      const side = rx * -dirZ[w]! + rz * dirX[w]!
      const d = hyp(rx, rz)
      if (Math.abs(side) >= need || d > need + LOOK) continue
      const k = Math.min(1, (need + LOOK - d) / LOOK)
      // to the side it already passes on (to its right when dead ahead), unless a wall or a step is there
      let sgn = side > 0 ? 1 : -1
      if (!room(w, sgn, need) && room(w, -sgn, need)) sgn = -sgn
      x[w] = x[w]! + dirZ[w]! * sgn * steer * k
      z[w] = z[w]! - dirX[w]! * sgn * steer * k
    }
    // rounds apart: a few passes over the pairs
    for (let pass = 0; pass < 3; pass++)
      for (let q = 0; q < npairs; q++) {
        const a = pairs[q * 2]!
        const b = pairs[q * 2 + 1]!
        let ex = x[a]! - x[b]!
        let ez = z[a]! - z[b]!
        let d = hyp(ex, ez)
        const need = radii[a]! + radii[b]! + MARGIN
        if (d >= need) continue
        if (d < 1e-4) {
          // exactly together: part them across the way of either, by a fixed per-pair turn
          const t = ((a * 92821 + b * 68917) % 628) / 100
          ex = Math.cos(t)
          ez = Math.sin(t)
          d = 1e-4
        } else {
          ex /= d
          ez /= d
        }
        // whoever stands at a spot keeps it: a walker gives way
        const wa = walk[a] ? 1 : STAYER
        const wb = walk[b] ? 1 : STAYER
        const move = need - d
        const fa = wa / (wa + wb)
        x[a] = x[a]! + ex * move * fa
        z[a] = z[a]! + ez * move * fa
        x[b] = x[b]! - ex * move * (1 - fa)
        z[b] = z[b]! - ez * move * (1 - fa)
      }
    // each offset: at a side-step's pace, capped, out of the solids and on its way's step
    const most = SIDESTEP * Math.max(dt, 1 / 120)
    for (let i = 0; i < n; i++) {
      if (!live[i]) continue
      let ox = x[i]! - baseX[i]!
      let oz = z[i]! - baseZ[i]!
      let cx = ox - offX[i]!
      let cz = oz - offZ[i]!
      const c = hyp(cx, cz)
      if (c > most) {
        cx *= most / c
        cz *= most / c
      }
      ox = offX[i]! + cx
      oz = offZ[i]! + cz
      const cap = walk[i] ? WALK_CAP : STAY_CAP
      const m = hyp(ox, oz)
      if (m > cap) {
        ox *= cap / m
        oz *= cap / m
      }
      const p = poses[i]!
      if (walk[i] || ox !== 0 || oz !== 0) {
        let px = baseX[i]! + ox
        let pz = baseZ[i]! + oz
        // out of the solids (but the seat a stayer sits in, and whatever stands by the door or the spot
        // a walk leaves or makes for: it goes in or out there)
        for (let round = 0; round < 2; round++) {
          let moved = false
          for (const s of world.solidsNear(px, pz, CORE)) {
            if (own(s, i, p, px, pz)) continue
            const d = world.solidDistance(s, px, pz, dir)
            if (d >= CORE) continue
            px += dir[0] * (CORE - d + 1e-3)
            pz += dir[1] * (CORE - d + 1e-3)
            moved = true
          }
          if (!moved) break
        }
        ox = px - baseX[i]!
        oz = pz - baseZ[i]!
        // on its way's step: a push that would take it up or down an edge is cut short
        baseY[i] = world.heightAt(baseX[i]!, baseZ[i]!)
        if (!fits(i, px, pz)) {
          let lo = 0
          let hi = 1
          for (let k = 0; k < 4; k++) {
            const f = (lo + hi) / 2
            if (fits(i, baseX[i]! + ox * f, baseZ[i]! + oz * f)) lo = f
            else hi = f
          }
          ox *= lo
          oz *= lo
        }
        // never left inside a solid: drawn back toward its way (out of them) until it is out
        if (inside(i, p, baseX[i]! + ox, baseZ[i]! + oz)) {
          let lo = 0
          let hi = 1
          for (let k = 0; k < 6; k++) {
            const f = (lo + hi) / 2
            if (inside(i, p, baseX[i]! + ox * f, baseZ[i]! + oz * f)) hi = f
            else lo = f
          }
          ox *= lo
          oz *= lo
        }
      }
      offX[i] = ox
      offZ[i] = oz
      x[i] = baseX[i]! + ox
      z[i] = baseZ[i]! + oz
    }
  }
  return { step, x, z, delay }
}
