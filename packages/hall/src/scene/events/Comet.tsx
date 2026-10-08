import { useFrame } from "@react-three/fiber"
import { useRef } from "react"
import {
  AdditiveBlending,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from "three"
import { sky } from "../atmosphere/state.ts"
import { FRAME } from "../frame.ts"
import { DURATION_S, type EventNodes, envelope, hash01, NIGHT_AT, useShowMeshes } from "./common.ts"
import type { ShowProps } from "./EventsLayer.tsx"

/**
 * A milestone (the 100th deed, the 1000th line, guild/events.ts): by night a shower of shooting
 * stars streaks over the island; by day one great comet crosses the sky, its tail streaming
 * behind. One instanced mesh of camera-facing streaks, each placed, stretched and faded entirely
 * in the vertex shader from its launch time — the CPU only advances a clock. On WebGPU the streaks
 * are node materials (eventNodes.ts).
 */

/** Meteors at night (staggered); one comet by day. */
const METEORS = 34

export default function Comet({ show, events }: ShowProps) {
  const age = useRef(0)
  const finished = useRef(false)
  const night = useRef(sky.night > NIGHT_AT).current
  const uniforms = useRef({ uTime: { value: 0 }, uFade: { value: 0 } }).current
  const built = useShowMeshes(
    (nodes) => ({ meshes: [night ? meteors(uniforms, nodes) : comet(uniforms, nodes)] }),
    [],
  )

  useFrame((_, delta) => {
    if (!built) return
    age.current += Math.min(delta, 0.1)
    const t = age.current
    const total = DURATION_S.comet
    uniforms.uTime.value = t
    uniforms.uFade.value = envelope(t, total, 0.4, 1.5)
    if (t >= total && !finished.current) {
      finished.current = true
      events.done(show.id)
    }
  }, FRAME.WORLD)

  if (!built) return null
  return <primitive object={built.meshes[0] as InstancedMesh} />
}

interface Uniforms {
  uTime: { value: number }
  uFade: { value: number }
}

/**
 * Streak shader: each instance flies from `aFrom` along `aDir` for `aLife` seconds from `aBirth`.
 * The quad is stretched along the flight's on-screen direction (head at +y of the quad), so the
 * streak reads in any camera, orthographic or not.
 */
const STREAK_VERTEX = /* glsl */ `
  attribute vec3 aFrom; attribute vec3 aDir; attribute float aBirth; attribute float aLife;
  attribute float aSize; attribute float aTail;
  uniform float uTime;
  varying vec2 vUv; varying float vLife;
  void main() {
    float t = (uTime - aBirth) / aLife;
    vUv = uv;
    vLife = t;
    if (t < 0.0 || t > 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec3 head = aFrom + aDir * t;
    vec4 a = modelViewMatrix * vec4(head, 1.0);
    vec4 b = modelViewMatrix * vec4(head - normalize(aDir) * aTail, 1.0);
    vec2 along = a.xy - b.xy;
    float len = max(length(along), 1e-4);
    vec2 axis = along / len;
    vec2 side = vec2(-axis.y, axis.x);
    // position.y in [-0.5, 0.5]: -0.5 the tail's end, +0.5 the head.
    vec4 mv = mix(b, a, position.y + 0.5);
    mv.xy += side * position.x * aSize * mix(0.25, 1.0, position.y + 0.5);
    gl_Position = projectionMatrix * mv;
  }
`

function streaks(count: number, fill: (i: number, set: Streak) => void): PlaneGeometry {
  const from = new Float32Array(count * 3)
  const dir = new Float32Array(count * 3)
  const birth = new Float32Array(count)
  const life = new Float32Array(count)
  const size = new Float32Array(count)
  const tail = new Float32Array(count)
  const s: Streak = { from: new Vector3(), dir: new Vector3(), birth: 0, life: 1, size: 1, tail: 1 }
  for (let i = 0; i < count; i++) {
    fill(i, s)
    from.set([s.from.x, s.from.y, s.from.z], i * 3)
    dir.set([s.dir.x, s.dir.y, s.dir.z], i * 3)
    birth[i] = s.birth
    life[i] = s.life
    size[i] = s.size
    tail[i] = s.tail
  }
  const geometry = new PlaneGeometry(1, 1, 1, 6)
  geometry.setAttribute("aFrom", new InstancedBufferAttribute(from, 3))
  geometry.setAttribute("aDir", new InstancedBufferAttribute(dir, 3))
  geometry.setAttribute("aBirth", new InstancedBufferAttribute(birth, 1))
  geometry.setAttribute("aLife", new InstancedBufferAttribute(life, 1))
  geometry.setAttribute("aSize", new InstancedBufferAttribute(size, 1))
  geometry.setAttribute("aTail", new InstancedBufferAttribute(tail, 1))
  return geometry
}

interface Streak {
  from: Vector3
  dir: Vector3
  birth: number
  life: number
  size: number
  tail: number
}

/** Night: a shower, radiating from one point of the sky so it reads as one event, not noise. */
function meteors(uniforms: Uniforms, nodes: EventNodes | false): InstancedMesh {
  const radiant = new Vector3(-120, 140, -160)
  const geometry = streaks(METEORS, (i, s) => {
    // Spread over the sky above the island, all falling away from the radiant.
    s.from.set(-70 + hash01(i * 5) * 140, 46 + hash01(i * 5 + 1) * 34, -80 + hash01(i * 5 + 2) * 120)
    s.dir
      .subVectors(s.from, radiant)
      .normalize()
      .multiplyScalar(26 + hash01(i * 5 + 3) * 18)
    s.from.addScaledVector(s.dir, -0.3)
    s.birth = 0.5 + (i / METEORS) * 9.5 + hash01(i * 5 + 4) * 1.2
    s.life = 0.7 + hash01(i * 7) * 0.5
    s.size = 0.9 + hash01(i * 11) * 0.8
    s.tail = 14 + hash01(i * 13) * 12
  })
  const material = nodes ? nodes.meteorNodeMaterial(uniforms) : meteorMaterial(uniforms)
  const mesh = new InstancedMesh(geometry, material, METEORS)
  mesh.frustumCulled = false
  mesh.renderOrder = 20
  return mesh
}

function meteorMaterial(uniforms: Uniforms): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...uniforms },
    vertexShader: STREAK_VERTEX,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying vec2 vUv; varying float vLife;
      void main() {
        float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
        float along = vUv.y;                         // 0 tail … 1 head
        float burn = sin(3.14159 * vLife);           // flares, then burns out
        float a = pow(along, 2.2) * across * across * burn * uFade;
        if (a < 0.004) discard;
        vec3 colour = mix(vec3(0.55, 0.7, 1.0), vec3(1.0, 0.97, 0.88), pow(along, 4.0));
        gl_FragColor = vec4(colour * (1.0 + 2.5 * pow(along, 6.0)), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    // The streak's basis can mirror the quad (it follows the flight on screen): draw both faces.
    side: DoubleSide,
    blending: AdditiveBlending,
  })
}

