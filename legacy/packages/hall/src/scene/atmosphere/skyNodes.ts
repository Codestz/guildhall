import { BackSide, CustomToneMapping, NoToneMapping, type ToneMapping } from "three"
import {
  abs,
  dot,
  exp,
  Fn,
  float,
  floor,
  fract,
  If,
  length,
  luminance,
  max,
  mix,
  neutralToneMapping,
  normalize,
  positionLocal,
  pow,
  renderOutput,
  sin,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from "three/tsl"
import { type Node, type NodeBuilder, NodeMaterial } from "three/webgpu"
import { isWebGPU } from "../../render/backend.ts"
import { unpackExposure } from "./lowGrade.ts"
import { type Dome, skyUniforms } from "./SkyDome.tsx"

/**
 * The sky dome as a TSL node material (WebGPU, and WebGL with `?tsl=1`): SkyDome's GLSL node for
 * node, so either path draws the same sky. Two changes of form, none of result: the reversed-edge
 * `smoothstep(a, b, x)` (a > b) are written `1 - smoothstep(b, a, x)`, the same curve, because
 * WGSL and Metal leave reversed edges undefined; and the output step is the dome's own (`display`).
 * Loaded on demand: it pulls in three/webgpu.
 */
export function nodeDome(): Dome {
  const v = skyUniforms()
  const u = {
    zenith: uniform(v.zenith.value),
    horizon: uniform(v.horizon.value),
    fogColor: uniform(v.fogColor.value),
    glow: uniform(v.glow.value),
    sunColor: uniform(v.sunColor.value),
    moonColor: uniform(v.moonColor.value),
    sunDirection: uniform(v.sunDirection.value),
    moonDirection: uniform(v.moonDirection.value),
    sunDisc: uniform(v.sunDisc.value),
    moonDisc: uniform(v.moonDisc.value),
    stars: uniform(v.stars.value),
    time: uniform(v.time.value),
  }

  const sky = Fn(() => {
    const d = normalize(positionLocal).toVar()
    const h = d.y.toVar()

    // Gradient: a wide pale band at the horizon that deepens towards the zenith.
    const up = h.clamp(0, 1)
    const colour = mix(u.horizon, u.zenith, pow(up, 0.55)).toVar()

    // The glow round the sun, strongest low in the sky (dawn, dusk) and along the horizon.
    const toSun = max(dot(d, u.sunDirection), 0).toVar()
    const band = exp(abs(h).mul(-6))
    colour.addAssign(u.glow.mul(pow(toSun, 6).mul(band.mul(0.55).add(0.25)).add(pow(toSun, 48).mul(0.5))))

    // Below the horizon: the fog, so the faded island edge meets the sky without a seam.
    colour.assign(mix(colour, u.fogColor, float(1).sub(smoothstep(-0.06, 0.02, h))))

    // Stars: one in a few cells of a grid on the sphere, twinkling, thinning into the horizon haze.
    If(u.stars.greaterThan(0.001).and(h.greaterThan(0)), () => {
      const p = d.mul(160).toVar()
      const cell = floor(p).toVar()
      const pick = hash(cell).toVar()
      If(pick.greaterThan(0.86), () => {
        const at = vec3(hash(cell.add(1.3)), hash(cell.add(7.1)), hash(cell.add(3.7)))
          .mul(0.6)
          .add(0.2)
        const r = length(fract(p).sub(at))
        const size = mix(0.1, 0.22, pow(hash(cell.add(5.9)), 3))
        const twinkle = sin(u.time.mul(pick.mul(3).add(1.5)).add(pick.mul(40)))
          .mul(0.25)
          .add(0.75)
        const star = float(1)
          .sub(smoothstep(0, size, r))
          .mul(twinkle)
          .mul(smoothstep(0.03, 0.3, h))
        colour.addAssign(vec3(0.85, 0.9, 1).mul(star).mul(u.stars).mul(3.5))
      })
    })

    // Moon: a soft-edged disc with a faint halo.
    const toMoon = dot(d, u.moonDirection).toVar()
    const moon = smoothstep(0.99935, 0.9996, toMoon)
    colour.addAssign(
      u.moonColor
        .mul(pow(max(toMoon, 0), 220))
        .mul(0.18)
        .mul(u.moonDisc),
    )
    colour.assign(mix(colour, u.moonColor.mul(1.4), moon.mul(u.moonDisc)))

    // Sun: an HDR disc, so bloom gives it a corona.
    const sun = smoothstep(0.99955, 0.99975, toSun)
    colour.addAssign(u.sunColor.mul(sun).mul(u.sunDisc).mul(8))
    return colour
  })()

  const material = new NodeMaterial()
  material.side = BackSide
  material.depthWrite = false
  material.depthTest = false
  material.fog = false
  // Two parameters, so three hands the builder second (its renderer: what this draw is into).
  material.fragmentNode = Fn((_: [], builder: NodeBuilder) => display(sky, builder.renderer))()
  return { material, uniforms: u }
}

/** The GLSL dome's `hash`: a cell's pseudo-random 0–1. */
const hash = Fn(([cell]: [Node<"vec3">]) => {
  const p = fract(cell.mul(vec3(443.897, 441.423, 437.195))).toVar()
  p.addAssign(dot(p, p.yzx.add(19.19)))
  return fract(p.x.add(p.y).mul(p.z))
})

/** What the output step reads of the renderer drawing (WebGLRenderer, through the handler, or WebGPU's). */
interface Drawing {
  getRenderTarget(): unknown
  toneMapping: ToneMapping
  outputColorSpace: string
}

/**
 * The GLSL dome's `tonemapping_fragment` + `colorspace_fragment`, decided when the shader is built.
 * WebGL turns both off inside a render target (the composer's: linear, graded later) and puts them
 * on for the screen (the Low tier, no post). The nodes handler would apply the renderer's either way,
 * encoding twice inside the composer (scene/tsl.ts), so the dome writes its own output. WebGPU
 * converts in its own output pass: the dome stays linear there.
 */
function display(colour: Node<"vec3">, renderer: Drawing): Node<"vec4"> {
  const out = vec4(colour, 1)
  if (isWebGPU(renderer) || renderer.getRenderTarget() !== null) return out
  if (renderer.toneMapping !== CustomToneMapping)
    return renderOutput(out, renderer.toneMapping, renderer.outputColorSpace)
  return renderOutput(vec4(lowGraded(colour), 1), NoToneMapping, renderer.outputColorSpace)
}

/**
 * The Low tier's CustomToneMapping (atmosphere/lowGrade.ts), which TSL can't run: the same Neutral
 * curve, then the desaturation, both unpacked from the renderer's exposure each draw.
 */
function lowGraded(colour: Node<"vec3">): Node<"vec3"> {
  const exposure = uniform(1).onRenderUpdate(({ renderer }) => unpack(renderer)[0])
  const desaturate = uniform(0).onRenderUpdate(({ renderer }) => unpack(renderer)[1])
  const toned = neutralToneMapping(colour, exposure) as Node<"vec3">
  return mix(toned, vec3(luminance(toned)), desaturate)
}

function unpack(renderer: unknown): [number, number] {
  return unpackExposure((renderer as { toneMappingExposure: number }).toneMappingExposure)
}
