/**
 * The HUD kit board (`/lab/hud?kit=<section>`): each V1-parity piece alone on its fixtures, one section a
 * screen, for side-by-side shots against V1 (desktop and phone). Sections: `avatars` (the three variants
 * and every expression), `badges` (the folded roster, party tabs), `roster` (rows with portraits),
 * `toasts`, `captions`, `acts` (the corner act chip, open), `timeline` (the hairline and the bar),
 * `settings`, `chips` (Show HUD · H, fast-forward), or `all`.
 */
import {
  Avatar,
  type AvatarVariant,
  Captions,
  type CaptionView,
  ChapterChip,
  type ChronicleEntry,
  FAMILIES,
  FastForwardChip,
  type HeroView,
  PartyTabs,
  type Phase,
  Roster,
  RosterBadges,
  SettingsPanel,
  type SettingsValues,
  ShowHudPill,
  Timeline,
  Toasts,
} from "@guildhall/ui"
import { type CSSProperties, Fragment, type ReactNode, useEffect, useState } from "react"
import { SoundSettings } from "../audio/ui.tsx"
import { fixture, PARTY, REDIS } from "./fixtures.ts"
import { usePortraits } from "./portraits.ts"
import { captionOf, type Told, tell } from "./story.ts"

export const KIT_SECTIONS = [
  "avatars",
  "badges",
  "roster",
  "toasts",
  "captions",
  "acts",
  "timeline",
  "settings",
  "chips",
] as const
export type KitSection = (typeof KIT_SECTIONS)[number] | "all"

/** The avatar board's six (the mock's): two at work, a plea, a fall, loot (picked), one idle. */
const SIX: readonly HeroView[] = [
  {
    id: "gm",
    name: "Guildmaster",
    banner: "#d4ad3a",
    family: "mage",
    phase: "working",
    master: true,
    party: "pagination",
  },
  {
    id: "architect",
    name: "Architect",
    banner: "#4f8fd6",
    family: "knight",
    phase: "working",
    party: "pagination",
  },
  {
    id: "query",
    name: "Artisan",
    banner: "#e0702f",
    family: "barbarian",
    phase: "waiting",
    ordinal: 2,
    party: "pagination",
  },
  { id: "verifier", name: "Warden", banner: "#3fae6b", family: "rogue", phase: "failed", party: "redis" },
  { id: "explorer", name: "Scout", banner: "#2fa7a0", family: "ranger", phase: "loot", party: "redis" },
  { id: "archivist", name: "Archivist", banner: "#8b6cd9", family: "mage", phase: "idle", party: "redis" },
]
const PHASES: readonly Phase[] = ["working", "waiting", "failed", "loot", "idle", "leaving"]
const PHASE_WORD: Record<Phase, string> = {
  working: "thinking",
  waiting: "plea",
  failed: "failed",
  loot: "loot",
  idle: "idle",
  resting: "idle",
  leaving: "calm",
}
const FAMILY_BANNER = {
  mage: "#8b6cd9",
  knight: "#4f8fd6",
  ranger: "#2fa7a0",
  barbarian: "#e0702f",
  rogue: "#3fae6b",
}

const SETTINGS: SettingsValues = {
  names: "world",
  pace: 1,
  director: true,
  directorStyle: "cinematic",
  quality: "auto",
  qualityNow: "medium",
  hud: "minimal",
  captions: true,
  time: "story",
  weather: "auto",
}

function Card({
  title,
  note,
  wide,
  children,
}: {
  title: string
  note?: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <section className="kit-card" data-wide={wide ?? false}>
      <h2>{title}</h2>
      {note && <p className="kit-note">{note}</p>}
      <div className="kit-body">{children}</div>
    </section>
  )
}

function AvatarRow({
  variant,
  size,
  portraitOf,
}: {
  variant: AvatarVariant
  size: number
  portraitOf: (h: HeroView) => string | null
}) {
  return (
    <div className="kit-row">
      {SIX.map((h) => (
        <figure key={h.id}>
          <Avatar
            variant={variant}
            hero={h}
            size={size}
            session="session-7f3a"
            src={variant === "portrait" ? portraitOf(h) : undefined}
            label={`${h.name}, ${PHASE_WORD[h.phase]}`}
          />
          <figcaption>
            {h.name}
            {h.ordinal ? " II" : ""}
            <br />
            {PHASE_WORD[h.phase]}
          </figcaption>
        </figure>
      ))}
    </div>
  )
}

