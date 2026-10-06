import { useFrame } from "@react-three/fiber"
import { useRef } from "react"
import { DoubleSide, Mesh, NormalBlending, RingGeometry, ShaderMaterial, Vector3 } from "three"
import { reducedMotion } from "../../guild/opening.ts"
import { sky } from "../atmosphere/state.ts"
import { FRAME } from "../frame.ts"
import { useOwnedMeshes } from "../owned.ts"
import { DURATION_S, envelope, NIGHT_AT, smooth } from "./common.ts"
import type { ShowProps } from "./EventsLayer.tsx"

/**
 * After the storm (the sky clears, guild/events.ts): a rainbow stands over the island. One arc
 * mesh, one draw call; the bands, their soft edges, the feet dissolving into the haze and the
 * sweep that draws it in from one foot to the other all live in its fragment shader. Like a real
 * rainbow it always faces the viewer (the arc turns with the camera, about the island). At night
 * it is a moonbow: the same arc, pale and silver.
 */

/** Where the arc stands: about the island's middle, pushed back from the viewer. */
const CENTRE = new Vector3(0, -10, -12)
const BACK = 46
const RADIUS = 104
const WIDTH = 13

const toCamera = new Vector3()

export default function Rainbow({ show, events }: ShowProps) {
  const age = useRef(0)
  const finished = useRef(false)
  const night = useRef(sky.night > NIGHT_AT).current
  const uniforms = useRef({
    uReveal: { value: 0 },
    uFade: { value: 0 },
    uNight: { value: night ? 1 : 0 },
  }).current
  const built = useOwnedMeshes(() => ({ meshes: [arc(uniforms)] }), [])

  useFrame(({ camera }, delta) => {
    const mesh = built?.meshes[0]
    if (!mesh) return
    age.current += Math.min(delta, 0.1)
    const t = age.current
    const total = DURATION_S.rainbow
    uniforms.uReveal.value = reducedMotion() ? 1.2 : smooth(0, 6.5, t) * 1.2
    uniforms.uFade.value = envelope(t, total, 1.5, 7)
    // Face the viewer, about the island: the arc's plane turns with the camera's bearing.
    toCamera.set(camera.position.x - CENTRE.x, 0, camera.position.z - CENTRE.z)
    if (toCamera.lengthSq() < 1e-6) toCamera.set(1, 0, 1)
    toCamera.normalize()
    mesh.position.set(CENTRE.x - toCamera.x * BACK, CENTRE.y, CENTRE.z - toCamera.z * BACK)
    mesh.rotation.set(0, Math.atan2(toCamera.x, toCamera.z), 0)
    if (t >= total && !finished.current) {
      finished.current = true
      events.done(show.id)
    }
  }, FRAME.WORLD)

  if (!built) return null
  return <primitive object={built.meshes[0] as Mesh} />
}

function arc(uniforms: { uReveal: { value: number }; uFade: { value: number }; uNight: { value: number } }) {
  const geometry = new RingGeometry(RADIUS - WIDTH, RADIUS, 128, 1, 0, Math.PI)
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vLocal;
      void main() {
        vLocal = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uReveal; uniform float uFade; uniform float uNight;
      varying vec2 vLocal;
      const float R = ${RADIUS.toFixed(1)};
      const float W = ${WIDTH.toFixed(1)};
      vec3 hue(float h) {
        vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        return k * k * (3.0 - 2.0 * k);
      }
      void main() {
        float r = length(vLocal);
        float band = clamp((r - (R - W)) / W, 0.0, 1.0);   // 0 inner (violet) … 1 outer (red)
        float along = 1.0 - atan(vLocal.y, vLocal.x) / 3.14159265;  // 0 left foot … 1 right foot
        // Soft edges, a little brighter in the middle bands, as a real bow.
        float edge = smoothstep(0.0, 0.2, band) * (1.0 - smoothstep(0.8, 1.0, band));
        // The feet melt into the haze over the sea.
        float feet = smoothstep(4.0, 34.0, vLocal.y);
        // Drawn in from the left foot to the right.
        float shown = 1.0 - smoothstep(uReveal - 0.12, uReveal, along);
        // The spectrum spans the band inside its soft edges, so the red and the violet both show.
        float h = clamp((band - 0.14) / 0.72, 0.0, 1.0);
        vec3 colour = hue((1.0 - h) * 0.74) * 0.9 + 0.1;
        colour = mix(colour, vec3(0.86, 0.9, 1.0), uNight * 0.82);
        float strength = mix(0.5, 0.26, uNight);
        float a = edge * feet * shown * uFade * strength;
        if (a < 0.003) discard;
        gl_FragColor = vec4(colour, a);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: NormalBlending,
  })
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = -1
  return mesh
}
