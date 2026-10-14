/**
 * The home's playing story (`/`), as the site's pieces reach it: V1's home is the live hall, so the
 * island carries the hall's HUD with a session of its own, mounted by `mountHomeHud` (hall/hud/mount.tsx,
 * one mount with a repo's hall). This module is only the handle the mount leaves here while it is up,
 * kept light so the site's first paint does not pull the HUD in: the demos picker (React) plays a story
 * through `homeStage`, the island's life plans its heroes from `homeSession`.
 */
import type { HallSession } from "../hall/feeds/index.ts"
import type { HomeStory } from "./homeFeed.ts"

/** What the site's pieces ask of the playing home. */
export interface HomeStage {
  /** Plays a story (null: the demo guild) from its start, or from its `act` (1 – 5). A story already playing there is left alone. */
  play(story: HomeStory, act?: number): void
}

let stage: HomeStage | null = null
let session: HallSession | null = null

/** The home's playing session while its HUD is up (what its heroes are planned from), else null. */
export const homeSession = (): HallSession | null => session
/** The home's stage while its HUD is up. */
export const homeStage = (): HomeStage | null => stage

/** The home's HUD went up (its session and stage) or down (null). */
export function setHome(next: { session: HallSession; stage: HomeStage } | null): void {
  session = next?.session ?? null
  stage = next?.stage ?? null
}
