import type { CatalogEntry, CatalogIndex, RigEntry } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { createStage, createViewer, type Overlay, type Stage, type Viewer } from "@guildhall/render"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { libraryUrl } from "../catalog.ts"
import type { ScreenCtx } from "../screens.ts"
import { AnimationPanel } from "./Animation.tsx"
import { clipSearch, defaultClip, isCharacter, parseClipLink } from "./clips.ts"
import { createPlayer, type Player } from "./player.ts"
import { showCharacter } from "./stand.ts"
import { describe, type Row } from "./stats.ts"

const logger = log("studio:viewer")

type Toggle = keyof Overlay
const TOOLS: { key: Toggle; label: string }[] = [
  { key: "doorBand", label: "door band" },
  { key: "hero", label: "hero" },
  { key: "grid", label: "grid" },
]
const START: Overlay = { grid: true, hero: true, doorBand: true }
/**
 * The viewer frames from the +x side, where a deep piece hides the hero (it stands left of the
 * origin): the inspector looks from the hero's side instead, so the 2.2 m reference is always in view.
 */
const HERO_SIDE = -50

/** Frames what the viewer shows, from the hero's side. */
function aim(viewer: Viewer, stage: Stage): void {
  viewer.frame()
  stage.setCamera({ ...stage.getCamera(), azimuth: HERO_SIDE })
}

function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="gh-kv">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd className={row.placeholder ? "ph" : undefined}>
            {row.value}
            {row.unit && <small>{row.unit}</small>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="gh-sec">
      <p className="gh-eyebrow">{title}</p>
      {children}
    </section>
  )
}

function Stats({ entry, children }: { entry: CatalogEntry; children?: ReactNode }) {
  const d = describe(entry)
  const flags = [
    ...d.scaleFlags.map((f) => ({ f, tone: "scale" })),
    ...d.pieceFlags.map((f) => ({ f, tone: "piece" })),
  ]
  return (
    <div className="gh-stats">
      {children}
      <Section title="Size">
        <Rows rows={d.size} />
      </Section>
      <Section title={`Swatches · ${d.swatches.length}`}>
        <div className="gh-swatches">
          {d.swatches.map((s) => (
            <span key={s.id} className="gh-sw" title={`${s.id} ${s.name} ${s.hex}`}>
              <i style={{ background: s.hex }} />
              {s.name}
            </span>
          ))}
        </div>
      </Section>
      <Section title="Scale">
        <Rows rows={d.scale} />
        <div className="gh-flags" style={{ marginTop: 8 }}>
          {flags.length === 0 ? (
            <span className="gh-flag" data-tone="ok">
              no flags
            </span>
          ) : (
            flags.map(({ f, tone }) => (
              <span key={f} className="gh-flag" data-tone={tone}>
                {f}
              </span>
            ))
          )}
        </div>
      </Section>
      <Section title="Compose">
        <Rows rows={d.compose} />
      </Section>
      {d.character.length > 0 && (
        <Section title="Character">
          <Rows rows={d.character} />
        </Section>
      )}
    </div>
  )
}

/** Starts a new character on the clip the deep link asks for, when it has it, else on its idle. */
function start(player: Player, link: ReturnType<typeof parseClipLink>): void {
  const asked = link.clip && player.clips.includes(link.clip) ? link.clip : null
  const clip = asked ?? defaultClip(player.clips)
  if (clip) player.play(clip, asked && link.t !== undefined ? { t: link.t } : {})
}

/**
 * The piece panel: an orbit viewer (1 m grid, the 2.2 m hero beside the piece, the door-top band) over
 * the entry's stats. A character plays its rig's clips, with the player above its stats. It owns the
 * screen's stage, so it is mounted for the screen's whole life.
 */
