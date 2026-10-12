/**
 * The piece as it will be written: size, footprint, tris, verts and palette swatches (from
 * `_SWATCH`), the category scale check (ADR 004), the `high-tris` flag, and compose meta from the
 * matching rule and the piece's override. Runs last, on the normalized, coloured, optimized document.
 */
import { getBounds, getGLPrimitiveCount } from "@gltf-transform/functions"
import { type Category, type ComposeMeta, checkScale } from "@guildhall/assets"
import { defaultScene } from "../read.ts"
import type { Measures, Stage, StageCtx } from "./types.ts"

/** A side within this of a whole cell still fits in it (metres). */
const CELL_TOLERANCE = 0.05
/**
 * Triangles above which a piece is flagged `high-tris`. Provisional, from the pack scan (medians
 * 200–900, rare outliers to 13k); calibrate with the real import.
 */
export const TRI_BUDGET: Readonly<Partial<Record<Category, number>>> = {
  building: 6000,
  tower: 6000,
  cliff: 6000,
  bridge: 4000,
  tree: 4000,
  vehicle: 4000,
}
export const DEFAULT_TRI_BUDGET = 2500

/** glTF TRIANGLES, TRIANGLE_STRIP, TRIANGLE_FAN; points and lines carry no triangles. */
const TRIANGLE_MODES: readonly number[] = [4, 5, 6]
const r2 = (v: number): number => Math.round(v * 100) / 100 || 0

/** Whole 1 m cells covering a size's width and depth, with a 5 cm tolerance; at least one cell. */
export function footprintOf(size: Measures["size"]): Measures["footprint"] {
  const cells = (m: number): number => Math.max(1, Math.ceil(Math.round((m - CELL_TOLERANCE) * 1000) / 1000))
  return { w: cells(size[0]), d: cells(size[2]) }
}

export const measure: Stage = async (doc, ctx) => {
  const scene = defaultScene(doc)
  let tris = 0
  let verts = 0
  scene?.traverse((node) => {
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const pos = prim.getAttribute("POSITION")
      if (!pos) continue
      verts += pos.getCount()
      if (TRIANGLE_MODES.includes(prim.getMode())) tris += getGLPrimitiveCount(prim)
      const swatch = prim.getAttribute("_SWATCH")
      for (let i = 0; i < (swatch?.getCount() ?? 0); i++)
        ctx.out.swatches.add(Math.round(swatch?.getElement(i, [0])[0] ?? 0))
    }
  })
  const box = scene ? getBounds(scene) : undefined
  const size: Measures["size"] =
    box && Number.isFinite(box.min[0])
      ? [r2(box.max[0] - box.min[0]), r2(box.max[1] - box.min[1]), r2(box.max[2] - box.min[2])]
      : [0, 0, 0]
  ctx.out.measures = { size, footprint: footprintOf(size), tris, verts }

  const category = ctx.source.category
  if (tris > (TRI_BUDGET[category] ?? DEFAULT_TRI_BUDGET)) ctx.out.flags.add("high-tris")
  if (ctx.out.scale) {
    const { target, flags } = checkScale(category, size)
    ctx.out.scale = target
      ? { ...ctx.out.scale, target, flags }
      : { ...ctx.out.scale, confidence: "pack", flags: [] }
  }
  ctx.out.compose = composeOf(ctx)
}

/** Rule fields, then the override's; `manual` when the override set any, `rule` when the rule did. */
function composeOf({ source, out }: StageCtx): ComposeMeta {
  const rule = source.rule
  const over = source.override
  const compose: ComposeMeta = {
    front: over?.front ?? rule?.front ?? null,
    streetEdge: rule?.streetEdge ?? null,
    attach: rule?.attach ?? "free",
    anchors: out.compose.anchors,
    source: "placeholder",
  }
  if (rule?.edgeKind) compose.edgeKind = rule.edgeKind
  if (over?.front !== undefined || over?.anchors !== undefined) compose.source = "manual"
  else if (rule && (rule.front ?? rule.streetEdge ?? rule.attach ?? rule.edgeKind) !== undefined)
    compose.source = "rule"
  return compose
}
