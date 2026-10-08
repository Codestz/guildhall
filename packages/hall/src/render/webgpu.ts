import type { Color, Fog, Scene } from "three"
import { bool, mix, positionLocal, uniform } from "three/tsl"
import { MeshStandardNodeMaterial, type NodeBuilder, WebGPURenderer } from "three/webgpu"
import { radialFog } from "../scene/atmosphere/fogNode.ts"
import { shimLowGrade, shimReadback } from "./shims.ts"

/**
 * The `?renderer=webgpu` renderer (loaded on demand by render/renderer.ts): three's WebGPURenderer,
 * initialised before R3F configures it (R3F 9's async `gl` factory), with the WebGL-only calls the
 * scene still makes shimmed (render/shims.ts) and a stand-in for its GLSL materials.
 */
export async function createWebGPURenderer(canvas: object): Promise<WebGPURenderer> {
  const renderer = new WebGPURenderer({
    canvas: canvas as HTMLCanvasElement,
    // The default path's choices (Hall.tsx): no MSAA (post-AA instead), the same power hint.
    antialias: false,
    alpha: true,
    powerPreference: "high-performance",
  })
  await renderer.init()
  shimLowGrade(renderer)
  shimReadback(renderer)
  renderer.library.addMaterial(GLSLStandIn, "ShaderMaterial")
  fogEveryRender(renderer)
  return renderer
}

/**
 * The island's radial fog (atmosphere/fogNode.ts) instead of three's planar range fog. The scene
 * sets `scene.fog` (Atmosphere.tsx); WebGPU reads `scene.fogNode` first. Every render, the main
 * one and the post pass's alike (both go through `render`), the node follows the scene's fog.
 */
function fogEveryRender(renderer: WebGPURenderer): void {
  const render = renderer.render.bind(renderer)
  const fogged = new WeakMap<Scene, Fog | null>()
  renderer.render = (object, camera) => {
    const scene = object as Scene & { fogNode?: unknown }
    if (scene.isScene) {
      const fog = (scene.fog as Fog | null)?.isFog ? (scene.fog as Fog) : null
      if (fogged.get(scene) !== fog) {
        fogged.set(scene, fog)
        scene.fogNode = fog ? radialFog(fog) : null
      }
    }
    return render(object, camera)
  }
}

/**
 * What WebGPU draws for a `ShaderMaterial` (GLSL, which node materials cannot run). three copies
 * the GLSL material's own fields onto this one, `uniforms` included, so it can pick by what the
 * shader was fed, and read the very same uniform objects (their per-frame writes stay live):
 *
 *   sky dome (atmosphere/SkyDome.tsx: zenith/horizon)  an unlit horizon→zenith gradient
 *   water (nature/Water.tsx: uShallow/uDeep)           an unlit, fogged sea between the two
 *   anything else (grass, rain/snow, sigils, events)   not drawn (discarded), until ported to TSL
 *
 * Without this, three logs "Material ShaderMaterial is not compatible" and draws each one as a
 * blank node material (a white sky, a white sea).
 */
class GLSLStandIn extends MeshStandardNodeMaterial {
  declare uniforms?: Record<string, { value: unknown } | undefined>

  override setup(builder: NodeBuilder): void {
    const u = this.uniforms ?? {}
    const zenith = u.zenith?.value as Color | undefined
    const horizon = u.horizon?.value as Color | undefined
    const shallow = u.uShallow?.value as Color | undefined
    const deep = u.uDeep?.value as Color | undefined
    if (zenith && horizon) {
      this.lights = false
      this.fog = false
      this.colorNode = mix(uniform(horizon), uniform(zenith), positionLocal.normalize().y.max(0))
    } else if (shallow && deep) {
      // Unlit: the sea's geometry carries no normals (its GLSL lit it from a flat up vector).
      this.lights = false
      this.colorNode = mix(uniform(deep), uniform(shallow), 0.6)
    } else {
      this.maskNode = bool(false)
    }
    super.setup(builder)
  }
}
