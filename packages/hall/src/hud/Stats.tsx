import { useSyncExternalStore } from "react"
import { quality, TIERS } from "../guild/quality.ts"
import { BUDGET, frameStats } from "../guild/stats.ts"
import type { GuildStore } from "../guild/store.ts"
import { Panel } from "./parts.tsx"

/** "Stats for nerds": what each frame costs, against the budget in docs/perf-budget.md. */
export function Stats({ store, open, onToggle }: { store: GuildStore; open: boolean; onToggle: () => void }) {
  const s = frameStats
  const tier = useSyncExternalStore(quality.subscribe, quality.snapshot)
  const rows: { label: string; value: string; budget?: string; over?: boolean }[] = [
    {
      label: "Frame rate",
      value: `${Math.round(s.fps)} fps`,
      budget: `${BUDGET.fps}`,
      over: s.fps < BUDGET.fps * 0.9,
    },
    { label: "Frame time", value: `${s.ms.toFixed(1)} ms` },
    {
      label: "Draw calls",
      value: s.calls.toLocaleString(),
      budget: `≤ ${BUDGET.calls}`,
      over: s.calls > BUDGET.calls,
    },
    {
      label: "Triangles",
      value: s.triangles.toLocaleString(),
      budget: `≤ ${(BUDGET.triangles / 1000).toFixed(0)}k`,
      over: s.triangles > BUDGET.triangles,
    },
    {
      label: "Geometries",
      value: s.geometries.toLocaleString(),
      budget: `≤ ${BUDGET.geometries}`,
      over: s.geometries > BUDGET.geometries,
    },
    { label: "Textures", value: s.textures.toLocaleString() },
    { label: "Shaders", value: s.programs.toLocaleString() },
    { label: "Adventurers", value: store.views.length.toLocaleString() },
    { label: "Quality", value: TIERS[tier].name, budget: "adaptive" },
  ]
  return (
    <Panel
      label="Stats for nerds"
      meta={
        <span className="mono">
          {Math.round(s.fps)} fps · {s.calls} calls
        </span>
      }
      open={open}
      onToggle={onToggle}
      className="stats"
    >
      <dl className="stats-grid">
        {rows.map((row) => (
          <div key={row.label} className="stats-row" data-over={row.over ?? false}>
            <dt>{row.label}</dt>
            <dd className="mono">{row.value}</dd>
            <dd className="stats-budget mono">{row.budget ?? ""}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}
