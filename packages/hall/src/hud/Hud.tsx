import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { MODE } from "../guild/mode.ts"
import { useGuild } from "../guild/useGuild.ts"
import { Brand } from "./Brand.tsx"
import { Chronicle, Toasts } from "./Chronicle.tsx"
import { Dossier } from "./Dossier.tsx"
import { Icon } from "./icons.tsx"
import { Pleas } from "./Pleas.tsx"
import { HUD_MODES, type HudMode, hudPrefs, useHudPrefs } from "./prefs.ts"
import { Roster, RosterBadges } from "./Roster.tsx"
import { Settings } from "./Settings.tsx"
import { Stats } from "./Stats.tsx"
import { Timeline } from "./Timeline.tsx"

const PHONE = "(max-width: 720px)"

/** Regions that fold into a compact form: the brand's about card, the roster, the chronicle. */
type Region = "about" | "roster" | "chronicle"
type Regions = Record<Region, boolean>

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
  const { mode, stats } = useHudPrefs()
  const [settings, setSettings] = useState(false)
  const [open, setOpen] = useState<Regions>(() => regionsFor(mode, phone))
  const [said, setSaid] = useState("")
  const [statsOpen, setStatsOpen] = useState(true)
  const modeBtn = useRef<HTMLButtonElement>(null)
  const gear = useRef<HTMLButtonElement>(null)
  const root = useRef<HTMLDivElement>(null)

  const view = store.selected ? store.views.find((v) => v.id === store.selected) : undefined
  const dossier = mode !== "hidden" && Boolean(store.selected && store.sessionOf(store.selected))
  const pleas = store.views.filter((v) => v.phase === "waiting").length
  const showcase = MODE === "showcase"
  const tape = !showcase && store.mode === "sim"

  // biome-ignore lint/correctness/useExhaustiveDependencies: refold only when the mode changes
  useEffect(() => {
    setOpen(regionsFor(mode, phone))
    document.documentElement.dataset.hud = mode
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
    if (next === "hidden") setSettings(false)
    if (inside) requestAnimationFrame(() => modeBtn.current?.focus())
  }

  function closeSettings() {
    setSettings(false)
    requestAnimationFrame(() => gear.current?.focus())
  }

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
      if (event.key === "h" || event.key === "H") {
        setMode(HUD_MODES[mode].next)
        return
      }
      if (event.key !== "Escape") return
      if (settings) closeSettings()
      else if (store.selected) store.select(null)
      else if (mode === "hidden") setMode("minimal")
      else if (open.about) setOpen((o) => ({ ...o, about: false }))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const hidden = mode === "hidden"
  const ModeGlyph = Icon[mode]

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
    >
      {!hidden && (
        <div className="region region-left">
          <Brand store={store} open={open.about} onToggle={() => toggle("about")} />
          {open.roster ? (
            <Roster store={store} open onToggle={() => toggle("roster")} compact className="is-sheet" />
          ) : (
            <RosterBadges store={store} onExpand={() => toggle("roster")} />
          )}
        </div>
      )}

      <div className="toolbar">
        <button
          ref={modeBtn}
          type="button"
          className={hidden ? "plaque show-hud" : "plaque tool"}
          onClick={() => setMode(HUD_MODES[mode].next)}
          aria-label={
            hidden
              ? `Show the HUD (H)${pleas > 0 ? `, ${pleas} waiting for you` : ""}`
              : `HUD: ${HUD_MODES[mode].label}. Switch to ${HUD_MODES[HUD_MODES[mode].next].label} (H)`
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
        {!hidden && (
          <button
            ref={gear}
            type="button"
            className="plaque tool"
            aria-label="Settings"
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
          </button>
        )}
      </div>

      {settings && !hidden && <Settings store={store} onClose={closeSettings} />}

      {!hidden && (
        <>
          <Pleas store={store} />

          <div className="region region-right">
            {dossier ? (
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

          {!open.chronicle && <Toasts store={store} onExpand={() => toggle("chronicle")} />}
          {tape && <Timeline store={store} pinned={mode === "detailed"} />}
        </>
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
