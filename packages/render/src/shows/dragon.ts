/**
 * The dragon (a red streak, plan v1events): a low-poly dragon comes down out of the northern sky,
 * circles the island's peaks banking into the turn, wings beating and tail swaying, breathes a gout of
 * fire every few seconds, and at the end climbs away north into the haze. Ported from V1
 * (scene/events/Dragon.tsx).
 *
 * There is no dragon in the KayKit packs, so it is built here from a handful of faceted primitives in
 * their manner: chunky, flat-shaded, a few flat colours. Two draws: the dragon (one merged mesh; the
 * wing beat and the tail's sway are in its vertex shader, bent about the shoulders and the tail's root)
 * and its fire (one instanced mesh, every flame placed in the shader, drawn only while it breathes).
 * The CPU poses one group a frame. Every pose is a function of the show's time alone (no state), so a
 * shot can seek it.
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
import { clamp01, hash01, lerp, litMaterial, type ShowCtx, type ShowPiece, smooth } from "./show.ts"

/** Seconds a lap of the peaks takes, and how far it leans into the turn (radians). */
export const LAP_S = 15
const BANK = 0.38
const SCALE = 1.1
/** The orbit over the peaks: its height over their top, and its radius from their spread (metres). */
const OVER_PEAKS = 27
const RADIUS: [number, number] = [24, 34]
/** Seconds coming in and going away; the breath every so often, lasting so long. */
export const DRAGON_ARRIVE_S = 7
export const DRAGON_LEAVE_S = 8
export const BREATH_EVERY = 7
export const BREATH_S = 1.6
/** Where it comes from and goes to, from the orbit's centre: high over the northern sea, in the haze. */
const FAR = new Vector3(-40, 50, -240)

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

/** The breath's strength 0 … 1 at `t` seconds into the show (none while arriving or leaving). */
export function breathAt(t: number, leaving: boolean): number {
  const since = t - DRAGON_ARRIVE_S - 1
  if (leaving || since <= 0) return 0
  const cycle = since % BREATH_EVERY
  return smooth(0, 0.2, cycle) * (1 - smooth(BREATH_S - 0.3, BREATH_S, cycle))
}

interface Uniforms {
  uTime: { value: number }
  uFlap: { value: number }
  uBreath: { value: number }
  uEmber: { value: number }
}

