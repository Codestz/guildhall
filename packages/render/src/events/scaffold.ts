/**
 * Scaffolds at the places being worked on (plan-hud-events §2 "Edits and commits: scaffolds and
 * builders at the touched place"): a heavy timber scaffold round the back and the sides of the place's
 * biggest building near its heart (sites.ts): poles, ledgers, plank decks at two lifts, X braces, a
 * ladder and a canvas sheet, with a builder's crane over the roof holding up a load. The frame is fitted
 * to the building's foot and height per instance (`anchor`, fxMaterial `anchored`), so its timbers keep
 * their thickness round a cottage or a barracks. It rises out of the ground and dithers in over a second
 * when the place turns busy, and sinks and fades the same way when it is quiet again. All of them are
 * one instanced draw; no shadows (as the crowd's).
 */

import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from "three"
import type { Stage } from "../stage.ts"
import { warmPrograms } from "../warm.ts"
import { type Transition, transition } from "./ease.ts"
import { fxMaterial, swatch } from "./fxMaterial.ts"

/** Seconds to rise or sink. */
export const SCAFFOLD_S = 1

/** The building the geometry is built round: half across its front, its height, half front to back (m). */
export const SCAFFOLD_NOMINAL = [2, 5, 2.2] as const
/** Without a building (a place of squares only): a frame this size round its heart. */
const BARE: [number, number, number] = [1.6, 4.4, 1.6]

export interface ScaffoldPlace {
  id: string
  /** Where it stands: the middle of the foot of the building it goes round, on the ground. */
  at: [number, number, number]
  /** The building's front (radians about +y, 0 = +z): the frame leaves that side open. */
  yaw?: number
  /** The building's foot, half across its front and half front to back (m); none or 0: a bare frame. */
  half?: readonly [number, number]
  /** The building's height (m). */
  top?: number
}

/** The frame's size for a place (`instanceSize`: half x, height, half z), its building's, kept sane. */
export function scaffoldSize(place: Pick<ScaffoldPlace, "half" | "top">): [number, number, number] {
  const [hx, hz] = place.half ?? [0, 0]
  if (!(hx > 0.3 && hz > 0.3)) return [...BARE]
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  return [clamp(hx, 1.1, 4), clamp(place.top ?? 0, 3.4, 8), clamp(hz, 1.1, 4)]
}

type V3 = [number, number, number]
/** A point of the frame: `s` times the building's size (half x, height, half z), plus `o` metres. */
interface Pt {
  s: V3
  o: V3
}
const pt = (s: V3, o: V3 = [0, 0, 0]): Pt => ({ s, o })
const N = SCAFFOLD_NOMINAL
const nominal = (p: Pt): V3 => [p.s[0] * N[0] + p.o[0], p.s[1] * N[1] + p.o[1], p.s[2] * N[2] + p.o[2]]
const FACES = [
  [0, 3, 2, 1],
  [4, 5, 6, 7],
  [0, 1, 5, 4],
  [3, 7, 6, 2],
  [0, 4, 7, 3],
  [1, 2, 6, 5],
] as const

/**
 * Square-ended timbers between two frame points, each end keeping its own anchor (a timber stretches
 * with the frame and keeps its section), flat-shaded, palette-coloured.
 */
class Frame {
  private pos: number[] = []
  private nor: number[] = []
  private col: number[] = []
  private anc: number[] = []

  /** A timber from `a` to `b`, `w` metres across (level, square to it) and `h` the other way. */
  timber(a: Pt, b: Pt, colour: V3, w: number, h = w): this {
    const pa = nominal(a)
    const pb = nominal(b)
    const d = new Vector3(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]).normalize()
    // across: level and square to the timber (an upright: across x); up: square to both
    const side = Math.abs(d.y) > 0.99 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0).cross(d).normalize()
    const up = new Vector3().crossVectors(d, side).normalize()
    const corner = (end: 0 | 1, i: number, j: number) => {
      const base = end ? pb : pa
      const off = side
        .clone()
        .multiplyScalar((i * w) / 2)
        .addScaledVector(up, (j * h) / 2)
      return { p: [base[0] + off.x, base[1] + off.y, base[2] + off.z] as V3, s: end ? b.s : a.s }
    }
    const c = [
      corner(0, -1, -1),
      corner(0, 1, -1),
      corner(0, 1, 1),
      corner(0, -1, 1),
      corner(1, -1, -1),
      corner(1, 1, -1),
      corner(1, 1, 1),
      corner(1, -1, 1),
    ]
    const e1 = new Vector3()
    const e2 = new Vector3()
    for (const face of FACES) {
      const q = face.map((k) => c[k] as (typeof c)[number])
      const [p0, p1, p2] = [q[0]?.p, q[1]?.p, q[2]?.p] as [V3, V3, V3]
      e1.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
      e2.set(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2])
      const n = e1.cross(e2).normalize()
      // a face is wound outward when its normal points away from the timber's middle
      const mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2]
      const away =
        n.x * (p0[0] - (mid[0] as number)) +
        n.y * (p0[1] - (mid[1] as number)) +
        n.z * (p0[2] - (mid[2] as number))
      const order = away >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]
      if (away < 0) n.negate()
      for (const k of order) {
        const v = q[k] as (typeof c)[number]
        this.pos.push(...v.p)
        this.nor.push(n.x, n.y, n.z)
        this.col.push(...colour)
        this.anc.push(...v.s)
      }
    }
    return this
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry()
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3))
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.nor), 3))
    g.setAttribute("color", new BufferAttribute(new Float32Array(this.col), 3))
    g.setAttribute("anchor", new BufferAttribute(new Float32Array(this.anc), 3))
    g.setAttribute("tint", new BufferAttribute(new Float32Array(this.pos.length / 3), 1))
    return g
  }
}

