import { useEffect, useState } from "react"
import type { OpeningState } from "../guild/opening.ts"
import type { GuildStore } from "../guild/store.ts"
import { Icon } from "./icons.tsx"

/** The project's home, linked from the showcase caption. */
export const PROJECT_URL = "https://github.com/Codestz/guildhall"

const PITCH =
  "Watch AI coding agents work as a living guild: every quest, deed and plea of a multi\u2011agent session, played out on an island."

/**
 * The showcase's directed opening (guild/opening.ts), drawn over the scene:
 *
 *   card    crest, name, the one-line pitch and the real loading state
 *   reveal  the card dissolves into the establishing shot between letterbox bars
 *   arrive  the bars retract as the HUD fades in
 *   landed  a short caption says what this is and how to start, with a link to the project
 *
 * Only mounted in showcase mode. Reduced motion: no bars, the card simply fades.
 */
export function Opening({ state, store, phone }: { state: OpeningState; store: GuildStore; phone: boolean }) {
  const { stage, loaded } = state
  const [dismissed, setDismissed] = useState(false)
  const touch = useTouch()

  // Following someone is what the caption asks for: once they do, it has done its job.
  useEffect(() => {
    if (store.selected) setDismissed(true)
  }, [store.selected])

  // The card stays mounted through "arrive" so a reduced-motion cut still fades.
  const titled = stage !== "landed"
  const caption = (stage === "arrive" || stage === "landed") && !dismissed
  const percent = Math.round(loaded * 100)

  return (
    <div className="opening" data-stage={stage} data-phone={phone}>
      <div className="letterbox" aria-hidden="true">
        <i />
        <i />
      </div>

      {titled && (
        <section className="title-card" aria-label="Guildhall" aria-busy={stage === "card"}>
          <div className="title-inner">
            <span className="crest title-crest">
              <Icon.crest />
            </span>
            <h1 className="title-name">Guildhall</h1>
            <span className="title-rule" aria-hidden="true" />
            <p className="title-pitch">{PITCH}</p>
            <div
              className="title-load"
              role="progressbar"
              aria-label="Loading the guildhall"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <span className="title-bar">
                <i style={{ transform: `scaleX(${Math.max(0.04, loaded)})` }} />
              </span>
              <span className="title-load-text">
                {stage === "card" ? (
                  <>
                    Raising the hall <span className="mono">{percent}%</span>
                  </>
                ) : (
                  "Enter the guild"
                )}
              </span>
            </div>
          </div>
        </section>
      )}

      {caption && (
        <aside className="plaque opening-caption" aria-label="About this view">
          <p className="caption-text">
            <b>A simulated guild fixing a bug.</b> <span>{touch ? "Tap" : "Click"} anyone to follow.</span>
          </p>
          <a className="caption-link" href={PROJECT_URL} target="_blank" rel="noopener noreferrer">
            About the project
            <svg
              className="glyph"
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M6 3.5H3.5v9h9V10M9 3h4v4M13 3 7.5 8.5" />
            </svg>
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
          <button
            type="button"
            className="icon-btn caption-close"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={() => setDismissed(true)}
          >
            <Icon.close />
          </button>
        </aside>
      )}
    </div>
  )
}

function useTouch(): boolean {
  const [touch, setTouch] = useState(false)
  useEffect(() => setTouch(window.matchMedia("(hover: none)").matches), [])
  return touch
}