/** Day: one great comet, slow and bright, a pale gold head and a long fading tail. */
function comet(uniforms: Uniforms, nodes: EventNodes | false): InstancedMesh {
  const geometry = streaks(2, (i, s) => {
    // The comet and, a little behind it, the fainter ion tail.
    s.from.set(-110, 78, -60)
    s.dir.set(200, -24, 40)
    s.birth = 0.3
    s.life = DURATION_S.comet - 1
    s.size = i === 0 ? 5.6 : 2.6
    s.tail = i === 0 ? 46 : 64
  })
  const material = nodes ? nodes.cometNodeMaterial(uniforms) : cometMaterial(uniforms)
  const mesh = new InstancedMesh(geometry, material, 2)
  mesh.frustumCulled = false
  mesh.renderOrder = 20
  return mesh
}

function cometMaterial(uniforms: Uniforms): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...uniforms },
    vertexShader: STREAK_VERTEX,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying vec2 vUv; varying float vLife;
      void main() {
        float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
        float along = vUv.y;
        float head = smoothstep(0.86, 1.0, along) * smoothstep(0.0, 0.6, across);
        float tail = pow(along, 1.6) * pow(across, 1.5) * 0.75;
        float a = clamp(max(head, tail), 0.0, 1.0) * uFade;
        if (a < 0.004) discard;
        vec3 colour = mix(vec3(1.0, 0.86, 0.55), vec3(1.0, 1.0, 0.97), head);
        gl_FragColor = vec4(colour * (1.0 + 1.4 * head), a);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    // The streak's basis can mirror the quad (it follows the flight on screen): draw both faces.
    side: DoubleSide,
    blending: NormalBlending,
  })
}
