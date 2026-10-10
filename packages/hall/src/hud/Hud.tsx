import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { hudInsets } from "../guild/director.ts"
import { MODE } from "../guild/mode.ts"
import { useOpening } from "../guild/opening.ts"
import { useGuild } from "../guild/useGuild.ts"
import { setChipMode } from "../scene/chips.ts"
import { Brand } from "./Brand.tsx"
import "./headbar.css"
import "./phonebar.css"
import { Captions } from "./Captions.tsx"
import { ChapterChip } from "./Chapter.tsx"
import { Chronicle, Toasts } from "./Chronicle.tsx"
import { Dossier } from "./Dossier.tsx"
import { FastForward } from "./FastForward.tsx"
import { IslandSwitcher } from "./Islands.tsx"
import { Icon } from "./icons.tsx"
import { IslandKeys, IslandUrl, TravelFade } from "./islandTravel.tsx"
import { Legends } from "./Legends.tsx"
import { Opening } from "./Opening.tsx"
import { PartySwitcher } from "./Parties.tsx"
import { Pleas } from "./Pleas.tsx"
import { HUD_MODES, type HudMode, hudPrefs, useHudPrefs } from "./prefs.ts"
import { RepoDoor, repoDoor, useRepoDoor } from "./RepoDoor.tsx"
import { RepoLegend } from "./RepoLegend.tsx"
import { Roster, RosterBadges } from "./Roster.tsx"
import { RosterStack } from "./RosterStack.tsx"
import { Settings } from "./Settings.tsx"
import { SoundToggle, useSoundWaiting } from "./Sound.tsx"
import { Stats } from "./Stats.tsx"
import { Timeline } from "./Timeline.tsx"
import { TimelineGrowth, useGrowthPhase } from "./TimelineGrowth.tsx"
import { TownDossier, useResident } from "./TownDossier.tsx"

const PHONE = "(max-width: 720px)"
/** The showcase's opening caption speaks first: story captions start this long after the HUD lands. */
const OPENING_QUIET_MS = 5000

/** Regions that fold into a compact form: the brand's about card, the roster, the chronicle. */
type Region = "about" | "roster" | "chronicle"
type Regions = Record<Region, boolean>

/** On a phone Detailed looks like Minimal (panels are sheets either way): H cycles Minimal and Hidden. */
function modeOn(mode: HudMode, phone: boolean): HudMode {
  return phone && mode === "detailed" ? "minimal" : mode
}
function nextMode(mode: HudMode, phone: boolean): HudMode {
  const next = HUD_MODES[mode].next
  return phone && next === "detailed" ? HUD_MODES[next].next : next
}

/** Detailed opens the lists; Minimal folds everything. Phones never open a sheet on their own. */
function regionsFor(mode: HudMode, phone: boolean): Regions {
  const open = mode === "detailed" && !phone
  return { about: false, roster: open, chronicle: open }
}

/**
 * The overlay. One rule everywhere: a folded region has a compact form (badges, toasts, a status
 * line, a hairline timeline) and unfolds into its full panel. The HUD mode (H) folds or unfolds
 * them all, or hides the HUD for a pure view of the world.
 *
 * Desktop: brand + roster top-left, toolbar + chronicle / dossier top-right, pleas top-centre,
 * toasts bottom-left, the tape bottom-centre. Phones: the same pieces, panels as bottom sheets.
 */