export function KitLab({ section, phone }: { section: KitSection; phone: boolean }) {
  const show = (s: KitSection) => section === "all" || section === s
  const { portraitOf, stats } = usePortraits(show("avatars") || show("roster"))
  const [saga, setSaga] = useState<Told | undefined>()
  const [following, setFollowing] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>("explorer")
  const [values, setValues] = useState(SETTINGS)
  const [act, setAct] = useState(2)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!show("captions") && !show("acts")) return
    let live = true
    void tell("saga").then((t) => live && setSaga(t))
    return () => {
      live = false
    }
  })
  // the portrait budget, read back while they land
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [])
  // every long task (> 50 ms) once the board is up: the library's parse included, which `stats` cannot see
  const [longest, setLongest] = useState(0)
  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return
    const from = performance.now() + 300
    const watch = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.startTime > from) setLongest((m) => Math.max(m, e.duration))
    })
    try {
      watch.observe({ type: "longtask", buffered: false })
    } catch {
      return
    }
    return () => watch.disconnect()
  }, [])

  const plea = fixture("plea")
  const toastItems: ChronicleEntry[] = [
    ...plea.log.filter((e) => e.kind !== "deed" && e.kind !== "thought").slice(-2),
  ]
  const fail = fixture("error").log.find((e) => e.kind === "fail")
  if (fail) toastItems.unshift(fail)
  const caption = (kind: string): CaptionView | undefined => (saga ? captionOf(saga, kind) : undefined)
  const s = stats()

  return (
    <div className="kit" data-phone={phone}>
      {show("avatars") && (
        <>
          <Card
            title="C · Face (badge bar)"
            note="Chibi face per body family; the expression follows the phase: thinking eyes up, plea sweat drop, failed X eyes, loot grin, idle zzz. Rim: plea, fail, loot tones; else the banner."
            wide
          >
            <AvatarRow variant="face" size={phone ? 44 : 60} portraitOf={portraitOf} />
            <div className="kit-grid" style={{ "--cols": PHASES.length + 1 } as CSSProperties}>
              <span />
              {PHASES.map((p) => (
                <b key={p}>{PHASE_WORD[p]}</b>
              ))}
              {FAMILIES.map((f) => (
                <Fragment key={f}>
                  <b>{f}</b>
                  {PHASES.map((p) => (
                    <Avatar
                      key={`${f}-${p}`}
                      variant="face"
                      size={phone ? 34 : 44}
                      hero={{ id: `${f}-seed`, family: f, banner: FAMILY_BANNER[f], phase: p }}
                    />
                  ))}
                </Fragment>
              ))}
            </div>
          </Card>
          <Card
            title="A · Portrait (roster rows, dossier)"
            note={`The hero's own KayKit figure, rendered once off the frame's path (render portrait.ts, 96 px, cached per body + tint + props). ${
              s
                ? `${s.drawn} drawn · longest main-thread slice ${s.worstSliceMs.toFixed(1)} ms (${Object.entries(
                    s.worst,
                  )
                    .map(([k, v]) => `${k} ${v.toFixed(1)}`)
                    .join(", ")}; last: ${Object.entries(s.last)
                    .map(([k, v]) => `${k} ${v.toFixed(1)}`)
                    .join(", ")})`
                : "No library: the face stands in."
            } Long tasks while drawing: ${longest > 0 ? `${longest.toFixed(0)} ms` : "none"}.`}
            wide
          >
            <AvatarRow variant="portrait" size={phone ? 44 : 60} portraitOf={portraitOf} />
          </Card>
          <Card
            title="B · Shield (the shareable card)"
            note="Tincture = the banner, division seeded by the session id, charge per family (star, cross, bow, axe, key)."
            wide
          >
            <AvatarRow variant="shield" size={phone ? 44 : 60} portraitOf={portraitOf} />
          </Card>
        </>
      )}

      {show("badges") && (
        <Card
          title="The Guild, folded"
          note="V1's slim bar: a face per hero, tone marks (plea, fail, loot), the pick ringed, ⤢ unfolds. Several parties: the switcher above, a banner per group."
          wide
        >
          <div className="kit-stack">
            <RosterBadges
              heroes={SIX.slice(0, 3)}
              selected="gm"
              onPick={() => undefined}
              onExpand={() => undefined}
            />
            <PartyTabs
              parties={[PARTY, REDIS]}
              heroes={SIX}
              following={following}
              onFollow={setFollowing}
              compact={phone}
            />
            <RosterBadges
              heroes={SIX}
              parties={[PARTY, REDIS]}
              following={following}
              selected={picked}
              onPick={setPicked}
              onExpand={() => undefined}
            />
          </div>
        </Card>
      )}

      {show("roster") && (
        <Card title="Roster rows with portraits" note="A in the rows (the face until the sprite lands).">
          <Roster
            heroes={SIX}
            parties={[PARTY, REDIS]}
            open
            compact
            selected={picked}
            onPick={setPicked}
            portraitOf={portraitOf}
            onToggle={() => undefined}
          />
        </Card>
      )}

      {show("toasts") && (
        <Card
          title="Toasts"
          note="V1: ink plaques, a diamond in the hero's banner, the name bold; pleas and failures with a tone bar."
        >
          <div className="kit-bottom">
            <Toasts
              items={toastItems}
              time={plea.time}
              parties={[PARTY, REDIS]}
              onPick={() => undefined}
              onExpand={() => undefined}
            />
          </div>
        </Card>
      )}

      {show("captions") && (
        <Card
          title="Captions"
          note="V1's pill: 19 px serif, a diamond in the beat's tone, two balanced lines at most within 576 px."
          wide
        >
          <div className="kit-captions">
            {(["quest", "long", "plea", "fall", "chapter"] as const).map((kind) => (
              <div key={kind} className="kit-caption">
                <Captions caption={caption(kind)} still />
              </div>
            ))}
          </div>
        </Card>
      )}

      {show("acts") && saga && (
        <Card
          title="The act chip"
          note="Bottom right; the act list opens upward: numeral, small-caps title, italic tagline, a brass bracket on the act playing."
        >
          <div className="kit-corner">
            <ChapterChip chapters={saga.chapters} current={act} onJump={setAct} open compact={phone} />
          </div>
        </Card>
      )}

      {show("timeline") && (
        <Card
          title="Timeline"
          note="Minimal: a 180×6 hairline of progress; hover, focus or tap opens the bar."
          wide
        >
          <div className="kit-tl">
            <Timeline
              scale="session"
              start={0}
              end={plea.session.end}
              at={plea.time}
              markers={plea.session.marks}
              playing={false}
              onPlay={() => undefined}
              onSeek={() => undefined}
              pinned={false}
            />
          </div>
          <div className="kit-tl">
            <Timeline
              scale="session"
              start={0}
              end={plea.session.end}
              at={plea.time}
              markers={plea.session.marks}
              playing
              onPlay={() => undefined}
              onSeek={() => undefined}
              rate={1}
              onRate={() => undefined}
            />
          </div>
        </Card>
      )}

      {show("settings") && (
        <Card
          title="Settings"
          note="V1's order: Your repo, Quality, the Director's controls (pace, the hour and weather, the Bard), Camera, Sound (a slot), Display."
        >
          <div className="kit-settings">
            <SettingsPanel
              values={values}
              onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
              onClose={() => undefined}
              onRepo={() => undefined}
              weatherNow="Cloudy · 14°C"
              hourNow={14.1}
              sound={<SoundSettings />}
            />
          </div>
        </Card>
      )}

      {show("chips") && (
        <Card
          title="Show HUD · H, fast-forward"
          note="The Hidden HUD keeps one way back (a plea dot when someone waits); the fast-forward chip shows while a replay skips a quiet stretch."
        >
          <div className="kit-row">
            <ShowHudPill onShow={() => undefined} />
            <ShowHudPill onShow={() => undefined} pleas={1} />
            <FastForwardChip rate={3.2} skip={3.2} />
          </div>
        </Card>
      )}
    </div>
  )
}
