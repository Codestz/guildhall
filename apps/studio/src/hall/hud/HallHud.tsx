/**
 * The island's HUD (plan-hud-events H1; decisions.md "HUD stays light", "V1 UI parity", "UI picks"):
 * V1's layout on the Viewer's HUD regions, for a repo's hall (its chronicle, `?feed=` its session) and
 * for the home (its demo guild or a told story).
 *
 *   top left      the Brand (under the site's crest); with a session the party tabs and the Guild's
 *                 badge bar (faces; a crowd folds into one badge per role), ⤢ opening the Guild
 *   top right     the icon rail (Places, Legends, the card, sound, Settings); Hidden keeps only the
 *                 "Show HUD · H" pill there
 *   top centre    a plea's card, and the fast-forward chip while the director skips a quiet stretch
 *   right         the one sheet: a place's or a hero's dossier, Settings, or the Chronicle
 *   bottom left   the last moments as toasts over the Chronicle chip
 *   bottom        the captions over the timeline: one scale picked for you, a hairline until hovered
 *   bottom right  a told story's act chip and its acts
 *
 * Minimal by default; Detailed opens the Guild on the left and the Chronicle on the right and pins the
 * timeline (V1); Hidden leaves the world, the captions and the way back. A badge or a roster row follows
 * its hero with the camera (a row also opens the hero's dossier).
 *
 * The top row (user 10-13) is the site's crest pill, then the repo chip (its name and source dot; it
 * unfolds the details under the row), the Guild's face bar under them, each its own width.
 *
 * A phone (decisions.md "Phone GUI"): the row ends in ☰, which opens the one bottom sheet with tabs
 * (Guild · Places · Chronicle · Settings; the Legends and the card under the Chronicle); the foot holds
 * the captions, then the face bar (+N) and the act chip on one row, then the timeline's hairline.
 */
import type { CameraPose } from "@guildhall/core"
import { type QualityPick, qualityDpr, qualityOf, type WeatherKind } from "@guildhall/render"
import {
  type Chronicle,
  DAY_MS,
  type Legend,
  legendMarkdown,
  legendOf,
  type Recap,
  type RepoLegend,
  type RepoRecap,
  recapOf,
} from "@guildhall/sim"
import {
  BrandCard,
  Button,
  Captions,
  ChapterChip,
  ChronicleCard,
  ChronicleFeed,
  clock as clockWords,
  FastForwardChip,
  FoldPanel,
  Glyphs,
  type HeroView,
  type HudState,
  heroTitle,
  LegendsBook,
  PartyTabs,
  type PartyView,
  PlaceDossier,
  pickToasts,
  type Quality,
  ReadmeBadge,
  type RecapView,
  RosterBadges,
  SettingsPanel,
  type SettingsValues,
  ShowHudPill,
  SourcesCard,
  StoryGlyphs,
  type TimeMode,
  type ToastItem,
  Toasts,
  Toggle,
  type ViewerHud,
  type WeatherPick,
} from "@guildhall/ui"
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { SoundButton, SoundSettings } from "../../audio/ui.tsx"
import type { HudParts } from "../../hexworld/index.ts"
import type { BuiltPlace } from "../../hexworld/job.ts"
import { captureStage } from "../../shell/viewer.ts"
import type { HallTime } from "../clock.ts"
import type { SessionSnapshot } from "../feeds/session.ts"
import { chronicleOf, groupRepeats, partiesOf, rosterOf, type SessionEntry } from "../feeds/view.ts"
import { beatsOf } from "../historyEvents.ts"
import { HallTimeline } from "../timeline.tsx"
import { useHistoryNarration } from "./historyHud.ts"
import { faceSlots, type MenuTab, menuOpens, menuTab, menuTabs, TAB_LABEL } from "./phone.ts"
import { usePortraitOf } from "./portraits.ts"
import {
  HeroSheet,
  type HudSession,
  PleaCards,
  pleaCount,
  RosterPanel,
  sessionStatus,
  sourceOf,
} from "./SessionHud.tsx"
import {
  brandOf,
  feedOf,
  feedPick,
  feedStamp,
  growthLine,
  monthOf,
  type PlaceRow,
  placeDossier,
  placeLabelOf,
  placeOfUnit,
  placeRows,
} from "./view.ts"

/**
 * The panels the HUD remembers open or folded between visits. Not the Guild: it always opens folded to
 * its badge bar (V1; user 10-13), ⤢ unfolds it.
 */
export const REMEMBERED = ["places", "chronicle"] as const

/** The HUD's own slots beside the Viewer's regions (hall/hud/mount.tsx makes them). */
export interface HallFloat {
  /** Top centre: a plea's card, the fast-forward chip. */
  top: HTMLElement
  /** Bottom centre over the bar: the captions (kept in the Hidden HUD). */
  caps: HTMLElement
  /** Bottom right: a told story's act chip. */
  acts: HTMLElement
}

/** What Settings pulls that the mount reads, and the director's skip it shows. */
export interface HallLevers {
  /** The director's style: a cinematic one skips a replay's quiet stretches. */
  cinematic: boolean
  /** A weather the viewer pinned, over what the session says (null: the session's). */
  weather: WeatherKind | null
  /** How fast the director runs a quiet stretch now (1: not skipping). */
  skip(): number
  subscribe(fn: () => void): () => void
}

export interface HallHudProps {
  hud: ViewerHud
  /** Where the dialogs (the Legends, the cards) are drawn: over the whole page. */
  modals: HTMLElement
  float: HallFloat
  levers: HallLevers
  parts: Omit<HudParts, "viewer">
  slug: string
  chronicle: Chronicle | null
  legend: RepoLegend | null
  legendMarkdown?: string
  recap: RepoRecap | null
  /** Moves the site (Another repo, Watch a demo). */
  go(url: string): void
  hrefs: { another: string; demos: string }
  /** No chronicle: the link that asks for one, and a retry when it could not be read. */
  request?: string
  onRetry?: () => void
  /** The hall's session (`?feed=`): the Guild, the Pleas, a hero's Dossier, the Brand's source. */
  session?: HudSession
  /** The hall's time: the bar's clock. */
  time?: HallTime | null
  /**
   * The site's home, not a repo's hall: the island has no places to list (its zones are not a repo's units),
   * no history to tell, and its Brand is the guild at work. `story` names what plays; `leave` is the way
   * out of a told story.
   */
  home?: { title: string; leave?: { label: string; href: string } }
}

