/**
 * A place up close (V1's hud/TownDossier.tsx, for a place instead of a townsperson), fed by props: the
 * place's name and kind, the package it stands for, its activity over the session as a sparkline, the
 * heroes there now, its recent deeds and the files touched in it. The right-hand sheet (a bottom sheet
 * on a phone); `collapsed`, it folds to a chip with the place's name and who is there, so the world
 * stays the hero. Esc inside it closes it.
 */
import type { CSSProperties } from "react"
import { clock, heroTitle, phaseOf } from "../format.ts"
import { Glyphs } from "../glyphs.tsx"
import { Sigil, Status } from "../parts.tsx"
import type { HeroView } from "../types.ts"
import type { PlaceDeed, PlaceView } from "./types.ts"

/** Recent deeds shown; the rest are counted. */
export const PLACE_DEEDS_SHOWN = 6
const SPARK = { width: 260, height: 40 }

export interface PlaceDossierProps {
  place: PlaceView
  /** Deeds done here per span of the session, oldest first (any number of spans, ≥ 2 to draw). */
  activity: readonly number[]
  /** What the sparkline spans: `This session, 0:00–1:07`. */
  activityLabel?: string
  /** Heroes at the place now. */
  heroes: readonly HeroView[]
  /** Its deeds, newest last. */
  deeds: readonly PlaceDeed[]
  /** Files of its package touched this session, with how many deeds each. */
  files: readonly { path: string; deeds: number }[]
  /** Folded to its chip. */
  collapsed?: boolean
  onCollapse?: () => void
  onExpand?: () => void
  onClose: () => void
  /** Open a hero's dossier. */
  onHero?: (id: string) => void
  className?: string
}

