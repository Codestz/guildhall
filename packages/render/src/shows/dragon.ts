/**
 * The dragon (a red streak, plan v1events): a low-poly dragon glides down out of the northern sky onto
 * an uneven route round the island's peaks and flies it in acts (flight.ts): a burst of strong wing
 * beats climbing, then a long glide on still wings held a little up, sinking; now and then a swoop,
 * diving on the peaks with its wings raised, a gout of fire at the bottom with its head turned on
 * them, and hard beats to climb away. It banks into its turns as a flier does (its lift tilted into
 * the turn), its wings leading the roll and its body and tail following a moment later; the tail
 * swings wide of a turn and trails a climb. At the end it beats up and away north into the haze.
 * Ported from V1 (scene/events/Dragon.tsx) and made to fly.
 *
 * There is no dragon in the KayKit packs, so it is built here from a handful of faceted primitives in
 * their manner: chunky, flat-shaded, a few flat colours. Two draws: the dragon (one merged mesh; the
 * wing beat, the wingtips' lag, the head's turn and the tail's swing are in its vertex shader) and its
 * fire (one instanced mesh, every flame placed in the shader, drawn only while it breathes). The CPU
 * poses one group a frame. Every pose is a function of the show's time alone (no state), so a shot can
 * seek it.
 */
