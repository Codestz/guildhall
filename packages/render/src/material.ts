import { MeshStandardMaterial } from "three"

let shared: MeshStandardMaterial | null = null

/**
 * The one material every library piece draws with (ADR 003): colour comes from the baked vertex
 * colours, so one material serves the whole palette. Shared, so never dispose it per piece.
 */
export function paletteMaterial(): MeshStandardMaterial {
  shared ??= new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
  return shared
}
