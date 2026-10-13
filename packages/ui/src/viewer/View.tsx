/** The Viewer's chrome, drawn from the store: each region subscribes to its own slice. */
import { type ReactNode, useEffect, useId, useRef } from "react"
import {
  Button,
  IconButton,
  Kbd,
  Segmented,
  Select,
  Slider,
  Stepper,
  Toggle,
} from "../components/controls.tsx"
import { Card, Figures, Legend, Loader, Panel, SectionHead, StatRows } from "../components/display.tsx"
import {
  CameraIcon,
  ChevronIcon,
  CloseIcon,
  KeysIcon,
  PauseIcon,
  PlayIcon,
  ResetIcon,
  SlidersIcon,
} from "../components/icons.tsx"
import { allKnobs, applyOf, formatStep, type Knob, type KnobValue } from "./knobs.ts"
import { type Store, useSlice } from "./store.ts"
import type { HelpEntry } from "./types.ts"

export interface Actions {
  setKnob(key: string, value: KnobValue): void
  rebuild(): void
  discard(): void
  resetAll(): void
  toggleInspector(open?: boolean): void
  toggleHelp(): void
  play(on: boolean): void
  scrub(v: number): void
  capture(): void
  dismiss(id: number): void
}

function TitleCard({ store }: { store: Store }) {
  const info = useSlice(store, (s) => s.info)
  return (
    <Panel className="ui-titlecard" as="section" label={info.title}>
      {info.eyebrow && <p className="ui-eyebrow">{info.eyebrow}</p>}
      <h1 className="ui-title">{info.title}</h1>
      {info.subtitle && <p className="ui-sub">{info.subtitle}</p>}
      {info.figures && info.figures.length > 0 && <Figures rows={info.figures} />}
      {info.status && (
        <p className="status" role="status">
          <i aria-hidden="true" />
          {info.status}
        </p>
      )}
    </Panel>
  )
}

function Perf({ store }: { store: Store }) {
  const perf = useSlice(store, (s) => s.perf)
  if (!perf) return null
  const tone = perf.p95 > 33 ? "fail" : perf.p95 > 17 ? "warn" : undefined
  return (
    <span
      className="ui-perf"
      data-tone={tone}
      role="status"
      aria-label={`${Math.round(perf.fps)} frames per second, ${perf.p95.toFixed(1)} ms per frame at the 95th percentile`}
      title="Frames per second · p95 frame time (` for the full HUD)"
    >
      <i className="led" aria-hidden="true" />
      {Math.round(perf.fps)}
      <small>fps</small>
      {perf.p95.toFixed(1)}
      <small>ms</small>
    </span>
  )
}

function Tools({ store, act, inspectorId }: { store: Store; act: Actions; inspectorId: string }) {
  const open = useSlice(store, (s) => s.inspector)
  const canCapture = useSlice(store, (s) => s.canCapture)
  const hasKnobs = useSlice(store, (s) => s.sections.length > 0 || s.readout.length > 0)
  return (
    <div className="ui-tools">
      <Perf store={store} />
      {canCapture && (
        <IconButton label="Save a screenshot" plaque onClick={act.capture}>
          <CameraIcon size={18} />
        </IconButton>
      )}
      {hasKnobs && (
        <IconButton
          label={open ? "Hide the inspector" : "Show the inspector"}
          plaque
          aria-expanded={open}
          aria-controls={inspectorId}
          aria-keyshortcuts="I"
          onClick={() => act.toggleInspector()}
        >
          <SlidersIcon size={18} />
        </IconButton>
      )}
    </div>
  )
}