import {
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  BufferGeometry as Geometry,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  NormalBlending,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { type FlightPlan, type FlightState, flightPlan, hermite, wingAngle } from "./flight.ts"
import { clamp01, hash01, litMaterial, type ShowCtx, type ShowPiece, smooth } from "./show.ts"

const SCALE = 1.1
/** The orbit over the peaks: its height over their top, and its radius from their spread (metres). */
const OVER_PEAKS = 27
const RADIUS: [number, number] = [24, 34]
/** Seconds coming in and going away. */
export const DRAGON_ARRIVE_S = 7
export const DRAGON_LEAVE_S = 8
/** Where it comes from and goes to, from the orbit's centre: high over the northern sea, in the haze. */
const FAR = new Vector3(-40, 50, -240)
/** Its speed coming in off the horizon and going away, metres a second. */
const IN_SPEED = 34
const OUT_SPEED = 26
/** Seconds the body and the tail lag the wings' roll. */
const BODY_LAG = 0.22
const TAIL_LAG = 0.35
const G = 9.8

/** Where a dragon circles: the orbit's centre (x, height, z) and radius. */
export function dragonOrbit(ctx: Pick<ShowCtx, "sites">): { centre: Vector3; r: number } {
  const peak = ctx.sites.peak
  if (peak)
    return {
      centre: new Vector3(peak.at[0], peak.at[1] + OVER_PEAKS, peak.at[2]),
      r: Math.min(RADIUS[1], Math.max(RADIUS[0], peak.reach + 6)),
    }
  const c = ctx.sites.castle
  return { centre: new Vector3(c?.[0] ?? 0, (c?.[1] ?? 0) + OVER_PEAKS, c?.[2] ?? 0), r: 30 }
}

/** The dragon's flight over an island: its route and its acts, from where the peaks are (the same every time). */
export function dragonFlight(ctx: Pick<ShowCtx, "sites">): FlightPlan {
  const { centre, r } = dragonOrbit(ctx)
  const seed = Math.floor(hash01(Math.round(centre.x * 7) * 131 + Math.round(centre.z * 7)) * 2 ** 31)
  return flightPlan(seed, [centre.x, centre.y, centre.z], r)
}

/** The breath's strength 0 … 1 at `t` seconds into the show (none while arriving or leaving). */
export function breathAt(plan: FlightPlan, t: number, leaving: boolean): number {
  if (leaving || t <= DRAGON_ARRIVE_S) return 0
  return plan.at(t - DRAGON_ARRIVE_S).breath
}

/** What the dragon does at a moment: where, its wings and fire, how much it watches its mark. */
export interface DragonState extends FlightState {
  /** Weight of the head's turn on the peaks (diving and breathing). */
  look: number
}

/**
 * The dragon's state at `t` into a show `total` long (Infinity while it stays): coming in it glides,
 * then takes up its acts; going away it beats steadily up into the haze, its fire out.
 */
export function dragonState(plan: FlightPlan, t: number, total: number): DragonState {
  const tau = t - DRAGON_ARRIVE_S
  const s = plan.at(tau)
  const leaveAt = total - DRAGON_LEAVE_S
  // gliding in until its first act begins
  const on = smooth(-0.4, 0.3, tau)
  let beating = s.beating * on
  let still = s.still * on + 0.14 * (1 - on)
  let breath = s.breath * on
  let strength = s.strength
  let look = clamp01(s.breath * 1.4 + (s.still > 0.3 ? (s.still - 0.3) * 4 : 0)) * on
  if (t > leaveAt) {
    const k = smooth(leaveAt, leaveAt + 0.6, t)
    beating += (1 - beating) * k
    strength += (1.15 - strength) * k
    breath *= 1 - smooth(leaveAt, leaveAt + 0.3, t)
    look *= 1 - k
    still += (0.14 - still) * k
  }
  return { ...s, beating, still, breath, strength, look }
}

/** On the route at `t` (a show's seconds): its point and height. */
function cruiseAt(plan: FlightPlan, t: number): [number, number, number] {
  const s = plan.at(t - DRAGON_ARRIVE_S)
  const [x, z] = plan.route(s.dist)
  return [x, plan.centre[1] + s.alt, z]
}

const velOf = (f: (t: number) => readonly number[], t: number, h = 0.05): [number, number, number] => {
  const a = f(t - h)
  const b = f(t + h)
  return [0, 1, 2].map((k) => ((b[k] as number) - (a[k] as number)) / (2 * h)) as [number, number, number]
}

/**
 * Where the dragon is at `t` into a show `total` long: in off the horizon on a curve that meets the
 * route at its own speed and heading, the route, then up and away on another from wherever it was.
 */
export function dragonAt(plan: FlightPlan, t: number, total: number): [number, number, number] {
  const leaveAt = total - DRAGON_LEAVE_S
  const far: [number, number, number] = [
    plan.centre[0] + FAR.x,
    plan.centre[1] + FAR.y,
    plan.centre[2] + FAR.z,
  ]
  if (t >= leaveAt) {
    const flying = (s: number) => dragonAt(plan, s, Number.POSITIVE_INFINITY)
    const p0 = flying(leaveAt)
    const v0 = velOf(flying, leaveAt)
    const away = [far[0] - p0[0], far[1] - p0[1], far[2] - p0[2]]
    const d = Math.hypot(away[0] as number, away[1] as number, away[2] as number) || 1
    const v1 = away.map((x) => (x / d) * OUT_SPEED)
    return hermite(p0, v0, far, v1, DRAGON_LEAVE_S, clamp01((t - leaveAt) / DRAGON_LEAVE_S))
  }
  if (t < DRAGON_ARRIVE_S) {
    const p1 = cruiseAt(plan, DRAGON_ARRIVE_S)
    const v1 = velOf((s) => cruiseAt(plan, s), DRAGON_ARRIVE_S)
    const dir = [p1[0] - (far[0] as number), p1[1] - (far[1] as number), p1[2] - (far[2] as number)]
    const d = Math.hypot(dir[0] as number, dir[1] as number, dir[2] as number) || 1
    const v0 = dir.map((x) => (x / d) * IN_SPEED)
    return hermite(far, v0, p1, v1, DRAGON_ARRIVE_S, clamp01(t / DRAGON_ARRIVE_S))
  }
  return cruiseAt(plan, t)
}

/**
 * How far the dragon leans into its turn at `t` (radians, + its left wing down): its lift tilted to
 * carry the turn, the horizontal pull to its left over gravity.
 */
export function bankAt(plan: FlightPlan, t: number, total: number): number {
  // the pull to its left, averaged over a second or so (a flier eases into a bank, it never snaps)
  const H = 0.6
  let left = 0
  for (const o of [-0.3, -0.15, 0, 0.15, 0.3]) {
    const a = dragonAt(plan, t + o - H, total)
    const b = dragonAt(plan, t + o, total)
    const c = dragonAt(plan, t + o + H, total)
    const ax = ((a[0] as number) - 2 * (b[0] as number) + (c[0] as number)) / (H * H)
    const az = ((a[2] as number) - 2 * (b[2] as number) + (c[2] as number)) / (H * H)
    const fx = (c[0] as number) - (a[0] as number)
    const fz = (c[2] as number) - (a[2] as number)
    const f = Math.hypot(fx, fz) || 1
    // its left, level: up × forward
    left += (ax * (fz / f) - az * (fx / f)) / 5
  }
  return 0.7 * Math.tanh((Math.atan2(left, G) * 0.9) / 0.7)
}

interface Uniforms {
  uTime: { value: number }
  uFlap: { value: number }
  uFlapTip: { value: number }
  uWingRoll: { value: number }
  uBreath: { value: number }
  uEmber: { value: number }
  uHead: { value: [number, number] }
  uTail: { value: [number, number, number] }
}

export function createDragon(ctx: ShowCtx): ShowPiece {
  const uniforms: Uniforms = {
    uTime: { value: 0 },
    uFlap: { value: 0 },
    uFlapTip: { value: 0 },
    uWingRoll: { value: 0 },
    uBreath: { value: 0 },
    uEmber: { value: 0 },
    uHead: { value: [0, 0] },
    uTail: { value: [0, 0, 1] },
  }
  const plan = dragonFlight(ctx)
  const mark = ctx.sites.peak
    ? new Vector3(ctx.sites.peak.at[0], ctx.sites.peak.at[1], ctx.sites.peak.at[2])
    : new Vector3(plan.centre[0], plan.centre[1] - 27, plan.centre[2])
  const body = new Mesh(buildDragon(), wingbeat(uniforms))
  body.name = "dragon"
  body.frustumCulled = false
  const fire = flames(uniforms)
  const group = new Group()
  group.name = "show dragon"
  group.add(body, fire)
  group.position.set(plan.centre[0] + FAR.x, plan.centre[1] + FAR.y, plan.centre[2] + FAR.z)
  group.scale.setScalar(SCALE)

  const ahead = new Vector3()
  const local = new Vector3()
  return {
    object: group,
    draws: () => (group.visible ? 1 + (fire.visible ? 1 : 0) : 0),
    update(t, total) {
      uniforms.uTime.value = t
      const s = dragonState(plan, t, total)
      if (ctx.still) {
        s.beating = 0
        s.still = 0.2
      }
      const [x, y, z] = dragonAt(plan, t, total)
      const v = velOf((u) => dragonAt(plan, u, total), t)
      // each downstroke lifts it a little; a hard climb tips its nose up
      const stroke = (wingAngle(s) - 0.1) / 0.62
      group.position.set(x, y - 0.22 * stroke * s.beating, z)
      ahead.set(x + v[0], y + v[1], z + v[2])
      group.lookAt(ahead)
      group.rotateX(-0.07 * s.beating)
      // the body rolls a moment after the wings: they lead, it follows
      const wings = bankAt(plan, t, total)
      const bodyBank = bankAt(plan, t - BODY_LAG, total)
      group.rotateZ(-bodyBank)
      uniforms.uWingRoll.value = -(wings - bodyBank)
      uniforms.uFlap.value = wingAngle(s)
      // the wingtips trail the stroke
      uniforms.uFlapTip.value = wingAngle(s, s.beat - 0.12)
      // the tail swings wide of the turn it is coming out of and sways with the beats
      const tail = bankAt(plan, t - TAIL_LAG, total)
      const vy0 = velOf((u) => dragonAt(plan, u, total), t - TAIL_LAG)[1]
      uniforms.uTail.value = [
        -tail * 1.6,
        -Math.max(-1, Math.min(1, (v[1] - vy0) * 0.25)),
        0.45 + 0.8 * s.beating,
      ]
      // its head turns on the peaks while it swoops and breathes
      group.updateMatrixWorld(true)
      local.copy(mark)
      body.worldToLocal(local)
      local.sub(HEAD_PIVOT)
      const yaw = Math.max(-0.7, Math.min(0.7, Math.atan2(local.x, local.z)))
      const pitch = Math.max(-0.3, Math.min(0.65, Math.atan2(-local.y, Math.hypot(local.x, local.z))))
      uniforms.uHead.value = [yaw * s.look, pitch * s.look]
      uniforms.uBreath.value = s.breath
      fire.visible = s.breath > 0.001
      // by night the hide keeps a faint ember glow, so the silhouette still reads against the dark
      uniforms.uEmber.value = 0.03 + 0.12 * ctx.nightLevel() + 0.2 * s.breath
    },
    dispose() {
      group.removeFromParent()
      body.geometry.dispose()
      body.material.dispose()
      fire.geometry.dispose()
      fire.material.dispose()
    },
  }
}

/** The head turns about the neck's root (model space). */
const HEAD_PIVOT = new Vector3(0, 0.9, 2.3)

// ─────────────────────────────── the model ───────────────────────────────

const HIDE = new Color("#a9302b")
const HIDE_DARK = new Color("#7e2220")
const BELLY = new Color("#e8c48a")
const MEMBRANE = new Color("#6f1f1d")
const SPAR = new Color("#4a1514")
const HORN = new Color("#efe0c0")
const EYE = new Color("#ffd23a")
const CLAW = new Color("#3a2a24")

interface Bits {
  wing?: number
  tail?: number
  glow?: number
  /** The head and neck: they turn with the head, more toward the snout. */
  head?: boolean
}

/** A part, coloured, with its bend weights (aWing: ±1 a wing; aTail: 0 root … 1 tip) and its glow. */
function part(
  source: BufferGeometry,
  color: Color | ((p: Vector3) => Color),
  matrix: Matrix4,
  bits: Bits = {},
): BufferGeometry {
  const g = (source.index ? source.toNonIndexed() : source.clone()).applyMatrix4(matrix)
  for (const name of Object.keys(g.attributes)) if (name !== "position") g.deleteAttribute(name)
  g.computeVertexNormals()
  const count = g.getAttribute("position").count
  const colors = new Float32Array(count * 3)
  const head = new Float32Array(count)
  const p = new Vector3()
  const pos = g.getAttribute("position")
  for (let i = 0; i < count; i++) {
    p.fromBufferAttribute(pos, i)
    if (bits.head) head[i] = Math.min(1, Math.max(0, (p.z - 2.2) / 1.4))
    const c = typeof color === "function" ? color(p) : color
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3))
  g.setAttribute("aWing", new Float32BufferAttribute(new Float32Array(count).fill(bits.wing ?? 0), 1))
  // the tail bends by where each vertex lies along it (root 0 … tip 1), so its segments never part
  const tail = new Float32Array(count)
  if (bits.tail !== undefined)
    for (let i = 0; i < count; i++)
      tail[i] = Math.min(1, Math.max(0, (TAIL_ROOT - pos.getZ(i)) / TAIL_LENGTH))
  g.setAttribute("aTail", new Float32BufferAttribute(tail, 1))
  g.setAttribute("_glow", new Float32BufferAttribute(new Float32Array(count).fill(bits.glow ?? 0), 1))
  g.setAttribute("aHead", new Float32BufferAttribute(head, 1))
  source.dispose()
  return g
}