const nothing = () => () => {}
const noSnapshot = (): SessionSnapshot | null => null

const useHud = (hud: ViewerHud): HudState => useSyncExternalStore(hud.subscribe, hud.state)
const usePhone = (hud: ViewerHud): boolean => useSyncExternalStore(hud.subscribe, hud.phone)

/** A short screen (a phone on its side): the viewer is at most this tall, CSS px (the HUD's own `@container` line). */
const SHORT_PX = 460
/** How long a toast stays on a short screen before it folds into the Chronicle chip, ms. */
const SHORT_TOAST_MS = 4000

/** True while the viewer is a short screen's (its height only, so a window dragged short does it too). */
function useShortScreen(hud: ViewerHud): boolean {
  const [short, setShort] = useState(false)
  useEffect(() => {
    const viewer = hud.corner.closest<HTMLElement>(".ui-viewer")
    if (!viewer) return
    const read = () => setShort(viewer.clientHeight > 0 && viewer.clientHeight <= SHORT_PX)
    read()
    const watch = new ResizeObserver(read)
    watch.observe(viewer)
    return () => watch.disconnect()
  }, [hud])
  return short
}

/** The viewer's width (CSS px) while it is a phone's, for the face bar; 0 before it is laid out. */
function useViewerWidth(hud: ViewerHud, on: boolean): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const viewer = hud.corner.closest<HTMLElement>(".ui-viewer")
    if (!on || !viewer) return
    const read = () => setWidth(viewer.clientWidth)
    read()
    const watch = new ResizeObserver(read)
    watch.observe(viewer)
    return () => watch.disconnect()
  }, [hud, on])
  return width
}

/** Between the site's crest pill and the repo chip, px. */
const CREST_GAP = 8

/**
 * The repo chip sits right of the site's crest pill in one row: the crest's width (its own, hugging its
 * word) and the gap after it are kept on the viewer as `--crest-w` (unset where the page has no crest: a
 * studio lab).
 */
function useCrestWidth(hud: ViewerHud): void {
  useEffect(() => {
    const viewer = hud.corner.closest<HTMLElement>(".ui-viewer")
    const crest = document.querySelector<HTMLElement>(".site-crest-btn")
    if (!viewer || !crest) return
    const read = () => viewer.style.setProperty("--crest-w", `${crest.offsetWidth + CREST_GAP}px`)
    read()
    const watch = new ResizeObserver(read)
    watch.observe(crest)
    return () => {
      watch.disconnect()
      viewer.style.removeProperty("--crest-w")
    }
  }, [hud])
}

/**
 * Where the camera goes to look at a place: over its heart, as close as its size allows, keeping the way
 * it looks. `sheet` says where the open sheet covers the screen, so the place lands in what is left:
 * left of the middle beside a right-hand sheet, above it over a phone's bottom sheet.
 */
export function poseFor(
  place: Pick<BuiltPlace, "at" | "tiles">,
  from: CameraPose,
  sheet: "right" | "bottom" | null = null,
): CameraPose {
  const distance = Math.min(150, 42 + Math.sqrt(place.tiles) * 6)
  const az = (from.azimuth * Math.PI) / 180
  // the rig looks along (-sin az, -cos az): its right is (cos az, -sin az), the camera's side (sin az, cos az)
  const right = sheet === "right" ? 0.17 * distance : 0
  const near = sheet === "bottom" ? 0.32 * distance : 0
  const [x, y, z] = place.at
  return {
    target: [
      x + right * Math.cos(az) + near * Math.sin(az),
      y,
      z - right * Math.sin(az) + near * Math.cos(az),
    ],
    azimuth: from.azimuth,
    elevation: Math.max(34, Math.min(52, from.elevation)),
    distance,
  }
}

/** A phone's side margin (the site's 12 px edge), as the face bar counts its room. */
const PHONE_GUT = 12

/** Where the hall keeps the viewer's quality pick (Settings, Quality) between visits. */
const QUALITY_KEY = "gh.hall.quality"

/** The remembered quality pick; Auto when there is none (or storage is blocked). */
function storedQuality(): QualityPick {
  try {
    return qualityOf(localStorage.getItem(QUALITY_KEY))
  } catch {
    return "auto"
  }
}

function storeQuality(pick: QualityPick): void {
  try {
    if (pick === "auto") localStorage.removeItem(QUALITY_KEY)
    else localStorage.setItem(QUALITY_KEY, pick)
  } catch {}
}

/** Puts a pick in force: a tier holds the DPR (the governor stands aside); Auto hands it back. */
function applyQuality(stage: HudParts["stage"], pick: QualityPick): void {
  stage.pickDpr(qualityDpr(pick, devicePixelRatio || 1))
}

/** The tiers the hall offers (the renderer has no Ultra). */
const QUALITIES: readonly { value: Quality; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
]
/** The skies the island can show (render events/weather.ts); Auto follows the guild's CI. */
const WEATHERS: readonly { value: WeatherPick; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "clear", label: "Clear" },
  { value: "cloudy", label: "Cloudy" },
  { value: "rain", label: "Rain" },
  { value: "storm", label: "Storm" },
  { value: "snow", label: "Snow" },
]

