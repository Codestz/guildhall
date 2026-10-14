/**
 * After the storm (the sky clears): a rainbow stands over the island, drawn in from one foot to the
 * other, and fades. Like a real rainbow it always faces the viewer: the arc turns with the camera's
 * bearing, about the island. At night it is a moonbow, the same arc pale and silver. Ported from V1
 * (scene/events/Rainbow.tsx).
 *
 * One mesh, one draw: the bands, their soft edges, the feet melting into the haze over the sea and the
 * sweep that draws it in all live in its fragment shader. The CPU turns it to the camera.
 */
import { DoubleSide, Mesh, NormalBlending, RingGeometry, ShaderMaterial, Vector3 } from "three"
import { envelope, type ShowCtx, type ShowPiece, smooth } from "./show.ts"

/**
 * The arc's size from the island's: its radius, its band's width, how far behind the island's middle
 * it stands and how far its centre sinks under the sea (so its feet melt into the haze), metres. Sized
 * for the wide view a director gives a rainbow: it spans the island and its top stays in frame.
 */
export function rainbowSize(span: number): { radius: number; width: number; back: number; drop: number } {
  const radius = Math.max(60, span * 0.6)
  return { radius, width: radius * 0.125, back: radius * 0.5, drop: radius * 0.1 }
}

/** How much of the camera's downward look the arc leans back by: from above it still reads as a bow. */
const LEAN = 0.6

export function createRainbow(ctx: ShowCtx): ShowPiece {
  const { radius, width, back, drop } = rainbowSize(ctx.span)
  const uniforms = {
    uReveal: { value: 0 },
    uFade: { value: 0 },
    uNight: { value: ctx.night ? 1 : 0 },
  }
  const geometry = new RingGeometry(radius - width, radius, 128, 1, 0, Math.PI)
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uReveal; uniform float uFade; uniform float uNight;
varying vec2 vLocal;
const float R = ${radius.toFixed(1)};
const float W = ${width.toFixed(1)};
vec3 hue(float h) {
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return k * k * (3.0 - 2.0 * k);
}
void main() {
  float r = length(vLocal);
  float band = clamp((r - (R - W)) / W, 0.0, 1.0);              // 0 inner (violet) … 1 outer (red)
  float along = 1.0 - atan(vLocal.y, vLocal.x) / 3.14159265;     // 0 left foot … 1 right foot
  // soft edges, a little brighter in the middle bands, as a real bow
  float edge = smoothstep(0.0, 0.2, band) * (1.0 - smoothstep(0.8, 1.0, band));
  // the feet melt into the haze over the sea
  float feet = smoothstep(${(drop * 0.4).toFixed(1)}, ${(drop * 3.4).toFixed(1)}, vLocal.y);
  // drawn in from the left foot to the right
  float shown = 1.0 - smoothstep(uReveal - 0.12, uReveal, along);
  // the spectrum spans the band inside its soft edges, so the red and the violet both show
  float h = clamp((band - 0.14) / 0.72, 0.0, 1.0);
  vec3 colour = hue((1.0 - h) * 0.74) * 0.9 + 0.1;
  colour = mix(colour, vec3(0.86, 0.9, 1.0), uNight * 0.82);
  float strength = mix(0.5, 0.26, uNight);
  float a = edge * feet * shown * uFade * strength;
  if (a < 0.003) discard;
  gl_FragColor = vec4(colour, a);
}`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: NormalBlending,
  })
  const mesh = new Mesh(geometry, material)
  mesh.name = "show rainbow"
  mesh.frustumCulled = false
  // behind the island's own transparent things (the water's glints, the rain)
  mesh.renderOrder = -1
  const toCamera = new Vector3()
  return {
    object: mesh,
    draws: () => (mesh.visible ? 1 : 0),
    update(t, total, camera) {
      uniforms.uReveal.value = ctx.still ? 1.2 : smooth(0, 6.5, t) * 1.2
      uniforms.uFade.value = envelope(t, total, 1.5, 7)
      // face the viewer, about the island's middle: the arc's plane turns with the camera's bearing
      toCamera.set(camera.position.x, 0, camera.position.z)
      if (toCamera.lengthSq() < 1e-6) toCamera.set(1, 0, 1)
      toCamera.normalize()
      mesh.position.set(-toCamera.x * back, -drop, -toCamera.z * back)
      const pitch = Math.atan2(camera.position.y, Math.hypot(camera.position.x, camera.position.z))
      mesh.rotation.set(-Math.max(0, pitch) * LEAN, Math.atan2(toCamera.x, toCamera.z), 0, "YXZ")
    },
    dispose() {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
