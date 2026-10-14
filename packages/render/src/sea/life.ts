/**
 * The sea's life drawn (plan.ts says where everything is): every hull in one instanced draw, the
 * ghost ship in its own, and the glows (the lamp, the ghost's wisps and mist, the galleon's sparks) in
 * one more, the lighthouse's beam a fourth. At rest (merchants and the quay's rowboat) that is one
 * draw. Nothing here casts a shadow (the shadow map stays as it is), everything fades in and out with
 * the FX's dither or its own alpha, and nothing is culled, so nothing pops at any distance.
 *
 * One draw for six different hulls: their models are baked side by side into one geometry, each
 * vertex marked with its hull (and a cargo ship's crates with their slot), and the vertex shader folds
 * away every vertex not of the instance's hull (to one point: no triangle drawn) and the crates past
 * its load. Two clocks: the merchants and the swell run on wall time, the voyages and the shows on the
 * sea's clock (ms), which a session sets (`sync`) and which otherwise runs at `rate`.
 */

import type { CiState } from "@guildhall/core"
import type { SeaRing } from "@guildhall/world"
import {
  AddEquation,
  AdditiveBlending,
  BufferAttribute,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CustomBlending,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from "three"
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { fxMaterial, swatch } from "../events/fxMaterial.ts"
import { bakeModel } from "../events/ships.ts"
import type { DayLight } from "../light.ts"
import type { Stage } from "../stage.ts"
import { warmPrograms } from "../warm.ts"
import { roundedPath } from "./course.ts"
import {
  anchorage,
  cargoPose,
  cargoStarts,
  galleonPose,
  ghostPose,
  type Hull,
  lampOf,
  merchants,
  mooredBoat,
  type Path,
  type Point,
  type Push,
  raidPose,
  SEA,
  type SeaShow,
  type ShipPose,
} from "./plan.ts"
import type { Mooring, SeaSites } from "./sites.ts"
import { attitudeOf, FEEL, type HullFeel } from "./swell.ts"

/** Each hull: the model it is (an index into MODELS), its size (metres per model unit) and how deep it sits (model units). */
const HULLS: Record<
  Exclude<Hull, "ghost">,
  { model: number; scale: number; draft: number; extras: number; feel: HullFeel; sails: boolean }
> = {
  "merchant-large": { model: 0, scale: 0.44, draft: 0.9, extras: 0, feel: FEEL.large, sails: true },
  "merchant-medium": { model: 1, scale: 0.42, draft: 0.9, extras: 0, feel: FEEL.medium, sails: true },
  cargo: { model: 2, scale: 0.4, draft: 0.8, extras: 0, feel: FEEL.small, sails: true },
  galleon: { model: 5, scale: 0.54, draft: 0.9, extras: 7, feel: FEEL.galleon, sails: true },
  pirate: { model: 3, scale: 0.48, draft: 0.9, extras: 0, feel: FEEL.medium, sails: true },
  rowboat: { model: 4, scale: 0.46, draft: 0.25, extras: 0, feel: FEEL.rowboat, sails: false },
}
/** The hulls' models; the galleon (5) is the large ship again, its sails and flags in its own colour. */
const MODELS = [
  "kenney-pirate/ship-large",
  "kenney-pirate/ship-medium",
  "kenney-pirate/ship-small",
  "kenney-pirate/ship-pirate-medium",
  "kenney-pirate/boat-row-small",
] as const
const GALLEON_MODEL = 5
/** The galleon's sails: a release flies the palette's gold. */
const GALLEON_SAILS = "gold"
const GHOST = { piece: "kenney-pirate/ship-ghost", scale: 0.5, draft: 0.9 }
/**
 * What rides on a hull (model units, bow +z; the decks read off the models): a cargo ship's crates
 * (slots 1-6, as many as its commits), the galleon's gold on its main deck (slot 7).
 */
const CRATE = "kenney-pirate/crate"
/** Before the mast, four on the deck and two stacked on them (x, z, layer). */
const CRATE_SPOTS: readonly [number, number, number][] = [
  [-0.85, 0.5, 0],
  [0.85, 0.6, 0],
  [-0.85, 2.1, 0],
  [0.85, 2.2, 0],
  [-0.4, 1.3, 1],
  [0.45, 1.4, 1],
]
const CRATE_SIZE = 1.5
/** The goods the crates carry, a colour each, so a cargo ship reads from afar (the hull is the harbour ships' own). */
const GOODS = ["banner-red", "royal-blue", "gold", "teal", "orange", "purple"]
const DECK = { small: 3.4, large: 3.4 }
const GOLD = "kaykit-resources/gold-bars"
export const SEA_PIECES = [...MODELS, GHOST.piece, CRATE, GOLD] as const

const MAX_SHIPS = 16
const MAX_GLOWS = 80

export interface SeaLifeOpts {
  sites: SeaSites
  load: (id: string) => Promise<Object3D>
  /** Points the quay's rowboat and the cargo's loading keep off (the harbour ships' berths, xz). */
  keepOff?: readonly (readonly [number, number])[]
  /** The day's light: the lamp and the beam glow brighter by night. */
  light?: () => DayLight
}

export interface SeaView {
  ships: { hull: Hull; key: string; at: [number, number]; seen: number }[]
  lamp: { state: CiState | null; glow: number } | null
  sparks: boolean
}

export interface SeaLife {
  ready: Promise<void>
  /** The sea's clock, ms. */
  now(): number
  /**
   * A session's clock (ms) and rate: the sea's clock lands on `at` when it has drifted from it (a seek,
   * a start), and runs at `rate` between reads.
   */
  sync(at: number, rate?: number): void
  setRate(rate: number): void
  rate(): number
  /** Moves the sea's clock (and the wall's, so the merchants sail on too), seconds. */
  advance(seconds: number): void
  /** The merchants sailing their laps and the rowboat at the quay (on by default). */
  setAmbient(on: boolean): void
  /** A push: its cargo ship casts off at `at` (default now), a crate a commit. */
  push(opts?: { at?: number; commits?: number; key?: string }): void
  /** A release: the galleon sails in at `at` (default now). */
  release(opts?: { at?: number; key?: string }): void
  /** The world's shows (Task A's `Show`): the ghost ship's and the raid's are drawn, the rest let be. */
  setShows(shows: readonly SeaShow[]): void
  /** The newest CI run's state (null: no run, the lamp dark) and since when (ms, default now). */
  setLighthouse(state: CiState | null, since?: number): void
  /** Forgets the pushes and releases (a new log): nothing sails for them again. */
  reset(): void
  /** What is on the water now. */
  view(): SeaView
  stats(): { ms: number; ships: number; glows: number; draws: number }
  dispose(): void
}

export function createSeaLife(stage: Stage, opts: SeaLifeOpts): SeaLife {
  const { sites } = opts
  // the routes with their corners rounded: every hull turns on a curve
  const laps: Path[] = sites.laps.map((ring) => roundedPath(ring.points, true))
  const keepOff = opts.keepOff ?? []
  const clearOf = (m: Mooring) =>
    keepOff.length ? Math.min(...keepOff.map(([x, z]) => Math.hypot(x - m.at[0], z - m.at[1]))) : 99
  // the quay's rowboat where it is clearest of the berths; the cargo loads at the next clearest
  const byClear = [...sites.moorings].sort((a, b) => clearOf(b) - clearOf(a))
  const quay = byClear[0] ?? null
  const loading = sites.moorings.find((m) => m !== quay && clearOf(m) > 4) ?? byClear[1] ?? quay
  const lane = loading ? roundedPath(loading.lane) : null
  const raidLane = lane
  const centre: Point = (sites.laps[0] as SeaRing | undefined)?.centre ?? [0, 0]
  const harbourBearing = loading ? Math.atan2(loading.at[1] - centre[1], loading.at[0] - centre[0]) : 0
  const anchor = sites.laps.length ? anchorage(sites.laps, harbourBearing) : null

  let now = 0
  let wall = 0
  let rate = 1
  let ambient = true
  let pushes: Push[] = []
  let releases: { key: string; at: number }[] = []
  let shows: readonly SeaShow[] = []
  let ci: { state: CiState | null; since: number } = { state: null, since: 0 }
  let pushN = 0
  let disposed = false
  const costs: number[] = []

  // ---- the meshes, built once the models are in ----
  let fleet: InstancedMesh | null = null
  let ghost: Mesh | null = null
  let ghostMaterial: MeshStandardMaterial | null = null
  const ghostFade = { value: 0 }
  /** The swell's clock for the sails' work in the wind. */
  const seaTime = { value: 0 }
  const ghostTime = { value: 0 }
  const glows = glowMesh()
  const beam = beamMesh()
  glows.mesh.visible = false
  beam.mesh.visible = false
  stage.scene.add(glows.mesh, beam.mesh)

  const ready = (async () => {
    const loaded = await Promise.all(
      SEA_PIECES.map((id) =>
        opts
          .load(id)
          .then((o) => bakeModel(o))
          .catch(() => null),
      ),
    )
    if (disposed) return
    const geo = (id: (typeof SEA_PIECES)[number]) => loaded[SEA_PIECES.indexOf(id)] ?? null
    const parts: BufferGeometry[] = []
    /** A model (or a load on one) marked with its hull and slot; `sails`: its pale cloth takes the instance's colour. */
    const mark = (
      g: BufferGeometry,
      model: number,
      slot: number,
      at?: Matrix4,
      sails = false,
      paint?: readonly [number, number, number],
    ) => {
      const c = g.clone()
      if (at) c.applyMatrix4(at)
      const n = c.getAttribute("position").count
      // a load painted (a crate's goods): its colours drawn toward the paint, keeping their shading
      const rgb0 = c.getAttribute("color")
      if (paint && rgb0)
        for (let i = 0; i < n; i++) {
          const l = (rgb0.getX(i) + rgb0.getY(i) + rgb0.getZ(i)) / 3
          const k = 0.7
          rgb0.setXYZ(
            i,
            rgb0.getX(i) * (1 - k) + paint[0] * (0.6 + l) * k,
            rgb0.getY(i) * (1 - k) + paint[1] * (0.6 + l) * k,
            rgb0.getZ(i) * (1 - k) + paint[2] * (0.6 + l) * k,
          )
        }
      c.setAttribute("part", new BufferAttribute(new Float32Array(n).fill(model * 8 + slot), 1))
      const tint = new Float32Array(n)
      const rgb = c.getAttribute("color")
      if (sails && rgb)
        for (let i = 0; i < n; i++) tint[i] = Math.min(rgb.getX(i), rgb.getY(i), rgb.getZ(i)) > 0.5 ? 1 : 0
      c.setAttribute("tint", new BufferAttribute(tint, 1))
      // the sails: pale cloth above the deck, weighted up the mast (the wind works the canvas, not the hull)
      const cloth = new Float32Array(n)
      const pos = c.getAttribute("position")
      if (rgb && slot === 0)
        for (let i = 0; i < n; i++)
          if (Math.min(rgb.getX(i), rgb.getY(i), rgb.getZ(i)) > 0.5)
            cloth[i] = Math.min(1, Math.max(0, (pos.getY(i) - 4.5) / 7))
      c.setAttribute("cloth", new BufferAttribute(cloth, 1))
      parts.push(c)
    }
    MODELS.forEach((id, k) => {
      const g = geo(id)
      if (g) mark(g, k, 0)
    })
    const large = geo(MODELS[0])
    if (large) mark(large, GALLEON_MODEL, 0, undefined, true)
    const crate = geo(CRATE)
    if (crate)
      for (const [k, [x, z, layer]] of CRATE_SPOTS.entries())
        mark(
          crate,
          2,
          k + 1,
          new Matrix4()
            .makeRotationY((hash01(k * 7 + 1) - 0.5) * 0.4)
            .scale(new Vector3(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE))
            .setPosition(x, DECK.small + layer * 0.77 * CRATE_SIZE, z),
          false,
          swatch(GOODS[k % GOODS.length] as string),
        )
    const gold = geo(GOLD)
    if (gold)
      for (const [x, z, turn] of [
        [-0.9, 1.4, 0.2],
        [0.9, 1.6, -0.3],
      ] as const)
        mark(
          gold,
          GALLEON_MODEL,
          7,
          new Matrix4()
            .makeRotationY(turn)
            .scale(new Vector3(1.5, 1.5, 1.5))
            .setPosition(x, DECK.large, z),
        )
    if (parts.length) {
      // indexed: a corner shared by its faces is shaded once (the folded-away hulls cost their vertices only)
      const merged = mergeVertices(mergeGeometries(parts) as BufferGeometry)
      for (const p of parts) p.dispose()
      const seen = new InstancedBufferAttribute(new Float32Array(MAX_SHIPS), 1)
      seen.setUsage(DynamicDrawUsage)
      merged.setAttribute("instanceSeen", seen)
      const hull = new InstancedBufferAttribute(new Float32Array(MAX_SHIPS * 2), 2)
      hull.setUsage(DynamicDrawUsage)
      merged.setAttribute("instanceHull", hull)
      const m = new InstancedMesh(merged, fxMaterial("sea-fleet", { patch: fleetPatch(seaTime) }), MAX_SHIPS)
      const sails = new Color(...swatch(GALLEON_SAILS))
      for (let i = 0; i < MAX_SHIPS; i++) m.setColorAt(i, sails)
      m.name = "sea fleet"
      m.instanceMatrix.setUsage(DynamicDrawUsage)
      m.count = 0
      m.frustumCulled = false
      m.castShadow = false
      m.receiveShadow = true
      m.visible = false
      fleet = m
      stage.scene.add(m)
    }
    const g = geo(GHOST.piece)
    if (g) {
      ghostMaterial = spectral(ghostFade, ghostTime)
      ghost = new Mesh(g, ghostMaterial)
      ghost.name = "sea ghost"
      ghost.castShadow = false
      ghost.receiveShadow = false
      ghost.frustumCulled = false
      ghost.renderOrder = 5
      ghost.matrixAutoUpdate = false
      ghost.visible = false
      stage.scene.add(ghost)
    }
    await Promise.all(
      [fleet, ghost, glows.mesh, beam.mesh]
        .filter((m): m is Mesh => m !== null)
        .map((m) => warmPrograms(stage, m)),
    )
  })()
  let warm = false
  void ready.then(() => {
    warm = true
  })

  // ---- what is on the water ----
  const poses = (): { ships: ShipPose[]; sparks: { x: number; z: number; u: number } | null } => {
    const ships: ShipPose[] = []
    if (ambient) {
      ships.push(...merchants(laps, wall))
      if (quay) ships.push(mooredBoat(quay))
    }
    if (lane)
      for (const { push, start } of cargoStarts(pushes)) {
        const p = cargoPose(lane, push.key, push.commits, (now - start) / 1000)
        if (p) ships.push(p)
      }
    let sparks: { x: number; z: number; u: number } | null = null
    const last = releases[releases.length - 1]
    if (anchor && last) {
      const g = galleonPose(anchor, last.key, (now - last.at) / 1000)
      if (g) {
        ships.push(g.pose)
        if (g.sparks !== null) sparks = { x: g.pose.x, z: g.pose.z, u: g.sparks }
      }
    }
    for (const show of shows) {
      const age = (now - show.start) / 1000
      const left =
        show.end !== undefined && Number.isFinite(show.end) && now >= show.end
          ? (now - show.end) / 1000
          : null
      if (show.kind === "ghostship" && laps.length) {
        const near = show.params?.near
        const bearing = near ? Math.atan2(near[1] - centre[1], near[0] - centre[0]) : harbourBearing + 0.5
        const p = ghostPose(laps[0] as Path, centre, bearing, age, left)
        if (p) ships.push(p)
      } else if (show.kind === "raid" && raidLane) {
        const r = raidPose(raidLane, age, left)
        if (r.ship) ships.push(r.ship)
        if (r.boat) ships.push(r.boat)
      }
    }
    return { ships, sparks }
  }

  // ---- drawing ----
  const matrix = new Matrix4()
  const q = new Quaternion()
  const roll = new Quaternion()
  const pitch = new Quaternion()
  const axis = new Vector3()
  const up = new Vector3(0, 1, 0)
  const p = new Vector3()
  const s = new Vector3()
  const colour = new Color()

  const shipMatrix = (
    pose: ShipPose,
    scale: number,
    draft: number,
    phase: number,
    feel: HullFeel,
    sails: boolean,
  ) => {
    // the quay's rowboat is tied up short; a ship at anchor swings on a long cable
    const a = attitudeOf(pose, feel, wall, phase, { sails, reach: pose.key === "quay-boat" ? 0.3 : 1 })
    p.set(a.x, sites.sea - draft * scale + a.heave, a.z)
    q.setFromAxisAngle(up, Math.PI / 2 - a.heading)
    roll.setFromAxisAngle(axis.set(0, 0, 1), a.roll)
    pitch.setFromAxisAngle(axis.set(1, 0, 0), a.pitch)
    q.multiply(roll).multiply(pitch)
    s.setScalar(scale)
    return matrix.compose(p, q, s)
  }

  let shipsDrawn = 0
  let glowsDrawn = 0
  let lastLamp = 0
  let sparksOn = false
  const draw = () => {
    seaTime.value = wall
    const { ships, sparks } = poses()
    sparksOn = sparks !== null
    let k = 0
    let g = 0
    /** A glow at (x, y, z), w by h metres, its colour and alpha; `solid` 1 covers what is behind (a lamp's glass), 0 adds light. */
    const put = (x: number, y: number, z: number, w: number, h: number, c: Color, a: number, solid = 0) => {
      if (g >= MAX_GLOWS || a <= 0.003) return
      glows.centre.setXYZ(g, x, y, z)
      glows.size.setXYZ(g, w, h, solid)
      glows.colour.setXYZW(g, c.r, c.g, c.b, a)
      g++
    }
    let ghostPoseNow: ShipPose | null = null
    if (fleet) {
      const seen = fleet.geometry.getAttribute("instanceSeen") as InstancedBufferAttribute
      const hulls = fleet.geometry.getAttribute("instanceHull") as InstancedBufferAttribute
      for (const pose of ships) {
        if (pose.hull === "ghost") {
          ghostPoseNow = pose
          continue
        }
        if (k >= MAX_SHIPS || pose.seen <= 0.002) continue
        const h = HULLS[pose.hull]
        fleet.setMatrixAt(k, shipMatrix(pose, h.scale, h.draft, phaseOf(pose.key), h.feel, h.sails))
        seen.setX(k, pose.seen)
        hulls.setXY(k, h.model, pose.hull === "cargo" ? pose.crates : h.extras)
        k++
      }
      fleet.count = k
      fleet.instanceMatrix.needsUpdate = true
      seen.needsUpdate = true
      hulls.needsUpdate = true
      fleet.visible = warm && k > 0
    } else ghostPoseNow = ships.find((x) => x.hull === "ghost") ?? null
    shipsDrawn = k

    // the ghost: its hull, its halo, its mist and its wisps
    if (ghost && ghostMaterial) {
      const pose = ghostPoseNow
      ghost.visible = warm && pose !== null
      if (pose) {
        ghost.matrix.copy(shipMatrix(pose, GHOST.scale, GHOST.draft, 3.1, FEEL.ghost, false))
        ghost.matrixWorld.copy(ghost.matrix)
        ghostFade.value = pose.seen
        ghostTime.value = wall
        const ch = Math.cos(pose.heading)
        const sh = Math.sin(pose.heading)
        const at = (along: number, across: number): [number, number] => [
          pose.x + ch * along - sh * across,
          pose.z + sh * along + ch * across,
        ]
        const [hx, hz] = at(0, 0)
        put(hx, 3, hz, 18, 14, colour.setRGB(0.25, 1, 0.6), 0.28 * pose.seen)
        for (let i = 0; i < 10; i++) {
          const t = wall * (0.2 + hash01(i * 3) * 0.2) + hash01(i) * 40
          const [mx, mz] = at(
            (hash01(i * 5) - 0.5) * 12 + Math.sin(t) * 1.5,
            (hash01(i * 7) - 0.5) * 7 + Math.cos(t) * 1.2,
          )
          put(
            mx,
            0.6 + hash01(i * 11) * 0.8,
            mz,
            6 + hash01(i * 13) * 5,
            2.6,
            colour.setRGB(0.45, 0.85, 0.65),
            0.32 * pose.seen * (0.6 + 0.4 * Math.sin(t * 1.3)),
          )
        }
        for (let i = 0; i < 12; i++) {
          const t = wall * (0.5 + hash01(i * 17) * 0.5) + hash01(i * 19) * 40
          const [wx, wz] = at(
            (hash01(i * 23) - 0.5) * 7 + Math.cos(t * 0.8) * 0.7,
            (hash01(i * 29) - 0.5) * 3 + Math.sin(t) * 0.6,
          )
          const size = 0.7 + 0.4 * hash01(i * 31)
          put(
            wx,
            1.5 + hash01(i * 37) * 4 + Math.sin(t * 1.7) * 0.4,
            wz,
            size,
            size,
            colour.setRGB(0.6, 1.6, 1),
            pose.seen * (0.55 + 0.45 * Math.sin(t * 3)),
          )
        }
      }
    }

    // the galleon's sparks: three bursts thrown up over it as it drops anchor
    if (sparks) {
      for (let b = 0; b < 3; b++) {
        const t = sparks.u * SEA.SPARKS_S - b * 0.9
        const life = SEA.SPARKS_S - 1.8
        if (t < 0 || t > life) continue
        const cx = sparks.x + (hash01(b * 31) - 0.5) * 4
        const cz = sparks.z + (hash01(b * 57) - 0.5) * 4
        const fade = 1 - t / life
        for (let i = 0; i < 14; i++) {
          const n = b * 14 + i
          const a = hash01(n * 3) * Math.PI * 2
          const lift = 0.4 + hash01(n * 5) * 0.6
          const speed = 5 + hash01(n * 11) * 3
          const r = speed * Math.min(t, 1) * Math.sqrt(1.2 - lift * lift)
          colour.set(FESTIVE[n % FESTIVE.length] as number).multiplyScalar(1.8)
          const size = 0.6 + 0.6 * fade
          put(
            cx + Math.cos(a) * r,
            7.5 + speed * lift * t - 2.4 * t * t,
            cz + Math.sin(a) * r,
            size,
            size,
            colour,
            0.9 * fade,
          )
        }
      }
    }

    // the lighthouse: its lamp and its beam
    beam.mesh.visible = false
    const lh = sites.lighthouse
    if (lh) {
      const lamp = lampOf(ci.state, ci.since, now)
      lastLamp = lamp.glow
      if (lamp.glow > 0) {
        const night = opts.light?.().lamps ?? 0
        const [lx, ly, lz] = lh.lamp
        colour.setRGB(...lamp.colour)
        // the glass, lit (it covers the lantern, so it reads by day), and its halo
        put(lx, ly, lz, 1.3, 1.3, colour.clone().multiplyScalar(0.6 + 1.6 * lamp.glow), 1, 1)
        put(lx, ly, lz, 4.5 + 2 * night, 4.5 + 2 * night, colour, (0.35 + 0.45 * night) * lamp.glow)
        beam.mesh.position.set(lx, ly, lz)
        beam.mesh.rotation.set(0, Math.PI / 2 - (lamp.beam ?? lh.seaward), 0)
        beam.material.color.copy(colour)
        beam.material.opacity = lamp.glow * (0.16 + 0.26 * night)
        beam.mesh.visible = warm
      }
    }
    glows.geometry.instanceCount = g
    glows.centre.needsUpdate = true
    glows.size.needsUpdate = true
    glows.colour.needsUpdate = true
    glows.mesh.visible = warm && g > 0
    glowsDrawn = g
  }

  const off = stage.onFrame((dt) => {
    const t0 = performance.now()
    const step = Math.min(dt, 0.1)
    wall += step
    now += step * 1000 * rate
    draw()
    costs.push(performance.now() - t0)
    if (costs.length > 60) costs.shift()
  })

  const life: SeaLife = {
    ready,
    now: () => now,
    sync(at, r) {
      if (r !== undefined) life.setRate(r)
      if (Math.abs(at - now) > 1000) now = at
    },
    setRate(r) {
      rate = Math.max(0, Number.isFinite(r) ? r : 1)
    },
    rate: () => rate,
    advance(seconds) {
      now += seconds * 1000
      wall += seconds
      draw()
    },
    setAmbient(on) {
      ambient = on
    },
    push(o = {}) {
      pushN++
      pushes.push({ key: o.key ?? `push-${pushN}`, at: o.at ?? now, commits: o.commits ?? 3 })
      // the voyages long over are forgotten
      const keep = now - (SEA.CARGO_S + SEA.CARGO_GAP_S * 8) * 1000
      if (pushes.length > 24) pushes = pushes.filter((x) => x.at > keep).slice(-24)
    },
    release(o = {}) {
      const key = o.key ?? `release-${releases.length + 1}`
      if (releases.some((r) => r.key === key)) return
      releases.push({ key, at: o.at ?? now })
      releases.sort((a, b) => a.at - b.at)
      if (releases.length > 8) releases = releases.slice(-8)
    },
    setShows(list) {
      shows = list
    },
    setLighthouse(state, since) {
      if (state === ci.state && since === undefined) return
      ci = { state, since: since ?? now }
    },
    reset() {
      pushes = []
      releases = []
    },
    view: () => ({
      ships: poses().ships.map((x) => ({
        hull: x.hull,
        key: x.key,
        at: [x.x, x.z] as [number, number],
        seen: x.seen,
      })),
      lamp: sites.lighthouse ? { state: ci.state, glow: lastLamp } : null,
      sparks: sparksOn,
    }),
    stats: () => ({
      ms: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0,
      ships: shipsDrawn,
      glows: glowsDrawn,
      draws: [fleet, ghost, glows.mesh, beam.mesh].filter((m) => m?.visible).length,
    }),
    dispose() {
      disposed = true
      off()
      for (const m of [fleet, ghost, glows.mesh, beam.mesh]) {
        if (!m) continue
        m.removeFromParent()
        m.geometry.dispose()
        ;(m.material as MeshBasicMaterial).dispose()
      }
    },
  }
  return life
}

const FESTIVE = [0xffd34d, 0xff5a5a, 0x5ad1ff, 0x9dff6a, 0xff8ae2, 0xffffff]

/** A stable 0 … 1 from an integer. */
const hash01 = (n: number): number => {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const phaseOf = (key: string) => {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return (h % 628) / 100
}

/**
 * The fleet's own shader part (fxMaterial `patch`): a vertex not of the instance's hull (`part` /
 * 8, against `instanceHull.x`) or a load past its count (`part` % 8, against `instanceHull.y`) folds
 * to the origin, so its triangles are drawn as nothing.
 */
const fleetPatch = (time: { value: number }) => (shader: WebGLProgramParametersWithUniforms) => {
  shader.uniforms.uSeaTime = time
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      "#include <common>\nattribute float part;\nattribute float cloth;\nattribute vec2 instanceHull;\nuniform float uSeaTime;",
    )
    .replace(
      "#include <begin_vertex>",
      `vec3 transformed = vec3( position );
// the sails fill and work in the wind, each ship in its own time (from where it is)
if ( cloth > 0.0 ) {
  float ph = dot( instanceMatrix[ 3 ].xz, vec2( 0.37, 0.23 ) );
  float w = sin( uSeaTime * 1.7 + ph + position.y * 0.45 ) + 0.5 * sin( uSeaTime * 2.9 + ph * 1.3 + position.x * 0.6 );
  transformed.z += cloth * ( 0.22 + 0.12 * w );
  transformed.x += cloth * 0.07 * w;
}
float hullOf = floor( part / 8.0 + 0.01 );
float slotOf = part - hullOf * 8.0;
if ( abs( hullOf - instanceHull.x ) > 0.5 || slotOf > instanceHull.y + 0.5 ) transformed = vec3( 0.0 );`,
    )
}

/** The ghost ship's look: the palette's colours drained to a sea green, a glowing rim, half there, fading into the water below. */
function spectral(fade: { value: number }, time: { value: number }): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    color: new Color(0.35, 0.55, 0.48),
    emissive: new Color(0.03, 0.16, 0.11),
    roughness: 0.9,
    transparent: true,
    depthWrite: true,
  })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFade = fade
    shader.uniforms.uTime = time
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vHullY;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvHullY = position.y;")
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uFade;\nuniform float uTime;\nvarying float vHullY;",
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
float rim = pow( 1.0 - abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) ), 2.0 );
totalEmissiveRadiance += vec3( 0.3, 1.0, 0.68 ) * ( rim * 1.8 + 0.22 ) * ( 0.85 + 0.2 * sin( uTime * 1.7 ) );`,
      )
      .replace(
        "#include <opaque_fragment>",
        `diffuseColor.a *= uFade * 0.82 * smoothstep( 0.2, 2.6, vHullY );
