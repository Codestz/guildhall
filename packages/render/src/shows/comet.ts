/**
 * A milestone (the 100th deed, the 1000th line): by night a shower of shooting stars streaks over the
 * island, all falling away from one point of the sky so it reads as one event, not noise; by day one
 * great comet crosses the sky, its tail streaming behind. Ported from V1 (scene/events/Comet.tsx).
 *
 * One instanced draw of streaks, each placed, stretched and faded wholly in the vertex shader from its
 * launch time: the CPU only moves the clock. They are laid out in the view the show starts in (a layer
 * in front of the camera, short of the ground it looks at), sized to it, so the shower fills the view
 * at any zoom; they stay put in the world after, as a camera moves.
 */
import {
  AdditiveBlending,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  NormalBlending,
  type PerspectiveCamera,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from "three"
import { envelope, hash01, type ShowCtx, type ShowPiece } from "./show.ts"

/** Shooting stars in a night's shower. */
export const METEORS = 34

/**
 * Streaks: each instance flies from `aFrom` along `aDir` for `aLife` seconds from `aBirth`. The quad is
 * stretched along the flight's on-screen direction (the head at +y of the quad), so it reads from any
 * camera.
 */
const STREAK_VERTEX = /* glsl */ `
attribute vec3 aFrom; attribute vec3 aDir; attribute float aBirth; attribute float aLife;
attribute float aSize; attribute float aTail;
uniform float uTime;
varying vec2 vUv; varying float vLife; varying float vIon;
void main() {
  float t = (uTime - aBirth) / aLife;
  vUv = uv;
  vLife = t;
  vIon = float(gl_InstanceID);
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
  // position.y in [-0.5, 0.5]: -0.5 the tail's end, +0.5 the head
  vec4 mv = mix(b, a, position.y + 0.5);
  mv.xy += side * position.x * aSize * mix(0.25, 1.0, position.y + 0.5);
  gl_Position = projectionMatrix * mv;
}`

const METEOR_FRAGMENT = /* glsl */ `
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
}`

const COMET_FRAGMENT = /* glsl */ `
uniform float uFade;
varying vec2 vUv; varying float vLife; varying float vIon;
void main() {
  float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float along = vUv.y;                         // 0 the tail's end … 1 the head
  // a round head: past 0.88 the streak narrows to a cap
  float cap = clamp((along - 0.88) / 0.12, 0.0, 1.0);
  float room = sqrt(max(0.0, 1.0 - cap * cap));
  float inside = smoothstep(0.0, 0.12, across - (1.0 - room));
  float head = smoothstep(0.8, 0.94, along) * smoothstep(0.3, 0.9, across);
  // the dust tail full and warm, the ion tail (the second streak) a thinner blue: bold against a pale sky
  float ion = step(0.5, vIon);
  float tail = min(1.0, pow(along, mix(0.8, 1.4, ion)) * pow(across, mix(0.75, 1.6, ion)) * mix(1.7, 1.0, ion));
  float a = clamp(max(head * (1.0 - ion), tail), 0.0, 1.0) * inside * uFade;
  if (a < 0.004) discard;
  vec3 dust = mix(vec3(0.95, 0.36, 0.08), vec3(1.0, 0.72, 0.32), pow(along, 2.0));
  vec3 colour = mix(dust, vec3(0.25, 0.55, 1.0), ion);
  colour = mix(colour, vec3(1.0, 1.0, 0.95), max(head * (1.0 - ion), pow(along, 8.0)));
  gl_FragColor = vec4(colour * (0.9 + 1.5 * head), a);
}`

interface Streak {
  from: Vector3
  dir: Vector3
  birth: number
  life: number
  size: number
  tail: number
}

function streaks(count: number, fill: (i: number, s: Streak) => void): PlaneGeometry {
  const from = new Float32Array(count * 3)
  const dir = new Float32Array(count * 3)
  const birth = new Float32Array(count)
  const life = new Float32Array(count)
  const size = new Float32Array(count)
  const tail = new Float32Array(count)
  const s: Streak = { from: new Vector3(), dir: new Vector3(), birth: 0, life: 1, size: 1, tail: 1 }
  for (let i = 0; i < count; i++) {
    fill(i, s)
    s.from.toArray(from, i * 3)
    s.dir.toArray(dir, i * 3)
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

/**
 * The view the streaks are laid out in, frozen when the show starts: the camera's eye, its forward,
 * right and up, how far in front the sky's layer is (`depth`, short of what it looks at, so it stands
 * clear of the ground) and that layer's half width and height. A point is `eye + forward·depth +
 * right·(x·w) + up·(y·h)`, x and y in -1 … 1: on screen at (x, y) whatever the zoom.
 */
export interface CometFrame {
  eye: Vector3
  forward: Vector3
  right: Vector3
  up: Vector3
  depth: number
  w: number
  h: number
}

export function cometFrame(camera: PerspectiveCamera, distance: number): CometFrame {
  camera.updateMatrixWorld()
  const e = camera.matrixWorld.elements
  const right = new Vector3(e[0], e[1], e[2]).normalize()
  const up = new Vector3(e[4], e[5], e[6]).normalize()
  const forward = new Vector3(-(e[8] ?? 0), -(e[9] ?? 0), -(e[10] ?? 1)).normalize()
  const depth = distance * 0.7
  const h = depth * Math.tan((camera.fov * Math.PI) / 360)
  return { eye: camera.position.clone(), forward, right, up, depth, w: h * camera.aspect, h }
}

/** The point at (x, y) on the frame's layer, `deeper` times its depth. */
const onFrame = (f: CometFrame, x: number, y: number, out: Vector3, deeper = 1) =>
  out
    .copy(f.eye)
    .addScaledVector(f.forward, f.depth * deeper)
    .addScaledVector(f.right, x * f.w * deeper)
    .addScaledVector(f.up, y * f.h * deeper)

export function createComet(ctx: ShowCtx): ShowPiece {
  const uniforms = { uTime: { value: 0 }, uFade: { value: 0 } }
  const f = cometFrame(ctx.stage.camera, ctx.stage.getCamera().distance)
  // a streak's scale: metres per unit of the layer's shorter side (on a phone held upright, its width)
  const k = Math.min(f.h, f.w) / 40
  const night = ctx.night
  let geometry: PlaneGeometry
  const to = new Vector3()
  if (night) {
    // over the top two thirds of the view, all falling away from one radiant up to the left, beyond it
    const radiant = onFrame(f, -1.6, 2.2, new Vector3(), 1.4)
    geometry = streaks(METEORS, (i, s) => {
      onFrame(
        f,
        -0.95 + hash01(i * 5) * 1.9,
        -0.25 + hash01(i * 5 + 1) * 1.15,
        s.from,
        0.8 + hash01(i * 5 + 2) * 0.4,
      )
      s.dir
        .subVectors(s.from, radiant)
        .normalize()
        .multiplyScalar((26 + hash01(i * 5 + 3) * 18) * k)
      s.from.addScaledVector(s.dir, -0.3)
      s.birth = 0.5 + (i / METEORS) * 9.5 + hash01(i * 5 + 4) * 1.2
      s.life = 0.7 + hash01(i * 7) * 0.5
      s.size = (0.9 + hash01(i * 11) * 0.8) * k
      s.tail = (14 + hash01(i * 13) * 12) * k
    })
  } else {
    // the comet and, a little behind it, its fainter ion tail: across the sky over the island, slowly,
    // below the HUD's top row (its crest and faces sit over the top of the view)
    geometry = streaks(2, (i, s) => {
      onFrame(f, -1.0, 0.5, s.from)
      onFrame(f, 1.45, 0.3, to)
      s.dir.subVectors(to, s.from)
      s.birth = 0.3
      s.life = 14
      s.size = (i === 0 ? 13 : 5.5) * k
      s.tail = (i === 0 ? 0.62 : 0.85) * f.w
    })
  }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: STREAK_VERTEX,
    fragmentShader: night ? METEOR_FRAGMENT : COMET_FRAGMENT,
    transparent: true,
    depthWrite: false,
    // the streak's basis can mirror the quad (it follows the flight on screen): both faces
    side: DoubleSide,
    blending: night ? AdditiveBlending : NormalBlending,
  })
  const mesh = new InstancedMesh(geometry, material, night ? METEORS : 2)
  mesh.name = night ? "show meteors" : "show comet"
  mesh.frustumCulled = false
  mesh.renderOrder = 20
  return {
    object: mesh,
    draws: () => (mesh.visible ? 1 : 0),
    update(t, total) {
      uniforms.uTime.value = t
      uniforms.uFade.value = envelope(t, total, 0.4, 1.5)
    },
    dispose() {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
