import { MeshStandardMaterial } from "three"
import { patchCloudShade } from "./atmosphere/shade.ts"
import { patchSnowCover } from "./events/snowCover.ts"
import { patchLodFade } from "./lodFade.ts"
import { patchGlow } from "./night/glow.ts"
import { patchCascades } from "./sun/patch.ts"

let shared: MeshStandardMaterial | null = null

/**
 * The one material every library piece draws with (ADR 003): colour comes from the baked vertex
 * colours, so one material serves the whole palette. Shared, so never dispose it per piece. Its sun
 * shadows read the cascades when the sun has them (ADR 009, `sun/patch.ts`), the sun dims under the
 * clouds' shadows when there is an atmosphere (`atmosphere/shade.ts`), and the light sources a batch
 * marks (`_glow`) glow by night (`night/glow.ts`).
 */
export function paletteMaterial(): MeshStandardMaterial {
  if (!shared) {
    shared = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
    shared.onBeforeCompile = (shader) => {
      patchCascades(shader)
      patchCloudShade(shader)
      patchSnowCover(shader)
      patchGlow(shader)
    }
  }
  return shared
}

const batched: (MeshStandardMaterial | null)[] = [null, null]

/**
 * The palette material as the static batch draws it: the same light, plus the batch's LOD
 * transitions (`lodFade.ts`). `dither`: the one for the draws mid-crossfade, which discards half
 * their pixels; the batch's other draws use the plain one, so only those few pay for the discard.
 * Shared.
 */
export function batchMaterial(dither = false): MeshStandardMaterial {
  const k = dither ? 1 : 0
  let material = batched[k]
  if (!material) {
    material = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
    material.onBeforeCompile = (shader) => {
      patchCascades(shader)
      patchCloudShade(shader)
      patchSnowCover(shader)
      patchGlow(shader)
      patchLodFade(shader, dither)
    }
    material.customProgramCacheKey = () => (dither ? "guildhall-batch-dither" : "guildhall-batch")
    batched[k] = material
  }
  return material
}