#include <opaque_fragment>`,
      )
  }
  material.customProgramCacheKey = () => "guildhall-sea-ghost"
  return material
}

/** The glows: soft discs facing the camera, one instanced draw, additive. */
function glowMesh() {
  const geometry = new InstancedBufferGeometry()
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3),
  )
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  const centre = new InstancedBufferAttribute(new Float32Array(MAX_GLOWS * 3), 3)
  const size = new InstancedBufferAttribute(new Float32Array(MAX_GLOWS * 3), 3)
  const colour = new InstancedBufferAttribute(new Float32Array(MAX_GLOWS * 4), 4)
  for (const a of [centre, size, colour]) a.setUsage(DynamicDrawUsage)
  geometry.setAttribute("aCentre", centre)
  geometry.setAttribute("aSize", size)
  geometry.setAttribute("aColour", colour)
  geometry.instanceCount = 0
  const material = new ShaderMaterial({
    vertexShader: /* glsl */ `
attribute vec3 aCentre;
attribute vec3 aSize;
attribute vec4 aColour;
varying vec2 vUv;
varying vec4 vColour;
varying float vSolid;
void main() {
  vUv = position.xy;
  vColour = aColour;
  vSolid = aSize.z;
  vec4 mv = viewMatrix * vec4( aCentre, 1.0 );
  mv.xy += position.xy * aSize.xy;
  // a solid disc (a lamp's glass) stands a little toward the eye, clear of the lantern round it
  mv.z += aSize.z * 0.9;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */ `
varying vec2 vUv;
varying vec4 vColour;
varying float vSolid;
void main() {
  float d = length( vUv ) * 2.0;
  // a glow falls off softly; a solid disc keeps a crisp rim
  float a = vSolid > 0.5 ? 1.0 - smoothstep( 0.8, 1.0, d ) : pow( 1.0 - smoothstep( 0.0, 1.0, d ), 2.0 );
  a *= vColour.a;
  if ( a < 0.003 ) discard;
  // premultiplied: a glow adds its light, a solid disc covers what lies behind it
  gl_FragColor = vec4( vColour.rgb * a, a * vSolid );
}`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    fog: false,
    toneMapped: false,
  })
  const mesh = new Mesh(geometry, material)
  mesh.name = "sea glows"
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.renderOrder = 8
  return { mesh, geometry, centre, size, colour }
}

/** The lighthouse's beam: a long open cone from the lamp out along +x of its turn, bright at the lamp, gone at its end. */
function beamMesh() {
  const LENGTH = 46
  const cone = new ConeGeometry(5, LENGTH, 20, 6, true)
  cone.translate(0, -LENGTH / 2, 0)
  const pos = cone.getAttribute("position")
  const fade = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) fade.fill((1 + pos.getY(i) / LENGTH) ** 2, i * 3, i * 3 + 3)
  cone.setAttribute("color", new Float32BufferAttribute(fade, 3))
  // along +z from the tip, dipping a little toward the sea
  cone.rotateX(-Math.PI / 2 + 0.07)
  const material = new MeshBasicMaterial({
    color: 0xffd9a0,
    transparent: true,
    opacity: 0.2,
    blending: AdditiveBlending,
    vertexColors: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  })
  const mesh = new Mesh(cone, material)
  mesh.name = "sea beam"
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.renderOrder = 7
  return { mesh, material }
}
