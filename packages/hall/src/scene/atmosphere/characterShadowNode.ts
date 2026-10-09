import type { Light, LightShadow, RenderTarget } from "three"
import { type NodeFrame, ShadowNode } from "three/webgpu"
import { castingNow, castRoots } from "./characterShadows.ts"

/**
 * The characters' map on WebGPU (characterShadows.ts is the plan, cascadeShadowNode.ts the lookup
 * that reads it): a shadow node that draws only the planned roots instead of the whole scene.
 * three's ShadowNode renders `frame.scene` through the shadow material it has just put on it; this
 * one renders `castRoots` through the same material, with the roots' meshes casting for the length
 * of the draw. Everything else (the target, the filter, the update flags) is three's.
 */
export class CharacterShadowNode extends ShadowNode {
  private primed = false

  /** The base class's fields, which its typings leave out. */
  private get held(): { light: Light; shadow: LightShadow; shadowMap: RenderTarget } {
    return this as unknown as { light: Light; shadow: LightShadow; shadowMap: RenderTarget }
  }

  /**
   * Drawn once, as soon as anything reads it, whether or not anyone is in it: a map first drawn
   * after the bindings that sample it were made is made anew then, and those bindings (every lit
   * material's) are left pointing at the destroyed one.
   */
  override updateBefore(frame: NodeFrame): boolean | undefined {
    if (!this.primed) {
      this.primed = true
      this.held.shadow.needsUpdate = true
    }
    return super.updateBefore(frame)
  }

  renderShadow(frame: NodeFrame): void {
    const { light, shadow, shadowMap } = this.held
    const { renderer, scene } = frame
    if (!renderer || !scene) return
    shadow.updateMatrices(light)
    shadowMap.setSize(shadow.mapSize.width, shadow.mapSize.height, shadowMap.depth)
    castRoots.overrideMaterial = scene.overrideMaterial
    try {
      castingNow(() => renderer.render(castRoots, shadow.camera))
    } finally {
      castRoots.overrideMaterial = null
    }
  }
}