/** The camera's keys, as the hall's Settings lists them. */
const KEYS: readonly (readonly [string, string])[] = [
  ["Drag", "Turn · one finger on a phone"],
  ["Right-drag", "Pan · two fingers"],
  ["Wheel", "Zoom · pinch"],
  ["Click a hero", "Follow them (a badge, a chip, a row)"],
  ["Click a name", "Open the place"],
  ["B", "The director on / off"],
  ["H", "Detailed / Minimal / Hidden"],
  ["Esc", "Let go · fold the open panel"],
]

/** A told story's acts as hours: dawn to night across them (V1 `time: story`, the Saga's acts). */
export function storyHour(chapter: number, chapters: number): number {
  if (chapters <= 1) return 10
  const k = Math.max(0, Math.min(chapters - 1, chapter))
  return 6.5 + (14 * k) / (chapters - 1)
}

/** The local clock's hour, 0–24. */
const nowHour = () => {
  const d = new Date()
  return d.getHours() + d.getMinutes() / 60
}

/** A whole day in this many seconds (`time: cycle`). */
const CYCLE_SECONDS = 360

/** The toasts shown at once (decisions.md "HUD stays light": at most 2). */
const TOASTS_MAX = 2

function RailButton({
  id,
  label,
  open,
  onClick,
  children,
}: {
  id: string
  label: string
  open: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="ui-icon-btn hall-rail-btn"
      data-plaque=""
      data-panel={id}
      aria-label={label}
      title={label}
      aria-expanded={open}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function PlacesPanel({
  rows,
  picked,
  onPick,
  onClose,
}: {
  rows: readonly PlaceRow[]
  picked: number | null
  onPick: (index: number) => void
  onClose: () => void
}) {
  return (
    <FoldPanel
      label="Places"
      meta={<span className="num">{rows.length}</span>}
      open
      compact
      onToggle={onClose}
      className="hall-places"
    >
      {rows.length === 0 ? (
        <p className="hud-empty">No places: this island is a sketch, not the repo's.</p>
      ) : (
        <ul className="hall-place-list">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="hall-place-row"
                data-index={r.index}
                aria-current={picked === r.index ? "true" : undefined}
                onClick={() => onPick(r.index)}
              >
                <span className="hall-place-name">
                  <b>{r.label}</b>
                  {r.path !== r.label && <small className="num">{r.path}</small>}
                </span>
                <span className="hall-place-meta">
                  <span className="num">{r.files.toLocaleString("en-US")}</span>
                  <small>{r.kind}</small>
                </span>
                <i
                  className="hall-place-bar"
                  style={{ width: `${Math.max(2, r.share * 100)}%` }}
                  aria-hidden="true"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </FoldPanel>
  )
}

/**
 * The toasts to show now from a session's chronicle: repeats told once (`×3`), the newest moments that
 * earn one, each fading on its own wall clock. A playing session's snapshot re-reads them (10 Hz); a still
 * one (`still`: paused) is re-read four times a second while one is up, so its toasts still clear.
 */
function useToasts(entries: readonly SessionEntry[], on: boolean, still: boolean, cap?: number): ToastItem[] {
  const seen = useRef(new Map<string, number>())
  const [tick, setTick] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` re-reads the wall clock
  const items = useMemo(
    () => (on ? pickToasts(groupRepeats(entries), performance.now(), seen.current, TOASTS_MAX, cap) : []),
    [entries, on, tick, cap],
  )
  const fading = still && items.length > 0
  useEffect(() => {
    if (!fading) return
    const timer = setInterval(() => setTick((k) => k + 1), 250)
    return () => clearInterval(timer)
  }, [fading])
  return items
}

/** The time-of-day lever at work: the local clock, a fast day, a told story's acts; Fixed leaves the hour be. */
function useTimeOfDay(
  clock: HudParts["clock"],
  mode: TimeMode,
  chapter: { at: number; of: number } | null,
): void {
  useEffect(() => {
    if (mode === "real") {
      clock.set(nowHour())
      const timer = setInterval(() => clock.set(nowHour()), 30_000)
      return () => clearInterval(timer)
    }
    if (mode === "cycle") {
      const timer = setInterval(() => clock.set((clock.get() + 24 / CYCLE_SECONDS) % 24), 1000)
      return () => clearInterval(timer)
    }
  }, [clock, mode])
  // a new act eases the hour over two seconds, ten steps a second
  const act = mode === "story" && chapter ? storyHour(chapter.at, chapter.of) : null
  useEffect(() => {
    if (act === null) return
    const from = clock.get()
    let k = 0
    const timer = setInterval(() => {
      k++
      clock.set(from + ((act - from) * k) / 20)
      if (k >= 20) clearInterval(timer)
    }, 100)
    return () => clearInterval(timer)
  }, [clock, act])
}

export function HallHud(props: HallHudProps) {
  const { hud, parts, slug, chronicle, legend, recap, float, levers } = props
  const state = useHud(hud)
  const phone = usePhone(hud)
  const width = useViewerWidth(hud, phone)
  const short = useShortScreen(hud)
  useCrestWidth(hud)
  const camera = parts.camera
  const [picked, setPicked] = useState<number | null>(null)
  const [brandOpen, setBrandOpen] = useState(false)
  const [frame, setFrame] = useState<string | undefined>()
  const [sources, setSources] = useState(false)
  const [following, setFollowing] = useState<string | null>(null)
  const [cardOf, setCardOf] = useState<"repo" | "session">("repo")
  // Detailed opens the Guild and the Chronicle; either may still be folded by hand until the mode changes
  const [folded, setFolded] = useState<{ roster: boolean; chronicle: boolean }>({
    roster: false,
    chronicle: false,
  })
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new mode unfolds them again
  useEffect(() => setFolded({ roster: false, chronicle: false }), [state.mode])
  const sheetRef = useRef<HTMLDivElement>(null)
  // the remembered quality pick, in force from the start (Auto leaves the governor alone)
  useEffect(() => {
    const pick = storedQuality()
    if (pick !== "auto") applyQuality(parts.stage, pick)
  }, [parts.stage])
  // the session, if the hall has one: its 10 Hz snapshot, and the hero opened in the sheet
  const live = props.session
  const snap = useSyncExternalStore(
    live?.session.subscribe ?? nothing,
    live ? live.session.snapshot : noSnapshot,
  )
  const portraitOf = usePortraitOf(live?.portraits)
  const [hero, setHero] = useState<string | null>(null)
  // who the camera follows (a badge reads pressed), and the director's switch
  const filmed = useSyncExternalStore(camera?.subscribe ?? nothing, () => camera?.state().following ?? null)
  const directing = useSyncExternalStore(
    camera?.subscribe ?? nothing,
    () => camera?.state().director ?? false,
  )
  const skip = useSyncExternalStore(levers.subscribe, levers.skip)

  const home = props.home
  const brand = useMemo(
    () =>
      home
        ? { name: home.title, source: { kind: "history" as const }, status: "", stats: [] }
        : brandOf(parts.repo, slug, parts.places.length, chronicle),
    [parts, slug, chronicle, home],
  )
  const rows = useMemo(() => placeRows(parts.places, parts.repo), [parts])
  const unitAt = useMemo(() => placeOfUnit(parts.places, parts.repo), [parts])
  const feed = useMemo(() => (legend ? feedOf(legend, unitAt) : []), [legend, unitAt])
  // the history's moments (hall/historyEvents.ts): a repo's hall narrates them while its growth plays
  const beats = useMemo(
    () => (chronicle && !home ? beatsOf(chronicle, legend, placeLabelOf(parts.places)) : null),
    [chronicle, legend, home, parts.places],
  )
  const place = picked !== null ? parts.places[picked] : undefined
  const dossier = useMemo(
    () => (place ? placeDossier(place, parts.repo, chronicle, legend) : null),
    [place, parts.repo, chronicle, legend],
  )

  // ── Settings' levers ──
  const [quality, setQuality] = useState(storedQuality)
  const [captions, setCaptions] = useState(true)
  const [style, setStyle] = useState<"calm" | "cinematic">(levers.cinematic ? "cinematic" : "calm")
  const [weather, setWeather] = useState<WeatherPick>(levers.weather ?? "auto")
  const storyTold = (snap?.chapters.length ?? 0) > 0
  const [timeMode, setTimeMode] = useState<TimeMode>(() => (storyTold ? "story" : "fixed"))
  const [hour, setHour] = useState(() => parts.clock.get())
  useTimeOfDay(
    parts.clock,
    timeMode,
    snap && storyTold ? { at: Math.max(0, snap.chapter), of: snap.chapters.length } : null,
  )
  const pace = snap ? snap.clock.rate : (props.time?.clock.get().rate ?? 1)

  const open = (index: number, from?: string) => {
    const p = parts.places[index]
    if (!p) return
    setPicked(index)
    hud.dispatch({ type: "open", id: "dossier", ...(from ? { from } : {}) })
    parts.stage.rig.glide(poseFor(p, parts.stage.rig.get(), hud.phone() ? "bottom" : "right"), 1100)
  }
  // a hero followed: the camera flies to them and keeps them framed (hall/camera.ts), or without one
  // it looks over where they stand (their place, or the hall's)
  const follow = (id: string) => {
    if (camera) return camera.follow(id)
    const a = snap?.world.actors.get(id)
    const p = live?.places.placeAt(a?.place)
    if (p) parts.stage.rig.glide(poseFor(p, parts.stage.rig.get(), hud.phone() ? "bottom" : "right"), 1100)
  }
  // a hero opened: their dossier in the sheet, and followed
  const openHero = (id: string, from?: string) => {
    setHero(id)
    hud.dispatch({ type: "open", id: "hero", ...(from ? { from } : {}) })
    follow(id)
  }
  // a plate clicked or tapped in the world opens its place
  // biome-ignore lint/correctness/useExhaustiveDependencies: `open` only reads what is stable (the HUD, the parts)
  useEffect(() => parts.onPick((k) => open(k)), [parts])
  // the hero open in the sheet is the one its chip follows; a chip's plea mark opens its hero
  const heroOpen = state.open === "hero" ? hero : null
  // (with the hall's camera, the chip followed is the hero the camera follows: hall/camera.ts says)
  useEffect(() => {
    if (!camera) parts.chips?.select(heroOpen)
  }, [parts.chips, heroOpen, camera])
  const openHeroRef = useRef(openHero)
  openHeroRef.current = openHero
  useEffect(() => {
    parts.chips?.onPlea((id) => openHeroRef.current(id))
    return () => parts.chips?.onPlea(null)
  }, [parts.chips])
  // the open place's plate is marked
  useEffect(() => {
    parts.labels?.select(state.open === "dossier" ? picked : null)
  }, [parts.labels, state.open, picked])
  // the sheet takes focus when a panel opens in it, so the keyboard follows
  // and a panel that folds while focus was in it hands focus back to its icon on the rail, never to the page
  const was = useRef<string | null>(null)
  useEffect(() => {
    const before = was.current
    was.current = state.open
    if (state.open === "dossier" || state.open === "hero") sheetRef.current?.focus({ preventScroll: true })
    const lost = document.activeElement === document.body || document.activeElement === null
    if (before === "dossier" && state.open === "places" && lost) {
      const row = document.querySelector<HTMLElement>(`.hall-place-row[data-index="${picked}"]`)
      if (row) row.focus()
      else
        document.querySelector<HTMLElement>(".hall-places .hud-panel-head button, .hall-place-row")?.focus()
    } else if (before && !state.open && lost)
      (
        (phone ? hud.rail.querySelector<HTMLElement>("[data-menu-toggle]") : null) ??
        hud.rail.querySelector<HTMLElement>(`[data-panel="${before === "dossier" ? "places" : before}"]`) ??
        document.querySelector<HTMLElement>(".hud-badges-expand, .hud-chron-open")
      )?.focus()
    // a panel opened from its control (the rail's icon, the badge bar's expander, the Chronicle chip) takes
    // the focus: the panels come before the rail in reading order, so Tab from the icon would pass them by
    const panel = { places: ".hall-places", roster: ".hud-roster", chronicle: ".hall-feed" }[
      state.open as string
    ]
    if (panel && before !== state.open && !phone) {
      const at = document.activeElement
      const fromControl =
        lost ||
        (at instanceof HTMLElement && at.matches(".hall-rail-btn, .hud-badges-expand, .hud-chron-open"))
      if (fromControl)
        document
          .querySelector<HTMLElement>(`${panel} .hall-place-row, ${panel} .hud-panel-head button`)
          ?.focus({ preventScroll: true })
    }
  }, [state.open, hud, picked, phone])
  // the card's picture is the island as it is drawn now
  useEffect(() => {
    if (state.open !== "card") return
    let on = true
    void captureStage(parts.stage).then((url) => on && url && setFrame(url))
    return () => {
      on = false
    }
  }, [state.open, parts.stage])

  const toggle = (id: string) => hud.dispatch({ type: "toggle", id })
  const close = () => hud.dispatch({ type: "close" })
  // the phone's one menu: its tabs, the one shown now (null: folded), the one ☰ opens next
  const tabs = useMemo(() => menuTabs({ guild: Boolean(live), places: !home }), [live, home])
  const tab = phone ? menuTab(state.open, state.back, tabs) : null
  const lastTab = useRef<MenuTab | null>(null)
  if (tab) lastTab.current = tab
  const pleas = snap ? pleaCount(snap) : 0
  const toggleMenu = () =>
    state.open
      ? hud.dispatch({ type: "closeAll" })
      : hud.dispatch({ type: "open", id: menuOpens(lastTab.current, tabs) })
  const hidden = state.mode === "hidden"
  const detailed = state.mode === "detailed"
  const placesOpen =
    state.open === "places" || (state.open === "dossier" && state.back === "places" && !phone)
  // the Guild: its badges, or (opened, or Detailed on a wide screen) its roster under the Brand
  const rosterOpen =
    Boolean(snap) &&
    (state.open === "roster" ||
      (state.open === "hero" && state.back === "roster" && !phone) ||
      (detailed && !phone && !folded.roster && !placesOpen))
  // the Chronicle on the right: opened, or Detailed with the sheet free (a dossier, Settings take it)
  const sheetBusy =
    state.open === "dossier" ||
    state.open === "hero" ||
    state.open === "settings" ||
    (phone && state.open !== null && state.open !== "chronicle")
  const chronicleOpen = state.open === "chronicle" || (detailed && !phone && !folded.chronicle && !sheetBusy)
  // the session's moments when there is a session, else the history's eras
  const sessionFeed = snap !== null
  const sessionEntries = useMemo(() => {
    if (!snap || !live) return []
    const origin = live.session.origin() ?? snap.clock.start
    return chronicleOf(live.session.log().events, snap.world, snap.clock.at, origin)
  }, [snap, live])
  const sessionStamp = snap ? clockWords(snap.clock.at - snap.clock.start) : ""
  // without a session, the history tells its moments: a caption, toasts, the Chronicle at the clock's day
  const labels = parts.labels
  const flash = useMemo(() => (labels ? (k: number) => labels.flash(k) : undefined), [labels])
  const narration = useHistoryNarration(props.time?.clock ?? null, beats, !sessionFeed, unitAt, flash)
  const historyFeed = beats ? narration.feed : feed
  // toasts while the Chronicle is folded (a phone's captions tell the moments; its chip opens the log)
  const toasts = useToasts(
    sessionEntries,
    sessionFeed && !chronicleOpen && !phone && !hidden,
    !snap?.clock.playing && snap?.clock.mode !== "live",
    short ? SHORT_TOAST_MS : undefined,
  )
  const roster = useMemo(
    () =>
      live && snap
        ? {
            heroes: rosterOf(snap.world, snap.clock.at, live.places.name),
            parties: partiesOf(snap.world, snap.clock.at),
          }
        : NO_ROSTER,
    [live, snap],
  )

  // the session's own book and card (the Teller's story so far), told when asked for
  const [told, setTold] = useState<{ legend?: Legend; markdown?: string; recap?: Recap } | null>(null)
  const wantsBook = state.open === "legends" || (state.open === "card" && cardOf === "session")
  // biome-ignore lint/correctness/useExhaustiveDependencies: told once each time the book or card opens
  useEffect(() => {
    if (!wantsBook || !live) return
    const teller = live.session.teller()
    if (!teller) return setTold(null)
    const sessions = teller.party()
    const book = legendOf(teller.history, sessions)
    if (!book) return setTold({})
    setTold({
      legend: book,
      markdown: legendMarkdown(book),
      recap: recapOf({
        legend: book,
        history: teller.history,
        sessions,
        lookup: { session: (id) => teller.session(id) },
        guild: home ? "The demo guild" : slug,
        story: snap?.name ?? "",
      }),
    })
  }, [wantsBook, live])

  const onFeedPick = (id: string) => {
    if (sessionFeed) return openHero(id, phone ? "chronicle" : undefined)
    const p = feedPick(id)
    if (p?.kind === "place") open(p.index, phone ? "chronicle" : undefined)
    else if (p?.kind === "era") hud.dispatch({ type: "open", id: "legends" })
  }

  const about = (
    <>
      {home && (
        <p>
          Events in, a living world out: every tool call a coding agent makes is a deed on this island. What
          plays now is told for the demo; point it at your own sessions on your machine.
        </p>
      )}
      {brand.description && <p>{brand.description}</p>}
      {brand.built && <p className="hall-about-quiet">{brand.built}.</p>}
      {!home && brand.sketch && (
        <p>
          {brand.sketch.why === "not-chronicled"
            ? "A sketch, not this repo's island: there is no chronicle for it yet, so the land is the generator's own at a default size."
            : `A sketch, not this repo's island: its chronicle could not be read${brand.sketch.reason ? ` (${brand.sketch.reason})` : ""}.`}
        </p>
      )}
      <p className="hall-about-links">
        {home?.leave && (
          <Link href={home.leave.href} go={props.go}>
            {home.leave.label}
          </Link>
        )}
        {props.request && (
          <a className="site-link" href={props.request} target="_blank" rel="noreferrer">
            Request a chronicle
          </a>
        )}
        {props.onRetry && (
          <button type="button" className="site-link" onClick={props.onRetry}>
            Try again
          </button>
        )}
        <Link href={props.hrefs.another} go={props.go}>
          Another repo
        </Link>
        <Link href={props.hrefs.demos} go={props.go}>
          Watch a demo
        </Link>
        <button type="button" className="site-link" onClick={() => setSources(true)}>
          Connect a source
        </button>
      </p>
    </>
  )

  const legendsAt = legend || live
  const chronicleFeed = (
    <ChronicleFeed
      entries={sessionFeed ? sessionEntries : historyFeed}
      time={sessionFeed && snap ? snap.clock.at - snap.clock.start : 0}
      parties={roster.parties}
      open
      compact
      onToggle={() =>
        state.open === "chronicle" ? toggle("chronicle") : setFolded((f) => ({ ...f, chronicle: true }))
      }
      onPick={onFeedPick}
      {...(sessionFeed ? {} : { when: monthOf })}
      stamp={sessionFeed ? sessionStamp : chronicle ? feedStamp(chronicle) : ""}
      empty={sessionFeed ? "Nothing yet: the guild has not stirred." : "No history: this island is a sketch."}
      foot={
        legendsAt || !home ? (
          <>
            {legendsAt && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => hud.dispatch({ type: "open", id: "legends" })}
                >
                  <StoryGlyphs.book size={14} />
                  {sessionFeed ? "Legends" : "Legends by era"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setCardOf(sessionFeed ? "session" : "repo")
                    hud.dispatch({ type: "open", id: "card" })
                  }}
                >
                  <StoryGlyphs.card size={14} />
                  Chronicle card
                </Button>
              </>
            )}
            {!home && <ReadmeBadge repo={slug} previewSrc="/badge.svg" />}
          </>
        ) : undefined
      }
      className="hall-feed"
    />
  )

  const placeSheet = dossier && (
    <PlaceDossier
      {...dossier}
      filesLabel={dossier.files.length > 1 ? "Folders" : "Path"}
      onClose={close}
      {...(phone && state.back
        ? { onBack: close, backLabel: state.back === "places" ? "Places" : "Chronicle" }
        : {})}
    />
  )

  const values: SettingsValues = {
    pace,
    director: directing,
    quality,
    hud: state.mode,
    captions,
    ...(snap ? { directorStyle: style } : {}),
    time: timeMode,
    hour,
    ...(parts.fx ? { weather } : {}),
  }
  const onSettings = (patch: Partial<SettingsValues>) => {
    if (patch.pace !== undefined) {
      if (live) live.session.clock.setRate(patch.pace)
      else props.time?.clock.setRate(patch.pace)
    }
    if (patch.director !== undefined) camera?.director(patch.director)
    if (patch.quality !== undefined) {
      const pick = qualityOf(patch.quality)
      setQuality(pick)
      storeQuality(pick)
      applyQuality(parts.stage, pick)
    }
    if (patch.hud !== undefined) hud.dispatch({ type: "mode", mode: patch.hud })
    if (patch.captions !== undefined) setCaptions(patch.captions)
    if (patch.directorStyle !== undefined) {
      setStyle(patch.directorStyle)
      levers.cinematic = patch.directorStyle === "cinematic"
    }
    if (patch.time !== undefined) setTimeMode(patch.time)
    if (patch.hour !== undefined) {
      parts.clock.set(patch.hour)
      setHour(patch.hour)
    }
    if (patch.weather !== undefined) {
      setWeather(patch.weather)
      const pin = patch.weather === "auto" ? null : (patch.weather as WeatherKind)
      levers.weather = pin
      if (pin) parts.fx?.drive.set(pin)
    }
  }
  const followed = filmed ? roster.heroes.find((h) => h.id === filmed) : undefined
  const followedName = followed ? heroTitle(followed) : undefined
  const settings = (
    <SettingsPanel
      values={values}
      onChange={onSettings}
      onClose={close}
      onRepo={() => props.go(props.hrefs.another)}
      hourNow={hour}
      qualities={QUALITIES}
      weathers={WEATHERS}
      keys={KEYS}
      sound={<SoundSettings bare />}
      {...(followedName ? { cameraNote: `Following ${followedName}` } : {})}
      display={parts.labels ? <PlatesToggle labels={parts.labels} /> : undefined}
    />
  )

  let sheet: ReactNode = null
  const rosterPanel = live && snap && (
    <RosterPanel
      hud={live}
      snap={snap}
      following={following}
      picked={state.open === "hero" ? hero : null}
      onCamera={filmed}
      onPick={(id) => openHero(id, "roster")}
      onClose={() => {
        if (state.open === "roster" || state.open === "hero")
          hud.dispatch({ type: phone ? "close" : "closeAll" })
        else setFolded((f) => ({ ...f, roster: true }))
      }}
    />
  )
  if (state.open === "dossier") sheet = placeSheet
  else if (state.open === "hero" && live && snap && hero)
    sheet = (
      <HeroSheet
        hud={live}
        snap={snap}
        id={hero}
        onClose={close}
        {...(phone && state.back === "roster" ? { onBack: close } : {})}
      />
    )
  else if (phone && state.open === "roster") sheet = rosterPanel
  else if (state.open === "settings") sheet = settings
  else if (phone && state.open === "places")
    sheet = <PlacesPanel rows={rows} picked={picked} onPick={(k) => open(k, "places")} onClose={close} />
  else if (chronicleOpen) sheet = chronicleFeed
  // a phone's menu: the tab bar over the tab's panel (a dossier opened from a tab stays under it)
  if (sheet && tab)
    sheet = (
      <div className="ui-panel hall-menu" data-tab={TAB_LABEL[tab].toLowerCase()}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the arrow keys of a tab list are heard on the list */}
        <div
          className="hall-tabs"
          role="tablist"
          aria-label="Menu"
          onKeyDown={(event) => {
            const at = tabs.indexOf(tab)
            const to =
              event.key === "ArrowRight"
                ? (at + 1) % tabs.length
                : event.key === "ArrowLeft"
                  ? (at - 1 + tabs.length) % tabs.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : -1
            const next = tabs[to]
            if (!next) return
            event.preventDefault()
            hud.dispatch({ type: "open", id: next })
            document.getElementById(`hall-menu-tab-${next}`)?.focus()
          }}
        >
          {tabs.map((t) => (
            <button
              key={t}
              id={`hall-menu-tab-${t}`}
              type="button"
              role="tab"
              className="hall-tab"
              data-tab={TAB_LABEL[t].toLowerCase()}
              aria-selected={t === tab}
              aria-controls="hall-menu-panel"
              tabIndex={t === tab ? 0 : -1}
              onClick={() => hud.dispatch({ type: "open", id: t })}
            >
              {TAB_LABEL[t]}
              {t === "roster" && pleas > 0 && <i className="hud-tab-dot" aria-hidden="true" />}
            </button>
          ))}
          <button
            type="button"
            className="ui-icon-btn hall-tabs-close"
            aria-label="Close the menu"
            onClick={() => hud.dispatch({ type: "closeAll" })}
          >
            <Glyphs.close size={16} />
          </button>
        </div>
        <div
          className="hall-menu-body"
          role="tabpanel"
          id="hall-menu-panel"
          aria-labelledby={`hall-menu-tab-${tab}`}
        >
          {sheet}
        </div>
      </div>
    )

  // a plea's card: top centre (V1), under the Guild on a phone; the fast-forward chip beside it
  const pleaCards = live && snap && !hidden && (
    <PleaCards hud={live} snap={snap} onOpen={(id) => openHero(id)} />
  )
  const ffwd = snap?.kind === "replay" && <FastForwardChip rate={pace * skip} skip={skip} />
  const chapters = snap?.chapters ?? []
  const clock = live?.session.clock
  // the Guild's face bar: under the top row, or a phone's foot beside the act chip (as many as fit, +N)
  const actsPx = chapters.length > 0 ? 52 : 0
  const faces = live && snap && !(phone && state.open !== null) && (
    <RosterBadges
      heroes={roster.heroes}
      parties={roster.parties}
      following={following}
      selected={filmed}
      look="portrait"
      portraitOf={portraitOf}
      size={phone ? 40 : 36}
      onPick={(id) => (id ? follow(id) : camera?.release())}
      onExpand={() => {
        if (detailed && !phone) setFolded((f) => ({ ...f, roster: false }))
        else hud.dispatch({ type: "open", id: "roster" })
      }}
      {...(phone && width > 0 ? { max: faceSlots(width, PHONE_GUT, actsPx) } : {})}
    />
  )

  return (
    <>
      {createPortal(
        hidden ? (
          <ShowHudPill onShow={() => hud.dispatch({ type: "mode", mode: "minimal" })} pleas={pleas} />
        ) : phone ? (
          <nav className="hall-rail" aria-label="HUD">
            <button
              type="button"
              className="ui-icon-btn hall-rail-btn hall-menu-btn"
              data-plaque=""
              aria-label={state.open ? "Close the menu" : "Menu"}
              title="Menu"
              aria-expanded={state.open !== null}
              aria-controls="hall-menu-panel"
              data-menu-toggle=""
              onClick={toggleMenu}
            >
              {state.open ? <Glyphs.close size={18} /> : <Glyphs.menu size={18} />}
              {pleas > 0 && !state.open && <i className="hud-tab-dot" aria-hidden="true" />}
            </button>
          </nav>
        ) : (
          <nav className="hall-rail" aria-label="HUD">
            {!home && (
              <RailButton id="places" label="Places" open={placesOpen} onClick={() => toggle("places")}>
                <Glyphs.place size={18} />
              </RailButton>
            )}
            {legendsAt && (
              <RailButton
                id="legends"
                label={legend ? "Legends by era" : "Legends"}
                open={state.open === "legends"}
                onClick={() => toggle("legends")}
              >
                <StoryGlyphs.book size={18} />
              </RailButton>
            )}
            {(recap || live) && !phone && (
              <RailButton
                id="card"
                label="Chronicle card"
                open={state.open === "card"}
                onClick={() => {
                  setCardOf(live ? "session" : "repo")
                  toggle("card")
                }}
              >
                <StoryGlyphs.card size={18} />
              </RailButton>
            )}
            <SoundButton />
            <RailButton
              id="settings"
              label="Settings"
              open={state.open === "settings"}
              onClick={() => toggle("settings")}
            >
              <Glyphs.gear size={18} />
            </RailButton>
          </nav>
        ),
        hud.rail,
      )}
      {createPortal(
        <>
          <BrandCard
            chip
            name={brand.name}
            source={snap ? sourceOf(snap) : brand.source}
            status={snap ? sessionStatus(snap) : brand.status}
            stats={brand.stats}
            about={about}
            open={brandOpen}
            onToggle={() => setBrandOpen((v) => !v)}
            {...(snap ? { pleas } : {})}
            {...(live && snap?.kind === "live" ? { onRetry: () => live.session.retry() } : {})}
          />
          {live && snap && !phone && (
            <PartyTabs
              parties={roster.parties}
              heroes={roster.heroes}
              following={following}
              onFollow={setFollowing}
              compact={phone}
              className="hall-parties"
            />
          )}
          {!phone && !rosterOpen && faces}
          {phone && pleaCards}
          {!phone && rosterOpen && rosterPanel}
          {!phone && placesOpen && (
            <PlacesPanel
              rows={rows}
              picked={state.open === "dossier" ? picked : null}
              onPick={(k) => open(k, "places")}
              onClose={() => hud.dispatch({ type: "closeAll" })}
            />
          )}
        </>,
        hud.corner,
      )}
      {createPortal(
        <>
          {!phone && pleaCards}
          {!phone && ffwd}
        </>,
        float.top,
      )}
      {snap &&
        createPortal(
          <Captions
            {...(snap.caption ? { caption: snap.caption } : {})}
            visible={captions && !detailed}
            announcePleas={false}
          />,
          float.caps,
        )}
      {!snap &&
        beats &&
        createPortal(
          <Captions
            key={narration.epoch}
            {...(narration.caption ? { caption: narration.caption } : {})}
            visible={captions && !detailed}
          />,
          float.caps,
        )}
      {createPortal(
        <>
          {phone && faces}
          {phone && ffwd}
          {chapters.length > 0 && clock && snap && !hidden && (
            <ChapterChip
              chapters={chapters}
              current={Math.max(0, snap.chapter)}
              onJump={(k) => clock.seek(snap.clock.start + (chapters[k]?.at ?? 0), { jump: true })}
              compact={phone}
              className="hall-chapter"
            />
          )}
        </>,
        float.acts,
      )}
      {createPortal(
        chronicleOpen || phone ? null : (
          <Toasts
            items={sessionFeed ? toasts : hidden ? [] : narration.toasts}
            time={0}
            parties={roster.parties}
            quiet
            compact={short}
            onPick={(id) => (sessionFeed ? openHero(id) : onFeedPick(id))}
            stamp={sessionFeed ? sessionStamp : chronicle ? feedStamp(chronicle) : "sketch"}
            onExpand={() =>
              detailed && !phone ? setFolded((f) => ({ ...f, chronicle: false })) : toggle("chronicle")
            }
          />
        ),
        hud.feed,
      )}
      {props.time &&
        createPortal(
          <HallTimeline
            time={props.time}
            pinned={detailed}
            overlay={false}
            {...(chronicle ? { growth: (at: number) => growthLine(chronicle, at / DAY_MS) } : {})}
          />,
          hud.bottom,
        )}
      {sheet &&
        createPortal(
          <div
            className="hall-sheet"
            ref={sheetRef}
            tabIndex={-1}
            data-panel={state.open ?? (chronicleOpen ? "chronicle" : "")}
            data-keepout=""
          >
            {sheet}
          </div>,
          hud.sheet,
        )}
      {state.open === "legends" &&
        legendsAt &&
        createPortal(
          <LegendsBook
            {...(told?.legend ? { legend: told.legend } : {})}
            {...(told?.markdown ? { markdown: told.markdown } : {})}
            {...(legend ? { history: { repo: legend.repo, sessions: [], milestones: [], legend } } : {})}
            {...(props.legendMarkdown ? { historyMarkdown: props.legendMarkdown } : {})}
            view={live ? "session" : "history"}
            onCard={(view) => {
              setCardOf(view === "history" ? "repo" : "session")
              hud.dispatch({ type: "open", id: "card", from: "legends" })
            }}
            onClose={() => hud.dispatch({ type: "closeAll" })}
          />,
          props.modals,
        )}
      {state.open === "card" &&
        (cardOf === "repo" && recap
          ? createPortal(
              <ChronicleCard
                recap={recapView(recap)}
                {...(frame ? { image: frame } : {})}
                focus={{ x: 0.5, y: 0.5 }}
                link={`https://${recap.link}`}
                onClose={close}
              />,
              props.modals,
            )
          : told?.recap &&
            createPortal(
              <ChronicleCard
                recap={sessionRecapView(told.recap)}
                {...(frame ? { image: frame } : {})}
                focus={{ x: 0.5, y: 0.5 }}
                onClose={close}
              />,
              props.modals,
            ))}
      {sources && createPortal(<SourcesCard onClose={() => setSources(false)} />, props.modals)}
    </>
  )
}

