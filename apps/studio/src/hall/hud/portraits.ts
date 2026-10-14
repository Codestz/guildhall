/**
 * The hall's hero portraits: each session hero drawn as the island draws it (its figure's look: body,
 * outfit, headgear, props; life's `heroLook`), in its banner's tint, by render's `createPortraits` on the
 * stage's own renderer (no second WebGL context), queued off the frame's path and cached. Until a
 * hero's sprite lands (or while it has no figure) `of` is null and its face stands in.
 */
import { createPortraits, type Portraits } from "@guildhall/render"
import type { HeroView } from "@guildhall/ui"
import { useSyncExternalStore } from "react"
import { libraryUrl } from "../../catalog.ts"
import type { HudParts } from "../../hexworld/index.ts"

export interface HeroPortraits {
  /** The hero's sprite URL once drawn; null until then (queued on the first ask). */
  of(hero: Pick<HeroView, "id" | "banner">): string | null
  subscribe(listener: () => void): () => void
  version(): number
  /** The drawing's numbers (shots, the perf probe), or null before the first portrait was asked for. */
  stats(): Portraits["stats"] | null
  dispose(): void
}

export function createHeroPortraits(parts: Pick<HudParts, "stage" | "heroLook">): HeroPortraits {
  let portraits: Portraits | null = null
  const listeners = new Set<() => void>()
  let version = 0
  const landed = () => {
    version++
    for (const fn of listeners) fn()
  }
  const ext = window.guildhall?.ext
  // for shots and the perf probe: how many are drawn and what each slice took
  if (ext) ext.portraits = () => portraits?.stats ?? null
  return {
    of(hero) {
      const drawn = parts.heroLook?.(hero.id)
      if (!drawn) return null
      if (!portraits) {
        portraits = createPortraits({
          catalog: drawn.catalog,
          url: libraryUrl,
          renderer: parts.stage.renderer,
        })
        portraits.subscribe(landed)
      }
      return portraits.get({ look: drawn.look, tint: hero.banner })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    version: () => version,
    stats: () => portraits?.stats ?? null,
    dispose() {
      if (ext?.portraits) delete ext.portraits
      portraits?.dispose()
      portraits = null
      listeners.clear()
    },
  }
}

const never = () => () => {}
const zero = () => 0

/**
 * A hero's portrait for the HUD's avatars (`portraitOf`), re-rendering as each lands; with no portraits
 * (a lab, no life) always null, so the faces stay.
 */
export function usePortraitOf(
  portraits: HeroPortraits | null | undefined,
): (hero: Pick<HeroView, "id" | "banner">) => string | null {
  useSyncExternalStore(portraits?.subscribe ?? never, portraits?.version ?? zero)
  return (hero) => portraits?.of(hero) ?? null
}
