/**
 * A repo's hall HUD in history mode (plan-hud-events H1, decisions.md "HUD stays light"): V1's layout on
 * the Viewer's HUD regions, fed from the repo's chronicle. The Brand top-left (under the site's crest),
 * the icon rail top-right, the Chronicle folded to a chip bottom-left, a place's Dossier and Settings
 * in the right-hand sheet, and the bottom-centre left free for the timeline. Minimal by default, one
 * panel at a time, H cycles the mode; on a phone every panel is the one bottom sheet.
 */
import type { CameraPose } from "@guildhall/core"
import type { Chronicle, RepoLegend, RepoRecap } from "@guildhall/sim"
import {
  BrandCard,
  Button,
  ChronicleCard,
  ChronicleFeed,
  FoldPanel,
  Glyphs,
  type HudState,
  Kbd,
  LegendsBook,
  PlaceDossier,
  type RecapView,
  Segmented,
  Slider,
  StoryGlyphs,
  Toasts,
  Toggle,
  type ViewerHud,
} from "@guildhall/ui"
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import type { HudParts } from "../../hexworld/index.ts"
import type { BuiltPlace } from "../../hexworld/job.ts"
import { clock as hourOf } from "../../hexworld/knobs.ts"
import { captureStage } from "../../shell/viewer.ts"
import {
  brandOf,
  feedOf,
  feedPick,
  feedStamp,
  monthOf,
  type PlaceRow,
  placeDossier,
  placeOfUnit,
  placeRows,
} from "./view.ts"

/** The panels the HUD remembers open or folded between visits. */
export const REMEMBERED = ["places", "chronicle"] as const

export interface HallHudProps {
  hud: ViewerHud
  /** Where the dialogs (the Legends, the card) are drawn: over the whole page. */
  modals: HTMLElement
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
}

const useHud = (hud: ViewerHud): HudState => useSyncExternalStore(hud.subscribe, hud.state)
const usePhone = (hud: ViewerHud): boolean => useSyncExternalStore(hud.subscribe, hud.phone)

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

/** The DPR each quality tier pins (Auto: the governor's own, from where the stage started). */
const QUALITY: Record<string, number | null> = { auto: null, low: 1, medium: 1.5, high: 2 }

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

