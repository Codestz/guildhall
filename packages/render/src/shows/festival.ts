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

// ─────────────────────────────── the fireworks' programme ───────────────────────────────

/** The fireworks' kinds of shell. */
export type ShellStyle = "peony" | "willow" | "crackle" | "ring"
const STYLE_CODE: Record<ShellStyle, number> = { peony: 0, willow: 1, crackle: 2, ring: 3 }

/** One shell: when it is launched (s into the show), its kind, where it bursts (from over the keep), its colours and its size. */
export interface Shell {
  launch: number
  style: ShellStyle
  /** Where it bursts, metres from the keep's top (x, up, z). */
  at: [number, number, number]
  /** Its stars' colour, and the colour they turn to as they burn (indices into `SHELL_COLOURS`). */
  colour: number
  turn: number
  /** How far its stars are thrown (1 a plain shell). */
  size: number
}

/** A rocket's climb from the keep's roofs to its burst, seconds. */
export const ROCKET_S = 1.1
/** How long each kind's stars burn after the burst, seconds. */
export const STAR_S: Readonly<Record<ShellStyle, number>> = {
  peony: 2.8,
  willow: 4.8,
  crackle: 2.6,
  ring: 2.6,
}
/** Stars in a shell, and the sparks of a rocket's trail. */
export const STARS = 60
const TRAIL = 7
/** When the finale's salvo begins, seconds into the show. */
export const FINALE_S = 21.5

/** red, gold, cyan, green, rose, cream, violet, orange: bright, so they bloom by night. */
export const SHELL_COLOURS = [
  "#ff4a3d",
  "#ffc23a",
  "#45c8ff",
  "#7dff5a",
  "#ff6fcf",
  "#fff0c8",
  "#a77bff",
  "#ff8a2a",
].map((c) => new Color(c))
const GOLD_I = 1
const CREAM_I = 5

/**
 * The night's programme, the same every time: an opening of single shells, a middle that mixes every
 * kind (two at once now and then), a finale salvo from `FINALE_S` that builds to a crown of gold
 * willows and a crackle, and a short coda. About 30 shells over 36 s; the director holds the keep
 * through the finale (sim `SHOW_LOOK.festival`). Many colours, as the user asked: every shell has its
 * own and turns to another as it burns; only the willows are gold.
 */
export function fireworksProgramme(): Shell[] {
  const out: Shell[] = []
  let n = 0
  const shell = (launch: number, style: ShellStyle, size = 1, colour?: number, turn?: number) => {
    const h = (k: number) => hash01(n * 31 + k)
    // by chance any colour but the cream (it would read white): that is for the crackles and the willows to turn to
    const c = colour ?? ([0, 1, 2, 3, 4, 6, 7][Math.floor(h(1) * 7)] as number)
    out.push({
      launch,
      style,
      at: [(h(2) - 0.5) * 30, 15 + h(3) * 9 + (size - 1) * 6, (h(4) - 0.5) * 30],
      colour: style === "willow" ? (colour ?? GOLD_I) : c,
      turn: turn ?? (style === "willow" ? CREAM_I : (c + 1 + Math.floor(h(5) * 3)) % SHELL_COLOURS.length),
      size,
    })
    n++
  }
  // the opening: one at a time
  shell(1.0, "peony", 1, 0, 1)
  shell(3.0, "ring", 1, 2)
  shell(5.0, "peony", 1, 4)
  shell(6.8, "willow")
  // the middle: every kind, some in pairs
  shell(9.0, "crackle")
  shell(10.4, "peony", 1, 3)
  shell(10.9, "peony", 1, 6)
  shell(12.8, "ring", 1.1, 1)
  shell(14.4, "willow", 1.1)
  shell(15.9, "crackle", 1, 5)
  shell(17.1, "peony", 1.1, 7)
  shell(17.6, "ring", 1, 4)
  shell(19.3, "peony", 1.1, 2)
  // the finale: a salvo, quicker and bigger, crowned by gold willows and a crackle
  const salvo: ShellStyle[] = [
    "peony",
    "ring",
    "crackle",
    "peony",
    "ring",
    "peony",
    "crackle",
    "peony",
    "ring",
    "peony",
  ]
  salvo.forEach((style, i) => {
    shell(FINALE_S + i * 0.42, style, 1.15 + i * 0.02)
  })
  for (let i = 0; i < 3; i++) shell(FINALE_S + 4.6 + i * 0.22, "willow", 1.3)
  shell(FINALE_S + 5.4, "crackle", 1.35, CREAM_I, GOLD_I)
  // the coda
  shell(32.0, "peony", 1, 4, 5)
  shell(34.6, "willow", 1.1)
  return out
}

