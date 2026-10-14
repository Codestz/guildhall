/**
 * The festival (a clean sweep): bunting and paper lanterns go up round the busiest square and down
 * the ways out of it, pennant by pennant; by night fireworks burst over the keep, by day confetti
 * volleys over the square; at the end it all comes down again. Ported from V1
 * (scene/events/Festival.tsx), on the square's own pole spots (world `squareSite`).
 *
 * Two draws: the poles, cords, pennants and lanterns (one merged mesh in the island's light: each
 * vertex grows out of its anchor as the reveal passes it, cloth sways, and the lanterns' paper is lit
 * with the town's lamps at dusk), and every spark or scrap of confetti (one instanced mesh whose motion
 * lives wholly in its vertex shader). The CPU moves two numbers a frame.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  BufferGeometry as Geometry,
  Group,
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
import type { Vec3 } from "../events/sites.ts"
import { clamp01, envelope, hash01, litMaterial, type ShowCtx, type ShowPiece, smooth } from "./show.ts"

/** A pole's height, and how far a cord sags per metre of its length. */
export const POLE_H = 4.4
const SAG = 0.08
/** A pennant's drop and its spacing along a cord; a lantern's spacing (metres). */
const PENNANT_DROP = 0.7
const PENNANT_EVERY = 0.85
const LANTERN_EVERY = 1.7

const PENNANTS = ["#d4493a", "#3f74c4", "#ecc046", "#4f9d4a", "#f3ead8", "#cf6a2f"].map((c) => new Color(c))
const WOOD = new Color("#6b4a2f")
const CORD = new Color("#3b2c22")
const GOLD = new Color("#e3b448")
const PAPER = ["#ff9d3b", "#e9503d", "#ffd36b"].map((c) => new Color(c))
const CAP = new Color("#3a2a20")

interface Part {
  geometry: BufferGeometry
  color: Color
  anchor: Vector3
  order: number
  /** Per vertex: how far below its cord it hangs, the sway's weight (none for rigid parts). */
  sway?: (y: number) => number
  glow?: number
}

/** A part's colour, anchor, reveal order, sway and glow, baked into a non-indexed copy. */
function bake(part: Part): BufferGeometry {
  const g = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry
  if (g !== part.geometry) part.geometry.dispose()
  for (const name of Object.keys(g.attributes)) if (name !== "position") g.deleteAttribute(name)
  g.computeVertexNormals()
  const pos = g.getAttribute("position")
  const count = pos.count
  const colors = new Float32Array(count * 3)
  const anchors = new Float32Array(count * 3)
  const sways = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    part.color.toArray(colors, i * 3)
    part.anchor.toArray(anchors, i * 3)
    sways[i] = part.sway ? part.sway(pos.getY(i)) : 0
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3))
  g.setAttribute("aAnchor", new Float32BufferAttribute(anchors, 3))
  g.setAttribute("aOrder", new Float32BufferAttribute(new Float32Array(count).fill(part.order), 1))
  g.setAttribute("aSway", new Float32BufferAttribute(sways, 1))
  g.setAttribute("_glow", new Float32BufferAttribute(new Float32Array(count).fill(part.glow ?? 0), 1))
  return g
}

/** A point on a cord between two pole tops, `t` 0 … 1, sagging in the middle. */
function cordAt(a: Vec3, b: Vec3, t: number, out: Vector3): Vector3 {
  const length = Math.hypot(b[0] - a[0], b[2] - a[2])
  const ya = a[1] + POLE_H - 0.12
  const yb = b[1] + POLE_H - 0.12
  return out.set(
    a[0] + (b[0] - a[0]) * t,
    ya + (yb - ya) * t - SAG * length * 4 * t * (1 - t),
    a[2] + (b[2] - a[2]) * t,
  )
}

const UP = new Vector3(0, 1, 0)

/** A thin box from p to q (a cord's segment). */
function segment(p: Vector3, q: Vector3, thickness: number): BufferGeometry {
  const box = new BoxGeometry(thickness, p.distanceTo(q), thickness)
  box.applyMatrix4(
    new Matrix4().compose(
      new Vector3().addVectors(p, q).multiplyScalar(0.5),
      new Quaternion().setFromUnitVectors(UP, new Vector3().subVectors(q, p).normalize()),
      new Vector3(1, 1, 1),
    ),
  )
  return box
}

