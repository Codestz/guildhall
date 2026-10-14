/**
 * Scale to hero-relative metres (ADR 004), pivot, ground and sink. The node tree's transforms are
 * baked into the vertices first (skinned meshes are left alone), so every later stage reads
 * world-space positions with identity nodes.
 *
 * The scale is, in order of precedence: the piece's override `factor`, the first matching `scaleBy`
 * entry, then the pack's `scale`. A `ref` scale measures the named reference piece once per pack and
 * run (memoised) and solves the factor that gives it the target metres.
 *
 * Units: `ground` is in source units (as `bun import scan` reports them), `sink` in metres. Override
 * anchors are authored in the raw model's frame and come out in piece space, through the same
 * transform as the vertices (a door's `height` only serves `doorTop` and is not carried on).
 */
import { join } from "node:path"
import type { Document, Node, Scene } from "@gltf-transform/core"
import { clearNodeParent, clearNodeTransform, getBounds, transformMesh } from "@gltf-transform/functions"
import type { PackConfig, PackScale, PieceOverride, ScaleInfo } from "@guildhall/assets"
import { hypot } from "@guildhall/core"
import { discover, kebab, matches } from "../discover.ts"
import { defaultScene, readModel, splitTopNodes } from "../read.ts"
import type { PieceSource, Stage, StageCtx } from "./types.ts"

type OverrideAnchor = PieceOverride["anchors"][number]
type RefMeasure = Extract<PackScale, { ref: string }>["measure"]
type Vec3 = [number, number, number]

/** Within this of the target, a piece's bottom counts as on the ground (metres). */
const GROUND_TOLERANCE = 0.01
/** A kept pivot further than this from the bbox's xz centre is flagged `off-centre` (metres). */
const CENTRE_TOLERANCE = 0.1
/** `trunk` pivots on the xz centroid of this share of the lowest vertices. */
const TRUNK_SHARE = 0.1

export const normalize: Stage = async (doc, ctx) => {
  const scene = defaultScene(doc)
  if (!scene) return
  const nodes = bake(scene)
  const scale = await scaleOf(ctx)
  const pivotMode = ctx.source.override?.pivot ?? ctx.pack.pivot
  const sink = ctx.pack.sink ?? 0
  const f = scale.factor

  const positions = worldPositions(nodes)
  const box = bounds(positions)
  const pivot: Vec3 = [0, 0, 0]
  if (box && pivotMode !== "keep") {
    const [x, z] =
      pivotMode === "trunk"
        ? trunk(positions)
        : [(box.min[0] + box.max[0]) / 2, (box.min[2] + box.max[2]) / 2]
    pivot[0] = x
    pivot[1] = box.min[1]
    pivot[2] = z
  }
  if (ctx.pack.ground !== undefined) pivot[1] = ctx.pack.ground

  // v' = f·(v − pivot) − (0, sink, 0), column-major.
  const t: Vec3 = [-f * pivot[0], -f * pivot[1] - sink, -f * pivot[2]]
  const matrix = [f, 0, 0, 0, 0, f, 0, 0, 0, 0, f, 0, t[0], t[1], t[2], 1] as Parameters<
    typeof transformMesh
  >[1]
  const meshes = new Set(nodes.map((n) => n.getMesh()).filter((m) => m !== null))
  for (const mesh of meshes) transformMesh(mesh, matrix)
  const place = (v: readonly number[]): Vec3 => [
    f * (v[0] ?? 0) + t[0],
    f * (v[1] ?? 0) + t[1],
    f * (v[2] ?? 0) + t[2],
  ]

  ctx.out.scale = scale
  const anchors = ctx.source.override?.anchors
  if (anchors)
    ctx.out.compose.anchors = anchors.map((a) => ({
      id: a.id,
      kind: a.kind,
      at: place(a.at),
      facing: a.facing,
    }))
  if (box) {
    const lo = place(box.min)
    const hi = place(box.max)
    // Measured before the sink: an intended embed is not a defect.
    const bottom = lo[1] + sink
    if (bottom < -GROUND_TOLERANCE) ctx.out.flags.add("sunk")
    if (bottom > GROUND_TOLERANCE) ctx.out.flags.add("floating")
    if (pivotMode === "keep" && hypot((lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2) > CENTRE_TOLERANCE)
      ctx.out.flags.add("off-centre")
  }
  ctx.log.debug("normalized", { factor: f, rule: scale.rule, pivot: pivotMode, sink })
}

/** Bakes every non-skinned mesh node's world transform into its vertices; returns those nodes. */
function bake(scene: Scene): Node[] {
  const nodes: Node[] = []
  scene.traverse((n) => {
    if (n.getMesh() && !n.getSkin()) nodes.push(n)
  })
  for (const node of nodes) {
    const mesh = node.getMesh()
    // A mesh shared by several nodes gets its own copy, or the first bake would move the others too.
    if (mesh && mesh.listParents().filter((p) => p.propertyType === "Node").length > 1)
      node.setMesh(mesh.clone())
    clearNodeParent(node)
    clearNodeTransform(node)
  }
  return nodes
}

/** Every vertex of the (baked) nodes, in world space. */
function worldPositions(nodes: readonly Node[]): Vec3[] {
  const out: Vec3[] = []
  const seen = new Set<unknown>()
  for (const node of nodes) {
    const mesh = node.getMesh()
    if (!mesh || seen.has(mesh)) continue
    seen.add(mesh)
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")
      if (!pos) continue
      for (let i = 0; i < pos.getCount(); i++) out.push(pos.getElement(i, [0, 0, 0]) as Vec3)
    }
  }
  return out
}

