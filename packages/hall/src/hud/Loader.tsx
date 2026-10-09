import { useEffect, useState } from "react"
import { type BootStage, type BootState, boot, useBoot } from "../guild/boot.ts"
import { reducedMotion } from "../guild/opening.ts"
import { Icon } from "./icons.tsx"
import "./loader.css"

/** The steps the viewer waits through, in order (guild/boot.ts). */
const STEPS: ReadonlyArray<{ stage: Exclude<BootStage, "ready">; text: string }> = [
  { stage: "world", text: "World growing" },
  { stage: "models", text: "Loading models" },
  { stage: "light", text: "Preparing light" },
]

/** How long the loader takes to lift, ms (the CSS `--fade`: quicker with reduced motion). */
const FADE_MS = 650
const FADE_QUICK_MS = 150

/** What the screen reader hears: the step, not the percentage, so it is spoken once per step. */
function sayOf({ stage, kind, label }: BootState): string {
  if (stage === "ready") return kind === "boot" ? "Guildhall is ready" : "Ready"
  const text = STEPS.find((step) => step.stage === stage)?.text ?? ""
  return kind === "boot" ? `Loading Guildhall. ${text}` : `${text}: ${label}`
}

/**
 * The page's loader (guild/boot.ts says what it waits on): opaque from the first paint until the
 * world is drawn, then it fades away onto the opening. After that it comes back, under the HUD, each
 * time the hall goes to another island in place (hud/RepoDoor.tsx). The polite live region says
 * each step once and outlives the card, so the last word, "ready", is heard.
 */
export function Loader() {
  const state = useBoot()
  return (
    <>
      <p className="visually-hidden" role="status" aria-live="polite">
        {sayOf(state)}
      </p>
      {state.shown && <Card key={state.epoch} state={state} />}
    </>
  )
}

function Card({ state }: { state: BootState }) {
  const { stage, kind, label, progress } = state
  // A visit's card starts clear and falls over the world; the page's own starts there already.
  const [open, setOpen] = useState(kind === "boot")
  const leaving = stage === "ready"
  const at = STEPS.findIndex((step) => step.stage === stage)

  useEffect(() => {
    if (open) return
    const frame = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(boot.faded, reducedMotion() ? FADE_QUICK_MS : FADE_MS)
    return () => clearTimeout(timer)
  }, [leaving])

  return (
    <div
      className="loader"
      data-kind={kind}
      data-state={leaving ? "out" : open ? "in" : "pre"}
      aria-hidden="true"
    >
      <div className="loader-inner">
        <span className="crest loader-crest">
          <Icon.crest />
        </span>
        <h1 className="loader-name">{kind === "boot" ? "Guildhall" : label}</h1>
        <span className="loader-rule" />
        <p className="loader-pitch">Events in. A living world out.</p>
        <span className="loader-bar">
          <i style={{ transform: `scaleX(${progress})` }} />
        </span>
        <ol className="loader-steps">
          {STEPS.map((step, i) => (
            <li key={step.stage} data-step={i < at || leaving ? "done" : i === at ? "now" : "later"}>
              {step.text}
            </li>
          ))}
        </ol>
        <p className="loader-say">{STEPS[at]?.text ?? ""}</p>
      </div>
    </div>
  )
}
