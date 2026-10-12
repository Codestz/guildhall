import type { FrameStats } from "@guildhall/core"

export interface PerfRow {
  label: string
  value: string
  unit: string
}

const count = (n: number): string => Math.round(n).toLocaleString("en-US")
const ms = (n: number): string => n.toFixed(1)

/** The HUD's rows for one reading, in display order. Formatting only; the numbers are the stage's. */
export function perfRows(s: FrameStats): PerfRow[] {
  return [
    { label: "fps", value: count(s.fps), unit: "" },
    { label: "frame p50", value: ms(s.frameMs.p50), unit: "ms" },
    { label: "frame p95", value: ms(s.frameMs.p95), unit: "ms" },
    { label: "draw calls", value: count(s.calls), unit: "" },
    { label: "triangles", value: count(s.tris), unit: "" },
    { label: "geometries", value: count(s.geometries), unit: "" },
    { label: "textures", value: count(s.textures), unit: "" },
    { label: "dpr", value: s.dpr.toFixed(2), unit: "×" },
  ]
}
