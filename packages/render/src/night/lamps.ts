/**
 * The town's lamplight, cheap enough for hundreds of lamps: three instanced draws and a few real
 * lights.
 *
 * - pools: an additive soft disc on the ground under every lamp (its light on the cobbles);
 * - halos: a camera-facing additive glow round every flame or pane (the bloom of a bright light,
 *   without a post pass: only the light sources get it);
 * - lights: MAX_LIGHTS real PointLights (no shadows) on the lamps nearest the camera's target, so
 *   walls, doors and people near the view are lit too. Each fades out before it is handed to another
 *   lamp, and the count never changes (a change would recompile every lit material).
 */
import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  PointLight,
  ShaderChunk,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from "three"
import type { Stage } from "../stage.ts"

/** Real lights near the view, at most. */
export const MAX_LIGHTS = 8

/**
 * Three's point-light loop (`lights_fragment_begin`) with the lights that are dark skipped: by day the
 * MAX_LIGHTS real lights stay in the scene at intensity 0 (the count never changes, so no program is
 * relinked), and every lit fragment on the island (the pieces, the ground, the water, the people) paid
 * eight distance falloffs and eight BRDFs for nothing (measured: 1.2–3.6 ms a frame at DPR 1.5). A
 * light's `color` uniform is its colour times its intensity, so a dark light is exactly `vec3(0)`
 * and its term exactly zero: a branch on the uniform (the same for every fragment, so no divergence)
 * leaves the picture byte for byte as it was and the lit lights at night as they were. The pattern
 * three's `#pragma unroll_loop` needs (the loop body up to the first `}` before the end pragma) is kept:
 * the branch's own brace is followed by the loop's, not by the pragma.
 */
const DARK_SKIP = "if ( pointLight.color != vec3( 0.0 ) )"

export function skipDarkPointLights(chunk: string): string {
  if (chunk.includes(DARK_SKIP)) return chunk
  const body =
    /(\t*pointLight = pointLights\[ i \];\n)([\s\S]*?)(\t*RE_Direct\( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight \);\n)/
  return chunk.replace(
    body,
    (_, pick: string, between: string, direct: string) =>
      `${pick}\t\t${DARK_SKIP} {\n${between}${direct}\t\t}\n`,
  )
}

ShaderChunk.lights_fragment_begin = skipDarkPointLights(ShaderChunk.lights_fragment_begin)
/** Metres over which a real light fades out as another lamp comes nearer than it. */
const HANDOVER = 6
/** Pools sit this far over the ground (the overlays are at +1–3 cm). */
const POOL_Y = 0.05

/** Per kind: how strong its pool and halo are, the halo's radius (m), and whether it flickers (fire). */
export type LightKind = "street" | "market" | "torch" | "door" | "pier"

/** One light: its kind, where the flame or glass is (`[x, y, z]`, metres) and its pool's radius. */
export interface LightPoint {
  kind: LightKind
  at: [x: number, y: number, z: number]
  radius: number
}

const LOOK: Readonly<Record<LightKind, { pool: number; halo: number; size: number; fire: boolean }>> = {
  street: { pool: 1, halo: 1, size: 1.7, fire: false },
  market: { pool: 1.15, halo: 1.1, size: 2.2, fire: false },
  torch: { pool: 0.9, halo: 1.2, size: 1.5, fire: true },
  door: { pool: 0.75, halo: 0.8, size: 1.1, fire: false },
  pier: { pool: 1, halo: 1, size: 1.7, fire: false },
}

const LAMP_COLOUR = new Color("#ffa24a")
/** A real light's intensity (candela) at full night; and how far it reaches as a share of its pool. */
const LIGHT_INTENSITY = 40
const LIGHT_REACH = 1.8

const POOL_VERTEX = /* glsl */ `
attribute float aStrength;
attribute float aPhase;
uniform float uTime;
varying vec2 vUv;
varying float vStrength;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  float flicker = aPhase < 0.0 ? 1.0 : 0.9 + 0.06 * sin(uTime * 7.3 + aPhase) + 0.04 * sin(uTime * 13.1 + 2.0 * aPhase);
  vStrength = aStrength * flicker;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const POOL_FRAGMENT = /* glsl */ `
