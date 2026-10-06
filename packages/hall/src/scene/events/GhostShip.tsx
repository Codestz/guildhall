import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useRef } from "react"
import {
  AdditiveBlending,
  Color,
  type Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  ShaderMaterial,
} from "three"
import { SHIPS_URL } from "../../world/cast.ts"
import { HEX_SCALE } from "../../world/lands.ts"
import { sky } from "../atmosphere/state.ts"
import { FRAME } from "../frame.ts"
import { useOwnedMeshes } from "../owned.ts"
import { bakeNode, DURATION_S, envelope, flutter, hash01, lerp } from "./common.ts"
import type { ShowProps } from "./EventsLayer.tsx"

/**
 * The ghost ship (a long run lost, or several fallen in one quest, guild/events.ts): Kenney's green
 * ghost ship glides silently past the graveyard's coast through a rising sea mist, its tattered
 * sails stirring, will-o'-the-wisps drifting round it, and fades as it came. Two draw calls (the
 * ship baked into one mesh, the wisps one instanced mesh); the mist is the grade pass's own ground
 * mist (atmosphere/GradeEffect.ts), thickened while it passes, so it costs nothing extra.
 */

const SEA_Y = -0.2 * HEX_SCALE + 0.05
/** Off the south-west coast, outside the merchants' lap (Ships.tsx), past the graveyard. */
const FROM = [-140, 40] as const
const TO = [-45, 135] as const
const SCALE = 1.25
const DRAFT = 1.25
/** The mist's colour while the ghost passes (linear): a pale spectral green, lit for the hour. */
const GHOST_MIST_DAY = new Color(0.62, 0.86, 0.74)
const GHOST_MIST_NIGHT = new Color(0.07, 0.2, 0.15)
const mistTint = new Color()

export default function GhostShip({ show, events }: ShowProps) {
  const { nodes } = useGLTF(SHIPS_URL) as unknown as { nodes: Record<string, Object3D> }
  const group = useRef<Group>(null)
  const age = useRef(0)
  const finished = useRef(false)
  const uniforms = useRef({ uTime: { value: 0 }, uFade: { value: 0 } }).current
  const built = useOwnedMeshes(() => buildGhost(nodes["ship-ghost"], uniforms), [nodes], "textures")

  useFrame((_, delta) => {
    const g = group.current
    if (!built || !g) return
    age.current += Math.min(delta, 0.1)
    const t = age.current
    const total = DURATION_S["ghost-ship"]
    const k = envelope(t, total, 5, 6)
    uniforms.uTime.value = t
    uniforms.uFade.value = k
    // Along the coast at an unhurried, even speed: a ghost doesn't sail, it drifts.
    const p = t / total
    const x = lerp(FROM[0], TO[0], p)
    const z = lerp(FROM[1], TO[1], p)
    g.position.set(x, SEA_Y - DRAFT * SCALE + Math.sin(t * 0.7) * 0.25, z)
    g.rotation.set(
      Math.sin(t * 0.45) * 0.03,
      Math.atan2(TO[0] - FROM[0], TO[1] - FROM[1]),
      Math.sin(t * 0.6) * 0.05,
    )
    if (t >= total && !finished.current) {
      finished.current = true
      events.done(show.id)
    }
  }, FRAME.WORLD)

  // The sea mist rises with it: written into the shared sky after the sky is computed and before
  // anything (atmosphere/Post's grade) copies it, hence between SKY and WORLD.
  useFrame(() => {
    if (!built) return
    const k = envelope(age.current, DURATION_S["ghost-ship"], 5, 6)
    if (k <= 0) return
    // The grade's mist only ever lifts the colour under it, so its tint must sit above the sea's.
    sky.mist = Math.max(sky.mist, 0.62 * k)
    sky.mistTop = Math.max(sky.mistTop, 1.7 * k)
    mistTint.copy(GHOST_MIST_NIGHT).lerp(GHOST_MIST_DAY, 1 - sky.night)
    sky.mistColor.lerp(mistTint, 0.8 * k)
  }, FRAME.SKY + 1)

  if (!built) return null
  return (
    <group ref={group} name="ghost-ship" scale={SCALE}>
      {built.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </group>
  )
}

interface Uniforms {
  uTime: { value: number }
  uFade: { value: number }
}

function buildGhost(node: Object3D | undefined, uniforms: Uniforms) {
  const baked = node ? bakeNode(node) : null
  const meshes: Mesh[] = []
  if (baked) {
    const material = new MeshStandardMaterial({
      map: baked.material.map,
      color: new Color(0.3, 0.46, 0.42),
      emissive: new Color(0.03, 0.16, 0.11),
      roughness: 0.9,
      transparent: true,
      depthWrite: true,
    })
    flutter(material, uniforms, 0.32)
    const base = material.onBeforeCompile
    material.onBeforeCompile = (shader, renderer) => {
      base(shader, renderer)
      shader.uniforms.uFade = uniforms.uFade
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying float vHullY;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvHullY = position.y;")
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uFade;\nuniform float uTime;\nvarying float vHullY;",
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          // A spectral rim: brightest where the hull turns away from the eye.
          float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.0);
          float pulse = 0.85 + 0.25 * sin(uTime * 1.7);
          totalEmissiveRadiance += vec3(0.3, 1.0, 0.68) * (rim * 1.3 + 0.12) * pulse;`,
        )
        .replace(
          "#include <opaque_fragment>",
          // Thin as smoke, and the hull dissolves into the sea below the waterline's mist.
          `diffuseColor.a *= uFade * 0.55 * smoothstep(0.4, 3.2, vHullY);
          #include <opaque_fragment>`,
        )
    }
    material.customProgramCacheKey = () => "ghost-ship"
    const ship = new Mesh(baked.geometry, material)
    ship.castShadow = false
    ship.receiveShadow = false
    ship.renderOrder = 5
    meshes.push(ship)
  }
  meshes.push(wisps(uniforms))
  return { meshes }
}

