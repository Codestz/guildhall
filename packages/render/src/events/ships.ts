/**
 * The harbour's pull-request ships (plan-hud-events §2 "PRs: a ship docks at the harbour with a
 * pennant"): the fleet's plan (fleet.ts) drawn as one instanced mesh, a library ship (Kenney's small
 * ship, in the house style) with a pennant at its masthead in the pull request's colour. Every ship is
 * one draw together; they fade in from the open sea and out to it with a dither (no pop at any
 * distance), bob at their berths and leave wakes on the water while they move. A merged ship dips its
 * pennant and a gold flare bursts over its masthead at the berth (in the same draw: its vertices lie
 * on one point until the flare spreads them), then its pennant glints as it casts off; a closed one
 * lists, settles and sinks, churning the water. Voyages run at the session clock's rate (`setRate`).
 * They cast no shadows (as the crowd and the doors).
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
  type MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { courseAt, roundedPath } from "../sea/course.ts"
import { motionOf, type Path, prHull } from "../sea/plan.ts"
import { attitudeOf, FEEL, type HullFeel } from "../sea/swell.ts"
import type { Stage } from "../stage.ts"
import { warmPrograms } from "../warm.ts"
import type { Wake, Water } from "../water.ts"
import { smooth01 } from "./ease.ts"
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
  /**
   * A ship's model by its library piece (`PR_PIECES`: a pull request's hull by the size of its diff);
   * every one rejected or absent: a plain stylised hull.
   */
  load?: (piece: string) => Promise<Object3D>
  /** The water, for the wakes. */
  water?: Water | null
  /** Metres per model unit. */
  scale?: number
  /** A closed pull request's ship sinks at its berth (default) or sails off. */
  close?: "sink" | "sail"
}

export interface ShipView {
  key: string
  /** Its library piece (`PR_PIECES`). */
  piece: string
  berth: number
  phase: ReturnType<typeof voyagePose>["phase"]
  at: [number, number, number]
}

export interface HarbourShips {
  /** Resolves once the ship's model is loaded and its program linked. */
  ready: Promise<void>
  /** Reads a harbour (sim `harbourOf`): new pull requests sail in, vanished ones leave (merged or closed by the count). */
  update(harbour: HarbourReading): void
  /**
   * Forgets the fleet (a jump on the session's clock, a new log): the next `update` finds its pull
   * requests already docked, so a scrub never sails or sinks a ship.
   */
  reset(): void
  /**
   * A pull request opened now (`docked`: already there, no sail in); `colour` its pennant's, `lines` its
   * diff's size (lines added and removed: its hull, `prHull`; unknown, the small ship).
   */
  open(key: string, opts?: { docked?: boolean; colour?: string; lines?: number }): void
  /** A pull request merged or closed now. */
  end(key: string, how: ShipEnd): void
  /** The ships on the water now. */
  ships(): ShipView[]
  /**
   * How fast the fleet's voyages run against real time: the session clock's rate (a replay at 4× sails
   * them 4× as fast; paused, 0, they hold where they are). The swell always runs at 1.
   */
  setRate(rate: number): void
  rate(): number
  /** The fleet's clock, seconds (shots: jump ahead to see a voyage's end). */
  advance(seconds: number): void
  /** `tris`: the triangles its draw really shows (each instance's own hull, not every hull it carries). */
  stats(): { afloat: number; waiting: number; ms: number; tris: number }
  dispose(): void
}

/**
 * A pull request's hulls (`prHull`, by its diff): Kenney's small, medium and large ships, drawn in one
 * instanced draw (each instance folds away the hulls it is not).
 */
export const PR_PIECES = [
  "kenney-pirate/ship-small",
  "kenney-pirate/ship-medium",
  "kenney-pirate/ship-large",
] as const
/** The ship piece of a pull request whose size is unknown, and its size: about 5.4 m stem to stern. */
export const SHIP_PIECE = PR_PIECES[0]
const SCALE = 0.38
/** Each hull's ride on the swell. */
const FEELS: readonly HullFeel[] = [FEEL.small, FEEL.medium, FEEL.large]
/** How deep a sunk ship goes, metres. */
const SINK_DEPTH = 6.5
/** The pennant's length, model units. */
const PENNANT = 6

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

