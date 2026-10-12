/**
 * Hero-relative scale targets (ADR 004, Look bar #1). Sizes are metres; a piece is checked by its
 * height (size[1]). The 1 m grid is the placement unit, not the scale target.
 */
import type { CatalogEntry, Category, ScaleFlag, ScaleTarget } from "./catalog.ts"

/** The KayKit hero's height: everything else is sized against it. */
export const HERO_HEIGHT = 2.2
/** A doorway's top, so a hero walks through. */
export const DOOR_TOP: ScaleTarget = [2.4, 2.8]
/** One storey, floor to floor. */
export const STOREY: ScaleTarget = [2.8, 3.2]

/** Height band per category; a category not listed has no target (confidence "pack", no flags). */
export const SCALE_TARGETS: Readonly<Partial<Record<Category, ScaleTarget>>> = {
  building: [5.5, null],
  tree: [4, 9],
  bush: [0.4, 1.8],
  fence: [0.9, 1.4],
  wall: [2.5, 6],
  rock: [0.3, 4],
  furniture: [0.4, 2.2],
  vehicle: [1.2, 3],
}

/** The category's target and whether the height falls outside it (bounds inclusive). */
export function checkScale(
  category: Category,
  size: CatalogEntry["size"],
): { target?: ScaleTarget; flags: ScaleFlag[] } {
  const target = SCALE_TARGETS[category]
  if (!target) return { flags: [] }
  const [min, max] = target
  const height = size[1]
  const flags: ScaleFlag[] = []
  if (height < min) flags.push("undersize")
  if (max !== null && height > max) flags.push("oversize")
  return { target, flags }
}
