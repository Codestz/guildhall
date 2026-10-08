import type { Fog, Scene } from "three"
import { bool } from "three/tsl"
import { MeshStandardNodeMaterial, type NodeBuilder, WebGPURenderer } from "three/webgpu"
import { radialFog } from "../scene/atmosphere/fogNode.ts"
import { ditheredNode } from "../scene/castNodes.ts"
import { setNodeDither } from "../scene/dissolve.ts"
import { shimLowGrade } from "./shims.ts"

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
  renderer.library.addMaterial(GLSLStandIn, "ShaderMaterial")
  fogEveryRender(renderer)
  // Characters dissolve with a node mask here: WebGPU never runs the GLSL patch (scene/dissolve.ts).
  setNodeDither(ditheredNode)
  return renderer
}

/**
 * The island's radial fog (atmosphere/fogNode.ts) instead of three's planar range fog. The scene
 * sets `scene.fog` (Atmosphere.tsx); WebGPU reads `scene.fogNode` first. Every render, the main
 * one and the post pass's alike (both go through `render`), the node follows the scene's fog.
 *
 * Known Low-tier difference: with post (Medium and up) the scene draws into the pipeline's linear
 * target and the fog matches the GLSL composer. On Low it draws for the canvas, and WebGPU fogs in
 * linear before its output pass tone-maps and encodes, where WebGL's built-ins fog after encoding:
 * partly fogged ground comes out lighter (measured blue 141 vs 108), fully fogged a little darker
 * (148 vs 157). Matching it means fogging after the output transform (a DirectRenderPipeline-style
 * per-material output with the fog mixed in display space), not done yet.
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
 * What WebGPU draws for a `ShaderMaterial` (GLSL, which node materials cannot run): nothing (it is
 * discarded). Without this, three logs "Material ShaderMaterial is not compatible" and draws each
 * one as a blank, white node material.
 *
 * Every GLSL material the island draws every day has a node-material twin on WebGPU and never
 * comes here: the sky dome (atmosphere/skyNodes.ts), rain and snow (weather/fallNodes.ts), the water
 * (nature/waterNodes.ts), the grass (nature/grassNodes.ts) and the sigils (scene/sigilNodes.ts); so
 * have the cast's onBeforeCompile patches (scene/castNodes.ts: dissolve, rings, blobs, deed motes).
 * Still GLSL: the event shows (events/: Dragon, Festival, Comet, Ghost ship, Rainbow). Their own
 * shaders come here and are not drawn; their patched standard materials draw unpatched (no flag
 * flutter, no festival reveal, no dragon wingbeat, no ghost-ship rim or fade), until they are ported.
 */
class GLSLStandIn extends MeshStandardNodeMaterial {
  override setup(builder: NodeBuilder): void {
    this.maskNode = bool(false)
    super.setup(builder)
  }
}
