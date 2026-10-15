/**
 * Mounts the HUD (HallHud.tsx) on an island's Viewer once the island is built: a repo's hall
 * (`mountHallHud`, `/hall/<owner>/<repo>`) or the site's home (`mountHomeHud`, `/`). Both are one mount
 * (`mountOn`): the Viewer's HUD regions turned on under the key `hall`, the HUD's own floating slots
 * (top centre, the captions, the act chip), the dialogs' layer over the page, the session's frame loop
 * (and the director's skip over a replay's quiet stretches), the island's event FX and the camera.
 *
 * A hall reads the repo's chronicle (already fetched for the build, site/chronicle.ts), tells its story
 * by era (sim `repoLegendOf`, places named as the island built them) and its card (`repoRecapOf`), and
 * starts the session its link asks for (`?feed=`). The home plays a session of its own on an island
 * that is no repo's: the demo guild at work, or a story the demos picked (`/?story=saga&act=3`), its
 * places the island's own zones (site/homePlaces.ts), switched in place (site/homeHud.tsx `homeStage`).
 */
import { pinOf, SEASON_AT, type WeatherKind } from "@guildhall/render"
import { repoLegendMarkdown, repoLegendOf, repoRecapOf, requestChronicleUrl } from "@guildhall/sim"
import { holdHudStyle } from "@guildhall/ui"
import { createRoot, type Root } from "react-dom/client"
import type { HudParts } from "../../hexworld/index.ts"
import { storySeason } from "../../hexworld/season.ts"
import { hallChronicle } from "../../site/chronicle.ts"
import { HomeFeed, type HomeStory, homeStoryOf } from "../../site/homeFeed.ts"
import { setHome } from "../../site/homeHud.tsx"
import { homePlaces } from "../../site/homePlaces.ts"
import { type HallCamera, mountHallCamera } from "../camera.ts"
import type { HallTime } from "../clock.ts"
import { createEraShots, hallCapture } from "../eraShots.ts"
import { mountEvents } from "../events.ts"
import { createSession, feedKindOf, type HallSession, openFeed } from "../feeds/index.ts"
import { type SessionPlaces, sessionPlaces } from "../feeds/places.ts"
import { storyTitle } from "../feeds/story.ts"
import { driveFx } from "../fx.ts"
import { type HallFloat, HallHud, type HallHudProps, type HallLevers, REMEMBERED } from "./HallHud.tsx"
import { watchClear } from "./clear.ts"
import { createHeroPortraits } from "./portraits.ts"
import type { HudSession } from "./SessionHud.tsx"
import { holdHallHudStyle } from "./style.ts"
import { placeLabelOf } from "./view.ts"

// ── the director's skip ────────────────────────────────────────────

/** A quiet stretch: nothing told for this long behind (session ms)… */
export const QUIET_BEHIND_MS = 1500
/** …and nothing for this long ahead: the replay may run fast through it. */
export const QUIET_AHEAD_MS = 5000
/** The fastest the director skips. */
export const SKIP_MAX = 8

/**
 * How fast the director would run a replay at `at` over `events` (sorted by time): 1 inside the action;
 * through a quiet stretch (none for `QUIET_BEHIND_MS` behind and `QUIET_AHEAD_MS` ahead) faster the
 * longer the wait, up to `SKIP_MAX`, and back to 1 as the next event nears. Pure.
 */
export function quietSkip(events: readonly { at: number }[], at: number): number {
  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((events[mid] as { at: number }).at <= at) lo = mid + 1
    else hi = mid
  }
  const next = events[lo]?.at
  const prev = events[lo - 1]?.at
  if (next === undefined) return 1
  const ahead = next - at
  const behind = prev === undefined ? Number.POSITIVE_INFINITY : at - prev
  if (behind < QUIET_BEHIND_MS || ahead < QUIET_AHEAD_MS) return 1
  return Math.min(SKIP_MAX, Math.max(1, ahead / 2500))
}

/** A weather a link names (clear, cloudy, rain, storm, snow), else null: the session's. */
export function weatherOf(asked: string | null): WeatherKind | null {
  return pinOf(asked)
}

