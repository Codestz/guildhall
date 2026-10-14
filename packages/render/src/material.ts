import { MeshStandardMaterial } from "three"
import { patchCloudShade } from "./atmosphere/shade.ts"
import { patchSnowCover } from "./events/snowCover.ts"
import { patchLodFade } from "./lodFade.ts"
import { patchGlow } from "./night/glow.ts"
import { patchRegionTint } from "./regionTint.ts"
import { patchSeason } from "./season.ts"
import { patchCascades } from "./sun/patch.ts"

/**
 * What draws with the palette material: a plain mesh, an InstancedMesh or a BatchedMesh. Three keys a
 * material's program by the object kind drawing it (`instancing`, `batching`), so one material drawn
 * by all three kinds in a frame swapped programs at every change of kind (a cache-key string and a
 * parameters object each time, and garbage); one shared material per kind, the same look, never swaps.
 */
export type PaletteKind = "mesh" | "instanced" | "batched"

const palette: Partial<Record<PaletteKind, MeshStandardMaterial>> = {}

/**
 * The one material every library piece draws with (ADR 003): colour comes from the baked vertex
 * colours, so one material serves the whole palette. Shared (one per object `kind`, see PaletteKind),
 * so never dispose it per piece. Its sun shadows read the cascades when the sun has them (ADR 009,
 * `sun/patch.ts`), the sun dims under the clouds' shadows when there is an atmosphere
 * (`atmosphere/shade.ts`), and the light sources a batch marks (`_glow`) glow by night (`night/glow.ts`).
 */
export function paletteMaterial(kind: PaletteKind = "mesh"): MeshStandardMaterial {
  let shared = palette[kind]
  if (!shared) {
    shared = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
    shared.name = `palette:${kind}`
    shared.onBeforeCompile = (shader) => {
      patchCascades(shader)
      patchCloudShade(shader)
      patchSnowCover(shader)
      patchRegionTint(shader)
      patchGlow(shader)
      // season tint (season.ts): the light's warmth only; summer draws as before
      patchSeason(shader, "light")
    }
    palette[kind] = shared
  }
  return shared
}

/** Whether `material` is one of the shared palette materials (never to be disposed per piece). */
export const isPaletteMaterial = (material: unknown): boolean =>
  Object.values(palette).some((m) => m === material)

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
      patchRegionTint(shader)
      patchGlow(shader)
      // season tint (season.ts): foliage, pines and crops by swatch, each tree its own; summer as before
      patchSeason(shader, "batch")
      patchLodFade(shader, dither)
    }
    material.customProgramCacheKey = () => (dither ? "guildhall-batch-dither" : "guildhall-batch")
    batched[k] = material
  }
  return material
}
