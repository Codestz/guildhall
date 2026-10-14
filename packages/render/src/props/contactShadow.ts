/**
 * Soft contact shadows for props (no shadow map): one instanced, flat, blurred dark disc under each heap
 * and each stock, drawn in one shared draw for everything that asks (the harvest's heaps and the stocks).
 * A disc is a quad on the ground with a radial falloff in its fragment shader; its centre, radius and
 * strength are per instance, so a heap's shadow grows and fades with its season weight by rewriting a few
 * numbers, never a texture or a light.
 *
 * Shared per stage: `contactShadows(stage)` hands the same set to whoever asks, each takes a `range` of
 * slots; the draw exists while some range is held (the batch is grown by replacing the mesh, one draw
 * the whole time) and is hidden while every slot is at strength 0.
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from "three"
import type { Stage } from "../stage.ts"

/** A held run of slots. */
export interface ShadowRange {
  /** Slot `k` of this range: a disc at (x, y, z) of radius `r` (metres), `a` dark (0 hides it). */
  set(k: number, x: number, y: number, z: number, r: number, a: number): void
  /** Hands the slots back (their discs go away). */
  release(): void
}

export interface ContactShadows {
  /** Takes `n` slots, all hidden. */
  range(n: number): ShadowRange
  /** Slots in use, those showing, and the draws the set costs now (0 or 1). */
  stats(): { slots: number; showing: number; draws: number }
}

/** How far above the ground a disc lies (clear of z-fighting; the ground is level under a prop). */
const LIFT = 0.035
/** The darkest a disc gets, whatever strength it is given. */
const INK = 0.9
const COLOR = [0.07, 0.06, 0.09] as const

const vertex = /* glsl */ `
  attribute float aAlpha;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vUv = position.xz * 2.0;
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`
const fragment = /* glsl */ `
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    float d = length(vUv);
    // a plateau that melts off to the rim: soft, never a hard edge
    float f = 1.0 - smoothstep(0.15, 1.0, d);
    float a = f * f * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(${COLOR.join(", ")}, a);
  }
`

/** A unit quad flat on the ground (x, z in ±0.5), facing up. */
function quad(): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute(
    "position",
    new Float32BufferAttribute([-0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 0, -0.5], 3),
  )
  g.setIndex([0, 1, 2, 0, 2, 3])
  return g
}

const IDENTITY = new Quaternion()
const sets = new WeakMap<Stage, ContactShadows>()

/** The stage's contact shadows (made on first ask, shared after). */
export function contactShadows(stage: Stage): ContactShadows {
  const had = sets.get(stage)
  if (had) return had
  const geometry = quad()
  const material = new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  let cap = 0
  let used = 0
  let held = 0
  let mesh: InstancedMesh | null = null
  let alpha = new Float32Array(0)
  let matrices = new Float32Array(0)
  let showing = 0
  const m = new Matrix4()
  const p = new Vector3()
  const s = new Vector3()

  const build = (n: number) => {
    const old = mesh
    const next = new InstancedMesh(geometry, material, n)
    next.name = "world:contact-shadows"
    next.frustumCulled = false
    next.castShadow = false
    next.receiveShadow = false
    next.renderOrder = 1
    next.visible = showing > 0
    const a = new Float32Array(n)
    const mat = new Float32Array(n * 16)
    a.set(alpha.subarray(0, Math.min(cap, n)))
    mat.set(matrices.subarray(0, Math.min(cap, n) * 16))
    alpha = a
    matrices = mat
    next.instanceMatrix.array = matrices
    next.instanceMatrix.needsUpdate = true
    const attr = new InstancedBufferAttribute(alpha, 1)
    geometry.setAttribute("aAlpha", attr)
    next.geometry = geometry
    next.count = used
    old?.removeFromParent()
    old?.dispose()
    mesh = next
    cap = n
    stage.scene.add(next)
  }
  const sync = () => {
    if (!mesh) return
    mesh.visible = showing > 0
    mesh.count = used
    mesh.instanceMatrix.needsUpdate = true
    const attr = geometry.getAttribute("aAlpha") as InstancedBufferAttribute
    attr.array = alpha
    attr.needsUpdate = true
  }

  const set: ContactShadows = {
    range(n) {
      const from = used
      used += n
      held++
      if (used > cap) build(Math.max(64, cap * 2, used))
      let live = true
      const range: ShadowRange = {
        set(k, x, y, z, r, a) {
          if (!live || k < 0 || k >= n) return
          const i = from + k
          const was = alpha[i] as number
          const next = a <= 0.003 || r <= 0.01 ? 0 : Math.min(1, a) * INK
          if (was <= 0 && next > 0) showing++
          else if (was > 0 && next <= 0) showing--
          alpha[i] = next
          m.compose(p.set(x, y + LIFT, z), IDENTITY, s.set(r * 2, 1, r * 2))
          m.toArray(matrices, i * 16)
          sync()
        },
        release() {
          if (!live) return
          live = false
          for (let k = 0; k < n; k++) {
            if ((alpha[from + k] as number) > 0) showing--
            alpha[from + k] = 0
          }
          sync()
          held--
          if (held === 0 && mesh) {
            mesh.removeFromParent()
            mesh.dispose()
            geometry.dispose()
            material.dispose()
            mesh = null
            cap = used = showing = 0
            sets.delete(stage)
          }
        },
      }
      return range
    },
    stats: () => ({ slots: used, showing, draws: mesh?.visible ? 1 : 0 }),
  }
  sets.set(stage, set)
  return set
}