function TransportBar({ store, act }: { store: Store; act: Actions }) {
  const t = useSlice(store, (s) => s.transport)
  if (!t) return null
  const p = t.max > t.min ? (t.value - t.min) / (t.max - t.min) : 0
  return (
    <Panel className="ui-transport" as="section" label={t.label}>
      <button
        type="button"
        className="ui-play"
        aria-label={t.playing ? `Pause ${t.label.toLowerCase()}` : `Play ${t.label.toLowerCase()}`}
        aria-pressed={t.playing}
        onClick={() => act.play(!t.playing)}
      >
        {t.playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <span className="time">
        <small>{t.label}</small>
        <b>{t.format(t.value)}</b>
      </span>
      <input
        className="ui-range"
        type="range"
        aria-label={t.label}
        aria-valuetext={t.format(t.value)}
        min={t.min}
        max={t.max}
        step={t.step}
        value={t.value}
        style={{ ["--p" as string]: String(p) }}
        onChange={(e) => act.scrub(Number(e.currentTarget.value))}
      />
    </Panel>
  )
}

function Keys({ entries }: { entries: readonly HelpEntry[] }) {
  return (
    <ul className="ui-keys" aria-label="Controls">
      {entries.map((e) => (
        <li key={`${e.keys?.join("+") ?? e.gesture}-${e.does}`}>
          {e.keys?.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
          {e.gesture && <b>{e.gesture}</b>} {e.does}
        </li>
      ))}
    </ul>
  )
}

/** The bottom-right corner: a static help chip (2D screens) and the slot a camera chip mounts into. */
function Help({ store, act, slot }: { store: Store; act: Actions; slot: HTMLElement }) {
  const help = useSlice(store, (s) => s.help)
  const open = useSlice(store, (s) => s.helpOpen)
  const holder = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    holder.current?.append(slot)
  }, [slot])
  return (
    <>
      {help.length > 0 && (
        <div className="ui-help">
          {open && (
            <Panel className="ui-help-body">
              <div id={id}>
                <Keys entries={help} />
              </div>
            </Panel>
          )}
          <button
            type="button"
            className="ui-pill"
            aria-expanded={open}
            aria-controls={id}
            onClick={act.toggleHelp}
          >
            <KeysIcon size={15} />
            Controls
          </button>
        </div>
      )}
      <div ref={holder} style={{ display: "contents" }} />
    </>
  )
}

function KnobField({ knob, store, act }: { knob: Knob; store: Store; act: Actions }) {
  const value = useSlice(store, (s) => s.values[knob.key] ?? knob.default)
  const built = useSlice(store, (s) => s.built[knob.key] ?? knob.default)
  const set = (v: KnobValue) => act.setKnob(knob.key, v)
  const staged = applyOf(knob) === "reload" && value !== built
  const hint = staged ? `${knob.hint ? `${knob.hint} · ` : ""}applies on rebuild` : knob.hint
  switch (knob.kind) {
    case "range":
      return (
        <Slider
          label={knob.label}
          value={value as number}
          min={knob.min}
          max={knob.max}
          step={knob.step}
          format={knob.format ?? ((v) => formatStep(v, knob.step))}
          changed={value !== knob.default}
          hint={hint}
          onChange={set}
        />
      )
    case "stepper":
      return (
        <Stepper
          label={knob.label}
          value={value as number}
          min={knob.min}
          max={knob.max}
          step={knob.step}
          onChange={set}
        />
      )
    case "toggle":
      return <Toggle label={knob.label} hint={hint} checked={value as boolean} onChange={set} />
    case "segment":
      return <Segmented label={knob.label} value={value as string} options={knob.options} onChange={set} />
    default:
      return (
        <Select
          label={knob.label}
          value={value as string}
          options={knob.options}
          hint={hint}
          onChange={set}
        />
      )
  }
}

function Group({
  title,
  meta,
  open = true,
  children,
}: {
  title: string
  meta?: string
  open?: boolean
  children: ReactNode
}) {
  return (
    <details className="ui-group" open={open}>
      <summary>
        <SectionHead meta={meta}>{title}</SectionHead>
        <ChevronIcon />
      </summary>
      <div className="ui-group-body">{children}</div>
    </details>
  )
}

