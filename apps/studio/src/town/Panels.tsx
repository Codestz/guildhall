import type { FrameStats } from "@guildhall/core"
import type { Rig, Stage } from "@guildhall/render"
import { TIERS, type Tier } from "@guildhall/world"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { drawMap } from "../planner/draw.ts"
import { COMPASS, type CompassPoint, compassOf, DEFAULT_LAYERS, type WallChoice } from "../planner/query.ts"
import { themeOf } from "../planner/theme.ts"
import { fit } from "../planner/view.ts"
import { createCamKeys } from "../shell/camKeys.ts"
import { href } from "../shell/router.ts"
import type { TownController, TownState } from "./controller.ts"
import { CAMS, type Cam, plannerLink } from "./query.ts"

const TIER_NAMES: Record<Tier, string> = {
  hamlet: "Hamlet",
  village: "Village",
  town: "Town",
  city: "City",
  capital: "Capital",
}
const CAM_NAMES: Record<Cam, string> = { hero: "Hero", street: "Street", map: "Map", free: "Free" }
const BUSY: Record<NonNullable<TownState["busy"]>, string> = {
  growing: "growing the town…",
  dressing: "dressing…",
  streaming: "streaming pieces…",
}
const HARBOURS: { value: string; name: string }[] = [
  { value: "auto", name: "Auto (tier odds)" },
  { value: "none", name: "None (dry land)" },
  ...(Object.keys(COMPASS) as CompassPoint[]).map((k) => ({ value: k, name: `Water to the ${k}` })),
]