/** A pennant: a triangle hanging point down from (left, right) on a cord (drawn from both sides). */
function pennant(left: Vector3, right: Vector3, drop: number): BufferGeometry {
  const tip = new Vector3().addVectors(left, right).multiplyScalar(0.5)
  tip.y -= drop
  const g = new Geometry()
  g.setAttribute(
    "position",
    new Float32BufferAttribute([...left.toArray(), ...right.toArray(), ...tip.toArray()], 3),
  )
  return g
}

/** Every pole, cord, pennant and lantern round the square, as one geometry (null without a square). */
export function buildBunting(ctx: Pick<ShowCtx, "sites">): BufferGeometry | null {
  const site = ctx.sites.square
  if (!site) return null
  const parts: BufferGeometry[] = []
  site.poles.forEach(([x, y, z], i) => {
    const base = new Vector3(x, y, z)
    const order = 0.02 * (i % 8)
    parts.push(
      bake({
        geometry: new CylinderGeometry(0.075, 0.1, POLE_H, 6).translate(x, y + POLE_H / 2, z),
        color: WOOD,
        anchor: base,
        order,
      }),
      bake({
        geometry: new OctahedronGeometry(0.16, 0).translate(x, y + POLE_H + 0.1, z),
        color: GOLD,
        anchor: base,
        order,
      }),
    )
  })
  const p = new Vector3()
  const q = new Vector3()
  const n = site.cords.length
  site.cords.forEach(({ a, b, hang }, k) => {
    const A = site.poles[a] as Vec3
    const B = site.poles[b] as Vec3
    const length = Math.hypot(B[0] - A[0], B[2] - A[2])
    const steps = Math.max(3, Math.round(length / 0.9))
    const start = 0.18 + (0.5 * k) / n
    for (let s = 0; s < steps; s++) {
      cordAt(A, B, s / steps, p)
      cordAt(A, B, (s + 1) / steps, q)
      const mid = new Vector3().addVectors(p, q).multiplyScalar(0.5)
      parts.push(
        bake({ geometry: segment(p, q, 0.05), color: CORD, anchor: mid, order: start + (0.45 * s) / steps }),
      )
    }
    if (hang === "pennants") {
      const count = Math.max(2, Math.floor(length / PENNANT_EVERY))
      for (let i = 0; i < count; i++) {
        const t0 = (i + 0.1) / count
        const t1 = (i + 0.9) / count
        const left = cordAt(A, B, t0, new Vector3())
        const right = cordAt(A, B, t1, new Vector3())
        const top = new Vector3().addVectors(left, right).multiplyScalar(0.5)
        parts.push(
          bake({
            geometry: pennant(left, right, PENNANT_DROP),
            color: PENNANTS[(i + k) % PENNANTS.length] as Color,
            anchor: top,
            order: start + 0.05 + 0.45 * t0,
            sway: (y) => clamp01((top.y - y) / PENNANT_DROP),
          }),
        )
      }
    } else {
      const count = Math.max(1, Math.floor(length / LANTERN_EVERY))
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count
        const at = cordAt(A, B, t, new Vector3())
        const order = start + 0.1 + 0.45 * t
        const paper = PAPER[(i + k) % PAPER.length] as Color
        const sway = (y: number) => clamp01((at.y - y) / 0.7) * 0.7
        const anchor = at.clone()
        parts.push(
          bake({
            geometry: new CylinderGeometry(0.015, 0.015, 0.16, 3).translate(at.x, at.y - 0.08, at.z),
            color: CAP,
            anchor,
            order,
            sway,
          }),
          bake({
            geometry: new CylinderGeometry(0.13, 0.13, 0.06, 6).translate(at.x, at.y - 0.19, at.z),
            color: CAP,
            anchor,
            order,
            sway,
          }),
          bake({
            // a faceted paper body: an elongated octagonal drum
            geometry: new CylinderGeometry(0.2, 0.2, 0.36, 6, 1).translate(at.x, at.y - 0.42, at.z),
            color: paper,
            anchor,
            order,
            sway,
            glow: 1,
          }),
          bake({
            geometry: new CylinderGeometry(0.1, 0.1, 0.05, 6).translate(at.x, at.y - 0.63, at.z),
            color: CAP,
            anchor,
            order,
            sway,
          }),
        )
      }
    }
  })
  const geometry = mergeGeometries(parts)
  for (const g of parts) g.dispose()
  return geometry
}

