import { MeshStandardMaterial } from "three"
import { patchCascades } from "./sun/patch.ts"

let shared: MeshStandardMaterial | null = null

/**
 * The one material every library piece draws with (ADR 003): colour comes from the baked vertex
 * colours, so one material serves the whole palette. Shared, so never dispose it per piece. Its sun
 * shadows read the cascades when the sun has them (ADR 009, `sun/patch.ts`).
 */
export function paletteMaterial(): MeshStandardMaterial {
  if (!shared) {
    shared = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
    shared.onBeforeCompile = patchCascades
  }
  return shared
}
