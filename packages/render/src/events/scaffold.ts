/**
 * Scaffolds at the places being worked on (plan-hud-events §2 "Edits and commits: scaffolds and
 * builders at the touched place"): a timber scaffold of poles, ledgers, plank decks, braces and a
 * ladder round a building of the place, with a builder's crane over it holding up a beam. It rises out
 * of the ground and dithers in over a second when the place turns busy, and sinks and fades the same
 * way when it is quiet again. All of them are one instanced draw; no shadows (as the crowd's).
 */

import { hash } from "@guildhall/core"
import {
  type BufferGeometry,
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
import { Boxes, fxMaterial, swatch } from "./fxMaterial.ts"

/** Seconds to rise or sink. */
export const SCAFFOLD_S = 1

export interface ScaffoldPlace {
  id: string
  /** Where it stands: the middle of the building it goes round, on the ground. */
  at: [number, number, number]
}

/** The scaffold's parts, metres, round a building about 3.6 m across, its foot at 0 (a pure geometry). */
export function scaffoldGeometry(): BufferGeometry {
  const pole = swatch("timber-dark")
  const ledger = swatch("timber")
  const plank = swatch("timber-light")
  const rope = swatch("thatch-light")
  const load = swatch("stone-light")
  const a = 1.95
  const H = 5.4
  const levels = [1.8, 3.6]
  const b = new Boxes()
  // the poles: the four corners and the middle of each side but the front
  const poles: [number, number][] = [
    [-a, -a],
    [a, -a],
    [a, a],
    [-a, a],
    [-a, 0],
    [a, 0],
    [0, -a],
  ]
  for (const [x, z] of poles) b.box([0.09, H / 2, 0.09], [x, H / 2, z], pole)
  for (const y of levels) {
    // ledgers round three sides (the front, +z, is left open for the crane's load)
    b.beam([-a, y, -a], [a, y, -a], 0.09, ledger)
    b.beam([-a, y, -a], [-a, y, a], 0.09, ledger)
    b.beam([a, y, -a], [a, y, a], 0.09, ledger)
    // plank decks along the back and the left
    b.box([a, 0.04, 0.32], [0, y + 0.05, -a + 0.05], plank)
    b.box([0.32, 0.04, a], [-a + 0.05, y + 0.05, 0], plank)
    // a guard rail over each deck
    b.beam([-a, y + 0.95, -a], [a, y + 0.95, -a], 0.06, ledger)
    b.beam([-a, y + 0.95, -a], [-a, y + 0.95, a], 0.06, ledger)
  }
  // braces across the back and the right side
  b.beam([-a, 0.1, -a], [0, levels[0] as number, -a], 0.07, ledger)
  b.beam([0, levels[0] as number, -a], [a, levels[1] as number, -a], 0.07, ledger)
  b.beam([a, 0.1, a], [a, levels[0] as number, 0], 0.07, ledger)
  b.beam([a, levels[0] as number, 0], [a, levels[1] as number, -a], 0.07, ledger)
  // a ladder up the left side's front
  const lz = a - 0.5
  b.beam([-a - 0.25, 0, lz - 0.22], [-a - 0.25, (levels[1] as number) + 0.9, lz - 0.22], 0.05, ledger)
  b.beam([-a - 0.25, 0, lz + 0.22], [-a - 0.25, (levels[1] as number) + 0.9, lz + 0.22], 0.05, ledger)
  for (let y = 0.35; y < (levels[1] as number) + 0.8; y += 0.4)
    b.box([0.025, 0.025, 0.22], [-a - 0.25, y, lz], ledger)
  // the crane: a mast off the back right corner, a jib out over the building, a counterweight, a load
  const mx = a + 0.55
  const mz = -a - 0.55
  const top = 7.6
  b.box([0.11, top / 2, 0.11], [mx, top / 2, mz], pole)
  b.beam([mx - 0.5, 0, mz], [mx, 2.2, mz], 0.08, ledger)
  b.beam([mx, 0, mz + 0.5], [mx, 2.2, mz], 0.08, ledger)
  const tip: [number, number, number] = [mx - 3.6, top - 0.3, mz + 3.6]
  b.beam([mx, top, mz], tip, 0.12, ledger)
  b.beam([mx, top + 0.9, mz], tip, 0.04, rope)
  b.box([0.07, 0.45, 0.07], [mx, top + 0.45, mz], pole)
  b.beam([mx, top, mz], [mx + 1.3, top - 0.2, mz - 1.3], 0.12, ledger)
  b.box([0.35, 0.3, 0.35], [mx + 1.3, top - 0.55, mz - 1.3], load)
  const hang = 3.4
  b.beam(tip, [tip[0], hang + 0.3, tip[2]], 0.03, rope)
  b.box([1.1, 0.09, 0.12], [tip[0], hang, tip[2]], plank, Math.PI / 4)
  return b.geometry()
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
  const material = fxMaterial("scaffold")
  const geometry = scaffoldGeometry()
  const seen = new InstancedBufferAttribute(new Float32Array(max), 1)
  seen.setUsage(DynamicDrawUsage)
  geometry.setAttribute("instanceSeen", seen)
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
      q.setFromAxisAngle(up, ((hash(id) >>> 0) % 6) * (Math.PI / 3))
      // it rises out of the ground (never under it: its foot stays on the ground)
      s.set(1, Math.max(0.02, level), 1)
      m.compose(p, q, s)
      mesh.setMatrixAt(k, m)
      seen.setX(k, level)
      k++
    }
    mesh.count = k
    mesh.instanceMatrix.needsUpdate = true
    seen.needsUpdate = true
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