/**
 * Will-o'-the-wisps bobbing round the deck and the bow, and low banks of sea mist clinging to the
 * hull (ship space): one instanced mesh, every motion in its vertex shader.
 */
function wisps(uniforms: Uniforms): InstancedMesh {
  const WISPS = 14
  const BANKS = 12
  const COUNT = WISPS + BANKS
  const seat = new Float32Array(COUNT * 3)
  const seed = new Float32Array(COUNT)
  const bank = new Float32Array(COUNT)
  for (let i = 0; i < COUNT; i++) {
    const mist = i >= WISPS
    seat.set(
      mist
        ? [(hash01(i * 3) - 0.5) * 16, 2.2 + hash01(i * 3 + 1) * 1.8, (hash01(i * 3 + 2) - 0.5) * 22]
        : [(hash01(i * 3) - 0.5) * 6, 2.5 + hash01(i * 3 + 1) * 6, (hash01(i * 3 + 2) - 0.5) * 11],
      i * 3,
    )
    seed[i] = hash01(i * 17)
    bank[i] = mist ? 1 : 0
  }
  const geometry = new PlaneGeometry(1, 1)
  geometry.setAttribute("aSeat", new InstancedBufferAttribute(seat, 3))
  geometry.setAttribute("aSeed", new InstancedBufferAttribute(seed, 1))
  geometry.setAttribute("aBank", new InstancedBufferAttribute(bank, 1))
  const material = new ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uFade: uniforms.uFade },
    vertexShader: /* glsl */ `
      attribute vec3 aSeat; attribute float aSeed; attribute float aBank;
      uniform float uTime;
      varying vec2 vUv; varying float vGlow; varying float vBank;
      void main() {
        vUv = uv;
        vBank = aBank;
        float t = uTime * (0.5 + aSeed * 0.5) + aSeed * 40.0;
        vec3 p = aSeat;
        float size;
        if (aBank > 0.5) {
          // Mist banks: slow rolling drift, wide and flat on screen.
          p += vec3(sin(t * 0.3) * 1.5, 0.0, cos(t * 0.25) * 2.0);
          size = 9.0 + aSeed * 7.0;
          vGlow = 0.6 + 0.4 * sin(t * 0.5);
        } else {
          p += vec3(sin(t) * 0.9, sin(t * 1.7) * 0.6, cos(t * 0.8) * 1.2);
          size = 1.0 + 0.5 * aSeed;
          vGlow = 0.55 + 0.45 * sin(t * 3.0);
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        mv.xy += position.xy * size * vec2(1.0, aBank > 0.5 ? 0.45 : 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying vec2 vUv; varying float vGlow; varying float vBank;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = 1.0 - smoothstep(0.0, 1.0, d);
        if (vBank > 0.5) {
          a = a * 0.24 * vGlow * uFade;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vec3(0.55, 0.8, 0.7), a);
          return;
        }
        a = a * a * vGlow * uFade;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vec3(0.55, 1.0, 0.75) * 2.2, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  const mesh = new InstancedMesh(geometry, material, COUNT)
  mesh.frustumCulled = false
  mesh.renderOrder = 6
  return mesh
}
