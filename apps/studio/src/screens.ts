import type { Stage } from "@guildhall/render"
import { placeOf } from "./shell/directory.ts"
import { SITE_SCREENS } from "./site/routes.ts"

/** What the shell hands a screen when it mounts it. */
export interface ScreenCtx {
  /** The deep link the screen was opened with: the query, plus the path's id under its key (`router.ts`). */
  query: URLSearchParams
  /** Hands the shell the screen's stage, so the HUD and `window.guildhall` read and drive it. */
  attach(stage: Stage): void
  /** Marks async work (a catalog fetch, a piece load) that `guildhall.ready()` waits for. */
  load<T>(work: Promise<T>): Promise<T>
}

export interface Screen {
  id: string
  title: string
  /** Builds the screen into `host`; returns the teardown. */
  mount(host: HTMLElement, ctx: ScreenCtx): () => void
}

/**
 * A screen loaded when it is first opened: each section is its own chunk, so the island does not wait for
 * the Studio's tools and the Studio does not carry the site. The import is a `ctx.load`, so
 * `guildhall.ready()` waits for it.
 */
function lazy(id: string, title: string, load: () => Promise<Screen>): Screen {
  return {
    id,
    title,
    mount(host, ctx) {
      let off: (() => void) | undefined
      let gone = false
      void ctx
        .load(load())
        .then((screen) => {
          if (!gone) off = screen.mount(host, ctx)
        })
        .catch(() => undefined)
      return () => {
        gone = true
        off?.()
      }
    },
  }
}

/**
 * Every screen the app can open (paths in `shell/router.ts`). New screens register here, one line each:
 * `lazy("<id>", "<title>", () => import("<file>").then((m) => m.<screen>))`. The site's five (the island,
 * the demos over it, the harbour, How it's built, a repo's hall) share one chunk, `site/index.tsx`.
 */
export const SCREENS: readonly Screen[] = [
  lazy("island", "Island", () => import("./site/index.tsx").then((m) => m.island)),
  lazy("demos", "Demos", () => import("./site/index.tsx").then((m) => m.demos)),
  lazy("harbour", "Harbour", () => import("./site/index.tsx").then((m) => m.harbour)),
  lazy("built", "How it's built", () => import("./site/index.tsx").then((m) => m.built)),
  lazy("hall", "Your repo", () => import("./site/index.tsx").then((m) => m.hall)),
  lazy("home", "Home", () => import("./home/index.tsx").then((m) => m.home)),
  lazy("pieces", "Pieces", () => import("./browser/index.tsx").then((m) => m.pieces)),
  lazy("palette", "Palette", () => import("./palette/index.ts").then((m) => m.palette)),
  lazy("composer", "Tile composer", () => import("./composer/index.tsx").then((m) => m.composer)),
  lazy("hextiles", "Tile prefabs", () => import("./hextiles/index.ts").then((m) => m.hexTiles)),
  lazy("npc", "NPC builder", () => import("./npcs/index.tsx").then((m) => m.npc)),
  lazy("grip", "Grip editor", () => import("./grips/editor/index.ts").then((m) => m.grip)),
  lazy("grips", "Grip matrix", () => import("./grips/matrix/index.ts").then((m) => m.grips)),
  lazy("town", "Town", () => import("./town/index.ts").then((m) => m.town)),
  lazy("hexmap", "Hex map", () => import("./hexmap/index.ts").then((m) => m.hexmap)),
  lazy("hudlab", "HUD lab", () => import("./hudlab/index.tsx").then((m) => m.hudLab)),
]

export const DEFAULT_SCREEN = "island"

/** The screen with `id`; undefined for an unknown id, or a studio tool this build leaves out (showcase). */
export function screenFor(id: string): Screen | undefined {
  return SITE_SCREENS.includes(id) || placeOf(id) ? SCREENS.find((screen) => screen.id === id) : undefined
}
