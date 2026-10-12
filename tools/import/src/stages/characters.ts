/**
 * Skinned pieces (kind "character"): they keep their skin and joints, and run this instead of the
 * static stages:
 *   scale     the pack factor, baked into the skeleton (`scaleSkeleton`: node translations, vertices,
 *             inverse bind matrices), so the model stays in bind space and fits a rig built at that factor
 *   bones     every bone the rig's clips animate must be a node of this model, checked against
 *             `<library>/rigs/<rig>.glb` (`ctx.library`); the import builds the rigs before any piece
 *   clips     stripped from the piece; their names stay in the report, the rig GLB carries the clips
 *   colour    the palette bake (skin attributes are carried through); `keep-texture` keeps the texture
 *   optimize  meshopt with POSITION left in float, then measure
 * No pivot, ground or AO: a character stands at its own origin, and AO baked in the bind pose would
 * be wrong once it moves.
 */
import { existsSync, statSync } from "node:fs"
import { join } from "node:path"
import type { Document } from "@gltf-transform/core"
import { animatedNodes, characterScale, rigFile, scaleSkeleton } from "../rigs.ts"
import { colour } from "./colour.ts"
import { measure } from "./measure.ts"
import { optimize } from "./optimize.ts"
import type { Stage } from "./types.ts"

/** Removes every animation (channels and samplers; prune drops their data); returns the clip names. */
export function stripAnimations(doc: Document): string[] {
  const names: string[] = []
  for (const anim of doc.getRoot().listAnimations()) {
    names.push(anim.getName())
    for (const channel of anim.listChannels()) channel.dispose()
    for (const sampler of anim.listSamplers()) sampler.dispose()
    anim.dispose()
  }
  return names
}

/** Rig bones the model has no node for (a clip would animate nothing there), sorted. */
export function missingBones(doc: Document, bones: ReadonlySet<string>): string[] {
  const nodes = new Set(
    doc
      .getRoot()
      .listNodes()
      .map((n) => n.getName()),
  )
  return [...bones].filter((b) => !nodes.has(b)).sort()
}

const rigBones = new Map<string, Promise<Set<string>>>()
const unbuilt = new Set<string>()

/** The rig's animated bones, read once per file version; undefined while the rig is not built. */
function bonesOf(file: string): Promise<Set<string>> | undefined {
  if (!existsSync(file)) return undefined
  const key = `${file}\0${statSync(file).mtimeMs}`
  let bones = rigBones.get(key)
  if (!bones) {
    bones = animatedNodes(file)
    rigBones.set(key, bones)
  }
  return bones
}

export const characters: Stage = async (doc, ctx) => {
  const rig = ctx.out.character?.rig ?? ctx.source.rig
  if (!rig) throw new Error(`${ctx.source.source}: a character needs a rig`)
  const scale = characterScale(ctx.pack, ctx.source)
  scaleSkeleton(doc, scale.factor)
  ctx.out.scale = { ...scale, confidence: "pack", flags: [] }

  const file = join(ctx.library, rigFile(rig))
  const bones = await bonesOf(file)
  if (!bones) {
    if (!unbuilt.has(file)) ctx.log.warn(`rig "${rig}" is not built (${file}); bones not checked`)
    unbuilt.add(file)
  } else {
    const missing = missingBones(doc, bones)
    if (missing.length > 0) throw new Error(`skeleton does not match rig "${rig}": no ${missing.join(", ")}`)
  }

  const clips = stripAnimations(doc)
  if (ctx.out.character) ctx.out.character.clips = clips
  await colour(doc, ctx)
  await optimize(doc, ctx)
  await measure(doc, ctx)
  ctx.log.debug("character", { rig, clips: clips.length, factor: scale.factor })
}