const X_AXIS = new Vector3(1, 0, 0)

/** Bursts over the keep: rockets climb from its roofs trailing sparks and burst into stars of four kinds. */
function fireworks(
  over: Vec3,
  still: boolean,
  uniforms: { uTime: { value: number }; uFade: { value: number } },
) {
  const shells = fireworksProgramme()
  const per = STARS + TRAIL + 1
  const count = shells.length * per
  const birth = new Float32Array(count)
  const origin = new Float32Array(count * 3)
  const dir = new Float32Array(count * 3)
  const colour = new Float32Array(count * 3)
  const turn = new Float32Array(count * 3)
  // role (0 a star, 1 the rocket's head and the burst's flash, 2 a trail spark), style, a seed
  const kind = new Float32Array(count * 3)
  const d = new Vector3()
  shells.forEach((sh, b) => {
    const style = STYLE_CODE[sh.style]
    const speed = (sh.style === "willow" ? 10.5 : 14.5) * sh.size
    // a ring lies in its own tilted plane
    const tilt = hash01(b * 13 + 7) * 1.1 - 0.55
    const yaw = hash01(b * 13 + 8) * Math.PI
    for (let k = 0; k < per; k++) {
      const i = b * per + k
      birth[i] = sh.launch
      origin[i * 3] = over[0] + sh.at[0]
      origin[i * 3 + 1] = over[1] + sh.at[1]
      origin[i * 3 + 2] = over[2] + sh.at[2]
      ;(SHELL_COLOURS[sh.colour] as Color).toArray(colour, i * 3)
      ;(SHELL_COLOURS[sh.turn] as Color).toArray(turn, i * 3)
      const role = k < STARS ? 0 : k === STARS ? 1 : 2
      kind[i * 3] = role
      kind[i * 3 + 1] = style
      kind[i * 3 + 2] = hash01(i * 7 + 3)
      if (role === 2)
        // a trail spark: how far it lags the head, seconds
        d.set(((k - STARS - 1) / TRAIL) * 0.34 + 0.03, 0, 0)
      else if (role === 1) d.set(0, 0, 0)
      else if (sh.style === "ring") {
        const a = (k / STARS) * Math.PI * 2
        d.set(Math.cos(a), 0, Math.sin(a))
          .applyAxisAngle(X_AXIS, tilt)
          .applyAxisAngle(UP, yaw)
          .multiplyScalar(speed * (0.96 + 0.08 * hash01(i)))
      } else {
        // a Fibonacci sphere: an even, round burst
        const y = 1 - (2 * (k + 0.5)) / STARS
        const r = Math.sqrt(1 - y * y)
        const a = k * 2.399963 + b
        d.set(Math.cos(a) * r, y, Math.sin(a) * r).multiplyScalar(speed * (0.86 + 0.28 * hash01(i)))
      }
      d.toArray(dir, i * 3)
    }
  })
  const geometry = new PlaneGeometry(1, 1)
  geometry.setAttribute("aBirth", new InstancedBufferAttribute(birth, 1))
  geometry.setAttribute("aOrigin", new InstancedBufferAttribute(origin, 3))
  geometry.setAttribute("aDir", new InstancedBufferAttribute(dir, 3))
  geometry.setAttribute("aColor", new InstancedBufferAttribute(colour, 3))
  geometry.setAttribute("aTurn", new InstancedBufferAttribute(turn, 3))
  geometry.setAttribute("aKind", new InstancedBufferAttribute(kind, 3))
  const material = new ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uFade: uniforms.uFade,
      uStill: { value: still ? 1 : 0 },
      uFrom: { value: new Vector3(over[0], over[1] - 4, over[2]) },
    },
    vertexShader: /* glsl */ `
attribute float aBirth; attribute vec3 aOrigin; attribute vec3 aDir; attribute vec3 aColor; attribute vec3 aTurn;
attribute vec3 aKind;
uniform float uTime; uniform float uStill; uniform vec3 uFrom;
varying vec3 vColor; varying float vAlpha; varying vec2 vUv;
const float RISE = ${ROCKET_S.toFixed(2)};
float lifeOf(float style) {
  return style < 0.5 ? ${STAR_S.peony.toFixed(1)} : style < 1.5 ? ${STAR_S.willow.toFixed(1)} : style < 2.5 ? ${STAR_S.crackle.toFixed(1)} : ${STAR_S.ring.toFixed(1)};
}
// the rocket on its way up, a seconds after launch: from the keep's roofs, wobbling a little
vec3 rocket(float a) {
  float k = clamp(a / RISE, 0.0, 1.0);
  vec3 from = uFrom + vec3((aOrigin.x - uFrom.x) * 0.15, 0.0, (aOrigin.z - uFrom.z) * 0.15);
  vec3 p = mix(from, aOrigin, 1.0 - (1.0 - k) * (1.0 - k));
  p.x += sin(a * 23.0 + aKind.z * 6.0) * 0.08;
  p.z += cos(a * 17.0) * 0.06;
  return p;
}
void main() {
  float age = uTime - aBirth;
  float role = aKind.x;
  float style = aKind.y;
  float seed = aKind.z;
  float life = lifeOf(style);
  vUv = uv;
  vColor = aColor;
  vAlpha = 0.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (age < 0.0 || age > RISE + life) return;
  vec3 p;
  float size;
  float t = age - RISE;
  if (role > 1.5) {
    // a spark of the rocket's trail: where the head was a moment ago, cooling and falling away
    float lag = aDir.x;
    float a = min(age, RISE) - lag;
    if (a < 0.0 || t > 0.7) return;
    p = rocket(a);
    float since = age - a;
    p.y -= 1.4 * since * since;
    float fade = (1.0 - lag / 0.4) * (1.0 - clamp(t / 0.7, 0.0, 1.0));
    size = 0.38 * (1.0 - 0.5 * lag / 0.4);
    vAlpha = 0.8 * fade;
    vColor = mix(vec3(1.0, 0.8, 0.45), vec3(1.0, 0.45, 0.12), lag / 0.4);
  } else if (role > 0.5) {
    if (t < 0.0) {
      // the rocket's head
      p = rocket(age);
      size = 0.6;
      vAlpha = 1.0;
      vColor = vec3(1.0, 0.86, 0.6);
    } else {
      // the burst's flash: brief, in the shell's colour (never a white sheet)
      if (t > 0.18) return;
      float k = t / 0.18;
      p = aOrigin;
      size = mix(2.6, 1.2, k);
      vAlpha = (1.0 - k) * 0.4;
      vColor = mix(vec3(1.0, 0.92, 0.75), aColor, 0.75) * 0.6;
    }
  } else {
    // a star: thrown out, dragged, drooping under gravity
    if (t < 0.0) return;
    float u = t / life;
    float willow = step(0.5, style) * step(style, 1.5);
    float crackle = step(1.5, style) * step(style, 2.5);
    float drag = mix(2.4, 1.5, willow);
    p = aOrigin + aDir * (1.0 - exp(-t * drag)) / drag;
    p.y -= mix(1.15, 0.85, willow) * t * t;
    // they open out of the burst small and faint, growing as they spread: 60 stars piled at its heart
    // would add up to a white sheet
    float bloom = smoothstep(0.0, 0.3, t);
    size = mix(1.0, 0.4, u) * mix(0.25, 1.0, bloom) * mix(1.0, 1.15, willow);
    vColor = mix(aColor, aTurn, smoothstep(0.35, 0.7, u));
    vColor = mix(vColor, mix(vec3(1.0, 0.75, 0.3), vec3(0.95, 0.4, 0.1), u), willow);
    float twinkle = uStill > 0.5 ? 1.0 : mix(1.0, 0.55 + 0.45 * sin(t * 31.0 + seed * 40.0), smoothstep(0.45, 0.8, u));
    vAlpha = mix(pow(1.0 - u, 1.4), pow(1.0 - u, 0.7), willow) * twinkle * bloom;
    if (crackle > 0.5 && u > 0.5) {
      // the crackle: each star pops in white flickers as it burns out
      float tick = floor(t * 26.0);
      float on = uStill > 0.5 ? 1.0 : step(0.6, fract(sin(seed * 91.7 + tick * 12.9898) * 43758.5453));
      vColor = mix(vColor, vec3(1.0, 0.97, 0.85), 0.8);
      size *= 1.0 + on * 0.9;
      vAlpha = on * (1.0 - smoothstep(0.85, 1.0, u)) * 0.95;
    }
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
  // past the bloom's threshold at the heart of every star: they glow in the night
  gl_FragColor = vec4(vColor * (1.05 + 1.9 * core * core), a);
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
