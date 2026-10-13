import type { Stage } from "@guildhall/render"
import { pieces } from "./browser/index.tsx"
import { composer } from "./composer/index.tsx"
import { grip } from "./grips/editor/index.ts"
import { grips } from "./grips/matrix/index.ts"
import { hexmap } from "./hexmap/index.ts"
import { hexScale } from "./hexscale/index.ts"
import { hexTiles } from "./hextiles/index.ts"
import { home } from "./home/index.tsx"
import { hudLab } from "./hudlab/index.tsx"
import { npc } from "./npcs/index.tsx"
import { palette } from "./palette/index.ts"
import { placeOf } from "./shell/directory.ts"
import { siteLab } from "./sitelab/index.tsx"
import { town } from "./town/index.ts"

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

/** Every screen the studio can open (paths in `shell/router.ts`). New screens register here, one line each. */
export const SCREENS: readonly Screen[] = [
  home,
  pieces,
  palette,
  composer,
  hexTiles,
  npc,
  grip,
  grips,
  town,
  hexmap,
  hexScale,
  hudLab,
  siteLab,
]

export const DEFAULT_SCREEN = "home"

/** The screen with `id`; undefined for an unknown id, or one this build leaves out of the directory (showcase). */
export function screenFor(id: string): Screen | undefined {
  return placeOf(id) ? SCREENS.find((screen) => screen.id === id) : undefined
}
