import type { Camera, Fog, Object3D, WebGLRenderer } from "three"

/**
 * TSL on today's WebGLRenderer (chapter 2, phase 2): shaders ported to node materials one at a
 * time, drawn through three's `WebGLNodesHandler`, behind `?tsl=1` until each is proven against the
 * golden views. Read once, at load. Off, nothing below is loaded (three/webgpu is ~0.8 MB).
 */
export const TSL: boolean =
  typeof location !== "undefined" && new URLSearchParams(location.search).get("tsl") === "1"

const installed = new WeakMap<WebGLRenderer, Promise<void>>()

/**
 * Teaches the renderer node materials, once: resolves when any node material may be drawn. Must
 * run before the first one is compiled. The handler then sits in every `render` of this renderer
 * (the composer's passes too), node materials or not.
 */
export function installNodes(gl: WebGLRenderer): Promise<void> {
  let done = installed.get(gl)
  if (!done) {
    done = install(gl)
    installed.set(gl, done)
  }
  return done
}

/** The handler's per-scene context (not in its typings): the fog node it hands node materials. */
interface SceneContext {
  fogNode: unknown
}

async function install(gl: WebGLRenderer): Promise<void> {
  const [{ WebGLNodesHandler }, { radialFog }] = await Promise.all([
    import("three/examples/jsm/tsl/WebGLNodesHandler.js"),
    import("./atmosphere/fogNode.ts"),
  ])

  /**
   * The stock handler fogs node materials by depth from the camera (`rangeFogFactor`); the island's
   * fog is radial (atmosphere/fog.ts). Each time a scene's fog changes, the handler rebuilds its fog
   * node in `renderStart`; right after, a linear fog's is swapped for the radial one. FogExp2 stays
   * stock, as it does for the built-in materials.
   */
  class IslandNodes extends WebGLNodesHandler {
    private readonly radial = new WeakMap<SceneContext, Fog | null>()

    override renderStart(scene: Object3D, camera: Camera, target: Object3D = scene): void {
      super.renderStart(scene, camera, target)
      const contexts = (this as unknown as { sceneContexts: WeakMap<Object3D, SceneContext> }).sceneContexts
      const context = contexts.get(target)
      const fog = (target as Object3D & { fog?: Fog | null }).fog ?? null
      if (!context || this.radial.get(context) === fog) return
      this.radial.set(context, fog)
      if (fog?.isFog) context.fogNode = radialFog(fog)
    }
  }

  gl.setNodesHandler(new IslandNodes())
}