const m = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromEuler(new Euler(rx, ry, rz)),
    new Vector3(sx, sy, sz),
  )

/** A cylinder from a to b (radius ra at a, rb at b). */
function limb(a: Vector3, b: Vector3, ra: number, rb: number, sides = 5) {
  const geometry = new CylinderGeometry(rb, ra, a.distanceTo(b), sides, 1)
  const dir = new Vector3().subVectors(b, a).normalize()
  const matrix = new Matrix4().compose(
    new Vector3().addVectors(a, b).multiplyScalar(0.5),
    new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir),
    new Vector3(1, 1, 1),
  )
  return { geometry, matrix }
}

/** A triangle fan (a wing's membrane panel; the material draws both faces). */
function panel(points: readonly Vector3[]): BufferGeometry {
  const positions: number[] = []
  for (let i = 1; i < points.length - 1; i++)
    for (const p of [points[0], points[i], points[i + 1]] as Vector3[]) positions.push(p.x, p.y, p.z)
  const g = new Geometry()
  g.setAttribute("position", new Float32BufferAttribute(positions, 3))
  return g
}

/** The shoulders the wings beat about (model space, x = ±SHOULDER_X). */
/** The tail runs back from its root over this long (model space, -z). */
const TAIL_ROOT = -2.1
const TAIL_LENGTH = 7.2
const SHOULDER_X = 0.7
const SHOULDER_Y = 0.75

