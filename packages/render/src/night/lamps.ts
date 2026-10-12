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
import type { LightKind, LightPoint } from "@guildhall/world"
import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  PointLight,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from "three"
import type { Stage } from "../stage.ts"

/** Real lights near the view, at most. */
export const MAX_LIGHTS = 8
/** Metres over which a real light fades out as another lamp comes nearer than it. */
const HANDOVER = 6
/** Pools sit this far over the ground (the overlays are at +1–3 cm). */
const POOL_Y = 0.05

/** Per kind: how strong its pool and halo are, the halo's radius (m), and whether it flickers (fire). */
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

export interface Lamps {
  /** Lamplight level 0 (day) to 1 (night); `dt` seconds drive the flicker. */
  update(level: number, dt: number): void
  /** Real lights lit last frame. */
  lit(): number
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
  points.forEach((p, i) => {
    const r = p.radius
    pools.setMatrixAt(i, m.makeScale(2 * r, 1, 2 * r).setPosition(p.at[0], POOL_Y, p.at[2]))
    halos.setMatrixAt(i, m.makeTranslation(p.at[0], p.at[1], p.at[2]))
  })
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
      distance[i] = Math.hypot(p.at[0] - target.x, p.at[1] - target.y, p.at[2] - target.z)
    })
    order.sort((a, b) => (distance[a] as number) - (distance[b] as number))
    const next = order.length > MAX_LIGHTS ? (distance[order[MAX_LIGHTS] as number] as number) : Infinity
    lit = 0
    lights.forEach((light, k) => {
      const i = order[k]
      if (i === undefined || level <= 0) {
        light.intensity = 0
        return
      }
      const p = points[i] as LightPoint
      const handover = Math.min(1, Math.max(0, (next - (distance[i] as number)) / HANDOVER))
      const flicker = LOOK[p.kind].fire ? 0.9 + 0.1 * Math.sin(time * 8.3 + i) : 1
      light.position.set(...p.at)
      light.distance = p.radius * LIGHT_REACH
      light.intensity = LIGHT_INTENSITY * LOOK[p.kind].pool * level * handover * flicker
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
