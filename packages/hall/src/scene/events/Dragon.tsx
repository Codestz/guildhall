import { useFrame } from "@react-three/fiber"
import { useRef } from "react"
import {
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  BufferGeometry as Geometry,
  type Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NormalBlending,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { reducedMotion } from "../../guild/opening.ts"
import { sky } from "../atmosphere/state.ts"
import { FRAME } from "../frame.ts"
import { useOwnedMeshes } from "../owned.ts"
import { clamp01, hash01, lerp, smooth } from "./common.ts"
import type { ShowProps } from "./EventsLayer.tsx"

/**
 * The dragon (a red streak, guild/events.ts): a low-poly dragon wakes and circles the mountain
 * peaks, banking into the turn, wings beating, tail swaying, now and then breathing a gout of fire,
 * for as long as the failures go on. When the streak breaks it climbs away north into the haze.
 *
 * There is no dragon in the KayKit packs, so it is built here from a handful of faceted primitives
 * in the packs' manner: chunky, flat-shaded, a few flat colours. Two draw calls: the dragon (one
 * merged mesh; the wing beat and the tail's sway are in its vertex shader, bent about the
 * shoulders and the tail root), and its fire (one instanced mesh, every flame in the shader).
 */

/** The orbit round the peaks (world/lands.ts: the high mountains sit about (0, -62)). */
const ORBIT = { x: 2, z: -58, y: 34, r: 30 }
/** Seconds per lap, and the bank into the turn. */
const LAP_S = 15
const BANK = 0.38
const SCALE = 1.25
/** Where it comes from and goes to: high over the northern sea, in the haze. */
const FAR = new Vector3(-40, 80, -240)
const ARRIVE_S = 7
const LEAVE_S = 8
/** Fire: a breath every so often, lasting this long (s). */
const BREATH_EVERY = 7
const BREATH_S = 1.6

const target = new Vector3()
const ahead = new Vector3()

export default function Dragon({ show, events }: ShowProps) {
  const group = useRef<Group>(null)
  const age = useRef(0)
  const left = useRef<number | null>(null)
  const from = useRef(new Vector3())
  const finished = useRef(false)
  const still = useRef(reducedMotion()).current
  const uniforms = useRef({
    uTime: { value: 0 },
    uFlap: { value: 0 },
    uBreath: { value: 0 },
    uEmber: { value: 0 },
  }).current
  const built = useOwnedMeshes(() => buildDragon(uniforms), [])

  useFrame((_, delta) => {
    const g = group.current
    if (!built || !g) return
    const dt = Math.min(delta, 0.1)
    age.current += dt
    const t = age.current
    uniforms.uTime.value = t

    // On the orbit at time `s` (counter-clockwise seen from above), with a gentle rise and fall.
    const orbitAt = (s: number, out: Vector3) => {
      const a = (s / LAP_S) * Math.PI * 2
      return out.set(
        ORBIT.x + Math.cos(a) * ORBIT.r,
        ORBIT.y + Math.sin(s * 0.7) * 2.2,
        ORBIT.z + Math.sin(a) * ORBIT.r,
      )
    }
    orbitAt(t, target)
    orbitAt(t + 0.4, ahead)
    if (show.leaving && left.current === null) {
      left.current = t
      from.current.copy(g.position)
    }
    const leaving = left.current
    let k = 1
    if (leaving !== null) {
      // Climb away north into the haze.
      const p = clamp01((t - leaving) / LEAVE_S)
      const e = p * p
      target.lerpVectors(from.current, FAR, e)
      ahead.copy(FAR)
      if (p >= 1 && !finished.current) {
        finished.current = true
        events.done(show.id)
      }
      k = 0
    } else if (t < ARRIVE_S) {
      // Down out of the northern sky onto the orbit.
      const p = smooth(0, ARRIVE_S, t)
      ahead.lerpVectors(FAR, ahead, p)
      target.lerpVectors(FAR, target, p)
      k = p
    }
    g.position.copy(target)
    g.lookAt(ahead)
    // Bank into the turn (and level out when gliding in or away).
    g.rotateZ(-BANK * k)
    g.scale.setScalar(SCALE)

    // Wings: a strong downstroke and a slower recovery; gliding while arriving.
    const beat = still ? 0.2 : Math.sin(t * 4.2) * 0.75 + Math.sin(t * 8.4) * 0.12
    uniforms.uFlap.value = lerp(0.15, beat, leaving !== null ? 1 : 0.35 + 0.65 * k)
    // Fire: now and then, once on the orbit.
    const since = t - ARRIVE_S - 1
    const cycle = ((since % BREATH_EVERY) + BREATH_EVERY) % BREATH_EVERY
    uniforms.uBreath.value =
      leaving === null && since > 0
        ? smooth(0, 0.2, cycle) * (1 - smooth(BREATH_S - 0.3, BREATH_S, cycle))
        : 0
    // At night the hide keeps a faint ember glow, so the silhouette still reads against the dark.
    uniforms.uEmber.value = 0.05 + 0.2 * sky.night + 0.22 * uniforms.uBreath.value
  }, FRAME.WORLD)

  if (!built) return null
  return (
    <group ref={group} name="dragon" position={FAR.toArray()}>
      {built.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </group>
  )
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

/** A part, flat-shaded and coloured, with its bend weights (aWing: ±1 a wing; aTail: 0 root … 1 tip). */
function part(
  source: BufferGeometry,
  color: Color | ((p: Vector3) => Color),
  matrix: Matrix4,
  bits: Bits = {},
) {
  const g = (source.index ? source.toNonIndexed() : source.clone()).applyMatrix4(matrix)
  for (const name of Object.keys(g.attributes)) if (name !== "position") g.deleteAttribute(name)
  g.computeVertexNormals()
  const count = g.attributes.position?.count ?? 0
  const colors = new Float32Array(count * 3)
  const p = new Vector3()
  const pos = g.getAttribute("position")
  for (let i = 0; i < count; i++) {
    p.fromBufferAttribute(pos, i)
    const c = typeof color === "function" ? color(p) : color
    colors.set([c.r, c.g, c.b], i * 3)
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3))
  g.setAttribute("aWing", new Float32BufferAttribute(new Float32Array(count).fill(bits.wing ?? 0), 1))
  const tails = new Float32Array(count)
  if (bits.tail !== undefined) for (let i = 0; i < count; i++) tails[i] = bits.tail
  g.setAttribute("aTail", new Float32BufferAttribute(tails, 1))
  g.setAttribute("aGlow", new Float32BufferAttribute(new Float32Array(count).fill(bits.glow ?? 0), 1))
  source.dispose()
  return g
}

const m = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromEuler(new Euler(rx, ry, rz)),
    new Vector3(sx, sy, sz),
  )

/** A cylinder from a to b (radii ra at a, rb at b). */
function limb(
  a: Vector3,
  b: Vector3,
  ra: number,
  rb: number,
  sides = 5,
): { geometry: BufferGeometry; matrix: Matrix4 } {
  const length = a.distanceTo(b)
  const geometry = new CylinderGeometry(rb, ra, length, sides, 1)
  const dir = new Vector3().subVectors(b, a).normalize()
  const matrix = new Matrix4().compose(
    new Vector3().addVectors(a, b).multiplyScalar(0.5),
    new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir),
    new Vector3(1, 1, 1),
  )
  return { geometry, matrix }
}