const ms = (v: number) => (v < 10 ? v.toFixed(1) : Math.round(v).toString())
const big = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)} k` : n.toLocaleString()
const clock = (h: number) => {
  const m = Math.round(h * 60)
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

function useTown(c: TownController): TownState {
  return useSyncExternalStore(c.subscribe, c.state)
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
  return (
    <div className="gh-pl-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        // biome-ignore lint/a11y/useSemanticElements: a styled segmented control, as the planner's
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.name}
        </button>
      ))}
    </div>
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

/** The camera's controls for the mode the rig is in (shell/camKeys.ts). */
function CamKeys({ rig }: { rig: Rig }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const keys = createCamKeys(rig)
    ref.current?.append(keys.el)
    return keys.dispose
  }, [rig])
  return <div ref={ref} className="gh-tw-camkeys" />
}

export function Controls({ town, rig }: { town: TownController; rig: Rig }) {
  const s = useTown(town)
  const q = s.query
  const harbourValue =
    q.harbour === "auto" || q.harbour === "none" ? q.harbour : (compassOf(q.harbour) ?? "auto")
  return (
    <>
      <div className="gh-pl-sec">
        <p className="gh-eyebrow">World · Town</p>
        <h1 className="gh-pl-title">
          {q.preset ? q.preset : TIER_NAMES[q.tier]} <span>· seed {s.spec?.seed ?? q.seed}</span>
        </h1>
        <p className="gh-pl-sub" aria-live="polite">
          {s.busy ? BUSY[s.busy] : s.build ? `drawn in ${ms(s.genMs + s.build.totalMs)} ms` : ""}
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
            onClick={() => town.set({ seed: Math.max(0, q.seed - 1) })}
          >
            −
          </button>
          <SeedField seed={q.seed} onSeed={(seed) => town.set({ seed })} />
          <button
            type="button"
            className="gh-pl-btn"
            aria-label="Next seed"
            onClick={() => town.set({ seed: q.seed + 1 })}
          >
            +
          </button>
        </div>
      </div>
      <div className="gh-pl-sec">
        <p className="gh-eyebrow">Settlement</p>
        <Segmented
          label="Tier"
          options={TIERS.map((t) => ({ value: t, name: TIER_NAMES[t] }))}
          value={q.tier}
          onChange={(tier) => town.set({ tier })}
        />
        <div style={{ height: 10 }} />
        <label className="gh-pl-field">
          <span>Harbour</span>
          <select
            className="gh-pl-select"
            value={harbourValue}
            onChange={(e) => {
              const v = e.target.value
              town.set({ harbour: v === "auto" || v === "none" ? v : COMPASS[v as CompassPoint] })
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
          <span>Walls</span>
          <Segmented<WallChoice>
            label="Walls"
            options={[
              { value: "auto", name: "Auto" },
              { value: "on", name: "On" },
              { value: "off", name: "Off" },
            ]}
            value={q.walls}
            onChange={(walls) => town.set({ walls })}
          />
        </div>
      </div>
      <div className="gh-pl-sec">
        <p className="gh-eyebrow">
          Light <span className="hint">{clock(q.hour)}</span>
        </p>
        <input
          className="gh-tw-hour"
          type="range"
          min={5}
          max={21}
          step={0.25}
          value={q.hour}
          aria-label="Hour of the day"
          onChange={(e) => town.set({ hour: Number(e.target.value) })}
        />
      </div>
      <div className="gh-pl-sec">
        <p className="gh-eyebrow">Camera</p>
        <div className="gh-pl-row">
          <div style={{ flex: 1 }}>
            <Segmented<Cam>
              label="Camera"
              options={CAMS.map((c) => ({ value: c, name: CAM_NAMES[c] }))}
              value={q.cam}
              onChange={(cam) => (cam === q.cam ? town.frame() : town.set({ cam }))}
            />
          </div>
          <button
            type="button"
            className="gh-pl-btn"
            aria-pressed={q.compare}
            onClick={() => town.set({ compare: !q.compare })}
            title="The planner's map of the same town, in a corner"
          >
            Compare
          </button>
        </div>
        <CamKeys rig={rig} />
      </div>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="gh-pl-stat">
      <span>{label}</span>
      <span className="v">{value}</span>
    </div>
  )
}

/** Frame stats, re-read twice a second. */
function useFrameStats(stage: Stage): FrameStats | null {
  const [f, setF] = useState<FrameStats | null>(null)
  useEffect(() => {
    const id = setInterval(() => setF(stage.stats()), 500)
    return () => clearInterval(id)
  }, [stage])
  return f
}

export function Stats({ town, stage }: { town: TownController; stage: Stage }) {
  const s = useTown(town)
  const f = useFrameStats(stage)
  // Re-read with the frame stats (they re-render this panel twice a second).
  const lod = f ? town.lod() : null
  const r = s.report
  const times = s.job?.times ?? {}
  const slowest = Math.max(1, ...Object.values(times))
  return (
    <>
      <div className="gh-pl-sec">
        <p className="gh-eyebrow">Town</p>
        <Stat label="Houses" value={r ? r.houses.toLocaleString() : "—"} />
        <Stat label="Pieces" value={r ? r.pieces.toLocaleString() : "—"} />
        <Stat label="Built area" value={r ? `${(r.builtPct * 100).toFixed(1)}%` : "—"} />
        <Stat label="Est. triangles" value={r ? big(r.estTris) : "—"} />
      </div>
      <div className="gh-pl-sec">
        <p className="gh-eyebrow">Frame</p>
        <Stat label="Main tris" value={f?.mainTris !== undefined ? big(f.mainTris) : "—"} />
        <Stat label="Shadow tris" value={f?.shadowTris !== undefined ? big(f.shadowTris) : "—"} />
        <Stat
          label="Draw calls"
          value={f ? `${f.mainCalls ?? f.calls}${f.shadowCalls ? ` + ${f.shadowCalls}` : ""}` : "—"}
        />
        <Stat
          label="Cost p50 · p95"
          value={f?.costMs ? `${ms(f.costMs.p50)} · ${ms(f.costMs.p95)} ms` : "—"}
        />
        <Stat label="DPR" value={f ? String(f.dpr) : "—"} />
        <Stat
          label="LOD tiers 0 · 1 · 2"
          value={lod && lod.tiers.length > 0 ? lod.tiers.map(big).join(" · ") : "—"}
        />
        <Stat label="Near clusters · shells" value={lod ? `${big(lod.near)} · ${big(lod.shells)}` : "—"} />
      </div>
      <div className="gh-pl-sec">
        <p className="gh-eyebrow">
          Build <span className="hint">ms</span>
        </p>
        {Object.entries(times).map(([stageName, v]) => (
          <div className="gh-pl-time" key={stageName}>
            <span>{stageName}</span>
            <span className="bar">
              <i style={{ width: `${(v / slowest) * 100}%` }} />
            </span>
            <span className="v">{ms(v)}</span>
          </div>
        ))}
        {s.dressed && (
          <>
            <Stat label="Compile · dress" value={`${ms(s.dressed.compileMs)} · ${ms(s.dressed.dressMs)}`} />
            <Stat label="Variants compiled" value={String(s.dressed.compiled)} />
          </>
        )}
        {s.build && (
          <>
            <Stat label="First frame" value={ms(s.build.firstFrameMs)} />
            <Stat
              label="Stream (bld · edge · plant)"
              value={s.build.stagesMs.map((v) => ms(v)).join(" · ")}
            />
            <Stat label="Ground · water upload" value={ms(s.build.groundMs)} />
          </>
        )}
        {s.error && <p className="gh-pl-note warn">Could not build this town: {s.error}</p>}
      </div>
    </>
  )
}

/** The planner's map of the town on screen, drawn into the corner inset. */
export function Compare({ town }: { town: TownController }) {
  const s = useTown(town)
  const ref = useRef<HTMLCanvasElement>(null)
  const map = s.job?.map ?? null
  const on = s.query.compare
  useEffect(() => {
    const canvas = ref.current
    const g = canvas?.getContext("2d")
    if (!on || !canvas || !g || !map) return
    const box = canvas.getBoundingClientRect()
    const dpr = Math.min(2, devicePixelRatio || 1)
    const w = Math.max(1, Math.round(box.width))
    const h = Math.max(1, Math.round(box.height))
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    drawMap(g, map, fit(map.box, w, h, 4), w, h, {
      theme: themeOf("colour"),
      layers: new Set(DEFAULT_LAYERS),
      dpr,
      thumb: true,
    })
  }, [map, on])
  if (!on) return null
  return (
    <figure className="gh-panel gh-tw-compare">
      <canvas ref={ref} role="img" aria-label="The planner's map of this town" />
      <figcaption>
        Planner map · <a href={href("planner", plannerLink(s.query))}>open</a>
      </figcaption>
    </figure>
  )
}
