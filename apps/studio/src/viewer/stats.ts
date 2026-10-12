/** What the inspector says about a catalog entry, as plain rows: the panel only lays them out. */
import { type CatalogEntry, PALETTE, type ScaleTarget } from "@guildhall/assets"

export interface Row {
  label: string
  value: string
  unit?: string
  /** Shown in the warning tone: a value that is a stand-in, not a real answer yet. */
  placeholder?: boolean
}

export interface Chip {
  id: number
  name: string
  hex: string
}

export interface Described {
  size: Row[]
  scale: Row[]
  compose: Row[]
  character: Row[]
  swatches: Chip[]
  /** Scale flags and piece flags, kept apart so the panel can tone them differently. */
  scaleFlags: string[]
  pieceFlags: string[]
}

const m = (v: number) => v.toFixed(2)

/** `5.5–∞` style band in metres. */
export function bandText([min, max]: ScaleTarget): string {
  return `${min}–${max === null ? "∞" : max}`
}

function bytesText(bytes: number): { value: string; unit: string } {
  return bytes >= 1024 * 1024
    ? { value: (bytes / (1024 * 1024)).toFixed(1), unit: "MB" }
    : { value: (bytes / 1024).toFixed(1), unit: "KB" }
}

export function describe(e: CatalogEntry): Described {
  const [w, h, d] = e.size
  const bytes = bytesText(e.bytes)
  const placeholder = e.compose.source === "placeholder"
  const swatches = e.swatches.map((id) => {
    const swatch = PALETTE.swatches[id]
    return { id, name: swatch?.name ?? `#${id}`, hex: swatch?.hex ?? "#000000" }
  })
  return {
    size: [
      { label: "height", value: m(h), unit: "m" },
      { label: "width × depth", value: `${m(w)} × ${m(d)}`, unit: "m" },
      { label: "footprint", value: `${e.footprint.w} × ${e.footprint.d}`, unit: "cells" },
      { label: "tris", value: e.tris.toLocaleString("en-US") },
      { label: "verts", value: e.verts.toLocaleString("en-US") },
      { label: "glb", value: bytes.value, unit: bytes.unit },
    ],
    scale: [
      { label: "factor", value: `×${e.scale.factor}` },
      { label: "rule", value: e.scale.rule },
      { label: "confidence", value: e.scale.confidence, placeholder: e.scale.confidence === "guess" },
      { label: "target height", value: e.scale.target ? bandText(e.scale.target) : "none", unit: "m" },
    ],
    compose: [
      { label: "source", value: e.compose.source, placeholder },
      { label: "attach", value: e.compose.attach },
      { label: "front", value: e.compose.front ?? "—" },
      { label: "street edge", value: e.compose.streetEdge ?? "—" },
      { label: "anchors", value: String(e.compose.anchors.length) },
      ...(e.compose.edgeKind ? [{ label: "edge kind", value: e.compose.edgeKind }] : []),
    ],
    character: e.character
      ? [
          { label: "rig", value: e.character.rig },
          { label: "clips", value: String(e.character.clips.length) },
          { label: "bones", value: String(e.character.bones) },
        ]
      : [],
    swatches,
    scaleFlags: [...e.scale.flags],
    pieceFlags: [...e.flags],
  }
}
