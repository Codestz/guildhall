/**
 * The home's HUD (`/`): V1's home is the live hall, so the island carries the hall's HUD with a session of
 * its own: the demo guild at work, or a story the demos picked (`/?story=saga&act=3`). It is the hall's
 * session and HUD (hall/feeds, hall/hud/HallHud.tsx) on an island that is no repo's: its places are the
 * island's own zones (homePlaces.ts), it has no chronicle to tell, and a story switches in place.
 *
 * `mountHomeHud` is `hall/hud/mount.tsx` for the home; the site's pieces reach the playing story through
 * `homeStage` (module state, like hudSlot.ts) because the picker lives in React and the island does not.
 */
import { holdHudStyle } from "@guildhall/ui"
import { createRoot } from "react-dom/client"
import type { HallTime } from "../hall/clock.ts"
import { createSession, type HallSession } from "../hall/feeds/index.ts"
import { storyTitle } from "../hall/feeds/story.ts"
import { driveFx } from "../hall/fx.ts"
import { HallHud, REMEMBERED } from "../hall/hud/HallHud.tsx"
import { holdHallHudStyle } from "../hall/hud/style.ts"
import type { HudParts } from "../hexworld/index.ts"
import { HomeFeed, type HomeStory, homeStoryOf } from "./homeFeed.ts"
import { type HomePlaces, homePlaces } from "./homePlaces.ts"

export interface HomeHudOptions {
  go(url: string): void
  hrefs: { another: string; demos: string; island: string }
  /** The link's knobs: `?story=`, `?act=`, `?st=` (open at, seconds), `?play=0`. */
  query: URLSearchParams
  time: HallTime
}

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

/** The act a link opens a story at, or undefined. */
const actOf = (query: URLSearchParams): number | undefined => {
  const n = Number(query.get("act"))
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined
}

/** Mounts the home's HUD on the island's Viewer once the island is built. Returns the unmount. */
export function mountHomeHud(parts: HudParts, opts: HomeHudOptions): () => void {
  const releaseHud = holdHudStyle()
  const releaseHall = holdHallHudStyle()
  const { viewer, ...rest } = parts
  viewer.hud.use("hall", REMEMBERED)
  const ext = window.guildhall?.ext as Record<string, unknown> | undefined
  if (ext) ext.hud = viewer.hud
  const host = document.createElement("div")
  host.className = "gh hall-hud-root"
  viewer.root.append(host)
  const modals = document.createElement("div")
  modals.className = "gh hall-hud-modals"
  document.body.append(modals)
  const root = createRoot(host)

  const places: HomePlaces = homePlaces(parts.zoneKinds)
  let story = homeStoryOf(opts.query.get("story"))
  let act = actOf(opts.query)
  const feed = new HomeFeed(story)
  const st = Number(opts.query.get("st"))
  const live = createSession(feed, {
    autoplay: opts.query.get("play") !== "0",
    ...(opts.query.has("st") && Number.isFinite(st) ? { openAt: Math.max(0, st) } : {}),
  })
  session = live
  opts.time.setSession(live)
  if (ext) ext.session = live
  live.start(places.placeOf)

  /** Opens the story's act: the clock at its start, playing. */
  const openAct = (n: number) => {
    const chapter = feed.chapters[n - 1]
    const c = live.clock.get()
    if (!chapter) return
    live.clock.seek(c.start + chapter.at, { jump: true })
    live.clock.play(true)
  }
  if (act && !opts.query.has("st")) openAct(act)
  stage = {
    play(next, n) {
      if (next === story && n === act) return
      if (next !== story) {
        story = next
        places.reset()
        feed.switchTo(next)
      }
      act = n
      paint()
      if (n) openAct(n)
      else if (next === story) {
        const c = live.clock.get()
        live.clock.seek(c.start, { jump: true })
        live.clock.play(true)
      }
    },
  }

  let raf = 0
  let last = performance.now()
  const frame = (now: number) => {
    live.frame(Math.max(0, (now - last) / 1000))
    last = now
    // the demo guild goes round again; a told story stops at its end for the visitor to leave or replay
    const c = live.clock.get()
    if (story === "demo" && !c.playing && c.end > c.start && c.at >= c.end) live.clock.play(true)
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  const offFx = parts.fx ? driveFx(parts.fx, live) : () => {}

  const paint = () =>
    root.render(
      <HallHud
        hud={viewer.hud}
        modals={modals}
        parts={rest}
        slug="guildhall"
        chronicle={null}
        legend={null}
        recap={null}
        go={opts.go}
        hrefs={opts.hrefs}
        session={{ session: live, places, repo: "guildhall" }}
        time={opts.time}
        home={{
          title: story === "demo" ? "The demo guild" : storyTitle(story),
          ...(story === "demo" ? {} : { leave: { label: "Leave the story", href: opts.hrefs.island } }),
        }}
      />,
    )
  paint()
  return () => {
    cancelAnimationFrame(raf)
    offFx()
    live.stop()
    opts.time.setSession(null)
    if (session === live) session = null
    stage = null
    setTimeout(() => {
      root.unmount()
      host.remove()
      modals.remove()
      releaseHall()
      releaseHud()
    }, 0)
  }
}
