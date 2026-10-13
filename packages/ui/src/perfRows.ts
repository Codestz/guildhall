import type { FrameStats } from "@guildhall/core"

export interface PerfRow {
  label: string
  value: string
  unit: string
}

const count = (n: number): string => Math.round(n).toLocaleString("en-US")
const ms = (n: number): string => n.toFixed(1)

/**
 * The HUD's rows for one reading, in display order. Formatting only; the numbers are the stage's.
 * The frame cost leads: it is what the budget holds. The animation-frame rate follows, labelled as
 * such, since without vsync (headless) it says nothing about cost. Draws split into main and shadow
 * passes when the reading has them.
 */
export function perfRows(s: FrameStats): PerfRow[] {
  const cost: PerfRow[] = s.costMs
    ? [
        { label: "cost p50", value: ms(s.costMs.p50), unit: "ms" },
        { label: "cost p95", value: ms(s.costMs.p95), unit: "ms" },
      ]
    : []
  const draws: PerfRow[] =
    s.mainCalls !== undefined
      ? [
          { label: "calls main", value: count(s.mainCalls), unit: "" },
          { label: "calls shadow", value: count(s.shadowCalls ?? 0), unit: "" },
          { label: "tris main", value: count(s.mainTris ?? 0), unit: "" },
          { label: "tris shadow", value: count(s.shadowTris ?? 0), unit: "" },
        ]
      : [
          { label: "draw calls", value: count(s.calls), unit: "" },
          { label: "triangles", value: count(s.tris), unit: "" },
        ]
  // the GPU passes and the CPU buckets, when the stage has timers (render timing.ts)
  const passes: PerfRow[] = Object.entries(s.passes ?? {}).map(([name, v]) => ({
    label: `gpu ${name}`,
    value: ms(v),
    unit: "ms",
  }))
  const cpu: PerfRow[] = Object.entries(s.cpu ?? {}).map(([name, v]) => ({
    label: `cpu ${name}`,
    value: ms(v),
    unit: "ms",
  }))
  return [
    ...cost,
    ...passes,
    ...cpu,
    { label: "rAF fps", value: count(s.fps), unit: "" },
    { label: "rAF p50", value: ms(s.frameMs.p50), unit: "ms" },
    { label: "rAF p95", value: ms(s.frameMs.p95), unit: "ms" },
    ...draws,
    { label: "geometries", value: count(s.geometries), unit: "" },
    { label: "textures", value: count(s.textures), unit: "" },
    { label: "dpr", value: s.dpr.toFixed(2), unit: "×" },
  ]
}