export function Hud() {
  const store = useGuild()
  const phone = useMedia(PHONE)
  const prefs = useHudPrefs()
  const mode = modeOn(prefs.mode, phone)
  const { stats } = prefs
  const intro = useOpening()
  const [settings, setSettings] = useState(false)
  const [open, setOpen] = useState<Regions>(() => regionsFor(mode, phone))
  const [said, setSaid] = useState("")
  const [statsOpen, setStatsOpen] = useState(true)
  const modeBtn = useRef<HTMLButtonElement>(null)
  const gear = useRef<HTMLButtonElement>(null)
  const [legends, setLegends] = useState(false)
  const book = useRef<HTMLButtonElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const soundWaiting = useSoundWaiting()
  const door = useRepoDoor()

  const view = store.selected ? store.views.find((v) => v.id === store.selected) : undefined
  const resident = useResident(store.selected)
  const dossier =
    mode !== "hidden" && Boolean(store.selected && (store.sessionOf(store.selected) || resident))
  const pleas = store.views.filter((v) => v.phase === "waiting").length
  const showcase = MODE === "showcase"
  const film = useGrowthPhase() !== "off"
  const tape = !showcase && store.mode === "sim"
  const hidden = mode === "hidden"

  // The cast's names follow Settings → Names (guild/casting.ts): a told story is retold in them.
  useEffect(() => store.setNames(prefs.names), [store, prefs.names])

  // biome-ignore lint/correctness/useExhaustiveDependencies: refold only when the mode changes
  useEffect(() => {
    setOpen(regionsFor(mode, phone))
    document.documentElement.dataset.hud = mode
    setChipMode(mode)
  }, [mode])

  /** On a phone one sheet at a time: opening one closes the rest. */
  function only(region: Region | "settings" | "dossier") {
    if (!phone) return
    if (region !== "settings") setSettings(false)
    if (region !== "dossier" && store.selected) store.select(null)
    setOpen((o) => ({
      about: region === "about" && o.about,
      roster: region === "roster" && o.roster,
      chronicle: region === "chronicle" && o.chronicle,
    }))
  }

  function toggle(region: Region) {
    const next = !open[region]
    if (next) only(region)
    setOpen((o) => ({ ...o, [region]: next }))
  }

  function setMode(next: HudMode) {
    // Keep focus somewhere real: the mode button is the one control every mode keeps.
    const inside = root.current?.contains(document.activeElement)
    hudPrefs.set({ mode: next })
    setSaid(`HUD ${HUD_MODES[next].label}`)
    if (next === "hidden") {
      setSettings(false)
      setLegends(false)
    }
    if (inside) requestAnimationFrame(() => modeBtn.current?.focus())
  }

  function closeLegends() {
    setLegends(false)
    // On a phone the book lives in Settings: focus goes back to the gear that leads there.
    requestAnimationFrame(() => (book.current ?? gear.current)?.focus())
  }

  function openLegends() {
    only("settings")
    setSettings(false)
    setLegends(true)
  }

  function closeSettings() {
    setSettings(false)
    requestAnimationFrame(() => gear.current?.focus())
  }

  // On a phone the door replaces the sheet it was opened from (Settings), one sheet at a time; once
  // it closes, focus that had nowhere to go back to lands on the gear.
  const doorWas = useRef(false)
  useEffect(() => {
    if (door && phone && settings) setSettings(false)
    if (doorWas.current && !door)
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) gear.current?.focus()
      })
    doorWas.current = door
  }, [door, phone, settings])

  // Tell the camera what the panels cover, so the Bard frames its subject in the clear area
  // (guild/director.ts clearFrame). Px, matching hall.css: --gut 16, --left-w 304, --right-w 356.
  const pleaBanner = !hidden && pleas > 0
  const rightPanel = !hidden && (dossier || settings || open.chronicle)
  const sheet = phone && !hidden && (dossier || settings || open.roster || open.chronicle)
  const captionsShown = prefs.captions && mode !== "detailed"
  useEffect(() => {
    hudInsets.left = !phone && !hidden && open.roster ? 16 + 304 : 0
    hudInsets.right = !phone && rightPanel ? 16 + 372 : 0
    hudInsets.top = pleaBanner ? 84 : 0
    hudInsets.bottom = sheet
      ? window.innerHeight * 0.62
      : (captionsShown ? 84 : 0) + (tape && !hidden ? 56 : 0)
  }, [phone, hidden, open.roster, rightPanel, pleaBanner, sheet, captionsShown, tape])

  // A new pick on a phone closes the other sheets.
  // biome-ignore lint/correctness/useExhaustiveDependencies: react to a new pick only
  useEffect(() => {
    if (store.selected && phone) only("dossier")
  }, [store.selected, phone])

  // Keyboard: H cycles the HUD mode; Esc unwinds one layer at a time.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && /textarea|select/i.test(target.tagName)) return
      if (target instanceof HTMLInputElement && target.type !== "range") return
      // The repo door is modal (hud/RepoDoor.tsx): Esc closes it, nothing else reaches the HUD.
      if (door) {
        if (event.key === "Escape") repoDoor.close()
        return
      }
      // The book is modal: Esc closes it, and nothing else reaches the HUD meanwhile.
      if (legends) {
        if (event.key === "Escape") closeLegends()
        return
      }
      if (event.key === "h" || event.key === "H") {
        setMode(nextMode(mode, phone))
        return
      }
      if (event.key !== "Escape") return
      // Esc is also "back to the Bard": letting go of someone, or of the camera, hands it back.
      if (settings) closeSettings()
      else if (store.selected) {
        store.select(null)
        store.setBard(true)
      } else if (!store.bard) store.setBard(true)
      else if (mode === "hidden") setMode("minimal")
      else if (open.about) setOpen((o) => ({ ...o, about: false }))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const ModeGlyph = Icon[mode]
  const next = nextMode(mode, phone)
  const opening = showcase && <Opening state={intro} store={store} phone={phone} />

  // The showcase opens on a title card and a camera reveal: the HUD waits until the camera lands.
  if (showcase && (intro.stage === "card" || intro.stage === "reveal")) {
    return (
      <div className="hud" ref={root} data-opening={intro.stage}>
        {opening}
      </div>
    )
  }

  return (
    <div
      className="hud"
      ref={root}
      data-mode={mode}
      data-phone={phone}
      data-dossier={dossier}
      data-settings={settings}
      data-tape={tape}
      data-sheet={dossier || settings || open.roster || open.chronicle}
      data-opening={showcase ? intro.stage : undefined}
      data-captions={prefs.captions && mode !== "detailed"}
    >
      {opening}
      <IslandKeys />
      <IslandUrl />
      <TravelFade />
      {!hidden && (
        <div className="region region-left">
          {/* The top-left bar: the crest, the repo's chip (its panel wraps below) and, on a phone, the roster's stack. */}
          <div className="hud-head">
            <Brand store={store} open={open.about} onToggle={() => toggle("about")} />
            <RepoLegend />
            <IslandSwitcher compact={phone} />
            {phone && !open.roster && <RosterStack store={store} onExpand={() => toggle("roster")} />}
          </div>
          <PartySwitcher store={store} compact={phone} />
          {open.roster ? (
            <Roster store={store} open onToggle={() => toggle("roster")} compact className="is-sheet" />
          ) : (
            !phone && <RosterBadges store={store} onExpand={() => toggle("roster")} />
          )}
        </div>
      )}

      <div className="toolbar">
        <button
          ref={modeBtn}
          type="button"
          className={hidden ? "plaque show-hud" : "plaque tool"}
          onClick={() => setMode(next)}
          aria-label={
            hidden
              ? `Show the HUD (H)${pleas > 0 ? `, ${pleas} waiting for you` : ""}`
              : `HUD: ${HUD_MODES[mode].label}. Switch to ${HUD_MODES[next].label} (H)`
          }
          title={hidden ? "Show the HUD (H)" : `HUD: ${HUD_MODES[mode].label} · H`}
        >
          <ModeGlyph />
          {hidden && (
            <>
              <span>Show HUD</span>
              <kbd>H</kbd>
              {pleas > 0 && <i className="tab-dot" aria-hidden="true" />}
            </>
          )}
        </button>
        {/* Phones keep the bar to two buttons (HUD mode, Settings): Legends and Sound live in Settings. */}
        {!hidden && !phone && (
          <button
            ref={book}
            type="button"
            className="plaque tool"
            aria-label="Legends: the story so far"
            aria-haspopup="dialog"
            aria-expanded={legends}
            title="Legends"
            onClick={openLegends}
          >
            <Icon.book />
          </button>
        )}
        {!hidden && !phone && <SoundToggle />}
        {!hidden && (
          <button
            ref={gear}
            type="button"
            className="plaque tool"
            aria-label={phone && soundWaiting ? "Settings, sound waiting to start" : "Settings"}
            aria-expanded={settings}
            aria-haspopup="dialog"
            title="Settings"
            onClick={() => {
              if (settings) closeSettings()
              else {
                only("settings")
                setSettings(true)
              }
            }}
          >
            <Icon.gear />
            {phone && soundWaiting && <i className="tab-dot" aria-hidden="true" />}
          </button>
        )}
      </div>

      {settings && !hidden && (
        <Settings store={store} onClose={closeSettings} onLegends={phone ? openLegends : undefined} />
      )}
      {legends && !hidden && <Legends store={store} onClose={closeLegends} />}

      {!hidden && (
        <>
          <Pleas store={store} />

          <div className="region region-right">
            {dossier && resident ? (
              <TownDossier store={store} resident={resident} className="is-sheet" />
            ) : dossier ? (
              <Dossier store={store} view={view} className="is-sheet" />
            ) : (
              open.chronicle && (
                <Chronicle
                  store={store}
                  open
                  onToggle={() => toggle("chronicle")}
                  compact
                  className="is-sheet"
                />
              )
            )}
            {stats && !phone && (
              <Stats store={store} open={statsOpen} onToggle={() => setStatsOpen((o) => !o)} />
            )}
          </div>

          {!open.chronicle && (
            <Toasts store={store} onExpand={() => toggle("chronicle")} quiet={prefs.captions} />
          )}
          {tape && !film && <Timeline store={store} pinned={mode === "detailed"} />}
          {showcase && <ChapterChip store={store} />}
        </>
      )}

      <FastForward store={store} />
      {door && <RepoDoor />}
      {/* A repo's growth timelapse (`?grow`): its tape and milestones own the bottom while it plays. */}
      <TimelineGrowth hidden={hidden} />

      {prefs.captions && (
        <Captions
          store={store}
          visible={mode !== "detailed"}
          announcePleas={hidden}
          quietMs={showcase ? OPENING_QUIET_MS : 1200}
        />
      )}

      <span className="visually-hidden" aria-live="polite">
        {said}
      </span>
    </div>
  )
}

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query)
      list.addEventListener("change", notify)
      return () => list.removeEventListener("change", notify)
    },
    () => window.matchMedia(query).matches,
  )
}