/** Each vertex grows out of its anchor once `uReveal` passes its order; cloth sways with `aSway`. */
function buntingMaterial(uniforms: { uTime: { value: number }; uReveal: { value: number } }) {
  return litMaterial(
    "festival",
    (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute vec3 aAnchor;\nattribute float aOrder;\nattribute float aSway;\nuniform float uReveal;\nuniform float uTime;",
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
float grown = smoothstep(aOrder, aOrder + 0.12, uReveal);
transformed = aAnchor + (transformed - aAnchor) * grown;
float gust = sin(uTime * 4.2 + aAnchor.z * 0.8 + aAnchor.x * 0.55);
transformed.x += gust * 0.12 * aSway;
transformed.z += cos(uTime * 3.1 + aAnchor.x * 0.7) * 0.08 * aSway;`,
        )
      // the paper glows its own colour with the town's lamps (patchGlow's uGlow), brighter than the glass
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * uGlow * 1.6;",
      )
    },
    { flat: true, doubleSided: true },
  )
}

// ─────────────────────────────── fireworks and confetti ───────────────────────────────

const SPARK_COLORS = ["#ff5a4a", "#ffd25a", "#5ad0ff", "#9cff6a", "#ff7ad9", "#fff2c8"].map(
  (c) => new Color(c),
)

function sparkGeometry(
  count: number,
  plane: PlaneGeometry,
  fill: (
    i: number,
    out: { birth: number; origin: Vector3; dir: Vector3; color: Color; lead: number },
  ) => void,
): PlaneGeometry {
  const birth = new Float32Array(count)
  const origin = new Float32Array(count * 3)
  const dir = new Float32Array(count * 3)
  const color = new Float32Array(count * 3)
  const lead = new Float32Array(count)
  const s = { birth: 0, origin: new Vector3(), dir: new Vector3(), color: new Color(), lead: 0 }
  for (let i = 0; i < count; i++) {
    fill(i, s)
    birth[i] = s.birth
    s.origin.toArray(origin, i * 3)
    s.dir.toArray(dir, i * 3)
    s.color.toArray(color, i * 3)
    lead[i] = s.lead
  }
  plane.setAttribute("aBirth", new InstancedBufferAttribute(birth, 1))
  plane.setAttribute("aOrigin", new InstancedBufferAttribute(origin, 3))
  plane.setAttribute("aDir", new InstancedBufferAttribute(dir, 3))
  plane.setAttribute("aColor", new InstancedBufferAttribute(color, 3))
  plane.setAttribute("aLead", new InstancedBufferAttribute(lead, 1))
  return plane
}

/** Bursts over the keep: a rocket climbs from its roofs, bursts into a sphere of sparks that droop and twinkle out. */
export const BURSTS = 13
const PER_BURST = 52

function fireworks(
  over: Vec3,
  still: boolean,
  uniforms: { uTime: { value: number }; uFade: { value: number } },
) {
  const count = BURSTS * PER_BURST
  const geometry = sparkGeometry(count, new PlaneGeometry(1, 1), (i, s) => {
    const b = Math.floor(i / PER_BURST)
    const k = i % PER_BURST
    s.birth = 1.2 + b * 2.45 + hash01(b * 7) * 1.1
    s.origin.set(
      over[0] - 16 + hash01(b * 7 + 1) * 32,
      over[1] + 10 + hash01(b * 7 + 3) * 9,
      over[2] - 16 + hash01(b * 7 + 2) * 32,
    )
    const speed = 13 + hash01(b * 7 + 4) * 6
    // a Fibonacci sphere: an even, round burst
    const y = 1 - (2 * (k + 0.5)) / PER_BURST
    const r = Math.sqrt(1 - y * y)
    const a = k * 2.399963 + b
    s.dir.set(Math.cos(a) * r, y, Math.sin(a) * r).multiplyScalar(speed * (0.85 + 0.3 * hash01(i)))
    s.color.copy(SPARK_COLORS[(k % 3 === 0 ? b + 3 : b) % SPARK_COLORS.length] as Color)
    s.lead = k === 0 ? 1 : 0
  })
  const material = new ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uFade: uniforms.uFade,
      uStill: { value: still ? 1 : 0 },
      uFrom: { value: new Vector3(over[0], over[1] - 6, over[2]) },
    },
    vertexShader: /* glsl */ `
attribute float aBirth; attribute vec3 aOrigin; attribute vec3 aDir; attribute vec3 aColor; attribute float aLead;
uniform float uTime; uniform float uStill; uniform vec3 uFrom;
varying vec3 vColor; varying float vAlpha; varying vec2 vUv;
const float RISE = 1.0;
const float LIFE = 3.0;
void main() {
  float age = uTime - aBirth;
  vUv = uv;
  vColor = aColor;
  vAlpha = 0.0;
  if (age < 0.0 || age > RISE + LIFE) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 p;
  float size;
  if (age < RISE) {
    // the rocket: only the burst's lead spark, climbing from the keep's roofs with a wobble
    float k = age / RISE;
    vec3 from = mix(uFrom, aOrigin, 0.15);
    from.y = uFrom.y;
    p = mix(from, aOrigin, 1.0 - (1.0 - k) * (1.0 - k));
    p.x += sin(age * 22.0) * 0.06;
    size = 1.0;
    vAlpha = aLead;
    vColor = vec3(1.0, 0.85, 0.6);
  } else {
    float t = age - RISE;
    float drag = (1.0 - exp(-t * 2.4)) / 2.4;
    p = aOrigin + aDir * drag;
    p.y -= 1.2 * t * t;
    float life = 1.0 - t / LIFE;
    size = mix(0.4, 1.5, life) * (1.0 + 0.4 * (1.0 - smoothstep(0.0, 0.2, t)));
    float twinkle = uStill > 0.5 ? 1.0 : 0.6 + 0.4 * sin(t * 34.0 + aDir.x * 9.0);
    vAlpha = life * life * twinkle;
    // the first instant is a white-hot flash
    vColor = mix(vec3(1.0, 0.95, 0.85), aColor, smoothstep(0.0, 0.18, t));
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */ `
uniform float uFade;
varying vec3 vColor; varying float vAlpha; varying vec2 vUv;
void main() {
  // a four-pointed star: bright where both axes are near the middle
  vec2 q = abs(vUv - 0.5) * 2.0;
  float core = clamp(1.0 - (q.x + q.y) * 0.9 - q.x * q.y * 2.0, 0.0, 1.0);
  float a = core * vAlpha * uFade;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * (1.3 + 2.4 * core), a);
}`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  return { mesh: new InstancedMesh(geometry, material, count), geometry, material }
}

/** Volleys of paper confetti over the square, tumbling down on the breeze. */
export const VOLLEYS = 9
const PER_VOLLEY = 60

function confetti(cannons: Vec3[], uniforms: { uTime: { value: number }; uFade: { value: number } }) {
  const count = VOLLEYS * PER_VOLLEY
  const geometry = sparkGeometry(count, new PlaneGeometry(0.75, 0.45), (i, s) => {
    const v = Math.floor(i / PER_VOLLEY)
    const [cx, cy, cz] = cannons[v % cannons.length] as Vec3
    s.birth = 0.8 + v * 3.3 + hash01(v * 5) * 0.8 + hash01(i * 3) * 0.25
    s.origin.set(cx, cy + 1, cz)
    const a = hash01(i * 3 + 1) * Math.PI * 2
    const spread = 1.1 + hash01(i * 3 + 2) * 2.4
    s.dir.set(Math.cos(a) * spread, 7 + hash01(i * 5) * 4, Math.sin(a) * spread)
    s.color.copy(PENNANTS[(i * 7) % 4] as Color)
    s.lead = hash01(i * 11)
  })
  const material = new ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uFade: uniforms.uFade, uFloor: { value: cannons[0]?.[1] ?? 0 } },
    vertexShader: /* glsl */ `
attribute float aBirth; attribute vec3 aOrigin; attribute vec3 aDir; attribute vec3 aColor; attribute float aLead;
uniform float uTime; uniform float uFloor;
varying vec3 vColor; varying float vAlpha;
const float LIFE = 7.0;
void main() {
  float t = uTime - aBirth;
  vAlpha = 0.0;
  vColor = aColor;
  if (t < 0.0 || t > LIFE) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // shot up fast, drag bleeds the speed, then each scrap flutters down at its own pace
  float drag = (1.0 - exp(-t * 3.0)) / 3.0;
  vec3 p = aOrigin + aDir * drag;
  p.y -= (0.6 + aLead * 0.45) * max(0.0, t - 0.35);
  p.x += sin(t * 2.6 + aLead * 20.0) * 0.35 * min(1.0, t);
  p.z += cos(t * 2.1 + aLead * 13.0) * 0.25 * min(1.0, t);
  p.y = max(p.y, uFloor + 0.04);
  // tumbling: the scrap turns edge-on and back (its width flips through zero)
  float spin = cos(t * (6.0 + aLead * 6.0) + aLead * 30.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += vec2(position.x * spin, position.y) * 0.5;
  gl_Position = projectionMatrix * mv;
  vColor = aColor * (0.75 + 0.35 * abs(spin));
  vAlpha = 1.0 - smoothstep(LIFE - 1.2, LIFE, t);
}`,
    fragmentShader: /* glsl */ `
uniform float uFade;
varying vec3 vColor; varying float vAlpha;
void main() {
  if (vAlpha * uFade < 0.5) discard;
  gl_FragColor = vec4(vColor, 1.0);
  #include <colorspace_fragment>
}`,
    side: DoubleSide,
    blending: NormalBlending,
  })
  return { mesh: new InstancedMesh(geometry, material, count), geometry, material }
}

export function createFestival(ctx: ShowCtx): ShowPiece {
  const uniforms = { uTime: { value: 0 }, uReveal: { value: 0 }, uFade: { value: 0 } }
  const group = new Group()
  group.name = "show festival"
  const buntingGeometry = buildBunting(ctx)
  const cloth = buntingGeometry ? new Mesh(buntingGeometry, buntingMaterial(uniforms)) : null
  if (cloth) {
    cloth.name = "festival bunting"
    // it comes and goes: never in the static shadow map, but in the island's shade
    cloth.castShadow = false
    cloth.receiveShadow = true
    cloth.frustumCulled = false
    group.add(cloth)
  }
  const square = ctx.sites.square
  const over = ctx.sites.castle ?? (square ? ([square.at[0], square.at[1] + 6, square.at[2]] as Vec3) : null)
  const cannons = square ? square.poles.slice(0, 6).map(([x, y, z]) => [x, y, z] as Vec3) : over ? [over] : []
  const sparks = ctx.night
    ? over
      ? fireworks(over, ctx.still, uniforms)
      : null
    : cannons.length
      ? confetti(cannons, uniforms)
      : null
  if (sparks) {
    sparks.mesh.name = ctx.night ? "festival fireworks" : "festival confetti"
    sparks.mesh.frustumCulled = false
    sparks.mesh.renderOrder = 20
    group.add(sparks.mesh)
  }
  return {
    object: group,
    draws: () => (group.visible ? (cloth ? 1 : 0) + (sparks ? 1 : 0) : 0),
    update(t, total) {
      uniforms.uTime.value = t
      // up pennant by pennant over ~4 s; down again over the last 3.5
      uniforms.uReveal.value = Math.min(smooth(0, 4.5, t), 1 - smooth(total - 3.5, total, t)) * 1.25
      uniforms.uFade.value = envelope(t, total, 0.5, 3)
    },
    dispose() {
      group.removeFromParent()
      buntingGeometry?.dispose()
      cloth?.material.dispose()
      sparks?.geometry.dispose()
      sparks?.material.dispose()
    },
  }
}