export function createDragon(ctx: ShowCtx): ShowPiece {
  const uniforms: Uniforms = {
    uTime: { value: 0 },
    uFlap: { value: 0 },
    uBreath: { value: 0 },
    uEmber: { value: 0 },
  }
  const { centre, r } = dragonOrbit(ctx)
  const far = centre.clone().add(FAR)
  const body = new Mesh(buildDragon(), wingbeat(uniforms))
  body.name = "dragon"
  body.frustumCulled = false
  const fire = flames(uniforms)
  const group = new Group()
  group.name = "show dragon"
  group.add(body, fire)
  group.position.copy(far)
  group.scale.setScalar(SCALE)

  const target = new Vector3()
  const ahead = new Vector3()
  const from = new Vector3()
  /** On the orbit at `s` seconds (counter-clockwise seen from above), rising and falling a little. */
  const orbitAt = (s: number, out: Vector3) => {
    const a = (s / LAP_S) * Math.PI * 2
    return out.set(centre.x + Math.cos(a) * r, centre.y + Math.sin(s * 0.7) * 2.2, centre.z + Math.sin(a) * r)
  }

  return {
    object: group,
    draws: () => (group.visible ? 1 + (fire.visible ? 1 : 0) : 0),
    update(t, total) {
      uniforms.uTime.value = t
      const leaveAt = total - DRAGON_LEAVE_S
      const leaving = t >= leaveAt
      orbitAt(t, target)
      orbitAt(t + 0.4, ahead)
      let k = 1
      if (leaving) {
        // climbs away north into the haze, from where it was when it turned for home
        orbitAt(leaveAt, from)
        const p = clamp01((t - leaveAt) / DRAGON_LEAVE_S)
        target.lerpVectors(from, far, p * p)
        ahead.copy(far)
        k = 0
      } else if (t < DRAGON_ARRIVE_S) {
        // down out of the northern sky onto the orbit
        const p = smooth(0, DRAGON_ARRIVE_S, t)
        ahead.lerpVectors(far, ahead, p)
        target.lerpVectors(far, target, p)
        k = p
      }
      group.position.copy(target)
      group.lookAt(ahead)
      group.rotateZ(-BANK * k)
      // wings: a strong downstroke and a slower recovery; gliding while it comes in
      const beat = ctx.still ? 0.2 : Math.sin(t * 4.2) * 0.75 + Math.sin(t * 8.4) * 0.12
      uniforms.uFlap.value = lerp(0.15, beat, leaving ? 1 : 0.35 + 0.65 * k)
      const breath = breathAt(t, leaving)
      uniforms.uBreath.value = breath
      fire.visible = breath > 0.001
      // by night the hide keeps a faint ember glow, so the silhouette still reads against the dark
      uniforms.uEmber.value = 0.03 + 0.12 * ctx.nightLevel() + 0.2 * breath
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
  const p = new Vector3()
  const pos = g.getAttribute("position")
  for (let i = 0; i < count; i++) {
    p.fromBufferAttribute(pos, i)
    const c = typeof color === "function" ? color(p) : color
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3))
  g.setAttribute("aWing", new Float32BufferAttribute(new Float32Array(count).fill(bits.wing ?? 0), 1))
  g.setAttribute("aTail", new Float32BufferAttribute(new Float32Array(count).fill(bits.tail ?? 0), 1))
  g.setAttribute("_glow", new Float32BufferAttribute(new Float32Array(count).fill(bits.glow ?? 0), 1))
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
  parts.push(part(neck.geometry, hide, neck.matrix))
  // the head: skull, snout, jaw, horns, glowing eyes
  parts.push(part(new IcosahedronGeometry(0.62, 0), hide, m(0, 1.7, 3.95, 0, 0, 0, 1, 0.82, 1.05)))
  parts.push(part(new CylinderGeometry(0.28, 0.4, 1.1, 5), hide, m(0, 1.55, 4.75, Math.PI / 2 + 0.12, 0, 0)))
  parts.push(part(new CylinderGeometry(0.2, 0.3, 0.9, 5), BELLY, m(0, 1.28, 4.6, Math.PI / 2 + 0.3, 0, 0)))
  for (const s of [-1, 1]) {
    parts.push(part(new ConeGeometry(0.13, 0.95, 5), HORN, m(0.3 * s, 2.15, 3.65, -0.9, 0, -0.35 * s)))
    parts.push(part(new ConeGeometry(0.09, 0.55, 4), HORN, m(0.45 * s, 1.95, 3.9, -1.1, 0, -0.9 * s)))
    parts.push(part(new OctahedronGeometry(0.12, 0), EYE, m(0.38 * s, 1.85, 4.3), { glow: 1 }))
    parts.push(part(new OctahedronGeometry(0.06, 0), CLAW, m(0.15 * s, 1.68, 5.28)))
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
function wingbeat(uniforms: Uniforms) {
  const material = litMaterial(
    "dragon",
    (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
attribute float aWing; attribute float aTail;
uniform float uTime; uniform float uFlap;
vec3 bendWing(vec3 p) {
  // about the shoulder, along the body's long axis; the outer wing lags and bends further
  vec3 q = p - vec3(${SHOULDER_X.toFixed(2)} * aWing, ${SHOULDER_Y.toFixed(2)}, 0.0);
  float reach = smoothstep(2.0, 8.5, abs(p.x));
  float angle = aWing * (uFlap + reach * 0.35 * uFlap);
  float c = cos(angle), s = sin(angle);
  q.xy = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  return q + vec3(${SHOULDER_X.toFixed(2)} * aWing, ${SHOULDER_Y.toFixed(2)}, 0.0);
}`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
if (aWing != 0.0) transformed = bendWing(transformed);
if (aTail > 0.0) transformed.x += sin(uTime * 2.4 - aTail * 3.2) * aTail * aTail * 1.4;`,
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
    uniforms: { uTime: uniforms.uTime, uBreath: uniforms.uBreath },
    vertexShader: /* glsl */ `
attribute float aSeed; attribute vec2 aSpread;
uniform float uTime; uniform float uBreath;
varying vec2 vUv; varying float vHeat;
const float LIFE = 0.55;
void main() {
  vUv = uv;
  float t = fract(uTime / LIFE + aSeed);            // 0 at the jaws … 1 burnt out
  vec3 mouth = vec3(0.0, 1.4, 5.3);
  vec3 p = mouth + vec3(aSpread.x * 2.6 * t, -1.6 * t + aSpread.y * 2.0 * t, 9.5 * t);
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
