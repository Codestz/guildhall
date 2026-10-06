import { useFrame } from "@react-three/fiber"
import { useRef } from "react"
import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  BufferGeometry as Geometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { reducedMotion } from "../../guild/opening.ts"
import { sky } from "../atmosphere/state.ts"
import { FRAME } from "../frame.ts"
import { useOwnedMeshes } from "../owned.ts"
import { clamp01, DURATION_S, envelope, hash01, NIGHT_AT, smooth } from "./common.ts"
import type { ShowProps } from "./EventsLayer.tsx"

/**
 * The festival (a clean sweep, guild/events.ts): bunting and paper lanterns go up across the
 * village square and down the avenue, pennant by pennant; by night fireworks burst over the keep,
 * by day confetti volleys over the square. Three draw calls: the poles, cords and pennants (one
 * merged mesh), the lanterns (one merged mesh, glowing at night), and every spark or scrap of
 * confetti (one instanced mesh whose motion lives entirely in its vertex shader).
 */
export default function Festival({ show, events }: ShowProps) {
  const night = useRef(sky.night > NIGHT_AT).current
  const age = useRef(0)
  const finished = useRef(false)
  const uniforms = useRef({ uTime: { value: 0 }, uReveal: { value: 0 }, uFade: { value: 0 } }).current

  const built = useOwnedMeshes(() => buildFestival(uniforms, night), [])

  useFrame((_, delta) => {
    if (!built) return
    age.current += Math.min(delta, 0.1)
    const t = age.current
    const total = DURATION_S.festival
    uniforms.uTime.value = t
    // Up pennant by pennant over ~4 s; down again over the last 3.
    uniforms.uReveal.value = Math.min(smooth(0, 4.5, t), 1 - smooth(total - 3.5, total, t)) * 1.25
    uniforms.uFade.value = envelope(t, total, 0.5, 3)
    built.lanterns.material.color.setScalar(night ? 2.1 + 0.25 * Math.sin(t * 2.3) : 1)
    if (t >= total && !finished.current) {
      finished.current = true
      events.done(show.id)
    }
  }, FRAME.WORLD)

  if (!built) return null
  return (
    <group name="festival">
      {built.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </group>
  )
}

// ─────────────────────────────── layout ───────────────────────────────

/** Pole height and how far a cord sags per unit of its length. */
const POLE_H = 5.6
const SAG = 0.09

/**
 * Poles in pairs across the avenue and round the square (world x, z), and the cords between them
 * (indices into POLES). Pennants hang on the cords that cross; lanterns on the ones that run along.
 * Placed by eye against world/lands.ts DRESSING: clear of the well, the market stalls and the lamps.
 */
const POLES: readonly (readonly [number, number])[] = [
  [-4.6, 17.5],
  [4.6, 17.5],
  [-3.6, 24],
  [3.8, 23.5],
  [-3.8, 30.5],
  [3.4, 29],
  [-3.6, 41],
  [3.6, 41],
  [-12.5, 21],
  [12.5, 27],
]
const CROSS: readonly (readonly [number, number])[] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 3],
  [1, 2],
  [8, 2],
  [3, 9],
]
const ALONG: readonly (readonly [number, number])[] = [
  [0, 2],
  [2, 4],
  [4, 6],
  [1, 3],
  [3, 5],
  [5, 7],
]

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
  /** Per-vertex sway weight: how far below its cord each vertex hangs (0 for rigid parts). */
  sway?: (y: number) => number
}

/** Bake a part's colour and reveal attributes into a non-indexed copy. */
function bake(part: Part): BufferGeometry {
  const g = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry
  for (const name of Object.keys(g.attributes))
    if (name !== "position" && name !== "normal") g.deleteAttribute(name)
  const count = g.attributes.position?.count ?? 0
  const colors = new Float32Array(count * 3)
  const anchors = new Float32Array(count * 3)
  const orders = new Float32Array(count).fill(part.order)
  const sways = new Float32Array(count)
  const pos = g.getAttribute("position")
  for (let i = 0; i < count; i++) {
    colors.set([part.color.r, part.color.g, part.color.b], i * 3)
    anchors.set([part.anchor.x, part.anchor.y, part.anchor.z], i * 3)
    sways[i] = part.sway ? part.sway(pos.getY(i)) : 0
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3))
  g.setAttribute("aAnchor", new Float32BufferAttribute(anchors, 3))
  g.setAttribute("aOrder", new Float32BufferAttribute(orders, 1))
  g.setAttribute("aSway", new Float32BufferAttribute(sways, 1))
  return g
}

