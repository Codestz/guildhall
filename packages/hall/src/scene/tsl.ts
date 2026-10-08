import {
  type Camera,
  ColorManagement,
  CustomToneMapping,
  type Fog,
  type FogExp2,
  type Material,
  NoToneMapping,
  type Object3D,
  type ToneMapping,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three"
import type { WebGLNodesHandler } from "three/examples/jsm/tsl/WebGLNodesHandler.js"
import type { Node } from "three/webgpu"

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
    done = nodesHandler().then((handler) => gl.setNodesHandler(handler))
    installed.set(gl, done)
  }
  return done
}

/**
 * The tone mapping and colour space WebGLRenderer gives any material drawn into `target`
 * (WebGLPrograms): the renderer's own on the canvas, none and the linear working space into any
 * other target — the composer's input buffer, which tone-maps and encodes once at the end.
 */
export function outputOf(
  gl: Pick<WebGLRenderer, "toneMapping" | "outputColorSpace">,
  target: WebGLRenderTarget | null,
  toneMapped: boolean,
): { toneMapping: ToneMapping; colorSpace: string } {
  const xr = target !== null && (target as { isXRRenderTarget?: boolean }).isXRRenderTarget === true
  return {
    toneMapping: toneMapped && (target === null || xr) ? gl.toneMapping : NoToneMapping,
    colorSpace:
      target === null
        ? gl.outputColorSpace
        : xr
          ? target.texture.colorSpace
          : ColorManagement.workingColorSpace,
  }
}

/** The handler's per-scene context (not in its typings): the fog node it hands node materials. */
interface SceneContext {
  fogNode: unknown
  scene: Object3D & { fog?: Fog | FogExp2 | null }
}

/** The handler's internals the subclass below reaches (not in its typings). */
interface Internals {
  renderer: WebGLRenderer
  renderStack: { sceneContext: SceneContext }[]
  sceneContexts: WeakMap<Object3D, SceneContext>
  getOutputCallback: (output: Node<"vec4">, builder: { material: Material }) => Node<"vec4">
}

/** lowGrade.ts packs `4 · desaturate steps + exposure` into toneMappingExposure. */
const SLOT = 4