/** The flare's rays (long and short in turn) and sparkles, metres on the screen's plane. */
const RAYS = 8
const RAY_LONG = 2.6
const RAY_SHORT = 1.5
const SPARKS = 7

/**
 * The merge's flare, all its vertices at the masthead `at` (model units): a gold star of rays round a
 * hexagonal core, and sparkles round it. `burst` (offset x, y and, for a sparkle, its centre's way x,
 * y; metres on the screen's plane) and `burstKind` (1 core, 2 a ray, 3 a sparkle) say where the vertex
 * shader spreads each one while the instance's flare runs; at rest they all lie on one point (nothing
 * drawn).
 */
export function flareGeometry(at: readonly [number, number, number]): BufferGeometry {
  const burst: number[] = []
  const kind: number[] = []
  const tri = (k: number, ...corners: [number, number, number, number][]) => {
    for (const c of corners) {
      burst.push(...c)
      kind.push(k)
    }
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const b = ((i + 1) / 6) * Math.PI * 2
    tri(
      1,
      [0, 0, 0, 0],
      [Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0, 0],
      [Math.cos(b) * 0.6, Math.sin(b) * 0.6, 0, 0],
    )
  }
  for (let i = 0; i < RAYS; i++) {
    const a = (i / RAYS) * Math.PI * 2 + Math.PI / RAYS
    const length = i % 2 ? RAY_SHORT : RAY_LONG
    const w = i % 2 ? 0.14 : 0.2
    const [dx, dy] = [Math.cos(a), Math.sin(a)]
    tri(2, [-dy * w, dx * w, 0, 0], [dy * w, -dx * w, 0, 0], [dx * length, dy * length, 0, 0])
  }
  for (let i = 0; i < SPARKS; i++) {
    const a = (i / SPARKS) * Math.PI * 2 + 0.4
    const [cx, cy] = [Math.cos(a), Math.sin(a)]
    const s = 0.32
    tri(3, [0, s, cx, cy], [-s * 0.6, 0, cx, cy], [s * 0.6, 0, cx, cy])
    tri(3, [0, -s, cx, cy], [s * 0.6, 0, cx, cy], [-s * 0.6, 0, cx, cy])
  }
  const n = kind.length
  const g = new BufferGeometry()
  const pos = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) pos.set(at, i * 3)
  g.setAttribute("position", new BufferAttribute(pos, 3))
  g.setAttribute(
    "normal",
    new BufferAttribute(
      new Float32Array(n * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)),
      3,
    ),
  )
  const [r, gr, b] = swatch("glow")
  g.setAttribute(
    "color",
    new BufferAttribute(
      new Float32Array(n * 3).map((_, i) => [r, gr, b][i % 3] as number),
      3,
    ),
  )
  g.setAttribute("tint", new BufferAttribute(new Float32Array(n), 1))
  g.setAttribute("burst", new BufferAttribute(new Float32Array(burst), 4))
  g.setAttribute("burstKind", new BufferAttribute(new Float32Array(kind), 1))
  return g
}

/** The highest point of a geometry (a ship's masthead), in its own units. */
export function mastheadOf(geometry: BufferGeometry): [number, number, number] {
  const position = geometry.getAttribute("position")
  let top = 0
  for (let i = 1; i < position.count; i++) if (position.getY(i) > position.getY(top)) top = i
  return [position.getX(top), position.getY(top), position.getZ(top)]
}

/**
 * Adds a pennant (a long thin triangle off the masthead, streaming aft) whose vertices take the instance
 * colour, and the merge's flare over the masthead (`flareGeometry`). Each vertex's `rig` says how far
 * along the pennant it is (0 at the mast, 1 at its tip: it flutters that much) and how far it dips at a
 * merge (a third of the way down the mast; 0 off the pennant), model units; its third, the hull
 * it belongs to (`prFleetGeometry`).
 */
