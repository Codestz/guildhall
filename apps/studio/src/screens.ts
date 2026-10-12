import type { Stage } from "@guildhall/render"
import { pieces } from "./browser/index.tsx"
import { composer } from "./composer/index.tsx"
import { lineup } from "./lineup/index.ts"
import { m0 } from "./m0/index.ts"
import { palette } from "./palette/index.ts"
import { scale } from "./scenes/scale.ts"
import { shadows } from "./shadows/index.ts"
import { siteScreen } from "./site/index.ts"

/** What the shell hands a screen when it mounts it. */
export interface ScreenCtx {
  /** The deep-link query the screen was opened with (`?screen=…` and anything the screen reads). */
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

/** Every screen the studio can open with `?screen=<id>`. New screens register here, one line each. */
export const SCREENS: readonly Screen[] = [m0, lineup, pieces, scale, palette, shadows, composer, siteScreen]

export const DEFAULT_SCREEN = "pieces"

/** The screen a query names, the default when it names none. Undefined for an unknown id. */
export function screenFor(query: URLSearchParams): Screen | undefined {
  const id = query.get("screen") ?? DEFAULT_SCREEN
  return SCREENS.find((screen) => screen.id === id)
}