export function PlaceDossier({
  place,
  activity,
  activityLabel = "This session",
  heroes,
  deeds,
  files,
  collapsed = false,
  onCollapse,
  onExpand,
  onClose,
  onHero,
  className,
}: PlaceDossierProps) {
  const total = activity.reduce((a, b) => a + b, 0)
  if (collapsed)
    return (
      <button
        type="button"
        className={`ui-panel st-place-chip${className ? ` ${className}` : ""}`}
        onClick={onExpand}
        aria-label={`${place.name}: ${heroes.length} ${heroes.length === 1 ? "hero" : "heroes"} here. Open the place`}
      >
        <Glyphs.place size={15} />
        <span className="st-place-chip-name">{place.name}</span>
        {heroes.length > 0 && (
          <span className="st-place-chip-heroes" aria-hidden="true">
            {heroes.slice(0, 3).map((h) => (
              <Sigil key={h.id} family={h.family} banner={h.banner} size="sm" />
            ))}
            {heroes.length > 3 && <span className="num">+{heroes.length - 3}</span>}
          </span>
        )}
      </button>
    )

  const shown = deeds.slice(-PLACE_DEEDS_SHOWN).reverse()
  return (
    <aside
      className={`ui-panel st-place${className ? ` ${className}` : ""}`}
      aria-labelledby="st-place-h"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <header className="st-place-head">
        <span className="st-place-mark" aria-hidden="true">
          <Glyphs.place size={20} />
        </span>
        <div className="st-place-id">
          <span className="hud-eyebrow">{place.kind}</span>
          <h2 id="st-place-h">{place.name}</h2>
          <span className="st-place-pkg num">{place.package}</span>
        </div>
        {onCollapse && (
          <button
            type="button"
            className="ui-icon-btn"
            onClick={onCollapse}
            aria-label="Fold to its chip"
            title="Fold"
          >
            <Glyphs.collapse size={14} />
          </button>
        )}
        <button
          type="button"
          className="ui-icon-btn"
          onClick={onClose}
          aria-label="Close the place (Esc)"
          title="Close (Esc)"
        >
          <Glyphs.close />
        </button>
      </header>
      {place.about && <p className="st-place-about">{place.about}</p>}

      <section
        className="st-place-spark"
        aria-label={`Activity: ${total} ${total === 1 ? "deed" : "deeds"}, ${activityLabel}`}
      >
        <div className="hud-sub-head">
          <span className="hud-eyebrow">Activity</span>
          <span className="hud-faint">
            {activityLabel} · <span className="num">{total}</span> {total === 1 ? "deed" : "deeds"}
          </span>
        </div>
        <Sparkline values={activity} />
      </section>

      <section aria-labelledby="st-place-heroes">
        <div className="hud-sub-head">
          <span className="hud-eyebrow" id="st-place-heroes">
            Here now
          </span>
          <span className="hud-faint num">{heroes.length}</span>
        </div>
        {heroes.length === 0 ? (
          <p className="hud-empty">Nobody is here now.</p>
        ) : (
          <ul className="st-place-heroes">
            {heroes.map((h) => {
              const state = phaseOf(h.phase)
              const body = (
                <>
                  <Sigil family={h.family} banner={h.banner} ordinal={h.ordinal} size="md" />
                  <span className="st-place-hero-id">
                    <b>{heroTitle(h)}</b>
                    {h.doing && <span className="num">{h.doing}</span>}
                  </span>
                  <Status tone={state.tone} label={state.label} />
                </>
              )
              return (
                <li key={h.id}>
                  {onHero ? (
                    <button type="button" className="st-place-hero" onClick={() => onHero(h.id)}>
                      {body}
                    </button>
                  ) : (
                    <span className="st-place-hero">{body}</span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="st-place-deeds">
        <div className="hud-sub-head">
          <span className="hud-eyebrow" id="st-place-deeds">
            Recent deeds
          </span>
          {deeds.length > PLACE_DEEDS_SHOWN && <span className="hud-faint">{deeds.length} in all</span>}
        </div>
        {shown.length === 0 ? (
          <p className="hud-empty">No deeds here yet.</p>
        ) : (
          <ol className="st-place-deeds">
            {shown.map((d) => (
              <li key={d.key} data-failed={d.failed ?? false}>
                <span className="st-place-at num">{clock(d.at)}</span>
                <i
                  className="st-place-pip"
                  style={{ "--banner": d.banner } as CSSProperties}
                  aria-hidden="true"
                />
                <span className="st-place-deed">
                  <b>{d.who}</b> <span className="num">{d.text}</span>
                  {d.failed && (
                    <span className="st-place-fail">
                      <Glyphs.fail size={12} /> failed
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {files.length > 0 && (
        <section aria-labelledby="st-place-files">
          <div className="hud-sub-head">
            <span className="hud-eyebrow" id="st-place-files">
              Files touched
            </span>
            <span className="hud-faint num">{files.length}</span>
          </div>
          <ul className="st-place-files">
            {files.map((f) => (
              <li key={f.path}>
                <span className="num st-place-file" title={f.path}>
                  {f.path}
                </span>
                <span className="num hud-faint">
                  {f.deeds} <span className="ui-visually-hidden">{f.deeds === 1 ? "deed" : "deeds"}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}

/** The activity as a line, its area washed in brass; decorative (the section's label says the total). */
function Sparkline({ values }: { values: readonly number[] }) {
  if (values.length < 2) return <p className="hud-empty">Not enough of the session yet.</p>
  const most = Math.max(1, ...values)
  const step = SPARK.width / (values.length - 1)
  const pts = values.map(
    (n, i) => `${(i * step).toFixed(1)},${(SPARK.height - 3 - (n / most) * (SPARK.height - 6)).toFixed(1)}`,
  )
  return (
    <svg
      className="st-spark"
      viewBox={`0 0 ${SPARK.width} ${SPARK.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon
        points={`0,${SPARK.height} ${pts.join(" ")} ${SPARK.width},${SPARK.height}`}
        className="st-spark-area"
      />
      <polyline points={pts.join(" ")} className="st-spark-line" />
    </svg>
  )
}