function InspectorFoot({ store, act }: { store: Store; act: Actions }) {
  const sections = useSlice(store, (s) => s.sections)
  const values = useSlice(store, (s) => s.values)
  const built = useSlice(store, (s) => s.built)
  const knobs = allKnobs(sections)
  const staged = knobs.filter((k) => applyOf(k) === "reload" && values[k.key] !== built[k.key])
  const custom = knobs.some((k) => values[k.key] !== k.default)
  if (staged.length === 0 && !custom) return null
  return (
    <div className="ui-inspector-foot">
      {staged.length > 0 && (
        <>
          <p>
            <b>{staged.length}</b> {staged.length === 1 ? "change needs" : "changes need"} a rebuild:{" "}
            {staged.map((k) => k.label.toLowerCase()).join(", ")}.
          </p>
          <div className="row">
            <Button variant="primary" onClick={act.rebuild}>
              Rebuild
            </Button>
            <Button variant="ghost" onClick={act.discard}>
              Discard
            </Button>
          </div>
        </>
      )}
      {staged.length === 0 && custom && (
        <Button variant="ghost" size="sm" onClick={act.resetAll}>
          <ResetIcon size={14} />
          Reset to defaults
        </Button>
      )}
    </div>
  )
}

function Inspector({ store, act, id }: { store: Store; act: Actions; id: string }) {
  const open = useSlice(store, (s) => s.inspector)
  const sections = useSlice(store, (s) => s.sections)
  const readout = useSlice(store, (s) => s.readout)
  const head = useId()
  return (
    <aside
      id={id}
      className="ui-panel ui-inspector"
      aria-labelledby={head}
      hidden={!open}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation()
          act.toggleInspector(false)
        }
      }}
    >
      <div className="ui-inspector-head">
        <h2 id={head}>Inspector</h2>
        <IconButton label="Close the inspector" onClick={() => act.toggleInspector(false)}>
          <CloseIcon />
        </IconButton>
      </div>
      <div className="ui-inspector-body">
        {readout.map((r) => (
          <Group key={r.title} title={r.title} meta={r.meta} open={!r.folded}>
            {r.rows && r.rows.length > 0 && <StatRows rows={r.rows} />}
            {r.legend && r.legend.length > 0 && <Legend items={r.legend} label={r.title} />}
          </Group>
        ))}
        {sections.map((s) => (
          <Group key={s.title} title={s.title} open={s.open !== false}>
            {s.knobs.map((k) => (
              <KnobField key={k.key} knob={k} store={store} act={act} />
            ))}
          </Group>
        ))}
      </div>
      <InspectorFoot store={store} act={act} />
    </aside>
  )
}

function Toasts({ store, act }: { store: Store; act: Actions }) {
  const toasts = useSlice(store, (s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    <div className="ui-toasts">
      {toasts.map((t) => (
        <Card key={t.id} detail={t.detail} onClose={() => act.dismiss(t.id)}>
          {t.text}
        </Card>
      ))}
    </div>
  )
}

function Veil({ store }: { store: Store }) {
  const loader = useSlice(store, (s) => s.loader)
  return loader ? <Loader state={loader} /> : null
}

export function View({ store, act, slot }: { store: Store; act: Actions; slot: HTMLElement }) {
  const inspectorId = useId()
  return (
    <>
      <div className="ui-corner" data-at="tl">
        <TitleCard store={store} />
      </div>
      <div className="ui-corner" data-at="tr">
        <Tools store={store} act={act} inspectorId={inspectorId} />
      </div>
      <div className="ui-corner" data-at="bl">
        <TransportBar store={store} act={act} />
      </div>
      <div className="ui-corner" data-at="br">
        <Help store={store} act={act} slot={slot} />
      </div>
      <div className="ui-corner" data-at="bc">
        <Toasts store={store} act={act} />
      </div>
      <Inspector store={store} act={act} id={inspectorId} />
      <Veil store={store} />
    </>
  )
}
