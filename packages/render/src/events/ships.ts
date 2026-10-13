/**
 * The harbour's pull-request ships (plan-hud-events §2 "PRs: a ship docks at the harbour with a
 * pennant"): the fleet's plan (fleet.ts) drawn as one instanced mesh, a library ship (Kenney's small
 * ship, in the house style) with a pennant at its masthead in the pull request's colour. Every ship is
 * one draw together; they fade in from the open sea and out to it with a dither (no pop at any
 * distance), bob at their berths, leave wakes on the water while they move, and a merged ship's pennant
 * glints as it casts off. They cast no shadows (as the crowd and the doors).
 */

import { PALETTE } from "@guildhall/assets"
import { hash } from "@guildhall/core"
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix3,
  Matrix4,
  Mesh,
  type Object3D,
  Quaternion,
  Vector3,
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import type { Stage } from "../stage.ts"
import { warmPrograms } from "../warm.ts"
import type { Wake, Water } from "../water.ts"
import {
  FLEET,
  type HarbourReading,
  harbourChanges,
  planFleet,
  prKey,
  type ShipEnd,
  type ShipLog,
  type Voyage,
  voyagePose,
} from "./fleet.ts"
import { Boxes, fxMaterial, swatch } from "./fxMaterial.ts"
import type { Berth } from "./sites.ts"

export interface HarbourShipsOpts {
  /** The harbour's berths, nearest first (sites.ts). */
  berths: readonly Berth[]
  /** The ship's model (a library piece); rejected or absent: a plain stylised hull. */
  load?: () => Promise<Object3D>
  /** The water, for the wakes. */
  water?: Water | null
  /** Metres per model unit. */
  scale?: number
  /** A closed pull request's ship sinks at its berth (default) or sails off. */
  close?: "sink" | "sail"
}

export interface ShipView {
  key: string
  berth: number
  phase: ReturnType<typeof voyagePose>["phase"]
  at: [number, number, number]
}

export interface HarbourShips {
  /** Resolves once the ship's model is loaded and its program linked. */
  ready: Promise<void>
  /** Reads a harbour (sim `harbourOf`): new pull requests sail in, vanished ones leave (merged or closed by the count). */
  update(harbour: HarbourReading): void
  /** A pull request opened now (`docked`: already there, no sail in); `colour` its pennant's. */
  open(key: string, opts?: { docked?: boolean; colour?: string }): void
  /** A pull request merged or closed now. */
  end(key: string, how: ShipEnd): void
  /** The ships on the water now. */
  ships(): ShipView[]
  /** The fleet's clock, seconds (shots: jump ahead to see a voyage's end). */
  advance(seconds: number): void
  stats(): { afloat: number; waiting: number; ms: number }
  dispose(): void
}

/** The ship piece and its size: Kenney's small ship, about 5.4 m stem to stern at this scale. */
export const SHIP_PIECE = "kenney-pirate/ship-small"
const SCALE = 0.38
/** How deep a sunk ship goes, metres. */
const SINK_DEPTH = 6.5

const PENNANTS = ["banner-red", "royal-blue", "gold", "teal", "orange", "purple"].map((name) => {
  const s = PALETTE.swatches.find((w) => w.name === name)
  return new Color(s?.hex ?? "#cc3333")
})

/** A pull request's pennant colour, from its key (stable). */
export function pennantOf(key: string): Color {
  return (PENNANTS[hash(key) % PENNANTS.length] as Color).clone()
}

/** Every mesh under `root` baked into one geometry (position, normal, colour), in the root's frame. */
export function bakeModel(root: Object3D): BufferGeometry {
  root.updateMatrixWorld(true)
  const inverse = new Matrix4().copy(root.matrixWorld).invert()
  const parts: BufferGeometry[] = []
  const v = new Vector3()
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return
    const src = node.geometry as BufferGeometry
    const index = src.index
    const position = src.getAttribute("position")
    const normal = src.getAttribute("normal")
    const colour = src.getAttribute("color")
    const n = index ? index.count : position.count
    // quantized attributes (meshopt) read back as floats, in the root's frame
    const toRoot = new Matrix4().multiplyMatrices(inverse, node.matrixWorld)
    const normalTo = new Matrix3().getNormalMatrix(toRoot)
    const pos = new Float32Array(n * 3)
    const nor = new Float32Array(n * 3)
    const rgb = new Float32Array(n * 3)
    for (let k = 0; k < n; k++) {
      const i = index ? index.getX(k) : k
      v.fromBufferAttribute(position, i).applyMatrix4(toRoot)
      pos.set([v.x, v.y, v.z], k * 3)
      if (normal) {
        v.fromBufferAttribute(normal, i).applyMatrix3(normalTo).normalize()
        nor.set([v.x, v.y, v.z], k * 3)
      }
      rgb.set(colour ? [colour.getX(i), colour.getY(i), colour.getZ(i)] : [0.8, 0.8, 0.8], k * 3)
    }
    const out = new BufferGeometry()
    out.setAttribute("position", new BufferAttribute(pos, 3))
    out.setAttribute("normal", new BufferAttribute(nor, 3))
    if (!normal) out.computeVertexNormals()
    out.setAttribute("color", new BufferAttribute(rgb, 3))
    parts.push(out)
  })
  const merged = parts.length ? mergeGeometries(parts) : null
  if (!merged) throw new Error("ships: the model has no meshes")
  return merged
}

