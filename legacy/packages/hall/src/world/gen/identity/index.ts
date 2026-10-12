import type { RepoShape } from "../repo.ts"
import { landOf } from "../scale.ts"
import { archetypeOf, traitsOf } from "./archetype.ts"
import { paletteOf } from "./palette.ts"
import { roleOf, wishOf } from "./role.ts"
import type { Identity, IslandHint } from "./types.ts"

export type { Archetype, Identity, IslandHint, Palette, Role } from "./types.ts"

/** The island's files, and their mean depth from its root. */
function sizeOf(shape: RepoShape): { files: number; depth: number } {
  const folders = [shape.root, ...shape.folders]
  const files = folders.reduce((sum, folder) => sum + folder.files, 0)
  const depth = folders.reduce((sum, folder) => sum + folder.depth * folder.files, 0)
  return { files, depth: files > 0 ? depth / files : 0 }
}

/**
 * Who an island is: its role (and so the landmark it wishes for), the shape of its land and its
 * palette, from its tree's shape and what its archipelago knows of it. `seed` is the island's own
 * (the tree's hash, mixed): the same tree and hint always give the same identity.
 */
export function identityOf(shape: RepoShape, seed: number, hint?: IslandHint): Identity {
  const { files, depth } = sizeOf(shape)
  const land = landOf(files)
  const role = roleOf(hint, [shape.root, ...shape.folders])
  return {
    role,
    archetype: archetypeOf(traitsOf(land, depth, hint), seed),
    palette: paletteOf(seed, hint?.palette),
    wish: wishOf(role, land, hint?.name ?? "", seed),
  }
}
