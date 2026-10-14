/**
 * The HUD lab's page: every HUD panel in V1's layout over a still of the island, fed by a fixture. Brand
 * and roster top-left, chronicle bottom-left, timeline bottom-centre, pleas top-centre, the gear and the
 * HUD mode top-right, the dossier (or settings) as the right-hand sheet. H cycles Detailed / Minimal /
 * Hidden; Esc closes the sheet. The fixture state lives in Settings → Developer (`?dev=1`).
 */
import {
  BrandCard,
  ChronicleFeed,
  Dossier,
  FastForwardChip,
  Glyphs,
  type HeroView,
  type HudMode,
  PartyTabs,
  Pleas,
  pickToasts,
  Roster,
  RosterBadges,
  Segmented,
  SettingsPanel,
  type SettingsValues,
  ShowHudPill,
  Timeline,
  type TimeScale,
  Toasts,
} from "@guildhall/ui"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { SoundSettings } from "../audio/ui.tsx"
import { type DossierFixture, fixture, HISTORY, HISTORY_MARKERS, type LabState, STATES } from "./fixtures.ts"
import { usePortraits } from "./portraits.ts"
import { StoryLab, type StoryOptions } from "./StoryLab.tsx"

const MODES: readonly HudMode[] = ["detailed", "minimal", "hidden"]
const PHONE = "(max-width: 720px)"

export interface LabOptions {
  state: LabState
  hud: HudMode
  /** Open on the fixture's hero (true) or this hero's id. */
  pick: string | boolean
  settings: boolean
  dev: boolean
  scale: TimeScale
  by: "party" | "family"
  /** Hold the toasts (no fading) and the clock: what a shot needs. */
  still: boolean
  /** The replay's fast-forward multiple (`ffwd=3`): the chip top centre while it is above 1. */
  ffwd: number
  /** On a phone, open the roster or the chronicle as a sheet. */
  sheet: "roster" | "chronicle" | null
  /** The story layer (U3): the rail, the overlays and what the query opens. */
  story: Omit<StoryOptions, "phone" | "cast" | "still">
  onState(state: LabState): void
}

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const list = matchMedia(query)
    const change = () => setOn(list.matches)
    list.addEventListener("change", change)
    return () => list.removeEventListener("change", change)
  }, [query])
  return on
}

/** A dossier for a hero the fixture has no story for: their quest and an empty transcript. */
function plainDossier(hero: HeroView): DossierFixture {
  return {
    quest: hero.master ? "Add cursor pagination to GET /users" : "",
    ledger: { tokens: 4_200, cost: 0.007, deeds: 1, ms: 6_000 },
    model: "claude-opus-5-5",
    files: [],
    transcript: [],
  }
}

