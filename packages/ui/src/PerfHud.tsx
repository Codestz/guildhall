import type { FrameStats } from "@guildhall/core"
import { type CSSProperties, useEffect, useState } from "react"
import { perfRows } from "./perfRows.ts"

/** How often the HUD reads the stats: often enough to feel live, rare enough to cost nothing. */
const REFRESH_MS = 250

const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace'

const panel: CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  minWidth: 184,
  padding: "8px 12px 9px",
  borderRadius: 7,
  background: "rgba(20, 15, 11, 0.86)",
  border: "1px solid rgba(220, 182, 98, 0.34)",
  boxShadow: "0 18px 40px -18px rgba(0, 0, 0, 0.7), 0 2px 8px rgba(0, 0, 0, 0.28)",
  backdropFilter: "blur(6px)",
  color: "#f3e9d4",
  font: `500 12px/1.5 ${MONO}`,
  fontVariantNumeric: "tabular-nums",
  pointerEvents: "none",
  userSelect: "none",
  zIndex: 40,
}
const title: CSSProperties = {
  margin: "0 0 4px",
  paddingBottom: 4,
  borderBottom: "1px solid rgba(243, 233, 212, 0.1)",
  color: "#dcb662",
  fontSize: 10.5,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
}
const row: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 16 }
const label: CSSProperties = { color: "#cdbfa3" }
const unit: CSSProperties = { color: "#ab9e85", marginLeft: 3 }

/**
 * A small frame-cost overlay. It polls `stats` a few times a second and re-renders only itself, so the
 * canvas underneath (drawn by render's own loop) is never touched by React.
 */
export function PerfHud({ stats }: { stats: () => FrameStats }) {
  const [reading, setReading] = useState(stats)
  useEffect(() => {
    setReading(stats())
    const id = setInterval(() => setReading(stats()), REFRESH_MS)
    return () => clearInterval(id)
  }, [stats])

  return (
    <div style={panel} role="status" aria-label="Frame stats" data-testid="perf-hud">
      <p style={title}>perf</p>
      {perfRows(reading).map((r) => (
        <div key={r.label} style={row}>
          <span style={label}>{r.label}</span>
          <span>
            {r.value}
            {r.unit && <span style={unit}>{r.unit}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}