/** The dragon in its own space: +z ahead, +y up, about 17 m from wingtip to wingtip. */
export function buildDragon(): BufferGeometry {
  const parts: BufferGeometry[] = []
  const I = new Matrix4()
  // body: chest and haunches, faceted; belly plates underneath
  const hide = (p: Vector3) => (p.y < -0.25 ? BELLY : p.y > 0.55 ? HIDE_DARK : HIDE)
  parts.push(part(new IcosahedronGeometry(1, 0), hide, m(0, 0.2, 1, 0, 0, 0, 1.15, 0.95, 1.7)))
  parts.push(part(new IcosahedronGeometry(1, 0), hide, m(0, 0.05, -1.1, 0.1, 0, 0, 0.95, 0.85, 1.5)))
  // the neck up and forward to the head
  const neck = limb(new Vector3(0, 0.6, 2.2), new Vector3(0, 1.55, 3.6), 0.62, 0.36, 6)
  const H = { head: true }
  parts.push(part(neck.geometry, hide, neck.matrix, H))
  // the head: skull, snout, jaw, horns, glowing eyes
  parts.push(part(new IcosahedronGeometry(0.62, 0), hide, m(0, 1.7, 3.95, 0, 0, 0, 1, 0.82, 1.05), H))
  parts.push(
    part(new CylinderGeometry(0.28, 0.4, 1.1, 5), hide, m(0, 1.55, 4.75, Math.PI / 2 + 0.12, 0, 0), H),
  )
  parts.push(part(new CylinderGeometry(0.2, 0.3, 0.9, 5), BELLY, m(0, 1.28, 4.6, Math.PI / 2 + 0.3, 0, 0), H))
  for (const s of [-1, 1]) {
    parts.push(part(new ConeGeometry(0.13, 0.95, 5), HORN, m(0.3 * s, 2.15, 3.65, -0.9, 0, -0.35 * s), H))
    parts.push(part(new ConeGeometry(0.09, 0.55, 4), HORN, m(0.45 * s, 1.95, 3.9, -1.1, 0, -0.9 * s), H))
    parts.push(part(new OctahedronGeometry(0.12, 0), EYE, m(0.38 * s, 1.85, 4.3), { glow: 1, head: true }))
    parts.push(part(new OctahedronGeometry(0.06, 0), CLAW, m(0.15 * s, 1.68, 5.28), H))
  }
  // spines along the back
  for (let i = 0; i < 6; i++) {
    const z = 2.6 - i * 0.85
    parts.push(
      part(
        new ConeGeometry(0.16, 0.55 - i * 0.04, 4),
        HIDE_DARK,
        m(0, 1.1 - Math.abs(z) * 0.08, z, -0.35, 0, 0),
      ),
    )
  }
  // legs tucked under: thighs and claws
  for (const s of [-1, 1]) {
    parts.push(part(new IcosahedronGeometry(0.42, 0), HIDE, m(0.62 * s, -0.45, -1.2, 0, 0, 0, 0.8, 1, 1.3)))
    parts.push(part(new ConeGeometry(0.16, 0.6, 4), CLAW, m(0.62 * s, -0.75, -1.85, -2.2, 0, 0)))
    parts.push(part(new ConeGeometry(0.13, 0.5, 4), CLAW, m(0.55 * s, -0.55, 1.4, -2.0, 0, 0)))
  }
  // the tail: tapering segments curving back and a little up, ending in a spade
  const tail = [0, 1, 2, 3, 4, 5, 6].map(
    (i) => new Vector3(0, 0.1 + Math.sin(i * 0.5) * 0.35, -2.2 - i * 1.15),
  )
  for (let i = 0; i < tail.length - 1; i++) {
    const seg = limb(tail[i] as Vector3, tail[i + 1] as Vector3, 0.55 - i * 0.075, 0.48 - i * 0.075, 5)
    parts.push(part(seg.geometry, hide, seg.matrix, { tail: (i + 0.5) / (tail.length - 1) }))
  }
  const tip = tail.at(-1) as Vector3
  parts.push(
    part(new OctahedronGeometry(0.6, 0), HIDE_DARK, m(tip.x, tip.y, tip.z - 0.45, 0, 0, 0, 1, 0.18, 1.2), {
      tail: 1,
    }),
  )
  // wings: an arm to the elbow and the wrist, three finger spars, a scalloped membrane between
  for (const s of [-1, 1]) {
    const shoulder = new Vector3(SHOULDER_X * s, SHOULDER_Y, 1.3)
    const elbow = new Vector3(3.3 * s, 1.35, 0.7)
    const wrist = new Vector3(6.4 * s, 1.0, 0.3)
    const fingers = [
      new Vector3(8.6 * s, 0.6, -1.6),
      new Vector3(7.2 * s, 0.5, -3.1),
      new Vector3(4.6 * s, 0.4, -3.4),
    ]
    const root = new Vector3(SHOULDER_X * s, SHOULDER_Y - 0.1, -1.6)
    const bones: [Vector3, Vector3, number, number][] = [
      [shoulder, elbow, 0.22, 0.16],
      [elbow, wrist, 0.16, 0.1],
      ...fingers.map((f) => [wrist, f, 0.08, 0.04] as [Vector3, Vector3, number, number]),
    ]
    for (const [a, b, ra, rb] of bones) {
      const bone = limb(a, b, ra, rb, 4)
      parts.push(part(bone.geometry, SPAR, bone.matrix, { wing: s }))
    }
    parts.push(
      part(new ConeGeometry(0.12, 0.45, 4), HORN, m(wrist.x, wrist.y + 0.25, wrist.z + 0.1, 0.4, 0, 0), {
        wing: s,
      }),
    )
    const dip = (a: Vector3, b: Vector3) =>
      new Vector3()
        .addVectors(a, b)
        .multiplyScalar(0.5)
        .add(new Vector3(-0.4 * s, 0, 0.55))
    const [f0, f1, f2] = fingers as [Vector3, Vector3, Vector3]
    for (const g of [
      panel([shoulder, elbow, wrist, f2, root]),
      panel([wrist, f0, dip(f0, f1), f1]),
      panel([wrist, f1, dip(f1, f2), f2]),
      panel([f2, dip(f2, root), root]),
    ])
      parts.push(part(g, (p) => (Math.abs(p.x) > 5 ? HIDE_DARK : MEMBRANE), I, { wing: s }))
  }
  const geometry = mergeGeometries(parts) ?? new IcosahedronGeometry(1, 0)
  for (const g of parts) g.dispose()
  return geometry
}

