/**
 * Lit windows. The kit's window panels are open holes (no glass to make glow), so each opening gets a
 * pane set just behind its frame and mullions: dark glass by day, warm lamplight by night. All panes
 * are one instanced draw. Each carries its house's rank and its room's: from about 21:00 the houses
 * go dark one by one (lowest rank first) as `windowsDark` rises, and a few rooms in a lit house stay
 * dark all night, so no two streets look alike. A lit window also throws a soft warm glow on the
 * wall round it (a second instanced draw, additive, just off the wall's face).
 */
import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from "three"
import type { Stage } from "../stage.ts"

/**
 * One lit window: the pane's centre, its heading (`rot`, the pane faces local +x turned by it), size,
 * the house's rank (0–1: the late-night share of dark houses that leaves it lit is below it) and the
 * room's (a few rooms stay dark in a lit house).
 */
export interface WindowLight {
  at: [x: number, y: number, z: number]
  rot: number
  w: number
  h: number
  house: number
  room: number
}

/** Rooms with a roll under this stay dark in a lit house. */
const DARK_ROOMS = 0.2

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/**
 * The share of houses whose lights are out at `hour` (0–24): none in the evening, most by 02:30, and
 * a few early risers light up again before dawn.
 */
export function windowsDark(hour: number): number {
  const since = (((hour - 18) % 24) + 24) % 24
  return 0.8 * smoothstep(3, 8.5, since) - 0.35 * smoothstep(10, 11.5, since)
}