export function Inspector({
  entry,
  ctx,
  packs,
  rig,
  onStage,
  onPlayer,
}: {
  entry: CatalogEntry | null
  ctx: ScreenCtx
  /** The library's packs, summarised while nothing is selected. */
  packs: CatalogIndex["packs"]
  /** Lends the stage out (the grid draws its previews on its renderer); null once it is gone. */
  onStage(stage: Stage | null): void
  /** A rig by id (`catalog.rig`), for a character's clips. */
  rig(id: string): RigEntry | undefined
  /** Lends the player out (`ext.studio.play`) while a character is shown; null otherwise. */
  onPlayer(player: Player | null): void
}) {
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const staged = useRef<Stage | null>(null)
  const [overlay, setOverlay] = useState<Overlay>(START)
  const [player, setPlayer] = useState<Player | null>(null)
  // The deep link's `&clip=`/`&t=` apply to the piece it opened on, once.
  const link = useRef<URLSearchParams | null>(ctx.query)

  useEffect(() => {
    if (!host.current) return
    const stage = createStage(host.current)
    ctx.attach(stage)
    const created = createViewer(stage, { overlay: START })
    aim(created, stage)
    viewer.current = created
    staged.current = stage
    onStage(stage)
    return () => {
      onStage(null)
      viewer.current = null
      staged.current = null
      created.dispose()
      stage.dispose()
    }
  }, [ctx, onStage])

  useEffect(() => {
    const shown = viewer.current
    const stage = staged.current
    if (!shown || !stage) return
    const opened = link.current && link.current.get("id") === entry?.id ? link.current : null
    if (!opened) link.current = null
    if (!entry) {
      shown.clear()
      aim(shown, stage)
      return
    }
    const asked = opened ? parseClipLink(opened) : { clip: null }
    const rigId = isCharacter(entry) ? entry.character?.rig : undefined
    const rigEntry = rigId ? rig(rigId) : undefined
    if (rigId && !rigEntry) logger.warn("no such rig: shown unanimated", { id: entry.id, rig: rigId })
    let live = true
    let made: Player | null = null
    const animate = async (r: RigEntry) => {
      const ch = await showCharacter(shown, stage, entry, r, () => live)
      if (!ch || !live) return
      made = createPlayer(stage, ch)
      start(made, asked)
      link.current = null
      setPlayer(made)
      onPlayer(made)
    }
    const work = rigEntry ? animate(rigEntry) : shown.show(entry, libraryUrl(entry.files.glb))
    ctx
      .load(work.then(() => live && aim(shown, stage)))
      .catch((error: unknown) => logger.error("show failed", { id: entry.id, error: String(error) }))
    return () => {
      live = false
      made?.dispose()
      setPlayer(null)
      onPlayer(null)
    }
  }, [entry, ctx, rig, onPlayer])

  // The deep link follows the player: `&clip=` while a character is shown, `&t=` while it is paused.
  useEffect(() => {
    const write = () => {
      const search = clipSearch(new URLSearchParams(location.search), player?.state() ?? null)
      if (search !== location.search) history.replaceState(null, "", search)
    }
    write()
    if (!player) return
    let last = ""
    return player.subscribe((s) => {
      const key = `${s.clip}|${s.playing}|${s.playing ? "" : s.t}`
      if (key === last) return
      last = key
      write()
    })
  }, [player])

  const toggle = (key: Toggle) => {
    const next = { ...overlay, [key]: !overlay[key] }
    setOverlay(next)
    viewer.current?.setOverlay(next)
  }

  return (
    <aside className="gh-panel gh-inspector" aria-label="Piece">
      <header className="gh-ins-head">
        <p className="gh-eyebrow">{entry ? `${entry.pack} · ${entry.category} · ${entry.kind}` : "Piece"}</p>
        <h2>{entry ? entry.name : "Nothing selected"}</h2>
        <div className="id">{entry ? entry.id : "the hero stands at 2.2 m; the band marks door tops"}</div>
      </header>
      <div className="gh-stage">
        <div ref={host} className="gh-stage-host" />
        <div className="gh-tools">
          {TOOLS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className="gh-tool"
              aria-pressed={overlay[key]}
              onClick={() => toggle(key)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="gh-tool"
            onClick={() => viewer.current && staged.current && aim(viewer.current, staged.current)}
          >
            frame
          </button>
        </div>
        <div className="gh-hint">drag orbit · right-drag pan · wheel zoom</div>
      </div>
      {entry ? (
        <Stats entry={entry}>{player && <AnimationPanel player={player} />}</Stats>
      ) : (
        <div className="gh-stats">
          <Section title="Library">
            <p className="gh-lead">
              <span className="num">{packs.reduce((n, p) => n + p.count, 0).toLocaleString("en-US")}</span>{" "}
              pieces in <span className="num">{packs.length}</span> packs. Pick a tile to stand it beside the
              hero.
            </p>
            <dl className="gh-kv">
              {packs.map((p) => (
                <div key={p.id}>
                  <dt>
                    {p.id} <small>{p.vendor}</small>
                  </dt>
                  <dd>{p.count.toLocaleString("en-US")}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>
      )}
    </aside>
  )
}
