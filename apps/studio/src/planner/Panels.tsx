import { TIERS, type Tier } from "@guildhall/world"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { Planner, PlannerState } from "./controller.ts"
import type { JobResult } from "./job.ts"
import { COMPASS, type CompassPoint, compassOf, LAYER_NAMES, LAYERS, type WallChoice } from "./query.ts"

/** The Look bar's density target (decisions.md #3). */
const BUILT_TARGET = 0.35

const TIER_NAMES: Record<Tier, string> = {
  hamlet: "Hamlet",
  village: "Village",
  town: "Town",
  city: "City",
  capital: "Capital",
}

const STAGE_NAMES: Record<string, string> = {
  site: "Site",
  streets: "Streets",
  blocks: "Blocks",
  lots: "Lots",
  place: "Placement",
  walls: "Walls",
  landmark: "Castle",
  harbour: "Harbour",
  farms: "Farms",
  nature: "Nature",
  generateTown: "Generate",
  "map shapes": "Map shapes",
}

const ms = (v: number) => (v < 10 ? v.toFixed(1) : Math.round(v).toString())
const metres = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${Math.round(v)} m`)

function usePlanner(p: Planner): PlannerState {
  return useSyncExternalStore(p.subscribe, p.state)
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { value: T; name: string }[]
  value: T
  onChange(v: T): void
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const index = options.findIndex((o) => o.value === value)
  const move = (to: number) => {
    const i = (to + options.length) % options.length
    const o = options[i]
    if (!o) return
    onChange(o.value)
    refs.current[i]?.focus()
  }
  return (
    <div className="gh-pl-seg" role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        // biome-ignore lint/a11y/useSemanticElements: a styled segmented control with the radio group roving tabindex and arrow keys
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value || (index < 0 && i === 0) ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
              e.preventDefault()
              move(i + 1)
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
              e.preventDefault()
              move(i - 1)
            }
          }}
        >
          {o.name}
        </button>
      ))}
    </div>
  )
}

function Minus() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 6h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
function Plus() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 6h7M6 2.5v7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
function Refresh() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M11.5 6.5A4.6 4.6 0 1 1 9.9 3M10.2 1.2v2.6H7.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
function Play({ on }: { on: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      {on ? (
        <path d="M3.5 2.5v7M8.5 2.5v7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <path d="M3 2v8l7-4z" fill="currentColor" />
      )}
    </svg>
  )
}

function SeedField({ seed, onSeed }: { seed: number; onSeed(n: number): void }) {
  const [text, setText] = useState(String(seed))
  useEffect(() => setText(String(seed)), [seed])
  const commit = () => {
    const n = Math.floor(Number(text))
    if (Number.isFinite(n) && n >= 0) onSeed(n)
    else setText(String(seed))
  }
  return (
    <input
      className="gh-pl-seed"
      type="number"
      min={0}
      inputMode="numeric"
      aria-label="Seed"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit()
      }}
    />
  )
}

const HARBOURS: { value: string; name: string }[] = [
  { value: "auto", name: "Auto (tier odds)" },
  { value: "none", name: "None (dry land)" },
  ...(Object.keys(COMPASS) as CompassPoint[]).map((k) => ({ value: k, name: `Water to the ${k}` })),
]

export function Controls({ planner }: { planner: Planner }) {
  const s = usePlanner(planner)
  const q = s.query
  const counts = s.result?.counts
  const harbourValue =
    q.harbour === "auto" || q.harbour === "none" ? q.harbour : (compassOf(q.harbour) ?? "auto")
  return (
    <>
      <div className="gh-pl-sec">
        <p className="gh-eyebrow">World · Town planner</p>
        <h1 className="gh-pl-title">
          {TIER_NAMES[q.tier]} <span>· seed {q.seed}</span>
        </h1>
        <p className="gh-pl-sub" aria-live="polite">
          {s.result ? (
            <>
              grown in <b>{ms(s.result.stats.totalMs)} ms</b> · drawn in <b>{ms(s.drawMs)} ms</b>
            </>
          ) : (
            "growing…"
          )}
        </p>
      </div>

      <div className="gh-pl-sec">
        <p className="gh-eyebrow">
          Seed <span className="hint">[ and ] step</span>
        </p>
        <div className="gh-pl-row">
          <button
            type="button"
            className="gh-pl-btn"
            aria-label="Previous seed"
            onClick={() => planner.set({ seed: Math.max(0, q.seed - 1) })}
          >
            <Minus />
          </button>
          <SeedField seed={q.seed} onSeed={(seed) => planner.set({ seed })} />
          <button
            type="button"
            className="gh-pl-btn"
            aria-label="Next seed"
            onClick={() => planner.set({ seed: q.seed + 1 })}
          >
            <Plus />
          </button>
        </div>
        <div className="gh-pl-row">
          <button type="button" className="gh-pl-btn grow primary" onClick={() => planner.regenerate()}>
            <Refresh /> Regenerate
            <span className="num" style={{ color: "var(--faint)", fontSize: 11.5 }}>
              {s.regenMs > 0 ? `${ms(s.regenMs)} ms` : ""}
            </span>
          </button>
          <button
            type="button"
            className="gh-pl-btn"
            aria-pressed={s.cycling}
            onClick={() => planner.setCycling(!s.cycling)}
            title="Step through seeds every 2 s"
          >
            <Play on={s.cycling} /> Cycle
          </button>
        </div>
      </div>

      <div className="gh-pl-sec">
        <p className="gh-eyebrow">Settlement</p>
        <Segmented
          label="Tier"
          options={TIERS.map((t) => ({ value: t, name: TIER_NAMES[t] }))}
          value={q.tier}
          onChange={(tier) => planner.set({ tier })}
        />
        <div style={{ height: 10 }} />
        <label className="gh-pl-field">
          <span>Harbour</span>
          <select
            className="gh-pl-select"
            value={harbourValue}
            onChange={(e) => {
              const v = e.target.value
              planner.set({ harbour: v === "auto" || v === "none" ? v : COMPASS[v as CompassPoint] })
            }}
          >
            {HARBOURS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <div className="gh-pl-field">
          <span id="pl-walls">Walls</span>
          <Segmented<WallChoice>
            label="Walls"
            options={[
              { value: "auto", name: "Auto" },
              { value: "on", name: "On" },
              { value: "off", name: "Off" },
            ]}
            value={q.walls}
            onChange={(walls) => planner.set({ walls })}
          />
        </div>
        <div className="gh-pl-field">
          <span>Style</span>
          <Segmented
            label="Map style"
            options={[
              { value: "colour", name: "Colour" },
              { value: "parchment", name: "Parchment" },
            ]}
            value={q.look}
            onChange={(look) => planner.set({ look })}
          />
        </div>
      </div>

      <div className="gh-pl-sec">
        <p className="gh-eyebrow">
          Layers <span className="hint">greyed = no data yet</span>
        </p>
        <div className="gh-pl-layers">
          {LAYERS.map((layer) => {
            const n = counts?.[layer] ?? 0
            const empty = counts !== undefined && n === 0
            return (
              <button
                key={layer}
                type="button"
                className="gh-pl-layer"
                aria-pressed={q.layers.includes(layer)}
                data-empty={empty}
                title={
                  empty
                    ? `${LAYER_NAMES[layer]}: nothing yet. It draws as soon as its stage produces data.`
                    : undefined
                }
                onClick={() => planner.toggleLayer(layer)}
              >
                <span className="box" aria-hidden="true" />
                <span className="label">{LAYER_NAMES[layer]}</span>
                <span className="count">{counts ? (n > 0 ? n.toLocaleString() : "—") : ""}</span>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="gh-pl-stat">
      <span>{label}</span>
      <span className="v">
        {value}
        {sub ? <small> {sub}</small> : null}
      </span>
    </div>
  )
}

export function Stats({ planner }: { planner: Planner }) {
  const s = usePlanner(planner)
  const st = s.result?.stats
  if (!st || !s.result)
    return (
      <div className="gh-pl-sec">
        <p className="gh-eyebrow">Plan</p>
        <p className="gh-pl-note">Growing the town…</p>
      </div>
    )
  const byUse = st.blocksByUse
  const built = st.builtPct
  const slowest = Math.max(1, ...st.timings.map((t) => t.ms))
  const streets = (cls: string) => st.streetLength[cls] ?? 0
  return (
    <>
      <div className="gh-pl-sec">
        <p className="gh-eyebrow">Plan</p>
        <Stat
          label="Blocks"
          value={String(st.blocks)}
          sub={`${byUse.lots ?? 0} lots · ${byUse.green ?? 0} green`}
        />
        <Stat label="Lots" value={st.lots.toLocaleString()} />
        <Stat label="Buildings" value={st.houses.toLocaleString()} />
        <div className="gh-pl-stat" style={{ marginTop: 4 }}>
          <span>Built area</span>
          <span className="v">{built === null ? "—" : `${(built * 100).toFixed(1)}%`}</span>
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: <meter> cannot draw the target mark */}
        <div
          className="gh-pl-meter"
          data-ok={built !== null && built >= BUILT_TARGET}
          role="meter"
          aria-label="Built area against the 35% target"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={built === null ? 0 : Math.round(built * 100)}
        >
          <div className="fill" style={{ width: `${Math.min(100, ((built ?? 0) / 0.6) * 100)}%` }} />
          <div className="mark" style={{ left: `${(BUILT_TARGET / 0.6) * 100}%` }} title="Target 35%" />
        </div>
        <p className={`gh-pl-note${built !== null && built < BUILT_TARGET ? " warn" : ""}`}>
          {built === null
            ? "No buildings placed yet."
            : built >= BUILT_TARGET
              ? "Meets the 35% density bar."
              : "Below the 35% density bar."}{" "}
          Lots blocks are {Math.round(st.lotsShare * 100)}% of the town.
        </p>
      </div>
      <div className="gh-pl-sec">
        <p className="gh-eyebrow">Edges and streets</p>
        <Stat
          label={st.edgeKind === "none" ? "Town edge" : `Town ${st.edgeKind}`}
          value={metres(st.edgeLength)}
        />
        <Stat label="Towers · gates" value={`${st.towers} · ${st.gates}`} />
        {st.castleLength > 0 && <Stat label="Castle curtain" value={metres(st.castleLength)} />}
        <Stat label="Main · streets" value={`${metres(streets("main"))} · ${metres(streets("street"))}`} />
        <Stat label="Lanes · roads" value={`${metres(streets("lane"))} · ${metres(streets("road"))}`} />
        <Stat label="Harbour" value={st.harbour} />
        <Stat label="Fields · trees" value={`${st.fields} · ${st.trees.toLocaleString()}`} />
      </div>
      <div className="gh-pl-sec">
        <p className="gh-eyebrow">
          Timings <span className="hint">ms</span>
        </p>
        {st.timings.map((t) => (
          <div className="gh-pl-time" key={t.stage}>
            <span>{STAGE_NAMES[t.stage] ?? t.stage}</span>
            <span className="bar">
              <i style={{ width: `${(t.ms / slowest) * 100}%` }} />
            </span>
            <span className="v">{ms(t.ms)}</span>
          </div>
        ))}
        <div className="gh-pl-time">
          <span>Redraw</span>
          <span className="bar">
            <i style={{ width: `${Math.min(100, (s.drawMs / slowest) * 100)}%`, background: "#8fdc7a" }} />
          </span>
          <span className="v">{ms(s.drawMs)}</span>
        </div>
        {s.result.problems.map((p) => (
          <p className="gh-pl-note warn" key={p.stage}>
            {STAGE_NAMES[p.stage] ?? p.stage} failed: {p.message}
          </p>
        ))}
      </div>
      <div className="gh-pl-sec">
        <p className="gh-eyebrow">Under the pointer</p>
        <p className="gh-pl-hover">{s.hover ?? "Point at the map. Drag to pan, scroll to zoom, 0 to fit."}</p>
      </div>
    </>
  )
}

function Thumb({ planner, seed, result }: { planner: Planner; seed: number; result: JobResult | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const look = usePlanner(planner).query.look
  useEffect(() => {
    if (ref.current && result) planner.thumb(ref.current, result, look)
  }, [planner, result, look])
  const st = result?.stats
  return (
    <button
      type="button"
      className="gh-pl-thumb"
      onClick={() => planner.set({ seed })}
      aria-label={`Open seed ${seed}`}
    >
      {result ? <canvas ref={ref} /> : <span className="wait">…</span>}
      <span className="cap">
        <b>#{seed}</b>
        <span>
          {st ? (st.builtPct === null ? `${st.blocks} blk` : `${Math.round(st.builtPct * 100)}%`) : ""}
        </span>
      </span>
    </button>
  )
}

export function Strip({ planner }: { planner: Planner }) {
  const s = usePlanner(planner)
  return (
    <>
      <div className="head">
        <p className="gh-eyebrow">Neighbours</p>
        <p>Seeds either side, same settings.</p>
      </div>
      {s.strip.map((t) => (
        <Thumb key={t.seed} planner={planner} seed={t.seed} result={t.result} />
      ))}
    </>
  )
}

export function Status({ planner }: { planner: Planner }) {
  const s = usePlanner(planner)
  if (s.error)
    return (
      <div className="gh gh-panel gh-pl-error" role="alert">
        Could not grow this town: {s.error}
      </div>
    )
  if (s.busy && !s.result) return <div className="gh gh-panel gh-pl-busy">Growing the town…</div>
  return null
}