function Settings({
  hud,
  mode,
  parts,
  onClose,
}: {
  hud: ViewerHud
  mode: HudState["mode"]
  parts: HallHudProps["parts"]
  onClose: () => void
}) {
  const head = useRef<HTMLHeadingElement>(null)
  const [plates, setPlates] = useState(() => parts.labels?.shown() ?? false)
  const [hour, setHour] = useState(() => parts.clock.get())
  const [quality, setQuality] = useState(() => sessionQuality)
  useEffect(() => head.current?.focus(), [])
  return (
    <aside className="ui-panel hud-settings" role="dialog" aria-labelledby="hall-settings-h">
      <header className="hud-settings-head">
        <h2 id="hall-settings-h" ref={head} tabIndex={-1}>
          Settings
        </h2>
        <button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close settings (Esc)">
          <Glyphs.close />
        </button>
      </header>
      <div className="hud-settings-body">
        <section className="hud-set-section">
          <h3 className="ui-section-head">Display</h3>
          <Segmented
            label="HUD (press H)"
            value={mode}
            options={[
              { value: "detailed", label: "Detailed" },
              { value: "minimal", label: "Minimal" },
              { value: "hidden", label: "Hidden" },
            ]}
            onChange={(v) => hud.dispatch({ type: "mode", mode: v as HudState["mode"] })}
          />
          {parts.labels && (
            <Toggle
              label="Name plates"
              hint="Each place's name over the island; click one to open it"
              checked={plates}
              onChange={(on) => {
                parts.labels?.show(on)
                setPlates(on)
              }}
            />
          )}
        </section>
        <section className="hud-set-section">
          <h3 className="ui-section-head">World</h3>
          <Slider
            label="Time of day"
            value={hour}
            min={0}
            max={24}
            step={0.25}
            format={hourOf}
            onChange={(h) => {
              parts.clock.set(h)
              setHour(h)
            }}
          />
        </section>
        <section className="hud-set-section">
          <h3 className="ui-section-head">Quality</h3>
          <Segmented
            label="Sharpness"
            value={quality}
            options={[
              { value: "auto", label: "Auto" },
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
            ]}
            onChange={(v) => {
              sessionQuality = v
              setQuality(v)
              const dpr = QUALITY[v] ?? startDpr
              if (dpr) parts.stage.setDpr(Math.min(dpr, devicePixelRatio || 1) || dpr)
            }}
          />
          <p className="ui-hint">
            {quality === "auto"
              ? "Trades sharpness for a smooth frame rate as it goes."
              : "Pinned for this visit. Low is lightest on a phone or an old laptop."}
          </p>
        </section>
        <section className="hud-set-section">
          <h3 className="ui-section-head">Camera</h3>
          <dl className="hall-keys">
            {KEYS.map(([k, what]) => (
              <div key={k}>
                <dt>
                  <Kbd>{k}</Kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </aside>
  )
}

const KEYS: readonly (readonly [string, string])[] = [
  ["Drag", "Turn · one finger on a phone"],
  ["Right-drag", "Pan · two fingers"],
  ["Wheel", "Zoom · pinch"],
  ["Click a name", "Open the place"],
  ["H", "Detailed / Minimal / Hidden"],
  ["Esc", "Fold the open panel"],
]

let sessionQuality = "auto"
let startDpr: number | null = null

export function HallHud(props: HallHudProps) {
  const { hud, parts, slug, chronicle, legend, recap } = props
  const state = useHud(hud)
  const phone = usePhone(hud)
  const [picked, setPicked] = useState<number | null>(null)
  const [brandOpen, setBrandOpen] = useState(false)
  const [frame, setFrame] = useState<string | undefined>()
  const sheetRef = useRef<HTMLDivElement>(null)
  startDpr ??= parts.stage.stats().dpr

  const brand = useMemo(
    () => brandOf(parts.repo, slug, parts.places.length, chronicle),
    [parts, slug, chronicle],
  )
  const rows = useMemo(() => placeRows(parts.places, parts.repo), [parts])
  const unitAt = useMemo(() => placeOfUnit(parts.places, parts.repo), [parts])
  const feed = useMemo(() => (legend ? feedOf(legend, unitAt) : []), [legend, unitAt])
  const place = picked !== null ? parts.places[picked] : undefined
  const dossier = useMemo(
    () => (place ? placeDossier(place, parts.repo, chronicle, legend) : null),
    [place, parts.repo, chronicle, legend],
  )

  const open = (index: number, from?: string) => {
    const p = parts.places[index]
    if (!p) return
    setPicked(index)
    hud.dispatch({ type: "open", id: "dossier", ...(from ? { from } : {}) })
    parts.stage.rig.glide(poseFor(p, parts.stage.rig.get(), hud.phone() ? "bottom" : "right"), 1100)
  }
  // a plate clicked or tapped in the world opens its place
  // biome-ignore lint/correctness/useExhaustiveDependencies: `open` only reads what is stable (the HUD, the parts)
  useEffect(() => parts.onPick((k) => open(k)), [parts])
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
    if (state.open === "dossier") sheetRef.current?.focus({ preventScroll: true })
    const lost = document.activeElement === document.body || document.activeElement === null
    // back from a place to the list it was opened from: the place's own row
    if (before === "dossier" && state.open === "places" && lost) {
      const row = document.querySelector<HTMLElement>(`.hall-place-row[data-index="${picked}"]`)
      if (row) row.focus()
      else
        document.querySelector<HTMLElement>(".hall-places .hud-panel-head button, .hall-place-row")?.focus()
    } else if (before && !state.open && lost)
      hud.rail
        .querySelector<HTMLElement>(`[data-panel="${before === "dossier" ? "places" : before}"]`)
        ?.focus()
  }, [state.open, hud, picked])
  // the card's picture is the island as it is drawn now
  useEffect(() => {
    if (state.open !== "card") return
    let live = true
    void captureStage(parts.stage).then((url) => live && url && setFrame(url))
    return () => {
      live = false
    }
  }, [state.open, parts.stage])

  const toggle = (id: string) => hud.dispatch({ type: "toggle", id })
  const close = () => hud.dispatch({ type: "close" })
  const hidden = state.mode === "hidden"
  const placesOpen =
    state.open === "places" || (state.open === "dossier" && state.back === "places" && !phone)

  const onFeedPick = (id: string) => {
    const p = feedPick(id)
    if (p?.kind === "place") open(p.index, phone ? "chronicle" : undefined)
    else if (p?.kind === "era") hud.dispatch({ type: "open", id: "legends" })
  }

  const about = (
    <>
      {brand.description && <p>{brand.description}</p>}
      {brand.built && <p className="hall-about-quiet">{brand.built}.</p>}
      {brand.sketch && (
        <p>
          {brand.sketch.why === "not-chronicled"
            ? "A sketch, not this repo's island: there is no chronicle for it yet, so the land is the generator's own at a default size."
            : `A sketch, not this repo's island: its chronicle could not be read${brand.sketch.reason ? ` (${brand.sketch.reason})` : ""}.`}
        </p>
      )}
      <p className="hall-about-links">
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
      </p>
    </>
  )

  const chronicleFeed = (
    <ChronicleFeed
      entries={feed}
      time={0}
      open
      compact
      onToggle={() => toggle("chronicle")}
      onPick={onFeedPick}
      when={monthOf}
      stamp={chronicle ? feedStamp(chronicle) : ""}
      empty="No history: this island is a sketch."
      foot={
        legend ? (
          <>
            <Button size="sm" variant="outline" onClick={() => hud.dispatch({ type: "open", id: "legends" })}>
              <StoryGlyphs.book size={14} />
              Legends by era
            </Button>
            <Button size="sm" variant="secondary" onClick={() => hud.dispatch({ type: "open", id: "card" })}>
              <StoryGlyphs.card size={14} />
              Chronicle card
            </Button>
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

  let sheet: ReactNode = null
  if (state.open === "dossier") sheet = placeSheet
  else if (state.open === "settings")
    sheet = <Settings hud={hud} mode={state.mode} parts={parts} onClose={close} />
  else if (phone && state.open === "places")
    sheet = <PlacesPanel rows={rows} picked={picked} onPick={(k) => open(k, "places")} onClose={close} />
  else if (phone && state.open === "chronicle") sheet = chronicleFeed

  return (
    <>
      {createPortal(
        hidden ? (
          <RailButton
            id="show"
            label="Show the HUD (H)"
            open={false}
            onClick={() => hud.dispatch({ type: "mode", mode: "minimal" })}
          >
            <Glyphs.eye size={18} />
          </RailButton>
        ) : (
          <nav className="hall-rail" aria-label="HUD">
            <RailButton id="places" label="Places" open={placesOpen} onClick={() => toggle("places")}>
              <Glyphs.place size={18} />
            </RailButton>
            <RailButton
              id="chronicle"
              label="Chronicle"
              open={state.open === "chronicle"}
              onClick={() => toggle("chronicle")}
            >
              <Glyphs.quest size={18} />
            </RailButton>
            {legend && (
              <RailButton
                id="legends"
                label="Legends by era"
                open={state.open === "legends"}
                onClick={() => toggle("legends")}
              >
                <StoryGlyphs.book size={18} />
              </RailButton>
            )}
            {recap && (
              <RailButton
                id="card"
                label="Chronicle card"
                open={state.open === "card"}
                onClick={() => toggle("card")}
              >
                <StoryGlyphs.card size={18} />
              </RailButton>
            )}
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
            name={brand.name}
            source={brand.source}
            status={brand.status}
            stats={brand.stats}
            crest={false}
            compact={state.mode !== "detailed" && !brandOpen}
            about={about}
            open={brandOpen}
            onToggle={() => setBrandOpen((v) => !v)}
          />
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
        !phone && state.open === "chronicle" ? (
          chronicleFeed
        ) : (
          <Toasts
            items={[]}
            time={0}
            stamp={chronicle ? feedStamp(chronicle) : "sketch"}
            onExpand={() => toggle("chronicle")}
          />
        ),
        hud.feed,
      )}
      {sheet &&
        createPortal(
          <div
            className="hall-sheet"
            ref={sheetRef}
            tabIndex={-1}
            data-panel={state.open ?? ""}
            data-keepout=""
          >
            {sheet}
          </div>,
          hud.sheet,
        )}
      {state.open === "legends" &&
        legend &&
        createPortal(
          <LegendsBook
            history={{ repo: legend.repo, sessions: [], milestones: [], legend }}
            {...(props.legendMarkdown ? { historyMarkdown: props.legendMarkdown } : {})}
            view="history"
            onCard={recap ? () => hud.dispatch({ type: "open", id: "card", from: "legends" }) : undefined}
            onClose={() => hud.dispatch({ type: "closeAll" })}
          />,
          props.modals,
        )}
      {state.open === "card" &&
        recap &&
        createPortal(
          <ChronicleCard
            recap={recapView(recap)}
            {...(frame ? { image: frame } : {})}
            focus={{ x: 0.5, y: 0.5 }}
            link={`https://${recap.link}`}
            onClose={close}
          />,
          props.modals,
        )}
    </>
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