const NO_ROSTER: { heroes: HeroView[]; parties: PartyView[] } = { heroes: [], parties: [] }

function PlatesToggle({ labels }: { labels: NonNullable<HudParts["labels"]> }) {
  const [on, setOn] = useState(() => labels.shown())
  return (
    <Toggle
      label="Name plates"
      hint="Each place's name over the island; click one to open it"
      checked={on}
      onChange={(next) => {
        labels.show(next)
        setOn(next)
      }}
    />
  )
}

function Link({ href, go, children }: { href: string; go(url: string): void; children: ReactNode }) {
  return (
    <a
      className="site-link"
      href={href}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
        e.preventDefault()
        go(href)
      }}
    >
      {children}
    </a>
  )
}

/** The Repo Chronicle card as the ui draws it (as /lab/hud's `tellRepo`). */
export function recapView(recap: RepoRecap): RecapView {
  return {
    kind: "repo",
    title: recap.title,
    guild: recap.repo,
    story: recap.subtitle,
    subtitle: recap.subtitle,
    outcome: "underway",
    numbers: recap.numbers,
    lines: recap.lines.map((l) => ({ at: l.at, kind: l.kind, parts: l.parts, text: l.parts[0]?.text ?? "" })),
    hero: recap.hero,
    site: recap.link,
  }
}

/** A session's card as the ui draws it (as /lab/hud's story `recapView`). */
export function sessionRecapView(recap: Recap): RecapView {
  return { ...recap, ...(recap.hero ? { hero: { label: recap.hero.label, at: recap.hero.at } } : {}) }
}