/** The levers the HUD's Settings pull and the mount reads: the director's style, a pinned weather, the skip. */
function createLevers(): HallLevers & { setSkip(k: number): void } {
  let skip = 1
  let shown = 1
  let told = 0
  const fns = new Set<() => void>()
  return {
    cinematic: true,
    weather: null as WeatherKind | null,
    skip: () => shown,
    subscribe(fn) {
      fns.add(fn)
      return () => fns.delete(fn)
    },
    setSkip(k) {
      skip = k
      // the chip hears at most four times a second, and only a tenth's change
      const now = performance.now()
      const next = skip < 1.05 ? 1 : Math.round(skip * 10) / 10
      if (next === shown || (now - told < 250 && next !== 1)) return
      shown = next
      told = now
      for (const fn of fns) fn()
    },
  }
}

// ── the one mount ──────────────────────────────────────────────────

interface Mounted {
  root: Root
  modals: HTMLElement
  float: HallFloat
  camera: HallCamera
  levers: HallLevers
  parts: HallHudProps["parts"]
  dispose(): void
}

/**
 * The HUD's frame on the island: its styles, its root, the floating slots and the dialogs' layer, the
 * session's frame loop (`after` runs after each frame: the home's demo goes round again), the FX and
 * the camera. `dispose` takes it all down.
 */
