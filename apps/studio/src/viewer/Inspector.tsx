import type { CatalogEntry, CatalogIndex } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { createStage, createViewer, type Overlay, type Stage, type Viewer } from "@guildhall/render"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { libraryUrl } from "../catalog.ts"
import type { ScreenCtx } from "../screens.ts"
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

function Stats({ entry }: { entry: CatalogEntry }) {
  const d = describe(entry)
  const flags = [
    ...d.scaleFlags.map((f) => ({ f, tone: "scale" })),
    ...d.pieceFlags.map((f) => ({ f, tone: "piece" })),
  ]
  return (
    <div className="gh-stats">
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

/**
 * The piece panel: an orbit viewer (1 m grid, the 2.2 m hero beside the piece, the door-top band) over
 * the entry's stats. It owns the screen's stage, so it is mounted for the screen's whole life.
 */
export function Inspector({
  entry,
  ctx,
  packs,
  onStage,
}: {
  entry: CatalogEntry | null
  ctx: ScreenCtx
  /** The library's packs, summarised while nothing is selected. */
  packs: CatalogIndex["packs"]
  /** Lends the stage out (the grid draws its previews on its renderer); null once it is gone. */
  onStage(stage: Stage | null): void
}) {
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const staged = useRef<Stage | null>(null)
  const [overlay, setOverlay] = useState<Overlay>(START)

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
    if (!entry) {
      shown.clear()
      aim(shown, stage)
      return
    }
    ctx
      .load(shown.show(entry, libraryUrl(entry.files.glb)).then(() => aim(shown, stage)))
      .catch((error: unknown) => logger.error("show failed", { id: entry.id, error: String(error) }))
  }, [entry, ctx])

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
        <Stats entry={entry} />
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
