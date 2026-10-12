/**
 * Rigs: one clip-only GLB per rig id (`library/rigs/<id>.glb`: the skeleton's nodes and its clips,
 * meshes and skins stripped, keyframes resampled), and the skeleton maths characters share with it.
 *
 * A rig collects the files every given pack lists under `rigs[]` with that id (globs relative to the
 * pack's source folder), in pack order then file order, so one rig can gather clips from several
 * packs; `clips` (globs) keeps only matching clips. A clip name seen again is dropped (packs ship the
 * same clip in several files); it is logged when its length differs. Every file must animate bones of
 * one skeleton: clips are rebound to the first file's nodes by name, and a missing bone is an error.
 * The GLB is rewritten only when its bytes change.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { extname, join } from "node:path"
import {
  type Accessor,
  type Animation,
  Document,
  Logger as GltfLogger,
  type Node,
} from "@gltf-transform/core"
import { EXTMeshoptCompression } from "@gltf-transform/extensions"
import { dedup, mergeDocuments, prune, resample, unpartition } from "@gltf-transform/functions"
import type { PackConfig, RigEntry, ScaleInfo } from "@guildhall/assets"
import { type Logger, log } from "@guildhall/core"
import { globToRegExp, kebab, listFiles, MODEL_EXTS, matches, stem } from "./discover.ts"
import { defaultScene, gltfIO, readModel } from "./read.ts"

export const rigFile = (id: string): string => `rigs/${id}.glb`

const QUIET = new GltfLogger(GltfLogger.Verbosity.WARN)
const r3 = (v: number): number => Math.round(v * 1000) / 1000 || 0

/**
 * A character's (or rig file's) factor: its override, the first matching `scaleBy` factor, then the
 * pack's factor. A reference scale measures a static piece, so it cannot apply to a skeleton.
 */
export function characterScale(
  pack: PackConfig,
  piece: { name: string; source: string; slug: string },
): Pick<ScaleInfo, "factor" | "rule"> {
  const override = pack.overrides?.[piece.slug]?.factor
  if (override !== undefined) return { factor: override, rule: "override" }
  const by = pack.scaleBy?.find((s) => matches(s.match, piece.name, piece.source))
  if (by?.factor !== undefined) return { factor: by.factor, rule: "factor" }
  if (by || "ref" in pack.scale)
    throw new Error(
      `${piece.source}: a skeleton needs a factor scale (a scaleBy or override factor), not a ref`,
    )
  return { factor: pack.scale.factor, rule: "factor" }
}

/** Scales the chosen components of every element of an accessor once, however many users it has. */
function scaleAccessor(acc: Accessor | null, f: number, seen: Set<Accessor>, pick?: (k: number) => boolean) {
  if (!acc || seen.has(acc)) return
  seen.add(acc)
  const el: number[] = []
  for (let i = 0; i < acc.getCount(); i++) {
    acc.getElement(i, el)
    for (let k = 0; k < el.length; k++) if (!pick || pick(k)) el[k] = (el[k] ?? 0) * f
    acc.setElement(i, el)
  }
}

/**
 * Uniform scale by `f` about the origin, baked: J' = S·J·S⁻¹ for every node (translations × f),
 * IBM' = S·IBM·S⁻¹ (its translation column × f), v' = S·v, so a skinned vertex lands at S·(J·IBM·v).
 * Translation clips scale with the nodes they drive.
 */
export function scaleSkeleton(doc: Document, f: number): void {
  if (f === 1) return
  const root = doc.getRoot()
  const seen = new Set<Accessor>()
  for (const node of root.listNodes()) {
    const [x, y, z] = node.getTranslation()
    node.setTranslation([x * f, y * f, z * f])
  }
  for (const mesh of root.listMeshes())
    for (const prim of mesh.listPrimitives()) {
      scaleAccessor(prim.getAttribute("POSITION"), f, seen)
      for (const target of prim.listTargets()) scaleAccessor(target.getAttribute("POSITION"), f, seen)
    }
  for (const skin of root.listSkins())
    scaleAccessor(skin.getInverseBindMatrices(), f, seen, (k) => k >= 12 && k <= 14)
  for (const anim of root.listAnimations())
    for (const channel of anim.listChannels())
      if (channel.getTargetPath() === "translation")
        scaleAccessor(channel.getSampler()?.getOutput() ?? null, f, seen)
}

/** A clip's length: the last keyframe time over its samplers. */
export function clipSeconds(anim: Animation): number {
  let end = 0
  for (const sampler of anim.listSamplers()) end = Math.max(end, sampler.getInput()?.getMax([0])[0] ?? 0)
  return end
}

/** The names of the nodes a GLB's clips animate. */
export async function animatedNodes(file: string): Promise<Set<string>> {
  const doc = await (await gltfIO()).read(file)
  const names = new Set<string>()
  for (const anim of doc.getRoot().listAnimations())
    for (const channel of anim.listChannels()) {
      const node = channel.getTargetNode()
      if (node) names.add(node.getName())
    }
  return names
}

interface RigSource {
  pack: PackConfig
  file: string
  source: string
  clips?: string[]
}