export function withPennant(geometry: BufferGeometry, length: number): BufferGeometry {
  const position = geometry.getAttribute("position")
  const [x, y, z] = mastheadOf(geometry)
  const dip = y * 0.35
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
  for (const part of [body, pennant]) {
    const count = part.getAttribute("position").count
    part.setAttribute("burst", new BufferAttribute(new Float32Array(count * 4), 4))
    part.setAttribute("burstKind", new BufferAttribute(new Float32Array(count), 1))
  }
  const flare = flareGeometry([x, y, z])
  body.setAttribute("rig", new BufferAttribute(new Float32Array(position.count * 3), 3))
  flare.setAttribute(
    "rig",
    new BufferAttribute(new Float32Array(flare.getAttribute("position").count * 3), 3),
  )
  const pp = pennant.getAttribute("position")
  const rig = new Float32Array(pp.count * 3)
  for (let i = 0; i < pp.count; i++)
    rig.set([Math.min(1, Math.max(0, (z - pp.getZ(i)) / length)), dip, 0], i * 3)
  pennant.setAttribute("rig", new BufferAttribute(rig, 3))
  return mergeGeometries([body, pennant, flare]) as BufferGeometry
}

/**
 * The pull requests' hulls side by side in one geometry (each with its pennant and flare,
 * `withPennant`), each vertex's `rig.z` its hull's index, and the triangles each hull has.
 */
export function prFleetGeometry(hulls: readonly BufferGeometry[]): {
  geometry: BufferGeometry
  tris: number[]
} {
  const parts = hulls.map((g, k) => {
    const p = withPennant(g, PENNANT)
    const rig = p.getAttribute("rig") as BufferAttribute
    for (let i = 0; i < rig.count; i++) rig.setZ(i, k)
    return p
  })
  const tris = parts.map((p) => p.getAttribute("position").count / 3)
  const geometry = mergeGeometries(parts) as BufferGeometry
  for (const p of parts) p.dispose()
  return { geometry, tris }
}

/**
 * The ships' shader parts (fxMaterial `patch`): every vertex not of the instance's hull (`rig.z` against
 * `instanceGlint.z`) folds to the origin (no triangle drawn); the pennant dips by `instanceGlint.y` of its
 * `rig.y`, and the flare's vertices spread on the screen's plane over the masthead while
 * `instanceGlint.x` (its progress) runs, glowing gold. With `flutter` (a clock), the pennant flutters,
 * more toward its tip (`rig.x`), each ship in its own time.
 */
