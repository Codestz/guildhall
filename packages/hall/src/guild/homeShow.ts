import { archipelagoSource, loadSplitRepo, type PatchesOf } from "../world/archipelagoSource.ts"
import { growth } from "../world/chronicle/growthControl.ts"
import { HOME } from "../world/islandRing.ts"
import { worldSource } from "../world/source.ts"
import { boot } from "./boot.ts"
import { HOME_REPO, type HomeLink, home } from "./home.ts"
import { type Cut, cutOf } from "./homePace.ts"
import { islandView } from "./islandView.ts"
import { opening } from "./opening.ts"
import type { GuildStore } from "./store.ts"

/**
 * The showcase's home, played (guild/home.ts says what it is). React opens as one island under its
 * growth film, cut to ~20 s (guild/homePace.ts). While the film plays the repo is also grown as an
 * archipelago of its packages, in the workers, held back (world/archipelagoSource.ts `loadSplit`'s
 * gate). When the film ends, or is skipped, the loader falls over it, the archipelago takes the sea
 * under the loader, and the loader lifts onto it: the same veil the repo door's visit to the guild's
 * island makes (hud/RepoDoor.tsx). The camera's settling is the showcase's own opening sweep; then
 * the invitation card comes up.
 *
 * Reduced motion plays no film: the home opens straight on the packages (main.tsx), then the card.
 */

/** The cut being played, for the captions (hud/HomeFilm.tsx). */
export const homeCut: { current: Cut | undefined } = { current: undefined }

/** How long the loader is given to fall over the film (its own 260 ms, after a frame, and some slack), ms. */
const VEIL_MS = 420
/** The camera's settling, after its sweep has landed, before the card comes up, ms. */
const SETTLE_MS = 1200
/** How long the settling shot holds with the card up before the Bard may direct again, ms. */
const BARD_BACK_MS = 12_000

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Resolves once the showcase's opening has landed the camera. */
function landed(): Promise<void> {
  return new Promise((resolve) => {
    const check = (): void => {
      if (opening.get().stage !== "landed") return
      off()
      resolve()
    }
    const off = opening.subscribe(check)
    check()
  })
}

/** Ends the film early (a click, Esc, the Skip button); the home goes on to the packages. */
export function skipFilm(): void {
  if (home.phase === "film") landNow?.()
}

/** Ends the film and goes on to the packages (set by `startHome`). */
let landNow: (() => void) | undefined

/** Gives the camera back to the Bard, once the settling shot has been seen. */
let giveBack: (() => void) | undefined

/** Dismisses the invitation card. */
export function dismissInvite(): void {
  if (home.phase === "invite") home.set("off")
  giveBack?.()
}

/**
 * Starts the home once the page has begun. Call after the repo's own island is asked for (main.tsx).
 * With a film, the page plays it; without (reduced motion), it settles on the island.
 */
export function startHome(
  store: GuildStore,
  { split, film }: HomeLink,
  /** The scene's footprints (scene/archipelago/footprint.ts: a lazy chunk, so the caller fetches it). */
  patchesOf: () => Promise<PatchesOf>,
): void {
  const settle = async (): Promise<void> => {
    await boot.ready()
    await landed()
    // The camera settles on the home island; the Bard's own shots (the saga opens inside the keep)
    // come back with the card's going, or a while after it comes up.
    if (archipelagoSource.archipelago) {
      store.setBard(false)
      islandView.go(HOME)
      giveBack = () => {
        giveBack = undefined
        if (!store.selected && !store.bard) store.setBard(true)
      }
    }
    await wait(SETTLE_MS)
    if (home.phase === "off") return giveBack?.()
    home.set("invite")
    setTimeout(() => giveBack?.(), BARD_BACK_MS)
  }

  if (!film) {
    // Until the card comes up the home is "swap": the welcome caption keeps off the stage.
    home.set("swap")
    void settle()
    return
  }

  home.set("film")
  growth.request(HOME_REPO)

  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let splitting: Promise<unknown> | undefined
  // The packages grow behind the film, after the page is up: the reveal does not wait for them.
  if (split)
    void boot.ready().then(() => {
      splitting = loadSplitRepo(HOME_REPO, patchesOf(), gate)
    })

  let landing = false
  async function land(): Promise<void> {
    if (landing) return
    landing = true
    home.set("swap")
    await boot.ready()
    growth.pause()
    if (!split) {
      growth.stop()
      return void settle()
    }
    // The loader falls over the film first, so what the end brings (today's layers mounting, the world
    // swapping) happens under it, never in the viewer's sight.
    boot.begin("React, as packages")
    await wait(VEIL_MS)
    growth.stop()
    store.select(null)
    store.frame(null)
    release()
    await splitting
    await worldSource.ready
    // One frame for React to take the new world up (and suspend on it), so the measuring starts on it.
    await new Promise(requestAnimationFrame)
    boot.arm()
    await boot.ready()
    await settle()
  }
  landNow = () => void land()
  growth.onEnd = landNow

  // The loader waits for the film to be made (its plan is a few seconds' work), so the reveal is of
  // an island about to rise, not of a frozen page; and the film waits for the reveal to land.
  boot.hold(
    new Promise<void>((resolve) => {
      const off = growth.subscribe(() => {
        if (growth.phase === "waiting") return
        off()
        resolve()
      })
    }),
  )
  const playWhenShown = (): void => {
    const shown = opening.get().stage
    if (shown !== "arrive" && shown !== "landed") return
    off()
    if (growth.phase === "paused" && home.phase === "film") growth.play()
  }
  const off = opening.subscribe(playWhenShown)

  let cut: Cut | undefined
  growth.subscribe(() => {
    if (home.phase !== "film") return
    if (growth.film && !cut) {
      cut = cutOf(growth.film)
      homeCut.current = cut
      growth.pace = cut.pace
      growth.pause()
      playWhenShown()
    }
    // No history to tell: on to the packages.
    if (growth.phase === "failed") landNow?.()
  })
}