uniform vec3 uColour;
uniform float uLevel;
varying vec2 vUv;
varying float vStrength;
#include <common>
#include <fog_pars_fragment>
void main() {
  float r = length(vUv - 0.5) * 2.0;
  // Bright under the lamp, a long soft fall-off to nothing at the rim.
  float fall = pow(clamp(1.0 - r, 0.0, 1.0), 2.2);
  vec3 colour = uColour * uLevel * vStrength * fall * 0.85;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    colour *= 1.0 - fogFactor;
  #endif
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

const HALO_VERTEX = /* glsl */ `
attribute float aStrength;
attribute float aPhase;
attribute float aSize;
uniform float uTime;
varying vec2 vUv;
varying float vStrength;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  float flicker = aPhase < 0.0 ? 1.0 : 0.88 + 0.07 * sin(uTime * 9.1 + aPhase) + 0.05 * sin(uTime * 15.7 + 2.0 * aPhase);
  vStrength = aStrength * flicker;
  // Camera-facing: the quad is laid out in view space round the light's centre.
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mvPosition.xy += position.xy * aSize * (0.85 + 0.15 * flicker);
  // Pulled a little toward the camera, so the glass it sits in does not cut it in half.
  mvPosition.xyz += normalize(-mvPosition.xyz) * 0.35;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const HALO_FRAGMENT = /* glsl */ `
uniform vec3 uColour;
uniform float uLevel;
varying vec2 vUv;
varying float vStrength;
#include <common>
#include <fog_pars_fragment>
void main() {
  float r = length(vUv - 0.5) * 2.0;
  // A small hot core and a long faint tail: light in the air, not an orb.
  float glow = 0.9 * exp(-r * r * 40.0) + 0.3 * exp(-r * r * 6.0) + 0.08 * (1.0 - smoothstep(0.0, 1.0, r));
  vec3 colour = uColour * uLevel * vStrength * glow;
  #ifdef USE_FOG
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    colour *= 1.0 - fogFactor;
  #endif
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

function additive(
  vertexShader: string,
  fragmentShader: string,
  uniforms: Record<string, { value: unknown }>,
) {
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog, uniforms]),
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: true,
  })
  // UniformsUtils.merge clones: keep the live ones.
  Object.assign(material.uniforms, uniforms)
  return material
}

/** A lamp lit by hand at an hour of the day (a lamplighter's round): where its post stands, and when. */
export interface LampLit {
  x: number
  z: number
  /** Day hour it is lit (it stays lit through the night, until the town's lamplight fades at dawn). */
  at: number
}

/** A lamp's light is matched to a hand-lit post this near (its flame hangs off the post's arm), metres. */
const LIT_REACH = 1.4
/** Hours a lamp takes to come up once lit (~2 s on screen at 20× time). */
const LIT_RISE = 0.012
/** Before this hour of the morning a lamp lit last evening is still lit. */
const LIT_MORNING = 9

/** How lit a hand-lit lamp is at `hour`: 0 before its lighting, rising to 1, lit until the morning. */
export function litLevel(at: number, hour: number): number {
  if (hour < LIT_MORNING) return 1
  const t = (hour - at) / LIT_RISE
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)
}

export interface Lamps {
  /** Lamplight level 0 (day) to 1 (night); `dt` seconds drive the flicker. */
  update(level: number, dt: number): void
  /**
   * The lamps lit by hand (a lamplighter's round, the life plan's): each light near one stays dark until
   * its hour; the others follow the town's level alone. Null: every lamp follows the town's level.
   */
  schedule(lit: readonly LampLit[] | null): void
  /** The day's hour, for the hand-lit lamps. */
  setHour(hour: number): void
  /** Real lights lit last frame. */
  lit(): number
  /**
   * Puts out the lamps standing where `at(x, z)` says (a history replay's land not yet risen): no pool,
   * no halo, no real light. Null lights them all again.
   */
  hide(at: ((x: number, z: number) => boolean) | null): void
  dispose(): void
}