export function shipPatch(flutter?: { time: { value: number } }) {
  return (shader: { vertexShader: string; fragmentShader: string; uniforms?: Record<string, unknown> }) => {
    if (flutter && shader.uniforms) shader.uniforms.uFlutter = flutter.time
    const flap = flutter
      ? `
if ( rig.x > 0.0 ) {
  float ph = dot( instanceMatrix[ 3 ].xz, vec2( 0.41, 0.27 ) );
  transformed.x += rig.x * 0.55 * sin( uFlutter * 7.0 + ph - rig.x * 4.0 );
  transformed.y += rig.x * 0.3 * sin( uFlutter * 5.3 + ph * 1.7 - rig.x * 3.0 );
}`
      : ""
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
${flutter ? "uniform float uFlutter;" : ""}
attribute vec3 instanceGlint;
attribute vec3 rig;
attribute vec4 burst;
attribute float burstKind;
varying float vBurst;`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3( position );
float ownHull = step( abs( rig.z - instanceGlint.z ), 0.5 );
transformed.y -= rig.y * instanceGlint.y;${flap}
transformed *= ownHull;`,
      )
      .replace(
        "#include <project_vertex>",
        `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
vBurst = 0.0;
if ( burstKind > 0.5 ) {
  float u = instanceGlint.x;
  float on = step( 0.0001, u ) * step( u, 0.9999 ) * ownHull;
  float grow = smoothstep( 0.0, 0.14, u ) * ( 1.0 - smoothstep( 0.45, 1.0, u ) ) * on;
  vec2 o = burst.xy;
  if ( burstKind < 2.5 ) {
    // the core and the rays: out at once, turning a little, then shrinking away
    float a = u * 0.7;
    o = mat2( cos( a ), sin( a ), -sin( a ), cos( a ) ) * o * ( burstKind > 1.5 ? 1.0 + 0.35 * u : 1.0 );
    o *= grow;
  } else {
    // the sparkles: thrown out and up, twinkling as they go
    float tw = 0.6 + 0.4 * sin( u * 26.0 + burst.z * 5.0 + burst.w * 3.0 );
    o = burst.zw * ( 1.0 + 3.0 * u ) + vec2( 0.0, 1.4 * u ) + o * tw * ( 1.0 - u ) * on * 1.6;
    o *= on;
  }
  // farther off it grows (to 2.5× at 175 m), so it still reads at the map's mid zoom
  float far = clamp( -mvPosition.z / 70.0, 1.0, 2.5 );
  mvPosition.xy += ( o + vec2( 0.0, 1.0 ) * on ) * far;
  mvPosition.z += 2.5 * on;
  vBurst = on;
}
gl_Position = projectionMatrix * mvPosition;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vBurst;")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vBurst * vec3( 3.2, 2.3, 0.8 );",
      )
  }
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

/**
 * Where a voyage's ship is at `t` on its rounded lane (`route`), which way it points and how far it
 * has turned about (0 … 1). Leaving, it first backs off its berth stern first, then swings its bow round
 * once it has room (`BACK_OFF` metres out), so its stern never sweeps the quay.
 */
export function voyagePlace(
  route: Path,
  v: Voyage,
  t: number,
): { x: number; z: number; heading: number; turn: number } {
  const pose = voyagePose(v, t)
  const c = courseAt(route, pose.along * route.length, 2.5)
  const leaving = pose.phase === "leaving" || pose.phase === "turning-back"
  const out = leaving ? ((v.back ?? 1) - pose.along) * route.length : 0
  const turn = leaving ? smooth01((out - BACK_OFF) / 7) : pose.turn
  return { x: c.x, z: c.z, heading: c.heading + Math.PI * turn, turn }
}

/** How far a ship backs off its berth before it swings round, metres. */
const BACK_OFF = 2.5

/** Which way a hull moves at `t` (radians from +x toward +z, whichever way it points) and how fast (m/s on its clock). */
export function wakeOf(
  at: (t: number) => { x: number; z: number },
  t: number,
  h = 0.05,
): { heading: number; speed: number } {
  const a = at(t - h)
  const b = at(t + h)
  return { heading: Math.atan2(b.z - a.z, b.x - a.x), speed: Math.hypot(b.x - a.x, b.z - a.z) / (2 * h) }
}

export function createHarbourShips(stage: Stage, opts: HarbourShipsOpts): HarbourShips {
  const berths = opts.berths.slice(0, FLEET.MAX)
  // each lane with its corners rounded: a ship turns on a curve, never at a waypoint
  const routes = berths.map((b) => roundedPath(b.lane))
  /** Where a voyage's ship is at `at` and which way it points (turned about as it leaves). */
  const placeOf = (v: Voyage, at: number) => voyagePlace(routes[v.berth] as Path, v, at)
  /** The swell's clock, for the pennants' flutter. */
  const flutter = { value: 0 }
  const scale = opts.scale ?? SCALE
  const logs = new Map<string, ShipLog>()
  const colours = new Map<string, Color>()
  /** Each pull request's hull (an index into PR_PIECES) and its size, metres per model unit. */
  const hulls = new Map<string, { hull: number; scale: number }>()
  /** Which hulls loaded (a missing one sails as the small ship), and the triangles of each. */
  let loadedHulls: boolean[] = [true]
  let hullTris: number[] = [0]
  let drawnTris = 0
  let voyages: Voyage[] = []
  /** The fleet's clock (the voyages), which runs at `rate`; `wall` (the swell) always runs at 1. */
  let t = 0
  let wall = 0
  let rate = 1
  let seenKeys: string[] = []
  let merged: number | null = null
  let mesh: InstancedMesh | null = null
  let disposed = false
  let wakes = 0
  const costs: number[] = []
  let material: MeshStandardMaterial | null = null
  const replan = () => {
    voyages = planFleet([...logs.values()], berths.length, { close: opts.close ?? "sink" })
  }

  const build = (models: readonly BufferGeometry[]) => {
    const { geometry: g, tris } = prFleetGeometry(models)
    hullTris = tris
    const seen = new InstancedBufferAttribute(new Float32Array(FLEET.MAX), 1)
    seen.setUsage(DynamicDrawUsage)
    g.setAttribute("instanceSeen", seen)
    // the flare's progress, the pennant's dip and the instance's hull
    const glint = new InstancedBufferAttribute(new Float32Array(FLEET.MAX * 3), 3)
    glint.setUsage(DynamicDrawUsage)
    g.setAttribute("instanceGlint", glint)
    material = fxMaterial("ships", { patch: shipPatch({ time: flutter }) })
    const m = new InstancedMesh(g, material, FLEET.MAX)
    m.name = "harbour ships"
    m.instanceMatrix.setUsage(DynamicDrawUsage)
    for (let i = 0; i < FLEET.MAX; i++) m.setColorAt(i, PENNANTS[0] as Color)
    m.count = 0
    m.frustumCulled = false
    m.castShadow = false
    m.receiveShadow = true
    // three counts every hull of the geometry for each instance; the frame's tally keeps only the drawn ones
    const all = tris.reduce((a, b) => a + b, 0)
    m.onAfterRender = (renderer) => {
      renderer.info.render.triangles -= all * m.count - drawnTris
    }
    return m
  }

  const ready = (async () => {
    const load = opts.load
    const models = load
      ? await Promise.all(PR_PIECES.map((id) => load(id).then(bakeModel, () => null)))
      : [null]
    if (disposed) return
    loadedHulls = models.map((g) => g !== null)
    const m = build(models.map((g) => g ?? plainHull()))
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

  /** A pull request's hull (an index into PR_PIECES, one that loaded) and its size. */
  const hullOf = (key: string): { hull: number; scale: number } => {
    const h = hulls.get(key)
    return h && loadedHulls[h.hull] ? h : { hull: 0, scale }
  }

  const draw = () => {
    if (!mesh) return
    flutter.value = wall
    const seen = mesh.geometry.getAttribute("instanceSeen") as InstancedBufferAttribute
    const glint = mesh.geometry.getAttribute("instanceGlint") as InstancedBufferAttribute
    let k = 0
    drawnTris = 0
    flow.length = 0
    for (const v of voyages) {
      if (t < v.start || t >= v.gone || k >= FLEET.MAX) continue
      const pose = voyagePose(v, t)
      const berth = berths[v.berth] as (typeof berths)[number]
      const place = (at: number) => placeOf(v, at)
      const { x, z, heading } = place(t)
      const phase = (hashKey(v.key) % 628) / 100
      const { hull, scale: size } = hullOf(v.key)
      const feel = FEELS[hull] ?? FEEL.small
      // riding the swell where it lies, heeled into its turns, tied up on its lines at the berth
      const a = attitudeOf(
        { x, z, heading, ...motionOf(place, t), hold: pose.hold, way: pose.way },
        feel,
        wall,
        phase,
        { sails: true, reach: 0.35 },
      )
      p.set(a.x, berth.at[1] + a.heave - pose.sink * SINK_DEPTH, a.z)
      // bow along the model's +z, turned to the heading; sinking, it lists to one side, then the bow goes
      q.setFromAxisAngle(up, Math.PI / 2 - a.heading)
      roll.setFromAxisAngle(e.set(0, 0, 1), a.roll + 0.45 * pose.list + 0.25 * pose.sink)
      pitch.setFromAxisAngle(e.set(1, 0, 0), a.pitch + 0.35 * pose.sink)
      q.multiply(roll).multiply(pitch)
      s.setScalar(size)
      matrix.compose(p, q, s)
      mesh.setMatrixAt(k, matrix)
      colour.copy(colours.get(v.key) ?? pennantOf(v.key)).multiplyScalar(1 + 2.5 * pose.glint)
      mesh.setColorAt(k, colour)
      seen.setX(k, pose.seen)
      glint.setXYZ(k, pose.flare, pose.dip, hull)
      drawnTris += hullTris[hull] ?? 0
      // its wake: the way it moves (astern as it backs off its berth), as white as it is fast
      const w = wakeOf(place, t)
      const beam = feel.beam * 0.55
      if (w.speed > 0.2 && pose.seen > 0.05)
        flow.push({ x, z, heading: w.heading, speed: w.speed * Math.min(1, pose.seen * 1.5), beam })
      // a sinking ship churns the water round it as it goes down
      else if (pose.phase === "sinking" && pose.sink > 0.05 && pose.seen > 0.2)
        flow.push({ x, z, heading: heading + wall * 0.6, speed: 1.2, beam })
      k++
    }
    mesh.count = k
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    seen.needsUpdate = true
    glint.needsUpdate = true
    if (opts.water && (flow.length || wakes)) opts.water.setWakes(flow, "harbour")
    wakes = flow.length
  }

  const off = stage.onFrame((dt) => {
    const t0 = performance.now()
    const step = Math.min(dt, 0.1)
    t += step * rate
    wall += step
    draw()
    costs.push(performance.now() - t0)
    if (costs.length > 60) costs.shift()
  })

  const open = (key: string, o: { docked?: boolean; colour?: string; lines?: number } = {}) => {
    if (logs.has(key)) return
    logs.set(key, { key, opened: t, ...(o.docked ? { docked: true } : {}) })
    if (o.colour) colours.set(key, new Color(o.colour))
    if (o.lines !== undefined && Number.isFinite(o.lines)) {
      const h = prHull(o.lines)
      hulls.set(key, {
        hull: Math.max(0, PR_PIECES.indexOf(h.piece as (typeof PR_PIECES)[number])),
        scale: h.scale,
      })
    }
    replan()
  }
  const end = (key: string, how: ShipEnd) => {
    const log = logs.get(key)
    if (!log || log.ended) return
    log.ended = { at: t, how }
    replan()
  }

  const reset = () => {
    logs.clear()
    hulls.clear()
    seenKeys = []
    merged = null
    replan()
  }

  return {
    ready,
    reset,
    update(harbour) {
      // the merged count fell: the clock went back, so this is a new start, not a closing
      if (merged !== null && harbour.merged < merged) reset()
      const first = merged === null
      const { opened, ended } = harbourChanges(seenKeys, merged ?? harbour.merged, harbour)
      const sizes = new Map(harbour.prs.map((pr) => [prKey(pr), pr.size]))
      for (const key of opened) {
        const lines = sizes.get(key)
        open(key, { docked: first, ...(lines !== undefined ? { lines } : {}) })
      }
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
          const { x, z } = placeOf(v, t)
          return {
            key: v.key,
            piece: PR_PIECES[hullOf(v.key).hull] as string,
            berth: v.berth,
            phase: pose.phase,
            at: [x, berth.at[1], z] as [number, number, number],
          }
        }),
    setRate(next) {
      rate = Math.max(0, Number.isFinite(next) ? next : 1)
    },
    rate: () => rate,
    advance(seconds) {
      t += seconds
      draw()
    },
    stats: () => ({
      afloat: voyages.filter((v) => t >= v.start && t < v.gone).length,
      waiting: [...logs.values()].filter((l) => !l.ended && !voyages.some((v) => v.key === l.key)).length,
      ms: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0,
      tris: mesh?.visible ? drawnTris : 0,
    }),
    dispose() {
      disposed = true
      off()
      if (opts.water && wakes) opts.water.setWakes([], "harbour")
      if (mesh) {
        mesh.removeFromParent()
        mesh.geometry.dispose()
        mesh.dispose()
      }
      material?.dispose()
    },
  }
}

const hashKey = (key: string) => hash(key) >>> 0