/** The hide: the lit show material, with the wing beat, the tail's sway and the eyes' and ember glow. */
/** The head's turn about the neck's root (`uHead`: yaw toward +x, pitch nose down), weighted `w`. */
const HEAD_TURN = /* glsl */ `
vec3 headTurn(vec3 p, float w) {
  vec3 q = p - vec3(${HEAD_PIVOT.x.toFixed(2)}, ${HEAD_PIVOT.y.toFixed(2)}, ${HEAD_PIVOT.z.toFixed(2)});
  float c = cos(uHead.y * w), s = sin(uHead.y * w);
  q.yz = vec2(q.y * c - q.z * s, q.y * s + q.z * c);
  c = cos(uHead.x * w); s = sin(uHead.x * w);
  q.xz = vec2(q.x * c + q.z * s, -q.x * s + q.z * c);
  return q + vec3(${HEAD_PIVOT.x.toFixed(2)}, ${HEAD_PIVOT.y.toFixed(2)}, ${HEAD_PIVOT.z.toFixed(2)});
}`

function wingbeat(uniforms: Uniforms) {
  const material = litMaterial(
    "dragon",
    (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
attribute float aWing; attribute float aTail; attribute float aHead;
uniform float uTime; uniform float uFlap; uniform float uFlapTip; uniform float uWingRoll;
uniform vec2 uHead; uniform vec3 uTail;
${HEAD_TURN}
vec3 bendWing(vec3 p) {
  // about the shoulder, along the body's long axis; the outer wing trails the stroke and bends further,
  // and both lead the body's roll into a turn
  vec3 q = p - vec3(${SHOULDER_X.toFixed(2)} * aWing, ${SHOULDER_Y.toFixed(2)}, 0.0);
  float reach = smoothstep(2.0, 8.5, abs(p.x));
  float flap = mix(uFlap, uFlapTip, reach);
  float angle = aWing * (flap + reach * 0.3 * flap) + uWingRoll;
  float c = cos(angle), s = sin(angle);
  q.xy = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  return q + vec3(${SHOULDER_X.toFixed(2)} * aWing, ${SHOULDER_Y.toFixed(2)}, 0.0);
}`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
if (aWing != 0.0) transformed = bendWing(transformed);
if (aHead > 0.0) transformed = headTurn(transformed, aHead);
// the tail: swaying with the beats, swung wide of a turn, trailing a climb
if (aTail > 0.0) {
  float k = aTail * aTail;
  transformed.x += (sin(uTime * 2.4 - aTail * 3.2) * uTail.z + uTail.x) * k;
  transformed.y += uTail.y * k;
}`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uEmber;")
        .replace(
          "#include <emissivemap_fragment>",
          "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * (vGlow * 2.5 + uEmber);",
        )
    },
    { flat: true, doubleSided: true },
  )
  return material
}

