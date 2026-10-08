import { useFrame, useThree } from "@react-three/fiber"
import { use, useMemo, useRef } from "react"
import { BackSide, Color, type Material, type Mesh, ShaderMaterial, Vector3, type WebGLRenderer } from "three"
import { useGuildStore } from "../../guild/useGuild.ts"
import { isWebGPU } from "../../render/backend.ts"
import { installNodes, TSL } from "../tsl.ts"
import type { SkyState } from "./sky.ts"

/**
 * The sky (ADR 0007, task "Sky"): one sphere round the camera with a gradient from the zenith to
 * the horizon, the fog colour below it (so the faded coast meets it seamlessly), a glow round the
 * sun, the sun and moon discs, and procedural stars — all one draw call. It is drawn first, never
 * writes depth, and never fogs. The Diorama looks down, so there it is the haze under the horizon;
 * Explore looks out, and sees the sky.
 *
 * GLSL by default. The same dome as a TSL node material (skyNodes.ts) on WebGPU, always, and on
 * WebGL with `?tsl=1` (scene/tsl.ts); it suspends while that loads.
 */
export function SkyDome({ sky }: { sky: SkyState }) {
  const store = useGuildStore()
  const gl = useThree((state) => state.gl)
  const build = isWebGPU(gl) || TSL ? use(nodeDomes(gl)) : glslDome
  const { material, uniforms } = useMemo(() => build(), [build])
  const mesh = useRef<Mesh>(null)

  useFrame(({ camera, clock }) => {
    if (mesh.current) mesh.current.position.copy(camera.position)
    const u = uniforms
    const { sun, moon } = store.environment
    u.zenith.value.copy(sky.zenith)
    u.horizon.value.copy(sky.horizon)
    u.fogColor.value.copy(sky.fog)
    u.glow.value.copy(sky.glow)
    u.sunColor.value.copy(sky.sunColor)
    u.sunDirection.value.set(sun[0], sun[1], sun[2])
    u.moonDirection.value.set(moon[0], moon[1], moon[2])
    u.sunDisc.value = sky.sunDisc
    u.moonDisc.value = sky.moonDisc
    u.stars.value = sky.stars
    u.time.value = clock.elapsedTime
  })

  return (
    <mesh ref={mesh} material={material} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[400, 48, 24]} />
    </mesh>
  )
}

/** What the dome is fed each frame (GLSL uniforms, or uniform nodes: both hold a `value`). */
export function skyUniforms() {
  return {
    zenith: { value: new Color() },
    horizon: { value: new Color() },
    fogColor: { value: new Color() },
    glow: { value: new Color() },
    sunColor: { value: new Color() },
    moonColor: { value: new Color("#e6edff") },
    sunDirection: { value: new Vector3(0, 1, 0) },
    moonDirection: { value: new Vector3(0, -1, 0) },
    sunDisc: { value: 0 },
    moonDisc: { value: 0 },
    stars: { value: 0 },
    time: { value: 0 },
  }
}
export type SkyUniforms = ReturnType<typeof skyUniforms>

/** A dome's material and the uniforms SkyDome writes. */
export interface Dome {
  material: Material
  uniforms: SkyUniforms
}

/** The GLSL dome (the default on WebGL). */
export function glslDome(): Dome {
  const uniforms = skyUniforms()
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  })
  return { material, uniforms }
}

const nodeBuilds = new WeakMap<object, Promise<() => Dome>>()

/**
 * The node-material dome, once the renderer can draw it (one promise per renderer, for `use`).
 * WebGPU draws node materials natively; WebGL needs the nodes handler first.
 */
function nodeDomes(gl: WebGLRenderer): Promise<() => Dome> {
  let build = nodeBuilds.get(gl)
  if (!build) {
    const ready = isWebGPU(gl) ? Promise.resolve() : installNodes(gl)
    build = ready.then(() => import("./skyNodes.ts")).then((nodes) => nodes.nodeDome)
    nodeBuilds.set(gl, build)
  }
  return build
}

const VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAGMENT = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 fogColor;
uniform vec3 glow;
uniform vec3 sunColor;
uniform vec3 moonColor;
uniform vec3 sunDirection;
uniform vec3 moonDirection;
uniform float sunDisc;
uniform float moonDisc;
uniform float stars;
uniform float time;
varying vec3 vDirection;

float hash(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 d = normalize(vDirection);
  float h = d.y;

  // Gradient: a wide pale band at the horizon that deepens towards the zenith.
  float up = clamp(h, 0.0, 1.0);
  vec3 colour = mix(horizon, zenith, pow(up, 0.55));

  // The glow round the sun, strongest low in the sky (dawn, dusk) and along the horizon.
  float toSun = max(dot(d, sunDirection), 0.0);
  float band = exp(-abs(h) * 6.0);
  colour += glow * (pow(toSun, 6.0) * (0.25 + 0.55 * band) + pow(toSun, 48.0) * 0.5);

  // Below the horizon: the fog, so the faded island edge meets the sky without a seam.
  colour = mix(colour, fogColor, smoothstep(0.02, -0.06, h));

  // Stars: one in a few cells of a grid on the sphere, twinkling, thinning into the horizon haze.
  if (stars > 0.001 && h > 0.0) {
    vec3 p = d * 160.0;
    vec3 cell = floor(p);
    float pick = hash(cell);
    if (pick > 0.86) {
      vec3 at = vec3(hash(cell + 1.3), hash(cell + 7.1), hash(cell + 3.7)) * 0.6 + 0.2;
      float r = length(fract(p) - at);
      float size = mix(0.1, 0.22, pow(hash(cell + 5.9), 3.0));
      float twinkle = 0.75 + 0.25 * sin(time * (1.5 + pick * 3.0) + pick * 40.0);
      float star = smoothstep(size, 0.0, r) * twinkle * smoothstep(0.03, 0.3, h);
      colour += vec3(0.85, 0.9, 1.0) * star * stars * 3.5;
    }
  }

  // Moon: a soft-edged disc with a faint halo.
  float toMoon = dot(d, moonDirection);
  float moon = smoothstep(0.99935, 0.9996, toMoon);
  colour += moonColor * pow(max(toMoon, 0.0), 220.0) * 0.18 * moonDisc;
  colour = mix(colour, moonColor * 1.4, moon * moonDisc);

  // Sun: an HDR disc, so bloom gives it a corona.
  float sun = smoothstep(0.99955, 0.99975, toSun);
  colour += sunColor * sun * sunDisc * 8.0;

  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
