import type { Tone } from "../components/controls.tsx"
import type { LegendItem, LoaderState, Stat } from "../components/display.tsx"
import type { Knob, KnobSection, KnobValues } from "./knobs.ts"

export type { LegendItem, Stat, Tone }

/** One line of control help: keys drawn as caps, or a gesture as a word, then what it does. */
export interface HelpEntry {
  keys?: readonly string[]
  gesture?: string
  does: string
}

/** A read-out block in the Inspector: rows, a colour legend, or both. */
export interface Readout {
  title: string
  meta?: string
  rows?: readonly Stat[]
  legend?: readonly LegendItem[]
  /** Starts folded (default open). */
  folded?: boolean
}

export interface CardAction {
  label: string
  run(): void
  /** The one brass-outlined way on; the rest are plain. */
  primary?: boolean
}

export interface TitleInfo {
  eyebrow?: string
  title: string
  subtitle?: string
  /** Headline numbers under the title (keep to four). */
  figures?: readonly Stat[]
  /** Buttons at the foot of the card: where to go from here ("Open in 3D"). */
  actions?: readonly CardAction[]
  /** One quiet line at the foot of the card: what is happening now ("Placing pieces…"). */
  status?: string | null
}

export interface TransportSpec {
  /** What the value is ("Time of day"): the slider's accessible name. */
  label: string
  value: number
  min: number
  max: number
  step: number
  format(v: number): string
  /** Units per second while playing. */
  rate: number
  /** Past `max` it comes round to `min` (a clock). */
  wrap?: boolean
  playing?: boolean
  onChange(v: number): void
}

export interface Transport {
  /** Moves the value without calling `onChange`. */
  set(v: number): void
  value(): number
  playing(): boolean
  dispose(): void
}

export interface Loading {
  /** Marks `step` (a name from the list, or its index) as the one being worked on. */
  step(step: string | number): void
  /** Lifts the veil while the rest builds in view; the card's status line carries the step. */
  lift(): void
  done(): void
  fail(message: string): void
}

export interface ViewerHooks {
  /** The frame rate and the 95th-percentile frame cost, for the perf chip. */
  stats?: () => { fps: number; p95: number }
  /** A PNG data URL of what the stage shows (null when it cannot). */
  capture?: () => Promise<string | null>
}

export interface ViewerOptions extends TitleInfo {
  /** The deep link the screen was opened with: knobs read their values from it. */
  query: URLSearchParams
  sections?: readonly KnobSection[]
  /** Static control help for the bottom-right chip (a 2D screen); 3D screens fill `camera` instead. */
  help?: readonly HelpEntry[]
  /** Live knobs changed: every value now, and which changed. */
  onKnobs?(values: KnobValues, changed: readonly Knob[]): void
  /**
   * Writes the URL in place (no history entry, no remount): `query` holds the knobs' values, `keys` names
   * the keys the viewer owns (one missing from `query` is at its default and leaves the URL).
   */
  writeQuery?(query: URLSearchParams, keys: readonly string[]): void
  /** Opens the screen again with these knob values (as `writeQuery`): what a rebuild does. */
  reload?(query: URLSearchParams, keys: readonly string[]): void
  /** False draws the stage alone (`?ui=0`, shots and embeds). */
  chrome?: boolean
  /** The Inspector starts open on a wide viewer (default closed: the stage comes first). */
  inspector?: boolean
  /** The screenshot's file name stem. */
  name?: string
}

export interface Viewer {
  /** The viewer's root, inside the host it was given. */
  root: HTMLElement
  /** The screen draws here: its canvas (a 3D stage, or a 2D canvas). Fills the viewer. */
  stage: HTMLElement
  /** A layer above the stage for labels pinned to the scene (`ui-plate`). */
  labels: HTMLElement
  /** The bottom-right slot for a camera's own help (the studio's camera chip). */
  camera: HTMLElement
  values(): KnobValues
  /** Sets knob values from the screen (a key press, a click on the map); live ones sync the URL. */
  setValues(values: KnobValues): void
  setInfo(info: Partial<TitleInfo>): void
  setReadout(readout: readonly Readout[]): void
  transport(spec: TransportSpec): Transport
  loading(title: string, steps: readonly string[]): Loading
  attach(hooks: ViewerHooks): void
  toast(text: string, detail?: string): void
  /** How much of the viewer's right edge the open Inspector covers (CSS px), so a 2D map can centre beside it. */
  coveredRight(): number
  /** How much of the viewer's left edge the title card covers (CSS px), so a framing can leave it room. */
  coveredLeft(): number
  /** How much of the viewer's top edge the tools row covers (CSS px). */
  coveredTop(): number
  /** Called when the Inspector opens or closes, or the viewer resizes. */
  onLayout(fn: () => void): () => void
  dispose(): void
}

export type { LoaderState }