/** A point on a cord between two pole tops, t in 0–1, sagging in the middle. */
function cordAt(
  a: readonly [number, number],
  b: readonly [number, number],
  t: number,
  out: Vector3,
): Vector3 {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  return out.set(
    a[0] + (b[0] - a[0]) * t,
    POLE_H - 0.15 - SAG * length * 4 * t * (1 - t),
    a[1] + (b[1] - a[1]) * t,
  )
}

const UP = new Vector3(0, 1, 0)

/** A thin box from p to q (a cord segment). */
function segment(p: Vector3, q: Vector3, thickness: number): BufferGeometry {
  const length = p.distanceTo(q)
  const box = new BoxGeometry(thickness, length, thickness)
  const dir = new Vector3().subVectors(q, p).normalize()
  const matrix = new Matrix4().compose(
    new Vector3().addVectors(p, q).multiplyScalar(0.5),
    new Quaternion().setFromUnitVectors(UP, dir),
    new Vector3(1, 1, 1),
  )
  box.applyMatrix4(matrix)
  return box
}

/** A pennant: a two-sided triangle hanging from (left, right) on a cord, point down. */
function pennant(left: Vector3, right: Vector3, drop: number): BufferGeometry {
  const tip = new Vector3().addVectors(left, right).multiplyScalar(0.5)
  tip.y -= drop
  const g = new Geometry()
  g.setAttribute(
    "position",
    new Float32BufferAttribute(
      [
        ...left.toArray(),
        ...right.toArray(),
        ...tip.toArray(),
        ...right.toArray(),
        ...left.toArray(),
        ...tip.toArray(),
      ],
      3,
    ),
  )
  g.computeVertexNormals()
  return g
}

// ─────────────────────────────── the reveal, on the GPU ───────────────────────────────