export function HudLab(opts: LabOptions) {
  const [state, setState] = useState(opts.state)
  const fx = useMemo(() => fixture(state), [state])
  const phone = useMedia(PHONE)
  const [mode, setMode] = useState<HudMode>(opts.hud)
  const shown = phone && mode === "detailed" ? "minimal" : mode
  const [selected, setSelected] = useState<string | null>(() =>
    opts.pick === true ? fx.pick : typeof opts.pick === "string" ? opts.pick : null,
  )
  const [settingsOpen, setSettingsOpen] = useState(opts.settings)
  const [roster, setRoster] = useState(true)
  const [chronicle, setChronicle] = useState(true)
  const [phoneSheet, setPhoneSheet] = useState(opts.sheet)
  const [about, setAbout] = useState(false)
  const [scale, setScale] = useState<TimeScale>(fx.historyUnavailable ? "session" : opts.scale)
  const [time, setTime] = useState(fx.time)
  const [historyAt, setHistoryAt] = useState(fx.historyAt)
  const [playing, setPlaying] = useState(false)
  const [values, setValues] = useState<SettingsValues>({
    names: "world",
    pace: 1,
    director: true,
    quality: "auto",
    qualityNow: "high",
    hud: opts.hud,
    captions: false,
    directorStyle: "cinematic",
    time: "story",
    weather: "auto",
  })
  const [following, setFollowing] = useState<string | null>(null)
  const { portraitOf } = usePortraits()
  const gear = useRef<HTMLButtonElement>(null)
  const seen = useRef(new Map<string, number>())
  const [, tick] = useState(0)

  // a new fixture: its own clock, pick and scale
  useEffect(() => {
    setTime(fx.time)
    setHistoryAt(fx.historyAt)
    setSelected((s) => (s && fx.heroes.some((h) => h.id === s) ? s : null))
    if (fx.historyUnavailable) setScale("session")
    seen.current.clear()
  }, [fx])

  // the lab's clock: plays the session (or history) at the chosen pace
  useEffect(() => {
    if (!playing || opts.still) return
    const id = setInterval(() => {
      if (scale === "session") setTime((t) => Math.min(fx.session.end, t + 250 * values.pace))
      else setHistoryAt((t) => Math.min(HISTORY.end, t + 86_400_000 * 3 * values.pace))
    }, 250)
    return () => clearInterval(id)
  }, [playing, scale, fx, values.pace, opts.still])

  // toasts fade on the wall clock: re-render while any is alive
  const toasts = opts.still
    ? fx.log.filter((e) => e.kind !== "deed" && e.kind !== "thought").slice(-3)
    : pickToasts(fx.log, performance.now(), seen.current)
  useEffect(() => {
    if (opts.still || toasts.length === 0) return
    const id = setTimeout(() => tick((n) => n + 1), 250)
    return () => clearTimeout(id)
  })

  const cycle = useCallback(() => {
    setMode((m) => {
      const order = phone ? MODES.filter((x) => x !== "detailed") : MODES
      const next =
        order[(order.indexOf(m === "detailed" && phone ? "minimal" : m) + 1) % order.length] ?? "minimal"
      setValues((v) => ({ ...v, hud: next }))
      return next
    })
  }, [phone])

  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
    requestAnimationFrame(() => gear.current?.focus())
  }, [])

  // H cycles the HUD; Esc unwinds one layer (settings, then the dossier)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target
      if (t instanceof HTMLInputElement && t.type !== "range") return
      if (t instanceof HTMLElement && /textarea|select/i.test(t.tagName)) return
      if (e.key === "h" || e.key === "H") cycle()
      else if (e.key === "Escape") {
        if (settingsOpen) closeSettings()
        else if (phone && phoneSheet) setPhoneSheet(null)
        else if (selected) setSelected(null)
        else if (mode === "hidden") setMode("minimal")
      }
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [cycle, closeSettings, settingsOpen, selected, mode, phone, phoneSheet])

  const hero = selected ? fx.heroes.find((h) => h.id === selected) : undefined
  const story = hero ? (fx.dossiers[hero.id] ?? plainDossier(hero)) : undefined
  const pleas = fx.pleas.length
  const hidden = shown === "hidden"
  const listSheet = phone && !hero && !settingsOpen ? phoneSheet : null
  const sheet = Boolean(hero) || settingsOpen || listSheet !== null
  const deeds = fx.log.filter((e) => e.kind === "deed").length
  const detailed = shown === "detailed"
  const pick = (id: string | null) => {
    setSelected(id)
    if (id && phone) {
      setSettingsOpen(false)
      setPhoneSheet(null)
    }
  }

  return (
    <div className="lab-hud" data-mode={shown} data-phone={phone} data-sheet={sheet}>
      {!hidden && (
        <div className="lab-left">
          <BrandCard
            name={fx.name}
            source={fx.source}
            figures={{ heroes: fx.heroes.length, places: fx.places, deeds }}
            pleas={pleas}
            open={about}
            onToggle={() => setAbout((o) => !o)}
            onRetry={() => setState("busy")}
            about={
              <>
                <p>
                  Events in. A living world out. Agents' sessions, commits, PRs and CI move heroes to the
                  places their files belong to.
                </p>
                <p className="hud-faint">This page is the HUD lab: fixtures, no world.</p>
              </>
            }
          />
          {detailed && roster ? (
            <Roster
              heroes={fx.heroes}
              parties={fx.parties}
              by={opts.by}
              following={following}
              selected={selected}
              look="portrait"
              portraitOf={portraitOf}
              onCamera={fx.heroes[0]?.id ?? null}
              open
              compact
              onToggle={() => setRoster(false)}
              onPick={pick}
              className="lab-roster"
            />
          ) : (
            <>
              <PartyTabs
                parties={fx.parties}
                heroes={fx.heroes}
                following={following}
                onFollow={setFollowing}
                compact={phone}
              />
              <RosterBadges
                heroes={fx.heroes}
                parties={fx.parties}
                following={following}
                selected={selected}
                onPick={pick}
                look="portrait"
                portraitOf={portraitOf}
                onExpand={() => {
                  if (phone) return setPhoneSheet("roster")
                  setRoster(true)
                  if (!detailed) setMode("detailed")
                }}
              />
            </>
          )}
        </div>
      )}

      {!hidden && (
        <div className="lab-pleas">
          <Pleas pleas={fx.pleas} parties={fx.parties} onOpen={pick} />
        </div>
      )}

      {opts.ffwd > 1 && (
        <div className="lab-ffwd">
          <FastForwardChip rate={opts.ffwd * values.pace} skip={opts.ffwd} />
        </div>
      )}

      <div className="lab-tools">
        {hidden ? (
          <ShowHudPill onShow={cycle} pleas={pleas} />
        ) : (
          <button
            type="button"
            className="ui-icon-btn"
            data-plaque=""
            onClick={cycle}
            aria-label={`HUD: ${shown}. Switch (H)`}
            title={`HUD: ${shown} · H`}
          >
            {shown === "minimal" ? <Glyphs.minimal size={18} /> : <Glyphs.detailed size={18} />}
          </button>
        )}
        {!hidden && (
          <button
            ref={gear}
            type="button"
            className="ui-icon-btn"
            data-plaque=""
            aria-label="Settings"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            onClick={() => (settingsOpen ? closeSettings() : setSettingsOpen(true))}
          >
            <Glyphs.gear size={18} />
          </button>
        )}
      </div>

      {!hidden && (
        <div className="lab-right">
          {listSheet === "roster" ? (
            <Roster
              heroes={fx.heroes}
              parties={fx.parties}
              by={opts.by}
              selected={selected}
              open
              compact
              onToggle={() => setPhoneSheet(null)}
              onPick={pick}
              className="hud-sheet"
            />
          ) : listSheet === "chronicle" ? (
            <ChronicleFeed
              entries={fx.log}
              time={time}
              parties={fx.parties}
              open
              compact
              onToggle={() => setPhoneSheet(null)}
              onPick={pick}
              className="hud-sheet"
            />
          ) : settingsOpen ? (
            <SettingsPanel
              className="hud-sheet"
              values={{ ...values, hud: shown }}
              onChange={(patch) => {
                setValues((v) => ({ ...v, ...patch }))
                if (patch.hud) setMode(patch.hud)
              }}
              onClose={closeSettings}
              onRepo={() => undefined}
              weatherNow="Cloudy · 14°C"
              sound={<SoundSettings />}
              hourNow={14.1}
              dev={
                opts.dev ? (
                  <Segmented
                    label="Fixture"
                    value={state}
                    options={STATES.map((s) => ({ value: s, label: s[0]?.toUpperCase() + s.slice(1) }))}
                    onChange={(s) => {
                      setState(s as LabState)
                      opts.onState(s as LabState)
                    }}
                  />
                ) : undefined
              }
            />
          ) : (
            hero &&
            story && (
              <Dossier
                className="hud-sheet"
                hero={hero}
                party={fx.parties.length > 1 ? fx.parties.find((p) => p.id === hero.party) : undefined}
                quest={story.quest || undefined}
                ledger={story.ledger}
                model={story.model}
                files={story.files}
                transcript={story.transcript}
                portrait={portraitOf(hero)}
                onClose={() => setSelected(null)}
              />
            )
          )}
        </div>
      )}

      {!hidden && (
        <div className="lab-bottom-left">
          {detailed && chronicle ? (
            <ChronicleFeed
              entries={fx.log}
              time={time}
              parties={fx.parties}
              open
              compact
              onToggle={() => setChronicle(false)}
              onPick={pick}
              className="lab-chronicle"
            />
          ) : (
            <Toasts
              items={toasts}
              time={time}
              parties={fx.parties}
              onPick={pick}
              onExpand={() => {
                if (phone) return setPhoneSheet("chronicle")
                setChronicle(true)
                if (!detailed) setMode("detailed")
              }}
              quiet={values.captions}
            />
          )}
        </div>
      )}

      {!hidden && <StoryLab {...opts.story} phone={phone} cast={fx.heroes} still={opts.still} />}

      {!hidden && (
        <div className="lab-bottom">
          <Timeline
            scale={scale}
            onScale={setScale}
            start={scale === "history" ? HISTORY.start : 0}
            end={scale === "history" ? HISTORY.end : fx.session.end}
            at={scale === "history" ? historyAt : time}
            markers={scale === "history" ? HISTORY_MARKERS : fx.session.marks}
            playing={playing}
            onPlay={setPlaying}
            onSeek={(t) => (scale === "history" ? setHistoryAt(t) : setTime(t))}
            live={fx.session.live}
            onLive={() => setTime(fx.session.end)}
            historyUnavailable={fx.historyUnavailable}
            pinned={detailed || phone}
          />
        </div>
      )}
    </div>
  )
}