// ─────────────────────────────── fire ───────────────────────────────

/** Flames from the jaws, in the dragon's space: a cone of puffs, each looping while the breath lasts. */
function flames(uniforms: Uniforms): InstancedMesh<PlaneGeometry, ShaderMaterial> {
  const COUNT = 46
  const seed = new Float32Array(COUNT)
  const spread = new Float32Array(COUNT * 2)
  for (let i = 0; i < COUNT; i++) {
    seed[i] = hash01(i * 13)
    spread[i * 2] = hash01(i * 13 + 1) - 0.5
    spread[i * 2 + 1] = hash01(i * 13 + 2) - 0.5
  }
  const geometry = new PlaneGeometry(1, 1)
  geometry.setAttribute("aSeed", new InstancedBufferAttribute(seed, 1))
  geometry.setAttribute("aSpread", new InstancedBufferAttribute(spread, 2))
  const material = new ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uBreath: uniforms.uBreath, uHead: uniforms.uHead },
    vertexShader: /* glsl */ `
attribute float aSeed; attribute vec2 aSpread;
uniform float uTime; uniform float uBreath; uniform vec2 uHead;
varying vec2 vUv; varying float vHeat;
const float LIFE = 0.55;
${HEAD_TURN}
void main() {
  vUv = uv;
  float t = fract(uTime / LIFE + aSeed);            // 0 at the jaws … 1 burnt out
  vec3 mouth = vec3(0.0, 1.4, 5.3);
  vec3 p = mouth + vec3(aSpread.x * 2.6 * t, -1.6 * t + aSpread.y * 2.0 * t, 9.5 * t);
  // out of the jaws the way the head is turned
  p = headTurn(p, 1.0);
  vHeat = (1.0 - t) * uBreath;
  float size = mix(0.7, 3.4, t) * uBreath;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */ `
varying vec2 vUv; varying float vHeat;
void main() {
  // a faceted puff: an octagon, not a soft disc (the packs' flames are cut, not blurred)
  vec2 q = abs(vUv - 0.5) * 2.0;
  float d = max(max(q.x, q.y), (q.x + q.y) * 0.7071);
  float a = (1.0 - step(0.92, d)) * smoothstep(0.0, 0.25, vHeat) * 0.95;
  if (a < 0.01) discard;
  vec3 colour = mix(vec3(0.95, 0.25, 0.05), vec3(1.0, 0.85, 0.4), vHeat * vHeat);
  // hot enough to bloom at night, solid enough to read against a bright sky
  gl_FragColor = vec4(colour * (1.0 + 1.6 * vHeat), a);
}`,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
  })
  const mesh = new InstancedMesh(geometry, material, COUNT)
  mesh.name = "dragon fire"
  mesh.frustumCulled = false
  mesh.renderOrder = 7
  mesh.visible = false
  return mesh
}