/** Each vertex grows out of its anchor once `uReveal` passes its order; cloth sways with `aSway`. */
function reveal(material: MeshStandardMaterial | MeshBasicMaterial, uniforms: Uniforms): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = uniforms.uReveal
    shader.uniforms.uTime = uniforms.uTime
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
        transformed.x += gust * 0.16 * aSway;
        transformed.z += cos(uTime * 3.1 + aAnchor.x * 0.7) * 0.1 * aSway;`,
      )
  }
  material.customProgramCacheKey = () => "festival-reveal"
}

interface Uniforms {
  uTime: { value: number }
  uReveal: { value: number }
  uFade: { value: number }
}

// ─────────────────────────────── build ───────────────────────────────

function buildFestival(uniforms: Uniforms, night: boolean) {
  const bunting: BufferGeometry[] = []
  const lanterns: BufferGeometry[] = []
  const p = new Vector3()
  const q = new Vector3()

  POLES.forEach(([x, z], i) => {
    const order = 0.02 * i
    const base = new Vector3(x, 0, z)
    bunting.push(
      bake({
        geometry: new CylinderGeometry(0.1, 0.14, POLE_H, 6).translate(x, POLE_H / 2, z),
        color: WOOD,
        anchor: base,
        order,
      }),
      bake({
        geometry: new SphereGeometry(0.2, 6, 4).translate(x, POLE_H + 0.12, z),
        color: GOLD,
        anchor: base,
        order,
      }),
    )
  })

  const cord = (
    a: readonly [number, number],
    b: readonly [number, number],
    k: number,
    hang: "pennants" | "lanterns",
  ) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    const steps = Math.max(4, Math.round(length / 1.2))
    const start = 0.18 + k * 0.05
    for (let s = 0; s < steps; s++) {
      cordAt(a, b, s / steps, p)
      cordAt(a, b, (s + 1) / steps, q)
      const mid = new Vector3().addVectors(p, q).multiplyScalar(0.5)
      bunting.push(
        bake({ geometry: segment(p, q, 0.07), color: CORD, anchor: mid, order: start + (0.45 * s) / steps }),
      )
    }
    if (hang === "pennants") {
      const count = Math.max(3, Math.floor(length / 1.15))
      for (let n = 0; n < count; n++) {
        const t0 = (n + 0.08) / count
        const t1 = (n + 0.92) / count
        const left = cordAt(a, b, t0, new Vector3())
        const right = cordAt(a, b, t1, new Vector3())
        const top = new Vector3().addVectors(left, right).multiplyScalar(0.5)
        const geometry = pennant(left, right, 0.95)
        bunting.push(
          bake({
            geometry,
            color: PENNANTS[(n + k) % PENNANTS.length] as Color,
            anchor: top,
            order: start + 0.05 + 0.45 * t0,
            sway: (y) => clamp01((top.y - y) / 0.95),
          }),
        )
      }
    } else {
      const count = Math.max(2, Math.floor(length / 2.6))
      for (let n = 0; n < count; n++) {
        const t = (n + 0.5) / count
        const at = cordAt(a, b, t, new Vector3())
        const anchor = at.clone()
        const order = start + 0.1 + 0.45 * t
        const paper = PAPER[(n + k) % PAPER.length] as Color
        const sway = (y: number) => clamp01((at.y - y) / 0.9) * 0.7
        lanterns.push(
          bake({
            geometry: new CylinderGeometry(0.02, 0.02, 0.22, 3).translate(at.x, at.y - 0.11, at.z),
            color: CAP,
            anchor,
            order,
            sway,
          }),
          bake({
            geometry: new CylinderGeometry(0.17, 0.17, 0.08, 8).translate(at.x, at.y - 0.25, at.z),
            color: CAP,
            anchor,
            order,
            sway,
          }),
          bake({
            geometry: new SphereGeometry(0.3, 8, 6).scale(1, 1.18, 1).translate(at.x, at.y - 0.6, at.z),
            color: paper,
            anchor,
            order,
            sway,
          }),
          bake({
            geometry: new CylinderGeometry(0.14, 0.14, 0.07, 8).translate(at.x, at.y - 0.97, at.z),
            color: CAP,
            anchor,
            order,
            sway,
          }),
        )
      }
    }
  }
  CROSS.forEach(([a, b], k) => {
    cord(POLES[a] as [number, number], POLES[b] as [number, number], k, "pennants")
  })
  ALONG.forEach(([a, b], k) => {
    cord(POLES[a] as [number, number], POLES[b] as [number, number], k + 3, "lanterns")
  })

  const clothMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    flatShading: true,
    side: DoubleSide,
  })
  reveal(clothMaterial, uniforms)
  const cloth = new Mesh(mergeGeometries(bunting) ?? new BoxGeometry(), clothMaterial)
  for (const g of bunting) g.dispose()
  const paperMaterial = new MeshBasicMaterial({ vertexColors: true, toneMapped: true })
  reveal(paperMaterial, uniforms)
  const lit = new Mesh(mergeGeometries(lanterns) ?? new BoxGeometry(), paperMaterial)
  for (const g of lanterns) g.dispose()
  for (const mesh of [cloth, lit]) {
    // The festival comes and goes: never in the static shadow map.
    mesh.castShadow = false
    mesh.receiveShadow = true
    mesh.frustumCulled = false
  }

  const sparks = night ? fireworks(uniforms) : confetti(uniforms)
  return { meshes: [cloth, lit, sparks] as Mesh[], lanterns: lit as Mesh & { material: MeshBasicMaterial } }
}

// ─────────────────────────────── fireworks and confetti ───────────────────────────────

const SPARK_COLORS = ["#ff5a4a", "#ffd25a", "#5ad0ff", "#9cff6a", "#ff7ad9", "#fff2c8"].map(
  (c) => new Color(c),
)

/** Bursts over the keep: a rocket climbs, bursts into a sphere of sparks that droop and twinkle out. */
function fireworks(uniforms: Uniforms): InstancedMesh {
  const BURSTS = 13
  const PER = 52
  const count = BURSTS * PER
  const birth = new Float32Array(count)
  const origin = new Float32Array(count * 3)
  const dir = new Float32Array(count * 3)
  const color = new Float32Array(count * 3)
  const lead = new Float32Array(count)
  const v = new Vector3()
  for (let b = 0; b < BURSTS; b++) {
    const t = 1.2 + b * 2.45 + hash01(b * 7) * 1.1
    const ox = -22 + hash01(b * 7 + 1) * 44
    const oz = -28 + hash01(b * 7 + 2) * 38
    const oy = 22 + hash01(b * 7 + 3) * 10
    const c = SPARK_COLORS[b % SPARK_COLORS.length] as Color
    const c2 = SPARK_COLORS[(b + 3) % SPARK_COLORS.length] as Color
    const speed = 15 + hash01(b * 7 + 4) * 7
    for (let k = 0; k < PER; k++) {
      const i = b * PER + k
      birth[i] = t
      origin.set([ox, oy, oz], i * 3)
      // A Fibonacci sphere: an even, round burst.
      const y = 1 - (2 * (k + 0.5)) / PER
      const r = Math.sqrt(1 - y * y)
      const a = k * 2.399963 + b
      v.set(Math.cos(a) * r, y, Math.sin(a) * r).multiplyScalar(speed * (0.85 + 0.3 * hash01(i)))
      dir.set([v.x, v.y, v.z], i * 3)
      const pick = k % 3 === 0 ? c2 : c
      color.set([pick.r, pick.g, pick.b], i * 3)
      lead[i] = k === 0 ? 1 : 0
    }
  }
  const geometry = new PlaneGeometry(1, 1)
  geometry.setAttribute("aBirth", new InstancedBufferAttribute(birth, 1))
  geometry.setAttribute("aOrigin", new InstancedBufferAttribute(origin, 3))
  geometry.setAttribute("aDir", new InstancedBufferAttribute(dir, 3))
  geometry.setAttribute("aColor", new InstancedBufferAttribute(color, 3))
  geometry.setAttribute("aLead", new InstancedBufferAttribute(lead, 1))
  const material = new ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uFade: uniforms.uFade, uStill: { value: reducedMotion() ? 1 : 0 } },
    vertexShader: /* glsl */ `
      attribute float aBirth; attribute vec3 aOrigin; attribute vec3 aDir; attribute vec3 aColor; attribute float aLead;
      uniform float uTime; uniform float uStill;
      varying vec3 vColor; varying float vAlpha; varying vec2 vUv;
      const float RISE = 1.0;
      const float LIFE = 3.0;
      void main() {
        float age = uTime - aBirth;
        vUv = uv;
        vColor = aColor;
        vec3 p;
        float size;
        vAlpha = 0.0;
        if (age < 0.0 || age > RISE + LIFE) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        if (age < RISE) {
          // The rocket: only the burst's lead spark, climbing from the keep's roofs with a wobble.
          float k = age / RISE;
          vec3 from = vec3(aOrigin.x * 0.5, 3.0, aOrigin.z * 0.5);
          p = mix(from, aOrigin, 1.0 - (1.0 - k) * (1.0 - k));
          p.x += sin(age * 22.0) * 0.08;
          size = 0.9;
          vAlpha = aLead;
          vColor = vec3(1.0, 0.85, 0.6);
        } else {
          float t = age - RISE;
          float drag = (1.0 - exp(-t * 2.4)) / 2.4;
          p = aOrigin + aDir * drag;
          p.y -= 1.5 * t * t;
          float life = 1.0 - t / LIFE;
          size = mix(0.35, 1.25, life) * (t < 0.15 ? 1.8 : 1.0);
          float twinkle = uStill > 0.5 ? 1.0 : 0.6 + 0.4 * sin(t * 34.0 + aDir.x * 9.0);
          vAlpha = life * life * twinkle;
          // The first instant is a white-hot flash.
          vColor = mix(vec3(1.0, 0.95, 0.85), aColor, smoothstep(0.0, 0.25, t));
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        mv.xy += position.xy * size;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying vec3 vColor; varying float vAlpha; varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float core = 1.0 - smoothstep(0.0, 1.0, d);
        float a = core * core * vAlpha * uFade;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vColor * (1.6 + 3.0 * core), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  const mesh = new InstancedMesh(geometry, material, count)
  mesh.frustumCulled = false
  mesh.renderOrder = 20
  return mesh
}

/** Volleys of paper confetti over the square, tumbling down on the breeze. */
function confetti(uniforms: Uniforms): InstancedMesh {
  const VOLLEYS = 9
  const PER = 60
  const count = VOLLEYS * PER
  const birth = new Float32Array(count)
  const origin = new Float32Array(count * 3)
  const dir = new Float32Array(count * 3)
  const color = new Float32Array(count * 3)
  const lead = new Float32Array(count)
  const CANNONS: readonly (readonly [number, number])[] = [
    [-3, 20],
    [3, 27],
    [-3, 34],
    [2, 38],
  ]
  for (let v = 0; v < VOLLEYS; v++) {
    const t = 0.8 + v * 3.3 + hash01(v * 5) * 0.8
    const [cx, cz] = CANNONS[v % CANNONS.length] as [number, number]
    for (let k = 0; k < PER; k++) {
      const i = v * PER + k
      birth[i] = t + hash01(i * 3) * 0.25
      origin.set([cx, 1.2, cz], i * 3)
      const a = hash01(i * 3 + 1) * Math.PI * 2
      const spread = 1.5 + hash01(i * 3 + 2) * 3.2
      dir.set([Math.cos(a) * spread, 9 + hash01(i * 5) * 5, Math.sin(a) * spread], i * 3)
      const c = PENNANTS[(i * 7) % 4] as Color
      color.set([c.r, c.g, c.b], i * 3)
      lead[i] = hash01(i * 11)
    }
  }
  const geometry = new PlaneGeometry(1, 0.6)
  geometry.setAttribute("aBirth", new InstancedBufferAttribute(birth, 1))
  geometry.setAttribute("aOrigin", new InstancedBufferAttribute(origin, 3))
  geometry.setAttribute("aDir", new InstancedBufferAttribute(dir, 3))
  geometry.setAttribute("aColor", new InstancedBufferAttribute(color, 3))
  geometry.setAttribute("aLead", new InstancedBufferAttribute(lead, 1))
  const material = new ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uFade: uniforms.uFade },
    vertexShader: /* glsl */ `
      attribute float aBirth; attribute vec3 aOrigin; attribute vec3 aDir; attribute vec3 aColor; attribute float aLead;
      uniform float uTime;
      varying vec3 vColor; varying float vAlpha;
      const float LIFE = 7.0;
      void main() {
        float t = uTime - aBirth;
        if (t < 0.0 || t > LIFE) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        // Shot up fast, drag bleeds the speed, then each scrap flutters down at its own pace.
        float drag = (1.0 - exp(-t * 3.0)) / 3.0;
        vec3 p = aOrigin + aDir * drag;
        p.y -= (0.7 + aLead * 0.5) * max(0.0, t - 0.35);
        p.x += sin(t * 2.6 + aLead * 20.0) * 0.45 * min(1.0, t);
        p.z += cos(t * 2.1 + aLead * 13.0) * 0.3 * min(1.0, t);
        p.y = max(p.y, 0.05);
        // Tumbling: the scrap turns edge-on and back (its width flips through zero).
        float spin = cos(t * (6.0 + aLead * 6.0) + aLead * 30.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        mv.xy += vec2(position.x * spin, position.y) * 0.5;
        gl_Position = projectionMatrix * mv;
        vColor = aColor * (0.75 + 0.35 * abs(spin));
        vAlpha = 1.0 - smoothstep(LIFE - 1.2, LIFE, t);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        float a = vAlpha * uFade;
        if (a < 0.5) discard;
        gl_FragColor = vec4(vColor, 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: DoubleSide,
    blending: NormalBlending,
  })
  const mesh = new InstancedMesh(geometry, material, count)
  mesh.frustumCulled = false
  return mesh
}