/** A plain hull when the library has no ship: a boat of boxes and a sail (model units, bow +z). */
export function plainHull(): BufferGeometry {
  const g = new Boxes()
    .box([2.5, 1, 6.5], [0, 1, 0], swatch("timber"))
    .box([2, 0.5, 2], [0, 2.4, -4], swatch("timber-light"))
    .box([0.2, 6, 0.2], [0, 8, 0.5], swatch("timber-dark"))
    .box([3, 3.5, 0.1], [0, 9, 0.5], swatch("snow"))
    .geometry()
  g.deleteAttribute("tint")
  return g
}

/** Adds a pennant (a long thin triangle off the masthead, streaming aft) whose vertices take the instance colour. */
export function withPennant(geometry: BufferGeometry, length: number): BufferGeometry {
  const position = geometry.getAttribute("position")
  geometry.computeBoundingBox()
  // the masthead: the highest point
  let top = 0
  for (let i = 1; i < position.count; i++) if (position.getY(i) > position.getY(top)) top = i
  const x = position.getX(top)
  const y = position.getY(top)
  const z = position.getZ(top)
  const h = length * 0.22
  const tri = new Float32Array([x, y, z, x, y - h, z, x, y - h * 0.5, z - length])
  const pennant = new BufferGeometry()
  // both faces
  pennant.setAttribute(
    "position",
    new BufferAttribute(
      new Float32Array([...tri, ...tri.slice(0, 3), ...tri.slice(6, 9), ...tri.slice(3, 6)]),
      3,
    ),
  )
  pennant.computeVertexNormals()
  pennant.setAttribute("color", new BufferAttribute(new Float32Array(18).fill(1), 3))
  const body = geometry.clone()
  body.setAttribute("tint", new BufferAttribute(new Float32Array(position.count), 1))
  pennant.setAttribute("tint", new BufferAttribute(new Float32Array(6).fill(1), 1))
  return mergeGeometries([body, pennant]) as BufferGeometry
}

/** A point along a polyline at fraction `f` of its length, and the way it runs there (radians from +x toward +z). */
export function along(
  lane: readonly [number, number][],
  lengths: readonly number[],
  f: number,
): [number, number, number] {
  const total = lengths[lengths.length - 1] ?? 0
  const d = Math.min(total, Math.max(0, f * total))
  let i = 1
  while (i < lengths.length - 1 && (lengths[i] as number) < d) i++
  const a = lane[i - 1] as [number, number]
  const b = (lane[i] ?? a) as [number, number]
  const span = (lengths[i] as number) - (lengths[i - 1] as number) || 1
  const u = (d - (lengths[i - 1] as number)) / span
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, Math.atan2(b[1] - a[1], b[0] - a[0])]
}