/** The island's nodes handler (exported for tests: `installNodes` is the way in). */
export async function nodesHandler(): Promise<WebGLNodesHandler> {
  const [{ WebGLNodesHandler }, T, { radialFog, radialFogFactor }, { DESATURATE_STEPS }] = await Promise.all([
    import("three/examples/jsm/tsl/WebGLNodesHandler.js"),
    import("three/tsl"),
    import("./atmosphere/fogNode.ts"),
    import("./atmosphere/lowGrade.ts"),
  ])

  /** lowGrade.ts's CustomToneMapping (Low's grade: Neutral, then a desaturation), node for node. */
  const lowGrade = (input: Node<"vec4">): Node<"vec4"> =>
    T.Fn(() => {
      const packed = T.toneMappingExposure as unknown as Node<"float">
      const slot = T.floor(packed.div(SLOT))
      const exposure = packed.sub(slot.mul(SLOT))
      const color = input.rgb.mul(exposure).toVar()
      const x = T.min(color.r, T.min(color.g, color.b))
      color.subAssign(T.select(x.lessThan(0.08), x.sub(x.mul(x).mul(6.25)), 0.04))
      const peak = T.max(color.r, T.max(color.g, color.b)).toVar()
      T.If(peak.greaterThanEqual(0.76), () => {
        const top = T.float(1).sub(T.float(0.24 * 0.24).div(peak.add(0.24 - 0.76)))
        color.mulAssign(top.div(peak))
        const g = T.float(1).sub(T.float(1).div(T.float(0.15).mul(peak.sub(top)).add(1)))
        color.assign(T.mix(color, T.vec3(top), g))
      })
      const luma = T.dot(color, T.vec3(0.2126, 0.7152, 0.0722))
      return T.vec4(T.mix(color, T.vec3(luma), slot.div(DESATURATE_STEPS)), input.a)
    })()

  /** Fog applied to an already-output colour, as three's built-ins do on the canvas. */
  const fogged = (input: Node<"vec4">, fog: Fog | FogExp2): Node<"vec4"> => {
    const color = T.reference("color", "color", fog)
    const factor = (fog as FogExp2).isFogExp2
      ? T.densityFogFactor(T.reference("density", "float", fog))
      : radialFogFactor(T.reference("near", "float", fog), T.reference("far", "float", fog))
    return T.vec4(T.mix(input.rgb, color, factor), input.a)
  }

  class IslandNodes extends WebGLNodesHandler {
    private readonly radial = new WeakMap<SceneContext, Fog | FogExp2 | null>()
    /** The scene fog a node material being built for the canvas takes after its output step. */
    private late: Fog | FogExp2 | null = null

    constructor() {
      super()
      const self = this as unknown as Internals
      /**
       * The stock output step tone-maps and encodes with the renderer's settings whatever the
       * target, so a lit node material drawn into the composer's buffer came out sRGB-encoded twice.
       * Here it follows the target as WebGLRenderer does for its own materials (`outputOf`); the
       * renderer's program key already tells the two apart. Low's CustomToneMapping is our GLSL
       * (lowGrade.ts), ported above: TSL has no custom slot.
       */
      self.getOutputCallback = (output, builder) => {
        const { toneMapping, colorSpace } = outputOf(
          self.renderer,
          self.renderer.getRenderTarget(),
          builder.material.toneMapped,
        )
        let node = output
        if (toneMapping === CustomToneMapping) node = lowGrade(node)
        else if (toneMapping !== NoToneMapping)
          node = node.toneMapping(toneMapping) as unknown as Node<"vec4">
        if (colorSpace !== ColorManagement.workingColorSpace)
          node = T.workingToColorSpace(node, colorSpace) as unknown as Node<"vec4">
        return this.late ? fogged(node, this.late) : node
      }
    }

    /**
     * The stock handler fogs node materials by depth from the camera (`rangeFogFactor`); the
     * island's fog is radial (atmosphere/fog.ts). Each time a scene's fog changes, the handler
     * rebuilds its fog node in `renderStart`; right after, a linear fog's is swapped for the radial
     * one. FogExp2 stays stock, as it does for the built-in materials.
     */
    override renderStart(scene: Object3D, camera: Camera, target: Object3D = scene): void {
      super.renderStart(scene, camera, target)
      const context = (this as unknown as Internals).sceneContexts.get(target)
      const fog = (target as SceneContext["scene"]).fog ?? null
      if (!context || this.radial.get(context) === fog) return
      this.radial.set(context, fog)
      if (fog && (fog as Fog).isFog) context.fogNode = radialFog(fog as Fog)
    }

    /**
     * On the canvas (Low: no composer) three's built-ins fog *after* tone mapping and encoding
     * (`fog_fragment` comes last); a node material fogs before. So a node material built for the
     * canvas is built without the scene's fog node and fogged in the output step instead. Into a
     * target the output step changes nothing, so the stock order stands. A material with its own
     * `fragmentNode` skips the output step and keeps the stock fog.
     */
    override build(...args: Parameters<WebGLNodesHandler["build"]>): void {
      const [material] = args
      const self = this as unknown as Internals
      const context = self.renderStack.at(-1)?.sceneContext
      const fog = context?.scene.fog ?? null
      const { fog: fogOn, fragmentNode } = material as Material & { fog?: boolean; fragmentNode?: unknown }
      if (!context?.fogNode || !fog || !fogOn || fragmentNode || self.renderer.getRenderTarget() !== null) {
        super.build(...args)
        return
      }
      const fogNode = context.fogNode
      context.fogNode = null
      this.late = fog
      try {
        super.build(...args)
      } finally {
        context.fogNode = fogNode
        this.late = null
      }
    }
  }

  return new IslandNodes()
}