function mountOn(
  parts: HudParts,
  live: { session: HallSession; places: Pick<SessionPlaces, "placeAt"> } | null,
  opts: {
    query: URLSearchParams
    time?: HallTime | null
    director?: boolean
    after?: (session: HallSession) => void
  },
): Mounted {
  const releaseHud = holdHudStyle()
  const releaseHall = holdHallHudStyle()
  const { viewer, ...rest } = parts
  viewer.hud.use("hall", REMEMBERED)
  // for shots: the HUD's state and its dispatch (`guildhall.ext.hud.dispatch({type: "open", id: "places"})`)
  const ext = window.guildhall?.ext as Record<string, unknown> | undefined
  if (ext) ext.hud = viewer.hud
  const host = document.createElement("div")
  host.className = "gh hall-hud-root"
  viewer.root.append(host)
  // the HUD's own slots beside the Viewer's regions, in its layer: what stays in the Hidden HUD (the
  // fast-forward chip, the captions) and what has no region (the pleas top centre, the act chip)
  const layer = viewer.hud.rail.parentElement ?? viewer.root
  const slot = (name: string) => {
    const el = document.createElement("div")
    el.className = `hall-float hall-${name}`
    el.dataset.keepout = ""
    layer.append(el)
    return el
  }
  const float: HallFloat = { top: slot("top"), caps: slot("caps"), acts: slot("acts") }
  // the captions and the bar stay centred on the screen, stepping aside only where a panel would cover them
  const stopClear = watchClear(viewer.root)
  // the book and the cards are dialogs over the whole page (the site's crest included)
  const modals = document.createElement("div")
  modals.className = "gh hall-hud-modals"
  document.body.append(modals)
  const root = createRoot(host)
  const levers = createLevers()
  // `?weather=clear|cloudy|rain|storm|snow`: a sky pinned from the link (a demo's night storm), as Settings pins it
  levers.weather = weatherOf(opts.query.get("weather"))
  if (levers.weather) parts.fx?.drive.set(levers.weather)
  if (ext) ext.levers = levers

  // the camera: follow a hero (a badge, a roster row, a chip), the director on a session (B)
  const camera = mountHallCamera(parts, {
    session: live?.session ?? null,
    places: live?.places ?? null,
    query: opts.query,
    ...(opts.director !== undefined ? { director: opts.director } : {}),
  })

  // the session: its clock run by the frames (a replay's quiet stretches skipped by a cinematic director)
  let raf = 0
  let offFx = () => {}
  let offEvents = () => {}
  if (live) {
    const { session } = live
    opts.time?.setSession(session)
    if (ext) ext.session = session
    let last = performance.now()
    let skip = 1
    const frame = (now: number) => {
      const dt = Math.max(0, (now - last) / 1000)
      last = now
      const c = session.clock.get()
      const directing = levers.cinematic && camera.state().director
      const want =
        directing && c.playing && c.mode === "replay" && session.snapshot().kind === "replay"
          ? quietSkip(session.log().events, c.at)
          : 1
      skip += (want - skip) * Math.min(1, dt * 3)
      if (want === 1 && skip < 1.05) skip = 1
      levers.setSkip(skip)
      session.frame(dt * skip)
      opts.after?.(session)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    // the island's event FX (weather, ships, scaffolds) read the session, twice a second
    if (parts.fx) offFx = driveFx(parts.fx, session, () => levers.weather)
    offEvents = mountEvents(session)
  }

  return {
    root,
    modals,
    float,
    camera,
    levers,
    parts: { ...rest, camera },
    dispose() {
      stopClear()
      offFx()
      offEvents()
      camera.dispose()
      if (live) {
        cancelAnimationFrame(raf)
        live.session.stop()
        opts.time?.setSession(null)
      }
      if (ext?.levers === levers) delete ext.levers
      setTimeout(() => {
        root.unmount()
        host.remove()
        modals.remove()
        for (const el of Object.values(float)) el.remove()
        releaseHall()
        releaseHud()
      }, 0)
    },
  }
}

// ── a repo's hall ──────────────────────────────────────────────────

export interface HallHudOptions {
  slug: string
  go(url: string): void
  hrefs: { another: string; demos: string }
  /** Opens the hall again for a fresh read of its chronicle. */
  retry(): void
  /** The hall's link: `?feed=live|replay|story` starts its session (hall/feeds), and its knobs. */
  query?: URLSearchParams
  /** The hall's time, which the session's clock joins (the bar's Session scale). */
  time?: HallTime | null
}

let current: HallSession | null = null

/**
 * The hall's session while a hall with a `?feed=` is up (null otherwise): for life (L1/L2), which poses
 * the heroes from `session.log()` at `session.clock.get().at`, and listens to `onReset` for a new log.
 */
export const hallSession = (): HallSession | null => current

/** Starts the session a link asks for, its places bound to the island's; null without a `?feed=`. */
function startSession(parts: HudParts, opts: HallHudOptions): HudSession | null {
  const query = opts.query
  const kind = query ? feedKindOf(query) : null
  if (!query || !kind) return null
  const st = Number(query.get("st"))
  // a story is told on this repo: its paths rehomed onto the repo's units, so heroes reach its places
  const repo = parts.repo?.kind === "chronicled" ? parts.repo : null
  const units = repo?.places.flatMap((p) =>
    p.pooled?.length ? p.pooled.map((name) => ({ name })) : [{ name: p.id, files: p.files }],
  )
  const stage = { name: repo?.name ?? opts.slug, ...(units?.length ? { units } : {}) }
  const session = createSession(openFeed(kind, opts.slug, query, stage), {
    autoplay: query.get("play") !== "0",
    ...(query.has("st") && Number.isFinite(st) ? { openAt: Math.max(0, st) } : {}),
  })
  const places = sessionPlaces(parts.repo, parts.places)
  session.start(places.placeOf)
  return {
    session,
    places,
    repo: opts.slug.split("/").pop() || opts.slug,
    portraits: createHeroPortraits(parts),
  }
}

export function mountHallHud(parts: HudParts, opts: HallHudOptions): () => void {
  const live = startSession(parts, opts)
  if (live) current = live.session
  const m = mountOn(parts, live, { query: opts.query ?? new URLSearchParams(), time: opts.time ?? null })
  // the Legends' era pictures: filmed only once the book opens (eraShots.ts)
  const eraShots = createEraShots(hallCapture(parts))
  const ext = window.guildhall?.ext as Record<string, unknown> | undefined
  if (ext) ext.eraShots = () => eraShots.stats()
  let gone = false
  void hallChronicle(opts.slug).then((found) => {
    if (gone) return
    const chronicle = found.status === "ok" ? found.chronicle : null
    // the book names a unit's place as the island built it: "the village of react-dom"
    const label = placeLabelOf(parts.places)
    const legend = chronicle ? repoLegendOf(chronicle, { placeOf: label }) : null
    const [owner = "", repo = ""] = opts.slug.split("/")
    m.root.render(
      <HallHud
        hud={parts.viewer.hud}
        modals={m.modals}
        float={m.float}
        levers={m.levers}
        parts={m.parts}
        slug={opts.slug}
        chronicle={chronicle}
        legend={legend}
        {...(legend ? { legendMarkdown: repoLegendMarkdown(legend) } : {})}
        recap={chronicle ? repoRecapOf(chronicle, { placeOf: label }) : null}
        go={opts.go}
        hrefs={opts.hrefs}
        {...(found.status === "not-chronicled" ? { request: requestChronicleUrl(owner, repo) } : {})}
        {...(found.status === "unavailable" ? { onRetry: opts.retry } : {})}
        {...(live ? { session: live } : {})}
        time={opts.time ?? null}
        eraShots={eraShots}
      />,
    )
  })
  return () => {
    gone = true
    eraShots.dispose()
    if (ext?.eraShots) delete ext.eraShots
    if (live && current === live.session) current = null
    m.dispose()
    live?.portraits?.dispose()
  }
}

// ── the home ───────────────────────────────────────────────────────

export interface HomeHudOptions {
  go(url: string): void
  hrefs: { another: string; demos: string; island: string }
  /** The link's knobs: `?story=`, `?act=`, `?st=` (open at, seconds), `?play=0`. */
  query: URLSearchParams
  time: HallTime
}

/** The act a link opens a story at, or undefined. */
const actOf = (query: URLSearchParams): number | undefined => {
  const n = Number(query.get("act"))
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined
}

/** Mounts the home's HUD on the island's Viewer once the island is built. Returns the unmount. */
export function mountHomeHud(parts: HudParts, opts: HomeHudOptions): () => void {
  const places = homePlaces(parts.zoneKinds)
  let story: HomeStory = homeStoryOf(opts.query.get("story"))
  let act = actOf(opts.query)
  const feed = new HomeFeed(story)
  const st = Number(opts.query.get("st"))
  const session = createSession(feed, {
    autoplay: opts.query.get("play") !== "0",
    ...(opts.query.has("st") && Number.isFinite(st) ? { openAt: Math.max(0, st) } : {}),
  })
  session.start(places.placeOf)
  const portraits = createHeroPortraits(parts)
  // the demo guild goes round again; a told story stops at its end for the visitor to leave or replay
  const after = (s: HallSession) => {
    const c = s.clock.get()
    if (story === "demo" && !c.playing && c.end > c.start && c.at >= c.end) s.clock.play(true)
  }
  // the camera: the director films the demo guild or the story (V1's home: B, ?director=0)
  const m = mountOn(parts, { session, places }, { query: opts.query, time: opts.time, director: true, after })
  // a told story is set in its own season (saga in autumn, the world events in winter…); the demo guild in today's
  parts.season?.setSource(() => {
    const name = storySeason(story)
    return name ? SEASON_AT[name] : null
  }, true)

  /** Opens the story's act: the clock at its start, playing. */
  const openAct = (n: number) => {
    const chapter = feed.chapters[n - 1]
    const c = session.clock.get()
    if (!chapter) return
    session.clock.seek(c.start + chapter.at, { jump: true })
    session.clock.play(true)
  }
  if (act && !opts.query.has("st")) openAct(act)

  const paint = () =>
    m.root.render(
      <HallHud
        hud={parts.viewer.hud}
        modals={m.modals}
        float={m.float}
        levers={m.levers}
        parts={m.parts}
        slug="guildhall"
        chronicle={null}
        legend={null}
        recap={null}
        go={opts.go}
        hrefs={opts.hrefs}
        session={{ session, places, repo: "guildhall", portraits }}
        time={opts.time}
        home={{
          title: story === "demo" ? "The demo guild" : storyTitle(story),
          ...(story === "demo" ? {} : { leave: { label: "Leave the story", href: opts.hrefs.island } }),
        }}
      />,
    )
  setHome({
    session,
    stage: {
      play(next, n) {
        if (next === story && n === act) return
        if (next !== story) {
          story = next
          places.reset()
          feed.switchTo(next)
          // a new story opens on its own framing; nobody stays followed from the last
          m.camera.reset()
        }
        act = n
        paint()
        if (n) openAct(n)
        else if (next === story) {
          const c = session.clock.get()
          session.clock.seek(c.start, { jump: true })
          session.clock.play(true)
        }
      },
    },
  })
  paint()
  return () => {
    parts.season?.setSource(null)
    setHome(null)
    m.dispose()
    portraits.dispose()
  }
}