export function laneLengths(lane: readonly [number, number][]): number[] {
  const out = [0]
  for (let i = 1; i < lane.length; i++) {
    const a = lane[i - 1] as [number, number]
    const b = lane[i] as [number, number]
    out.push((out[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  return out
}

export function createHarbourShips(stage: Stage, opts: HarbourShipsOpts): HarbourShips {
  const berths = opts.berths.slice(0, FLEET.MAX)
  const lengths = berths.map((b) => laneLengths(b.lane))
  const scale = opts.scale ?? SCALE
  const logs = new Map<string, ShipLog>()
  const colours = new Map<string, Color>()
  let voyages: Voyage[] = []
  let t = 0
  let seenKeys: string[] = []
  let merged: number | null = null
  let mesh: InstancedMesh | null = null
  let disposed = false
  let wakes = 0
  const costs: number[] = []
  const material = fxMaterial("ships")
  const replan = () => {
    voyages = planFleet([...logs.values()], berths.length, { close: opts.close ?? "sink" })
  }

  const build = (geometry: BufferGeometry) => {
    const g = withPennant(geometry, 6)
    const seen = new InstancedBufferAttribute(new Float32Array(FLEET.MAX), 1)
    seen.setUsage(DynamicDrawUsage)
    g.setAttribute("instanceSeen", seen)
    const m = new InstancedMesh(g, material, FLEET.MAX)
    m.name = "harbour ships"
    m.instanceMatrix.setUsage(DynamicDrawUsage)
    for (let i = 0; i < FLEET.MAX; i++) m.setColorAt(i, PENNANTS[0] as Color)
    m.count = 0
    m.frustumCulled = false
    m.castShadow = false
    m.receiveShadow = true
    return m
  }

  const ready = (async () => {
    let geometry: BufferGeometry
    try {
      if (!opts.load) throw new Error("no model")
      geometry = bakeModel(await opts.load())
    } catch {
      geometry = plainHull()
    }
    if (disposed) return
    const m = build(geometry)
    m.visible = false
    stage.scene.add(m)
    await warmPrograms(stage, m)
    if (disposed) return
    m.visible = true
    mesh = m
  })()

  const matrix = new Matrix4()
  const q = new Quaternion()
  const e = new Vector3()
  const up = new Vector3(0, 1, 0)
  const s = new Vector3()
  const p = new Vector3()
  const roll = new Quaternion()
  const pitch = new Quaternion()
  const colour = new Color()
  const flow: Wake[] = []

  const draw = () => {
    if (!mesh) return
    const seen = mesh.geometry.getAttribute("instanceSeen") as InstancedBufferAttribute
    let k = 0
    flow.length = 0
    for (const v of voyages) {
      if (t < v.start || t >= v.gone || k >= FLEET.MAX) continue
      const pose = voyagePose(v, t)
      const berth = berths[v.berth] as (typeof berths)[number]
      const [x, z, inbound] = along(berth.lane, lengths[v.berth] as number[], pose.along)
      const heading = inbound + Math.PI * pose.turn
      const phase = (hashKey(v.key) % 628) / 100
      const bob = 0.07 * Math.sin(t * 1.3 + phase) - pose.sink * SINK_DEPTH
      p.set(x, berth.at[1] + bob, z)
      // bow along the model's +z, turned to the heading
      q.setFromAxisAngle(up, Math.PI / 2 - heading)
      roll.setFromAxisAngle(e.set(0, 0, 1), 0.035 * Math.sin(t * 0.9 + phase) + 0.55 * pose.sink)
      pitch.setFromAxisAngle(e.set(1, 0, 0), 0.02 * Math.sin(t * 1.1 + phase * 1.7) + 0.2 * pose.sink)
      q.multiply(roll).multiply(pitch)
      s.setScalar(scale)
      matrix.compose(p, q, s)
      mesh.setMatrixAt(k, matrix)
      colour.copy(colours.get(v.key) ?? pennantOf(v.key)).multiplyScalar(1 + 2.5 * pose.glint)
      mesh.setColorAt(k, colour)
      seen.setX(k, pose.seen)
      if (pose.way > 0.05 && flow.length < 8)
        flow.push({ x, z, heading: pose.turn > 0.5 ? inbound + Math.PI : inbound, speed: 0.8 * pose.way })
      k++
    }
    mesh.count = k
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    seen.needsUpdate = true
    if (opts.water && (flow.length || wakes)) opts.water.setWakes(flow)
    wakes = flow.length
  }

  const off = stage.onFrame((dt) => {
    const t0 = performance.now()
    t += Math.min(dt, 0.1)
    draw()
    costs.push(performance.now() - t0)
    if (costs.length > 60) costs.shift()
  })

  const open = (key: string, o: { docked?: boolean; colour?: string } = {}) => {
    if (logs.has(key)) return
    logs.set(key, { key, opened: t, ...(o.docked ? { docked: true } : {}) })
    if (o.colour) colours.set(key, new Color(o.colour))
    replan()
  }
  const end = (key: string, how: ShipEnd) => {
    const log = logs.get(key)
    if (!log || log.ended) return
    log.ended = { at: t, how }
    replan()
  }

  return {
    ready,
    update(harbour) {
      const first = merged === null
      const { opened, ended } = harbourChanges(seenKeys, merged ?? harbour.merged, harbour)
      for (const key of opened) open(key, { docked: first })
      for (const e of ended) end(e.key, e.how)
      seenKeys = harbour.prs.map(prKey)
      merged = harbour.merged
    },
    open,
    end,
    ships: () =>
      voyages
        .filter((v) => t >= v.start && t < v.gone)
        .map((v) => {
          const berth = berths[v.berth] as (typeof berths)[number]
          const pose = voyagePose(v, t)
          const [x, z] = along(berth.lane, lengths[v.berth] as number[], pose.along)
          return {
            key: v.key,
            berth: v.berth,
            phase: pose.phase,
            at: [x, berth.at[1], z] as [number, number, number],
          }
        }),
    advance(seconds) {
      t += seconds
      draw()
    },
    stats: () => ({
      afloat: voyages.filter((v) => t >= v.start && t < v.gone).length,
      waiting: [...logs.values()].filter((l) => !l.ended && !voyages.some((v) => v.key === l.key)).length,
      ms: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0,
    }),
    dispose() {
      disposed = true
      off()
      if (opts.water && wakes) opts.water.setWakes([])
      if (mesh) {
        mesh.removeFromParent()
        mesh.geometry.dispose()
        mesh.dispose()
      }
      material.dispose()
    },
  }
}

const hashKey = (key: string) => hash(key) >>> 0