/**
 * The scaffold round the nominal building (`SCAFFOLD_NOMINAL`), its foot at 0, its front (+z) open:
 * a pure geometry with an `anchor` per vertex.
 */
export function scaffoldGeometry(): BufferGeometry {
  const pole = swatch("timber-dark")
  const ledger = swatch("timber")
  const plank = swatch("sand")
  const rope = swatch("thatch-light")
  const canvas = swatch("sand-light")
  const load = swatch("stone-light")
  const f = new Frame()
  // the poles stand this far out from the walls, the decks between them and the walls
  const out = 1
  const lifts = [0.36, 0.72] as const
  const rail = 1
  /** A point on the frame's line: at side (sx, sz), height fraction sy plus oy metres, nudged by ox, oz. */
  const P = (sx: number, sz: number, sy: number, oy = 0, ox = 0, oz = 0) =>
    pt([sx, sy, sz], [sx * out + ox, oy, (sz < 0 ? -out : sz > 0 ? -0.4 : 0) + oz])
  const top = lifts[1]
  // the poles: the corners and the middle of each run, from the ground to over the top lift's rail
  const feet: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
    [0, -1],
    [-1, 0],
    [1, 0],
  ]
  for (const [x, z] of feet) f.timber(P(x, z, 0), P(x, z, top, rail + 0.2), pole, 0.24)
  // the three runs (back, left, right): at each lift a ledger, a deck of wide planks and a rail
  const runs: [number, number, number, number][] = [
    [-1, -1, 1, -1],
    [-1, -1, -1, 1],
    [1, -1, 1, 1],
  ]
  for (const lift of lifts)
    for (const [ax, az, bx, bz] of runs) {
      f.timber(P(ax, az, lift), P(bx, bz, lift), ledger, 0.17)
      f.timber(P(ax, az, lift, rail), P(bx, bz, lift, rail), ledger, 0.12)
      const inX = ax === bx ? -ax * 0.5 : 0
      const inZ = az === bz ? -az * 0.5 : 0
      f.timber(P(ax, az, lift, 0.12, inX, inZ), P(bx, bz, lift, 0.12, inX, inZ), plank, 0.95, 0.08)
    }
  // X braces up the back and the sides' back halves, a lift at a time
  const levels = [0, ...lifts]
  for (let k = 0; k + 1 < levels.length; k++) {
    const lo = levels[k] as number
    const hi = levels[k + 1] as number
    const braces: [number, number, number, number][] = [
      [-1, -1, 0, -1],
      [0, -1, 1, -1],
      [-1, -1, -1, 0],
      [1, -1, 1, 0],
    ]
    for (const [ax, az, bx, bz] of braces) {
      f.timber(P(ax, az, lo, 0.15), P(bx, bz, hi), ledger, 0.12)
      f.timber(P(bx, bz, lo, 0.15), P(ax, az, hi), ledger, 0.12)
    }
  }
  // a canvas sheet hung outside the right side's back half, from the top rail down to the first lift
  f.timber(
    pt([1, lifts[0], -0.5], [out + 0.2, 0.3, -out / 2]),
    pt([1, top, -0.5], [out + 0.2, rail - 0.05, -out / 2]),
    canvas,
    0.04,
    2.2,
  )
  // a ladder up the left side near its front
  const lz = 0.5
  for (const dz of [-0.3, 0.3])
    f.timber(pt([-1, 0, lz], [-out - 0.4, 0, dz]), pt([-1, top, lz], [-out - 0.4, rail, dz]), ledger, 0.09)
  for (let y = 0.4; y < 3.8; y += 0.45)
    f.timber(pt([-1, 0, lz], [-out - 0.4, y, -0.3]), pt([-1, 0, lz], [-out - 0.4, y, 0.3]), ledger, 0.07)
  // the crane: a mast off the back right corner, a jib out over the roof, a counterweight, a load
  const mast = (oy: number, sy = 1) => pt([1, sy, -1], [out + 1, oy, -out - 1])
  f.timber(mast(0, 0), mast(2.8), pole, 0.32)
  f.timber(pt([1, 0, -1], [out + 0.1, 0, -out - 1]), mast(2.4, 0.3), ledger, 0.15)
  f.timber(pt([1, 0, -1], [out + 1, 0, -out - 0.1]), mast(2.4, 0.3), ledger, 0.15)
  const tip = pt([-0.2, 1, 0.15], [0, 2.4, 0])
  f.timber(mast(2.5), tip, ledger, 0.28)
  f.timber(mast(3.7), tip, rope, 0.06)
  f.timber(mast(2.6), mast(3.8), pole, 0.16)
  const tail = pt([1, 1, -1], [out + 2.5, 2.4, -out - 2.5])
  f.timber(mast(2.5), tail, ledger, 0.26)
  f.timber(mast(3.7), tail, rope, 0.06)
  f.timber(
    pt([1, 1, -1], [out + 2.4, 1.5, -out - 2.4]),
    pt([1, 1, -1], [out + 2.4, 2.25, -out - 2.4]),
    load,
    0.8,
  )
  // the load: a rope down from the tip to a bundle of beams over the roof
  f.timber(tip, pt([-0.2, 1, 0.15], [0, 1.05, 0]), rope, 0.06)
  f.timber(pt([-0.2, 1, 0.15], [-1, 0.9, -1]), pt([-0.2, 1, 0.15], [1, 0.9, 1]), plank, 0.42, 0.3)
  return f.geometry()
}

