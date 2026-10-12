/** A character shown in the piece viewer: laid out, grounded and framed as any piece, then animated. */
import type { CatalogEntry, RigEntry } from "@guildhall/assets"
import { type Character, loadCharacter, type Stage, type Viewer } from "@guildhall/render"
import { libraryUrl } from "../catalog.ts"

/**
 * Shows `entry` with `viewer.show` (so the row slot, door band, shadows and stats are the viewer's),
 * then swaps the viewer's bind-pose copy for the animated body. render's viewer keeps what it shows
 * in the first child of its `viewer` group; null (and the static copy stays) when that is not so, or
 * when `current()` says a newer selection has replaced this one while it loaded.
 */
export async function showCharacter(
  viewer: Viewer,
  stage: Stage,
  entry: CatalogEntry,
  rig: RigEntry,
  current: () => boolean,
): Promise<Character | null> {
  const [ch] = await Promise.all([
    loadCharacter(entry, rig, (path) => libraryUrl(path)),
    viewer.show(entry, libraryUrl(entry.files.glb)),
  ])
  if (!current()) return null
  const pieces = stage.scene.getObjectByName("viewer")?.children[0]
  const body = pieces?.children.length === 1 ? pieces.children[0] : undefined
  if (!pieces || !body) return null
  ch.root.position.copy(body.position)
  pieces.remove(body)
  pieces.add(ch.root)
  return ch
}