/** Pools, halos and the nearest real lights for `points`, added to the stage's scene. */
export function createLamps(stage: Pick<Stage, "scene" | "getCamera">, points: readonly LightPoint[]): Lamps {
  const n = Math.max(1, points.length)
  const strength = new Float32Array(n)
  const halo = new Float32Array(n)
  const phase = new Float32Array(n)
  const size = new Float32Array(n)
  points.forEach((p, i) => {
    const look = LOOK[p.kind]
    strength[i] = look.pool
    halo[i] = look.halo
    size[i] = look.size
    phase[i] = look.fire ? (i * 1.7) % 6.283 : -1
  })

  const poolUniforms = { uColour: { value: LAMP_COLOUR.clone() }, uLevel: { value: 0 }, uTime: { value: 0 } }
  const poolGeometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  poolGeometry.setAttribute("aStrength", new InstancedBufferAttribute(strength, 1))
  poolGeometry.setAttribute("aPhase", new InstancedBufferAttribute(phase, 1))
  const poolMaterial = additive(POOL_VERTEX, POOL_FRAGMENT, poolUniforms)
  poolMaterial.polygonOffset = true
  poolMaterial.polygonOffsetFactor = -4
  poolMaterial.polygonOffsetUnits = -4
  const pools = new InstancedMesh(poolGeometry, poolMaterial, n)
  pools.name = "lamp-pools"
  pools.count = points.length
  pools.renderOrder = 5

  const haloUniforms = { uColour: { value: LAMP_COLOUR.clone() }, uLevel: { value: 0 }, uTime: { value: 0 } }
  const haloGeometry = new PlaneGeometry(2, 2)
  haloGeometry.setAttribute("aStrength", new InstancedBufferAttribute(halo, 1))
  haloGeometry.setAttribute("aPhase", new InstancedBufferAttribute(phase, 1))
  haloGeometry.setAttribute("aSize", new InstancedBufferAttribute(size, 1))
  const halos = new InstancedMesh(haloGeometry, additive(HALO_VERTEX, HALO_FRAGMENT, haloUniforms), n)
  halos.name = "lamp-halos"
  halos.count = points.length
  halos.renderOrder = 10

  const m = new Matrix4()
  const NONE = new Matrix4().makeScale(0, 0, 0)
  const hidden = new Uint8Array(points.length)
  const place = (i: number) => {
    const p = points[i] as LightPoint
    const r = p.radius
    if (hidden[i]) {
      pools.setMatrixAt(i, NONE)
      halos.setMatrixAt(i, NONE)
      return
    }
    pools.setMatrixAt(i, m.makeScale(2 * r, 1, 2 * r).setPosition(p.at[0], POOL_Y, p.at[2]))
    halos.setMatrixAt(i, m.makeTranslation(p.at[0], p.at[1], p.at[2]))
  }
  for (let i = 0; i < points.length; i++) place(i)
  /** Each light's hand-lit hour (NaN: none), its level now, and the day's hour. */
  const litAt = new Float32Array(n).fill(Number.NaN)
  const lit01 = new Float32Array(n).fill(1)
  let dayHour = 12
  const relight = () => {
    let moved = false
    for (let i = 0; i < points.length; i++) {
      const at = litAt[i] as number
      const f = Number.isNaN(at) ? 1 : litLevel(at, dayHour)
      if (f === lit01[i]) continue
      lit01[i] = f
      const look = LOOK[(points[i] as LightPoint).kind]
      strength[i] = look.pool * f
      halo[i] = look.halo * f
      moved = true
    }
    if (!moved) return
    ;(poolGeometry.getAttribute("aStrength") as InstancedBufferAttribute).needsUpdate = true
    ;(haloGeometry.getAttribute("aStrength") as InstancedBufferAttribute).needsUpdate = true
  }
  for (const mesh of [pools, halos]) {
    mesh.instanceMatrix.needsUpdate = true
    // Spread over the whole town: always drawn (one call each), never culled as one box.
    mesh.frustumCulled = false
    stage.scene.add(mesh)
  }

  const lights = Array.from({ length: MAX_LIGHTS }, () => {
    const light = new PointLight(LAMP_COLOUR, 0, 10, 2)
    light.castShadow = false
    stage.scene.add(light)
    return light
  })

  const order = points.map((_, i) => i)
  const distance = new Float32Array(points.length)
  const target = new Vector3()
  let level = 0
  let time = 0
  let lit = 0

  /** Hands the real lights to the lamps nearest the camera's target, fading each before it moves. */
  const assign = () => {
    target.set(...stage.getCamera().target)
    points.forEach((p, i) => {
      // a lamp put out is never handed a light
      distance[i] = hidden[i]
        ? Number.POSITIVE_INFINITY
        : Math.hypot(p.at[0] - target.x, p.at[1] - target.y, p.at[2] - target.z)
    })
    order.sort((a, b) => (distance[a] as number) - (distance[b] as number))
    const next = order.length > MAX_LIGHTS ? (distance[order[MAX_LIGHTS] as number] as number) : Infinity
    lit = 0
    lights.forEach((light, k) => {
      const i = order[k]
      if (i === undefined || level <= 0 || hidden[i]) {
        light.intensity = 0
        return
      }
      const p = points[i] as LightPoint
      const handover = Math.min(1, Math.max(0, (next - (distance[i] as number)) / HANDOVER))
      const flicker = LOOK[p.kind].fire ? 0.9 + 0.1 * Math.sin(time * 8.3 + i) : 1
      light.position.set(...p.at)
      light.distance = p.radius * LIGHT_REACH
      light.intensity =
        LIGHT_INTENSITY * LOOK[p.kind].pool * level * handover * flicker * (lit01[i] as number)
      if (light.intensity > 0) lit++
    })
  }

  return {
    update(next, dt) {
      level = next
      time += dt
      poolUniforms.uLevel.value = level
      haloUniforms.uLevel.value = level
      poolUniforms.uTime.value = time
      haloUniforms.uTime.value = time
      // Nothing to draw by day: skip the two calls.
      pools.visible = level > 0.001
      halos.visible = level > 0.001
      assign()
    },
    lit: () => lit,
    schedule(list) {
      litAt.fill(Number.NaN)
      for (const [i, p] of points.entries()) {
        let best = LIT_REACH
        for (const l of list ?? []) {
          const d = Math.hypot(l.x - p.at[0], l.z - p.at[2])
          if (d < best) {
            best = d
            litAt[i] = l.at
          }
        }
      }
      relight()
    },
    setHour(hour) {
      dayHour = hour
      relight()
    },
    hide(at) {
      let moved = false
      points.forEach((p, i) => {
        const h = at?.(p.at[0], p.at[2]) ? 1 : 0
        if (h === hidden[i]) return
        hidden[i] = h
        place(i)
        moved = true
      })
      if (!moved) return
      pools.instanceMatrix.needsUpdate = true
      halos.instanceMatrix.needsUpdate = true
    },
    dispose() {
      for (const mesh of [pools, halos]) {
        mesh.removeFromParent()
        mesh.geometry.dispose()
        ;(mesh.material as ShaderMaterial).dispose()
        mesh.dispose()
      }
      for (const light of lights) light.removeFromParent()
    },
  }
}