const VERTEX = /* glsl */ `
attribute float aHouse;
attribute float aRoom;
uniform float uLevel;
uniform float uDark;
varying float vLit;
varying float vRoom;
varying vec2 vUv;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vRoom = aRoom;
  // The house is lit while its rank is over the dark share; the switch takes a sliver of the rank.
  vLit = uLevel * smoothstep(uDark, uDark + 0.015, aHouse) * step(${DARK_ROOMS.toFixed(2)}, aRoom);
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const FRAGMENT = /* glsl */ `
uniform vec3 uGlass;
uniform vec3 uWarm;
varying float vLit;
varying float vRoom;
varying vec2 vUv;
#include <common>
#include <fog_pars_fragment>
void main() {
  // Lamplight inside: warmer and brighter low in the room, a little different room to room.
  vec3 warm = uWarm * (0.75 + 0.5 * fract(vRoom * 7.31)) * (1.15 - 0.35 * vUv.y);
  vec3 colour = mix(uGlass, warm, vLit);
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

/** The spill: a quad this much wider and taller than the pane, this far out from it (metres). */
const SPILL = { wide: 2.2, tall: 1.8, out: 0.27 }

const SPILL_VERTEX = /* glsl */ `
attribute float aHouse;
attribute float aRoom;
uniform float uLevel;
uniform float uDark;
varying float vLit;
varying vec2 vUv;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vLit = uLevel * smoothstep(uDark, uDark + 0.015, aHouse) * step(${DARK_ROOMS.toFixed(2)}, aRoom);
  vec3 p = vec3(${SPILL.out.toFixed(2)}, position.y * ${SPILL.tall.toFixed(1)}, position.z * ${SPILL.wide.toFixed(1)});
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // Unlit windows draw nothing: their quad collapses behind the far plane.
  if (vLit <= 0.0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
  #include <fog_vertex>
}
`

const SPILL_FRAGMENT = /* glsl */ `
uniform vec3 uWarm;
varying float vLit;
varying vec2 vUv;
#include <common>
#include <fog_pars_fragment>
void main() {
  // An ellipse round the opening, a little stronger below it (the light falls out and down).
  vec2 d = (vUv - vec2(0.5, 0.56)) * 2.0;
  float fall = pow(clamp(1.0 - length(d), 0.0, 1.0), 1.6);
  vec3 colour = uWarm * vLit * fall * fall * 0.1;
  #ifdef USE_FOG
    colour *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** Glass by day (a dim interior behind it) and by night (dark). */
const GLASS_DAY = new Color("#2b3038")
const GLASS_NIGHT = new Color("#0a0c12")
const WARM = new Color("#ffb062").multiplyScalar(1.9)

export interface Windows {
  /** `level` the lamplight (0 day, 1 night), `night` how dark the sky is, `hour` for who is asleep. */
  update(level: number, night: number, hour: number): void
  readonly count: number
  /** Leaves out the panes standing where `at(x, z)` says (land not yet risen); null puts them all back. */
  hide(at: ((x: number, z: number) => boolean) | null): void
  dispose(): void
}

export function createWindows(stage: Pick<Stage, "scene">, windows: readonly WindowLight[]): Windows {
  const n = Math.max(1, windows.length)
  // A unit pane facing +x (the panels' dressed face), width along z.
  const geometry = new PlaneGeometry(1, 1).rotateY(Math.PI / 2)
  const house = new Float32Array(n)
  const room = new Float32Array(n)
  windows.forEach((w, i) => {
    house[i] = w.house
    room[i] = w.room
  })
  geometry.setAttribute("aHouse", new InstancedBufferAttribute(house, 1))
  geometry.setAttribute("aRoom", new InstancedBufferAttribute(room, 1))
  const uniforms = {
    uLevel: { value: 0 },
    uDark: { value: 0 },
    uGlass: { value: GLASS_DAY.clone() },
    uWarm: { value: WARM.clone() },
  }
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog, uniforms]),
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    fog: true,
  })
  // UniformsUtils.merge clones: keep the live ones.
  Object.assign(material.uniforms, uniforms)
  const mesh = new InstancedMesh(geometry, material, n)
  mesh.name = "windows"
  mesh.count = windows.length
  const spillGeometry = new PlaneGeometry(1, 1).rotateY(Math.PI / 2)
  spillGeometry.setAttribute("aHouse", geometry.getAttribute("aHouse"))
  spillGeometry.setAttribute("aRoom", geometry.getAttribute("aRoom"))
  const spillMaterial = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog, uniforms]),
    vertexShader: SPILL_VERTEX,
    fragmentShader: SPILL_FRAGMENT,
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  Object.assign(spillMaterial.uniforms, uniforms)
  const spill = new InstancedMesh(spillGeometry, spillMaterial, n)
  spill.name = "window-spill"
  spill.count = windows.length
  spill.renderOrder = 6
  const m = new Matrix4()
  const q = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const p = new Vector3()
  const s = new Vector3()
  const NONE = new Matrix4().makeScale(0, 0, 0)
  const hidden = new Uint8Array(windows.length)
  const place = (i: number) => {
    const w = windows[i] as WindowLight
    if (hidden[i]) m.copy(NONE)
    else m.compose(p.set(...w.at), q.setFromAxisAngle(up, w.rot), s.set(1, w.h, w.w))
    mesh.setMatrixAt(i, m)
    spill.setMatrixAt(i, m)
  }
  for (let i = 0; i < windows.length; i++) place(i)
  for (const each of [mesh, spill]) {
    each.instanceMatrix.needsUpdate = true
    each.computeBoundingSphere()
    stage.scene.add(each)
  }

  return {
    update(level, night, hour) {
      uniforms.uLevel.value = level
      uniforms.uDark.value = windowsDark(hour)
      uniforms.uGlass.value.copy(GLASS_DAY).lerp(GLASS_NIGHT, night)
      spill.visible = level > 0.001
    },
    count: windows.length,
    hide(at) {
      let moved = false
      windows.forEach((w, i) => {
        const h = at?.(w.at[0], w.at[2]) ? 1 : 0
        if (h === hidden[i]) return
        hidden[i] = h
        place(i)
        moved = true
      })
      if (!moved) return
      mesh.instanceMatrix.needsUpdate = true
      spill.instanceMatrix.needsUpdate = true
    },
    dispose() {
      for (const each of [mesh, spill]) {
        each.removeFromParent()
        each.geometry.dispose()
        ;(each.material as ShaderMaterial).dispose()
        each.dispose()
      }
    },
  }
}