/** A two-sided triangle fan (a wing membrane panel). */
function panel(points: readonly Vector3[]): BufferGeometry {
  const positions: number[] = []
  for (let i = 1; i < points.length - 1; i++)
    for (const p of [points[0], points[i], points[i + 1]] as Vector3[]) positions.push(p.x, p.y, p.z)
  const g = new Geometry()
  g.setAttribute("position", new Float32BufferAttribute(positions, 3))
  return g
}

/** Shoulder pivots: the wings beat about these (model space, x = ±SHOULDER_X). */
const SHOULDER_X = 0.7
const SHOULDER_Y = 0.75

function buildDragon(uniforms: {
  uTime: { value: number }
  uFlap: { value: number }
  uBreath: { value: number }
  uEmber: { value: number }
}) {
  const parts: BufferGeometry[] = []
  const I = new Matrix4()
  // Body: chest and haunches, faceted; belly plates underneath.
  const hide = (p: Vector3) => (p.y < -0.25 ? BELLY : p.y > 0.55 ? HIDE_DARK : HIDE)
  parts.push(part(new IcosahedronGeometry(1, 0), hide, m(0, 0.2, 1, 0, 0, 0, 1.15, 0.95, 1.7)))
  parts.push(part(new IcosahedronGeometry(1, 0), hide, m(0, 0.05, -1.1, 0.1, 0, 0, 0.95, 0.85, 1.5)))
  // Neck up and forward to the head.
  const neck = limb(new Vector3(0, 0.6, 2.2), new Vector3(0, 1.55, 3.6), 0.62, 0.36, 6)
  parts.push(part(neck.geometry, hide, neck.matrix))
  // Head: skull, snout, jaw, horns, glowing eyes.
  parts.push(part(new IcosahedronGeometry(0.62, 0), hide, m(0, 1.7, 3.95, 0, 0, 0, 1, 0.82, 1.05)))
  parts.push(part(new CylinderGeometry(0.28, 0.4, 1.1, 5), hide, m(0, 1.55, 4.75, Math.PI / 2 + 0.12, 0, 0)))
  parts.push(part(new CylinderGeometry(0.2, 0.3, 0.9, 5), BELLY, m(0, 1.28, 4.6, Math.PI / 2 + 0.3, 0, 0)))
  for (const s of [-1, 1]) {
    parts.push(part(new ConeGeometry(0.13, 0.95, 5), HORN, m(0.3 * s, 2.15, 3.65, -0.9, 0, -0.35 * s)))
    parts.push(part(new ConeGeometry(0.09, 0.55, 4), HORN, m(0.45 * s, 1.95, 3.9, -1.1, 0, -0.9 * s)))
    parts.push(part(new OctahedronGeometry(0.12, 0), EYE, m(0.38 * s, 1.85, 4.3), { glow: 1 }))
    parts.push(part(new OctahedronGeometry(0.06, 0), CLAW, m(0.15 * s, 1.68, 5.28)))
  }
  // Spines along the back.
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
  // Legs tucked under: thighs and claws.
  for (const s of [-1, 1]) {
    parts.push(part(new IcosahedronGeometry(0.42, 0), HIDE, m(0.62 * s, -0.45, -1.2, 0, 0, 0, 0.8, 1, 1.3)))
    parts.push(part(new ConeGeometry(0.16, 0.6, 4), CLAW, m(0.62 * s, -0.75, -1.85, -2.2, 0, 0)))
    parts.push(part(new ConeGeometry(0.13, 0.5, 4), CLAW, m(0.55 * s, -0.55, 1.4, -2.0, 0, 0)))
  }
  // Tail: tapering segments curving back and slightly up, ending in a spade.
  const tailPoints = [0, 1, 2, 3, 4, 5, 6].map(
    (i) => new Vector3(0, 0.1 + Math.sin(i * 0.5) * 0.35, -2.2 - i * 1.15),
  )
  for (let i = 0; i < tailPoints.length - 1; i++) {
    const seg = limb(
      tailPoints[i] as Vector3,
      tailPoints[i + 1] as Vector3,
      0.55 - i * 0.075,
      0.48 - i * 0.075,
      5,
    )
    parts.push(part(seg.geometry, hide, seg.matrix, { tail: (i + 0.5) / (tailPoints.length - 1) }))
  }
  const tip = tailPoints.at(-1) as Vector3
  parts.push(
    part(new OctahedronGeometry(0.6, 0), HIDE_DARK, m(tip.x, tip.y, tip.z - 0.45, 0, 0, 0, 1, 0.18, 1.2), {
      tail: 1,
    }),
  )

  // Wings: an arm to the elbow and the wrist, three finger spars, scalloped membrane between.
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
    for (const [a, b, ra, rb] of [
      [shoulder, elbow, 0.22, 0.16],
      [elbow, wrist, 0.16, 0.1],
      ...fingers.map((f) => [wrist, f, 0.08, 0.04] as const),
    ] as [Vector3, Vector3, number, number][]) {
      const bone = limb(a, b, ra, rb, 4)
      parts.push(part(bone.geometry, SPAR, bone.matrix, { wing: s }))
    }
    parts.push(
      part(new ConeGeometry(0.12, 0.45, 4), HORN, m(wrist.x, wrist.y + 0.25, wrist.z + 0.1, 0.4, 0, 0), {
        wing: s,
      }),
    )
    // Membrane: panels between the bones, the trailing edge scalloped between finger tips.
    const dip = (a: Vector3, b: Vector3) =>
      new Vector3()
        .addVectors(a, b)
        .multiplyScalar(0.5)
        .add(new Vector3(-0.4 * s, 0, 0.55))
    const [f0, f1, f2] = fingers as [Vector3, Vector3, Vector3]
    const membrane = [
      panel([shoulder, elbow, wrist, f2, root]),
      panel([wrist, f0, dip(f0, f1), f1]),
      panel([wrist, f1, dip(f1, f2), f2]),
      panel([f2, dip(f2, root), root]),
    ]
    for (const g of membrane)
      parts.push(part(g, (p) => (Math.abs(p.x) > 5 ? HIDE_DARK : MEMBRANE), I, { wing: s }))
  }

  const geometry = mergeGeometries(parts) ?? new IcosahedronGeometry(1, 0)
  for (const g of parts) g.dispose()
  const material = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.75,
    side: DoubleSide,
  })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime
    shader.uniforms.uFlap = uniforms.uFlap
    shader.uniforms.uEmber = uniforms.uEmber
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aWing; attribute float aTail; attribute float aGlow;
        uniform float uTime; uniform float uFlap;
        varying float vGlow;
        vec3 bendWing(vec3 p) {
          // About the shoulder, along the body's long axis; the outer wing lags and bends further.
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
        vGlow = aGlow;
        if (aWing != 0.0) transformed = bendWing(transformed);
        if (aTail > 0.0) transformed.x += sin(uTime * 2.4 - aTail * 3.2) * aTail * aTail * 1.4;`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
        if (aWing != 0.0) {
          float reach = smoothstep(2.0, 8.5, abs(position.x));
          float angle = aWing * (uFlap + reach * 0.35 * uFlap);
          float c = cos(angle), s = sin(angle);
          objectNormal.xy = vec2(objectNormal.x * c - objectNormal.y * s, objectNormal.x * s + objectNormal.y * c);
        }`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vGlow;\nuniform float uEmber;")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * (vGlow * 2.5 + uEmber);",
      )
  }
  material.customProgramCacheKey = () => "dragon"
  const dragon = new Mesh(geometry, material)
  // It flies: never in the static shadow map.
  dragon.castShadow = false
  dragon.receiveShadow = false
  dragon.frustumCulled = false
  return { meshes: [dragon, fire(uniforms)] }
}

// ─────────────────────────────── fire ───────────────────────────────

/** Flames from the jaws, in model space: a cone of puffs, each looping while the breath lasts. */
function fire(uniforms: { uTime: { value: number }; uBreath: { value: number } }): InstancedMesh {
  const COUNT = 46
  const seed = new Float32Array(COUNT)
  const spread = new Float32Array(COUNT * 2)
  for (let i = 0; i < COUNT; i++) {
    seed[i] = hash01(i * 13)
    spread.set([hash01(i * 13 + 1) - 0.5, hash01(i * 13 + 2) - 0.5], i * 2)
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
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; varying float vHeat;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.3, 1.0, d)) * smoothstep(0.0, 0.25, vHeat) * 0.92;
        if (a < 0.01) discard;
        vec3 colour = mix(vec3(0.95, 0.25, 0.05), vec3(1.0, 0.9, 0.45), vHeat * vHeat);
        // Hot enough to bloom at night; opaque enough to read against a bright sky.
        gl_FragColor = vec4(colour * (1.0 + 1.2 * vHeat), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
  })
  const mesh = new InstancedMesh(geometry, material, COUNT)
  mesh.frustumCulled = false
  mesh.renderOrder = 7
  return mesh
}