function bounds(points: readonly Vec3[]): { min: Vec3; max: Vec3 } | undefined {
  if (points.length === 0) return undefined
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const p of points)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] as number, p[k] as number)
      max[k] = Math.max(max[k] as number, p[k] as number)
    }
  return { min, max }
}

/** The xz centroid of the lowest `TRUNK_SHARE` of the vertices (ties broken by vertex order). */
function trunk(points: readonly Vec3[]): [x: number, z: number] {
  const order = points.map((_, i) => i).sort((a, b) => (points[a]?.[1] ?? 0) - (points[b]?.[1] ?? 0) || a - b)
  const take = Math.max(1, Math.ceil(points.length * TRUNK_SHARE))
  let x = 0
  let z = 0
  for (const i of order.slice(0, take)) {
    x += points[i]?.[0] ?? 0
    z += points[i]?.[2] ?? 0
  }
  return [x / take, z / take]
}

/**
 * The factor that brings a reference piece's measure to `metres`. `height` and `storey` read the
 * bbox height. `doorTop` reads the door's top above its threshold, in the raw frame: the `door`
 * anchor's `at` marks the top of the opening, and its threshold is `at.y − height` when the anchor
 * carries a `height` (so a plinth or steps under the door do not count), else the bbox bottom.
 */
export function refScale(
  doc: Document,
  measure: RefMeasure,
  metres: number,
  anchors?: readonly OverrideAnchor[],
): number {
  const scene = defaultScene(doc)
  const box = scene ? getBounds(scene) : undefined
  if (!box || !Number.isFinite(box.min[1])) throw new Error("reference piece has no geometry")
  let raw = box.max[1] - box.min[1]
  if (measure === "doorTop") {
    const door = anchors?.find((a) => a.kind === "door")
    if (!door) throw new Error('measure "doorTop" needs a "door" anchor in the reference piece\'s override')
    const threshold = door.height !== undefined ? door.at[1] - door.height : box.min[1]
    raw = door.at[1] - threshold
  }
  if (!(raw > 0)) throw new Error(`reference piece measures ${raw} (${measure}); cannot solve a scale`)
  return metres / raw
}

type Rule = { factor: number; rule: ScaleInfo["rule"] } | { ref: string; measure: RefMeasure; metres: number }

/** Which scale applies to this piece, before any reference is measured. */
function scaleRule(pack: PackConfig, source: PieceSource): Rule {
  const factor = source.override?.factor
  if (factor !== undefined) return { factor, rule: "override" }
  const by = pack.scaleBy?.find((s) => matches(s.match, source.name, source.source))
  if (by?.factor !== undefined) return { factor: by.factor, rule: "factor" }
  if (by?.ref !== undefined) {
    if (by.metres === undefined) throw new Error(`scaleBy "${by.match}": a ref needs metres`)
    return { ref: by.ref, measure: "ref" in pack.scale ? pack.scale.measure : "height", metres: by.metres }
  }
  return "factor" in pack.scale ? { factor: pack.scale.factor, rule: "factor" } : pack.scale
}

async function scaleOf(ctx: StageCtx): Promise<ScaleInfo> {
  const r = scaleRule(ctx.pack, ctx.source)
  const factor = "factor" in r ? r.factor : await refFactor(ctx, r)
  if (!(factor > 0) || !Number.isFinite(factor)) throw new Error(`scale factor ${factor}: expected > 0`)
  return "factor" in r
    ? { factor, rule: r.rule, confidence: "pack", flags: [] }
    : { factor, rule: "ref", confidence: "ref", flags: [] }
}

const refs = new Map<string, Promise<number>>()

/** One measurement per pack folder, reference and target, for the life of the process. */
function refFactor(ctx: StageCtx, r: { ref: string; measure: RefMeasure; metres: number }): Promise<number> {
  const key = [join(ctx.raw, ctx.pack.source), r.ref, r.measure, r.metres].join("\0")
  let factor = refs.get(key)
  if (!factor) {
    factor = measureRef(ctx, r)
    refs.set(key, factor)
  }
  return factor
}

/** A piece is the reference when its slug is kebab(ref), or `ref` matches it as a rule pattern. */
const isRef = (ref: string, name: string, path: string): boolean =>
  kebab(name) === kebab(ref) || matches(ref, name, path)

async function measureRef(
  { pack, raw }: StageCtx,
  r: { ref: string; measure: RefMeasure; metres: number },
): Promise<number> {
  for (const file of discover(pack, raw)) {
    const whole = pack.split !== "top-nodes"
    if (whole && !isRef(r.ref, file.name, file.source)) continue
    const doc = await readModel(file.file)
    const parts = whole ? [{ node: file.name, doc }] : await splitTopNodes(doc)
    const hit = parts.find((p) => whole || isRef(r.ref, p.node, `${file.source}#${p.node}`))
    if (!hit) continue
    const anchors = pack.overrides?.[kebab(hit.node)]?.anchors
    return refScale(hit.doc, r.measure, r.metres, anchors)
  }
  throw new Error(`scale ref "${r.ref}" matches no piece in ${pack.id}`)
}
