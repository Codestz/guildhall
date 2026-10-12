/**
 * Make the piece small: dedup, prune, weld, (simplify), then meshopt (reorder + quantize, written with
 * EXT_meshopt_compression in its QUANTIZE mode, plan's "meshopt medium").
 *
 * Weld merges only bitwise-identical vertices, so the colour stage's per-swatch splits (a different
 * _SWATCH, _SHADE or COLOR_0) survive; prune runs first so attributes nothing reads (stray UVs) do not
 * keep vertices apart.
 *
 * Quantization: POSITION gets the fewest bits (≥ 14) whose grid step is ≤ POSITION_STEP over the
 * largest mesh (14 bits hold 1 cm up to ~160 m); NORMAL 8 bits (< 0.5° error); COLOR_0 8 bits;
 * _SWATCH and _SHADE are bytes already and stay as they are. A skinned document keeps POSITION in
 * float: quantizing it would fold a per-model scale into the inverse bind matrices, and every model
 * that shares a rig wants the same bind pose.
 *
 * Simplify runs only when the piece's override asks: `simplify: <ratio>` (0–1, share of vertices kept).
 */
import type { Document } from "@gltf-transform/core"
import { EXTMeshoptCompression } from "@gltf-transform/extensions"
import { dedup, prune, quantize, reorder, simplify, weld } from "@gltf-transform/functions"
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer"
import type { Stage } from "./types.ts"

/** The largest quantized position step allowed, in metres. */
export const POSITION_STEP = 0.01
const POSITION_BITS = { min: 14, max: 16 } as const
/** Simplify's error budget, as a share of the mesh radius. */
export const SIMPLIFY_ERROR = 0.02

/** The vertex data the document holds, in bytes, before compression. */
export function accessorBytes(doc: Document): number {
  return doc
    .getRoot()
    .listAccessors()
    .reduce((sum, a) => sum + (a.getArray()?.byteLength ?? 0), 0)
}

/**
 * POSITION bits for a 1 cm grid: quantize maps each mesh's bbox onto [-1, 1] in signed steps of
 * halfExtent / (2^(bits−1) − 1). Undefined when even 16 bits are too coarse (leave it in float).
 */
export function positionBits(doc: Document): number | undefined {
  let half = 0
  for (const mesh of doc.getRoot().listMeshes()) {
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")
      if (!pos) continue
      const lo = pos.getMin([0, 0, 0])
      const hi = pos.getMax([0, 0, 0])
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k] as number, lo[k] ?? 0)
        max[k] = Math.max(max[k] as number, hi[k] ?? 0)
      }
    }
    for (let k = 0; k < 3; k++) half = Math.max(half, ((max[k] as number) - (min[k] as number)) / 2)
  }
  const bits = 1 + Math.ceil(Math.log2(half / POSITION_STEP + 1))
  if (bits > POSITION_BITS.max) return undefined
  return Math.max(POSITION_BITS.min, bits)
}

/** The override's `simplify` ratio, if it sets a valid one. */
export function simplifyRatio(override: unknown): number | undefined {
  const ratio = (override as { simplify?: unknown } | undefined)?.simplify
  if (ratio === undefined) return undefined
  if (typeof ratio !== "number" || !(ratio > 0 && ratio < 1))
    throw new Error(`override simplify: expected a ratio in (0, 1), got ${String(ratio)}`)
  return ratio
}

export const optimize: Stage = async (doc, ctx) => {
  const before = accessorBytes(doc)
  const skinned = doc.getRoot().listSkins().length > 0
  // Bones and attachment slots are often empty leaves; a static piece's empty nodes are noise.
  await doc.transform(dedup(), prune({ keepLeaves: skinned }), weld())
  const ratio = simplifyRatio(ctx.source.override)
  if (ratio !== undefined)
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: SIMPLIFY_ERROR }))

  const bits = skinned ? undefined : positionBits(doc)
  const pattern = bits === undefined ? /^(?!POSITION$|_SWATCH$|_SHADE$)/ : /^(?!_SWATCH$|_SHADE$)/
  await doc.transform(
    reorder({ encoder: MeshoptEncoder, target: "size" }),
    quantize({ pattern, quantizePosition: bits ?? 14, quantizeNormal: 8, quantizeColor: 8 }),
  )
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })
  ctx.log.debug("optimized", {
    bytes: { before, after: accessorBytes(doc) },
    positionBits: bits ?? 32,
    ratio,
  })
}