/** Every rig id the packs declare → its files, in pack order then sorted file order. */
function rigSources(packs: readonly PackConfig[], raw: string): Map<string, RigSource[]> {
  const out = new Map<string, RigSource[]>()
  for (const pack of packs)
    for (const decl of pack.rigs ?? []) {
      const dir = join(raw, pack.source)
      const globs = decl.files.map(globToRegExp)
      const files = existsSync(dir)
        ? listFiles(dir).filter(
            (f) => MODEL_EXTS.includes(extname(f).toLowerCase()) && globs.some((re) => re.test(f)),
          )
        : []
      if (files.length === 0) throw new Error(`${pack.id}: rig "${decl.id}" lists no model file`)
      const list = out.get(decl.id) ?? []
      for (const f of files)
        list.push({ pack, file: join(dir, f), source: f, ...(decl.clips ? { clips: decl.clips } : {}) })
      out.set(decl.id, list)
    }
  return out
}

/** One rig's clip-only document and its entry (without writing anything). */
export async function buildRig(
  id: string,
  sources: readonly RigSource[],
  cacheDir: string,
  logger: Logger = log("import").child("rigs"),
): Promise<{ doc: Document; entry: RigEntry }> {
  const target = new Document().setLogger(QUIET)
  const seconds = new Map<string, number>()
  let bones: number | undefined
  for (const src of sources) {
    const doc = (await readModel(src.file, cacheDir)).setLogger(QUIET)
    const root = doc.getRoot()
    const name = stem(src.source)
    scaleSkeleton(doc, characterScale(src.pack, { name, source: src.source, slug: kebab(name) }).factor)
    bones ??= root.listSkins()[0]?.listJoints().length
    const keep = src.clips?.map(globToRegExp)
    for (const anim of root.listAnimations()) {
      const clip = anim.getName()
      const length = clipSeconds(anim)
      const seen = seconds.get(clip)
      if (seen !== undefined && Math.abs(seen - length) > 1e-3)
        logger.warn(
          `rig "${id}": clip "${clip}" again in ${src.source} (${r3(length)} s, kept ${r3(seen)} s)`,
        )
      if (seen !== undefined || (keep && !keep.some((re) => re.test(clip)))) anim.dispose()
      else seconds.set(clip, length)
    }
    for (const node of root.listNodes()) {
      if (!node.getMesh()) continue
      if (node.listChildren().length > 0) node.setMesh(null).setSkin(null)
      else node.dispose()
    }
    for (const skin of root.listSkins()) skin.dispose()
    await doc.transform(prune({ keepLeaves: true }))
    mergeDocuments(target, doc)
  }
  rebind(id, target)
  const root = target.getRoot()
  if (root.listAnimations().length === 0) throw new Error(`rig "${id}": no clips`)
  await target.transform(unpartition(), resample(), dedup(), prune({ keepLeaves: true }))
  // FILTER: meshopt's quaternion (16-bit) and exponential (12-bit) filters on the keyframe outputs.
  target
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER })

  const scene = defaultScene(target)
  let nodes = 0
  scene?.traverse(() => {
    nodes++
  })
  const clips = root
    .listAnimations()
    .map((a) => ({ name: a.getName(), seconds: r3(clipSeconds(a)) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return { doc: target, entry: { id, file: rigFile(id), clips, bones: bones ?? nodes } }
}

/**
 * Each merged file brought its own copy of the skeleton. Points every clip at the first copy by bone
 * name and drops the rest (three renames duplicate node names on load, so a clip bound to a copy
 * would animate nothing).
 */
function rebind(id: string, doc: Document): void {
  const root = doc.getRoot()
  const [keep, ...extra] = root.listScenes()
  if (!keep) throw new Error(`rig "${id}": no skeleton`)
  const bones = new Map<string, Node>()
  keep.traverse((node) => {
    if (!bones.has(node.getName())) bones.set(node.getName(), node)
  })
  for (const anim of root.listAnimations())
    for (const channel of anim.listChannels()) {
      const node = channel.getTargetNode()
      const bone = node && bones.get(node.getName())
      if (!bone)
        throw new Error(
          `rig "${id}": clip "${anim.getName()}" animates "${node?.getName()}", not in the skeleton`,
        )
      channel.setTargetNode(bone)
    }
  const doomed: Node[] = []
  for (const scene of extra) scene.traverse((node) => doomed.push(node))
  for (const node of doomed) node.dispose()
  for (const scene of extra) scene.dispose()
  root.setDefaultScene(keep)
}

/**
 * Builds and writes every rig the packs declare (`library/rigs/<id>.glb`), returning the index's
 * `rigs[]`, sorted by id. Pass every pack that shares a rig: a rig is built from the packs given.
 */
export async function importRigs(
  packs: readonly PackConfig[],
  raw: string,
  library: string,
  logger: Logger = log("import").child("rigs"),
): Promise<RigEntry[]> {
  const io = await gltfIO()
  const entries: RigEntry[] = []
  const all = rigSources(packs, raw)
  for (const id of [...all.keys()].sort()) {
    const { doc, entry } = await buildRig(id, all.get(id) ?? [], join(library, ".cache"), logger)
    const bytes = await io.writeBinary(doc)
    const file = join(library, entry.file)
    if (!existsSync(file) || !Buffer.from(readFileSync(file)).equals(Buffer.from(bytes))) {
      mkdirSync(join(library, "rigs"), { recursive: true })
      writeFileSync(file, bytes)
    }
    logger.info(`rig ${id}: ${entry.clips.length} clips, ${entry.bones} bones, ${bytes.byteLength} bytes`)
    entries.push(entry)
  }
  return entries
}