export interface Scaffolds {
  ready: Promise<void>
  /** The places being worked on now (ids); the rest sink away. `now`: at once (shots). */
  set(busy: Iterable<string>, now?: boolean): void
  busy(): string[]
  stats(): { shown: number; ms: number }
  dispose(): void
}

export function createScaffolds(stage: Stage, places: readonly ScaffoldPlace[]): Scaffolds {
  const byId = new Map(places.map((p) => [p.id, p]))
  const rise = new Map<string, Transition>()
  const max = Math.max(1, places.length)
  const material = fxMaterial("scaffold", { anchored: SCAFFOLD_NOMINAL })
  const geometry = scaffoldGeometry()
  const seen = new InstancedBufferAttribute(new Float32Array(max), 1)
  seen.setUsage(DynamicDrawUsage)
  geometry.setAttribute("instanceSeen", seen)
  const size = new InstancedBufferAttribute(new Float32Array(max * 3), 3)
  size.setUsage(DynamicDrawUsage)
  geometry.setAttribute("instanceSize", size)
  const mesh = new InstancedMesh(geometry, material, max)
  mesh.name = "scaffolds"
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.count = 0
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = true
  mesh.visible = false
  stage.scene.add(mesh)
  let disposed = false
  const ready = warmPrograms(stage, mesh).then(() => {
    if (!disposed) mesh.visible = true
  })
  let t = 0
  let busy = new Set<string>()
  let settling = false
  const costs: number[] = []
  const m = new Matrix4()
  const q = new Quaternion()
  const p = new Vector3()
  const s = new Vector3()
  const up = new Vector3(0, 1, 0)

  const draw = () => {
    let k = 0
    for (const [id, tr] of rise) {
      const level = tr.at(t)
      const place = byId.get(id)
      if (!place || level <= 0) continue
      p.set(...place.at)
      q.setFromAxisAngle(up, place.yaw ?? 0)
      // it rises out of the ground (never under it: its foot stays on the ground)
      s.set(1, Math.max(0.02, level), 1)
      m.compose(p, q, s)
      mesh.setMatrixAt(k, m)
      seen.setX(k, level)
      size.setXYZ(k, ...scaffoldSize(place))
      k++
    }
    mesh.count = k
    mesh.instanceMatrix.needsUpdate = true
    seen.needsUpdate = true
    size.needsUpdate = true
  }

  const off = stage.onFrame((dt) => {
    const t0 = performance.now()
    t += Math.min(dt, 0.1)
    let moving = false
    for (const tr of rise.values()) if (tr.moving(t)) moving = true
    // one more draw once they settle, so the last frame is the settled one
    if (moving || settling) draw()
    settling = moving
    // the quiet ones that have sunk are forgotten
    for (const [id, tr] of rise) if (!busy.has(id) && !tr.moving(t) && tr.at(t) === 0) rise.delete(id)
    costs.push(performance.now() - t0)
    if (costs.length > 60) costs.shift()
  })

  return {
    ready,
    set(next, now = false) {
      busy = new Set([...next].filter((id) => byId.has(id)))
      for (const id of busy) if (!rise.has(id)) rise.set(id, transition(0, SCAFFOLD_S))
      for (const [id, tr] of rise) {
        const target = busy.has(id) ? 1 : 0
        if (now) tr.jump(target)
        else tr.to(target, t)
      }
      settling = true
      draw()
    },
    busy: () => [...busy],
    stats: () => ({
      shown: mesh.count,
      ms: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0,
    }),
    dispose() {
      disposed = true
      off()
      mesh.removeFromParent()
      geometry.dispose()
      mesh.dispose()
      material.dispose()
    },
  }
}
