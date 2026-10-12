/**
 * Townsfolk by the hundred (R5): `createCrowd(stage, actors, library)` draws every actor as the NPC
 * builder's person (`resolveNpc` look: body, outfit, hidden parts, held props), cheaply.
 *
 *   heroes   the nearest few, tall on screen (heroes.ts): full `createNpc` people with a mixer and
 *            real mounted props, their body parts merged into one draw;
 *   crowd    everyone else: one BatchedMesh of the ten KayKit bodies skinned in the vertex shader from
 *            one baked bone texture (bake.ts) and tinted per person (outfit.ts), coarser tiers by
 *            screen size (LodBatchedMesh); their props one more batch, posed on the CPU with the
 *            heroes' own maths (props.ts), left out when a person is a few pixels tall;
 *   shadows  a blob under everyone (blobs.ts), one draw: people never cast into the cached cascades.
 *
 * The caller owns the simulation: every frame `update(dt, sample)` reads each actor's place, heading,
 * clip and phase. A clip change fades over FADE seconds, the old clip held where it was left; the hero
 * and the crowd pose from that same state, so a hand-off between them does not pop.
 */
import { type Catalog, type MountSlot, type NpcLook, SLOT_FRAMES } from "@guildhall/assets"
import { log } from "@guildhall/core"
import {
  BatchedMesh,
  type BufferGeometry,
  DataTexture,
  FloatType,
  Matrix4,
  NearestFilter,
  type Object3D,
  type PerspectiveCamera,
  PropertyBinding,
  Quaternion,
  RGBAFormat,
  Vector3,
} from "three"
import { batchGeometry } from "../batchGeometry.ts"
import { LodBatchedMesh } from "../batchMesh.ts"
import { loadCharacter } from "../character/load.ts"
import { createNpc } from "../character/npc.ts"
import type { LodCounts } from "../lod.ts"
import { simplifierReady } from "../lodGeometry.ts"
import { paletteMaterial } from "../material.ts"
import { loadPiece } from "../pieces.ts"
import type { Stage } from "../stage.ts"
import { type BakePose, type BoneBake, bakeBytes, bakeClips, boneMap, frameAt } from "./bake.ts"
import { createBlobs } from "./blobs.ts"
import { chooseHeroes, glowSwatches, type Hero, makeHero, type Playing, poseHero } from "./heroes.ts"
import { crowdMaterial, crowdUniforms, PEOPLE_ROW, TEXELS_PER_PERSON } from "./material.ts"
import { outfitTable, tintTable } from "./outfit.ts"
import { mergeParts, type PartsTier, simplifyParts, skinnedParts } from "./parts.ts"
import { type HeldProp, propMatrix } from "./props.ts"

const logger = log("render:crowd")

/** One person: an id the caller samples by, and the look it wears. */
export interface CrowdActor {
  id: number
  look: NpcLook
}

/** Where an actor is this frame and what it plays. */
export interface ActorSample {
  /** Its feet, metres. */
  position: readonly [number, number, number]
  /** Radians about +y; 0 faces +z. */
  heading: number
  /** A clip of the rig (one of its look's clips, which are the ones baked). */
  clip: string
  /** 0–1 through the clip (wraps). */
  phase: number
}

/** Where bodies and props load from: the catalog (with mounts) and its library url mapping. */
export interface CrowdLibrary {
  catalog: Catalog
  url: (path: string) => string
}

export interface CrowdOpts {
  /** Most heroes at once (default 12); 0 draws everyone as crowd, ≥ the actor count everyone as hero. */
  heroes?: number
  /** On-screen height (CSS px) from which a person may become a hero (default heroes.ts TALL). */
  tall?: number
  /** Rows of the bake a second (default 30). */
  fps?: number
}

export interface CrowdStats {
  people: number
  heroes: number
  /** Heroes being made (loading), still drawn as crowd. */
  pending: number
  /** Crowd members drawn last frame, and their props. */
  crowd: number
  props: number
  /** Crowd bodies by LOD tier in the last main pass. */
  lod: LodCounts
  /** Bake: clips, rows and GPU bytes; crowd body geometry vertices (every tier). */
  clips: number
  rows: number
  bakeBytes: number
  vertices: number
}

export interface Crowd {
  /** Advances fades by `dt` seconds and draws everyone where `sample` says. */
  update(dt: number, sample: (id: number) => ActorSample): void
  /** These ids are heroes whatever their distance (the selected or followed), until set again. */
  setHeroes(ids: readonly number[]): void
  stats(): CrowdStats
  dispose(): void
}

/** Seconds a clip change cross-fades over. */
export const FADE = 0.25
/** People shorter than this on screen (CSS px) draw without their props. */
export const PROP_MIN_PX = 10
/** A standing person's height (m) at look scale 1, for their size on screen. */
export const FIGURE_HEIGHT = 1.9
/** The crowd bodies' coarser tiers, finer first (LodBatchedMesh picks by screen size). */
export const BODY_TIERS: readonly PartsTier[] = [
  { ratio: 0.45, error: 0.01 },
  { ratio: 0.2, error: 0.03 },
]
const DEFAULT_HEROES = 12

interface Body {
  /** Base geometry id in the batch. */
  geometry: number
  /** Part name (sanitized) → its bit. */
  parts: Map<string, number>
}

interface Person {
  actor: CrowdActor
  body: number
  instance: number
  props: { prop: HeldProp; instance: number }[]
  playing: Playing
  hidden: number
  hero: Hero | null
  /** A hero being made for it (resolves null when that failed or was given up). */
  pending: Promise<Hero | null> | null
  failed: boolean
}

/** Every clip name the looks play. */
export function lookClips(looks: readonly NpcLook[]): string[] {
  const names = new Set<string>()
  for (const look of looks) for (const clip of Object.values(look.clips)) names.add(clip)
  return [...names].sort()
}

/** The bake pose of `playing` (clip ids into `bake`); unknown clips fall back to the first. */
export function bakePose(bake: BoneBake, playing: Playing, out: BakePose): BakePose {
  const now = bake.clips[bake.clipIds.get(playing.clip) ?? 0]
  const was = playing.was === null ? undefined : bake.clips[bake.clipIds.get(playing.was) ?? -1]
  if (!now) throw new Error("bakePose: an empty bake")
  const a = frameAt(now, playing.phase)
  out.now = a.row
  out.blendNow = a.blend
  if (was && playing.fade < 1) {
    const b = frameAt(was, playing.wasPhase)
    out.was = b.row
    out.blendWas = b.blend
    out.fade = playing.fade
  } else {
    out.was = a.row
    out.blendWas = a.blend
    out.fade = 1
  }
  return out
}

/** Moves `playing` on to the sample's clip and phase, starting a fade on a clip change. */
export function advance(playing: Playing, clip: string, phase: number, dt: number): void {
  if (clip !== playing.clip) {
    playing.was = playing.clip
    playing.wasPhase = playing.phase
    playing.fade = 0
    playing.clip = clip
  } else if (playing.fade < 1) playing.fade = Math.min(1, playing.fade + dt / FADE)
  playing.phase = phase - Math.floor(phase)
}

export async function createCrowd(
  stage: Pick<Stage, "scene" | "camera" | "renderer">,
  actors: readonly CrowdActor[],
  library: CrowdLibrary,
  opts: CrowdOpts = {},
): Promise<Crowd> {
  const start = performance.now()
  const { catalog, url } = library
  const maxHeroes = opts.heroes ?? DEFAULT_HEROES
  const allHeroes = maxHeroes >= actors.length && actors.length > 0
  const entryOf = (id: string) => {
    const entry = catalog.get(id)
    if (!entry) throw new Error(`createCrowd: "${id}" is not in the catalog`)
    return entry
  }

  // The bake, on a copy of the first body (all KayKit bodies share Rig_Medium).
  const bodyIds = [...new Set(actors.map((a) => a.look.body))].sort()
  const first = bodyIds[0]
  const firstEntry = first ? entryOf(first) : null
  const rig = firstEntry?.character && catalog.rig(firstEntry.character.rig)
  if (!firstEntry || !rig) throw new Error("createCrowd: no actors, or the first body has no rig")
  const rigBody = await loadCharacter(firstEntry, rig, url)
  const wanted = lookClips(actors.map((a) => a.look))
  const clips = wanted.flatMap((name) => rigBody.clips.filter((c) => c.name === name))
  for (const name of wanted)
    if (!clips.some((c) => c.name === name)) logger.warn("clip not in the rig", { clip: name })
  const bake = bakeClips(rigBody.root, clips, opts.fps ?? 30)
  const tint = tintTable()
  const uniforms = crowdUniforms(bake, tint)

  // Body geometries, every part kept (people hide theirs by mask) and joints in the bake's order.
  await simplifierReady
  const roots = await Promise.all(bodyIds.map((id) => loadPiece(url(entryOf(id).files.glb))))
  const geometries: BufferGeometry[][] = []
  const partNames: string[][] = []
  for (const [i, root] of roots.entries()) {
    const parts = skinnedParts(root)
    const joints = parts[0] ? boneMap(bake, parts[0]) : null
    if (!joints) throw new Error(`createCrowd: body "${bodyIds[i]}" is not on the baked rig`)
    const base = mergeParts(parts, joints)
    geometries.push([base, ...BODY_TIERS.map((tier) => simplifyParts(base, tier))])
    partNames.push(parts.map((p) => p.name))
  }
  const vertices = geometries.flat().reduce((n, g) => n + g.getAttribute("position").count, 0)
  const indices = geometries.flat().reduce((n, g) => n + (g.index?.count ?? 0), 0)

  const material = crowdMaterial(uniforms)
  const bodies = new LodBatchedMesh(Math.max(1, actors.length), Math.max(1, vertices), Math.max(1, indices), material)
  bodies.name = "crowd:bodies"
  bodies.perObjectFrustumCulled = true
  bodies.sortObjects = false
  bodies.castShadow = false
  bodies.receiveShadow = true
  const bodyOf = new Map<string, Body>()
  for (const [i, tiers] of geometries.entries()) {
    const ids = tiers.map((g) => bodies.addGeometry(g))
    bodies.setTiers(ids[0] as number, ids.slice(1))
    const names = partNames[i] as string[]
    bodyOf.set(bodyIds[i] as string, {
      geometry: ids[0] as number,
      parts: new Map(names.map((n, bit) => [PropertyBinding.sanitizeNodeName(n), bit])),
    })
  }
  // The batch copied them into its own buffers.
  for (const g of geometries.flat()) g.dispose()

  // Props: one batch geometry per distinct prop, lanterns marked to glow.
  const propIds = [...new Set(actors.flatMap((a) => a.look.mounts.map((m) => m.piece)))].sort()
  const propGeometry = new Map<string, BufferGeometry>()
  await Promise.all(
    propIds.map(async (id) => {
      const piece = await loadPiece(url(entryOf(id).files.glb))
      propGeometry.set(id, batchGeometry(piece, {}, glowSwatches(id)))
    }),
  )
  const propCount = actors.reduce((n, a) => n + a.look.mounts.length, 0)
  const propVertices = [...propGeometry.values()].reduce((n, g) => n + g.getAttribute("position").count, 0)
  const propIndices = [...propGeometry.values()].reduce((n, g) => n + (g.index?.count ?? 0), 0)
  const props = new BatchedMesh(Math.max(1, propCount), Math.max(1, propVertices), Math.max(1, propIndices), paletteMaterial())
  props.name = "crowd:props"
  props.perObjectFrustumCulled = true
  props.sortObjects = false
  props.castShadow = false
  props.receiveShadow = true
  const propGeometryId = new Map<string, number>()
  for (const [id, g] of propGeometry) {
    propGeometryId.set(id, props.addGeometry(g))
    g.dispose()
  }

  const blobs = createBlobs(actors.length)
  stage.scene.add(bodies, props, blobs.mesh)

  // Per person: an instance, an outfit row, a hide mask, its props.
  const outfits = outfitTable(actors.map((a) => a.look.rampMap))
  uniforms.crowdOutfits.value = outfits
  const rows = Math.max(1, Math.ceil(actors.length / PEOPLE_ROW))
  const peopleData = new Float32Array(PEOPLE_ROW * TEXELS_PER_PERSON * rows * 4)
  const people = new DataTexture(peopleData, PEOPLE_ROW * TEXELS_PER_PERSON, rows, RGBAFormat, FloatType)
  people.minFilter = NearestFilter
  people.magFilter = NearestFilter
  people.generateMipmaps = false
  people.needsUpdate = true
  uniforms.crowdPeople.value = people

  const slotBone = (slot: MountSlot) => bake.bones.indexOf(PropertyBinding.sanitizeNodeName(SLOT_FRAMES[slot].bone))
  const persons: Person[] = actors.map((actor, i) => {
    const body = bodyOf.get(actor.look.body) as Body
    const instance = bodies.addInstance(body.geometry)
    let hidden = 0
    for (const part of actor.look.hide) {
      const bit = body.parts.get(PropertyBinding.sanitizeNodeName(part))
      if (bit !== undefined) hidden += 2 ** bit
    }
    const held = actor.look.mounts.flatMap(({ piece, slot }) => {
      const mount = catalog.get(piece)?.compose.mount
      const bone = slotBone(slot)
      if (!mount || bone < 0) {
        logger.warn("prop left out", { piece, slot })
        return []
      }
      return [{ prop: { mount, slot, bone }, instance: props.addInstance(propGeometryId.get(piece) as number) }]
    })
    const at = (i % PEOPLE_ROW) * TEXELS_PER_PERSON * 4 + Math.floor(i / PEOPLE_ROW) * PEOPLE_ROW * TEXELS_PER_PERSON * 4
    peopleData[at + 4] = 1
    peopleData[at + 5] = hidden
    peopleData[at + 6] = i
    return {
      actor,
      body: body.geometry,
      instance,
      props: held,
      playing: { clip: actor.look.clips.idle, phase: actor.look.phase, was: null, wasPhase: 0, fade: 1 },
      hidden,
      hero: null,
      pending: null,
      failed: false,
    }
  })

  logger.info("crowd", {
    people: actors.length,
    bodies: bodyIds.length,
    props: propIds.length,
    clips: bake.clips.length,
    rows: bake.texture.image.height,
    bakeKB: Math.round(bakeBytes(bake) / 1024),
    vertices,
    ms: Math.round(performance.now() - start),
  })

  let pinned = new Set<number>()
  let disposed = false
  const pose: BakePose = { now: 0, blendNow: 0, was: 0, blendWas: 0, fade: 1 }
  const place = new Matrix4()
  const local = new Matrix4()
  const world = new Matrix4()
  const turn = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const at = new Vector3()
  const size = new Vector3()
  const eye = new Vector3()
  const forward = new Vector3()
  let last = { crowd: 0, props: 0 }

  const makeHeroFor = (person: Person) => {
    const { look } = person.actor
    person.pending = createNpc(look, catalog, url)
      .then((npc) => {
        if (disposed) {
          npc.dispose()
          return null
        }
        return makeHero(npc, look.mounts.map((m) => m.piece))
      })
      .catch((error: unknown) => {
        logger.warn("hero failed; stays in the crowd", { id: person.actor.id, error: String(error) })
        person.failed = true
        return null
      })
    void person.pending.then((hero) => {
      person.pending = null
      if (!hero) return
      // Given up while it loaded: let it go. Otherwise it waits, hidden, for update to swap it in.
      if (!wantHero.has(person.actor.id)) {
        hero.dispose()
        return
      }
      person.hero = hero
      hero.npc.root.visible = false
      stage.scene.add(hero.npc.root)
    })
  }
  let wantHero = new Set<number>()

  return {
    update(dt, sample) {
      if (disposed) return
      const camera = stage.camera as PerspectiveCamera
      camera.updateMatrixWorld()
      eye.setFromMatrixPosition(camera.matrixWorld)
      forward.setFromMatrixColumn(camera.matrixWorld, 2).negate()
      const cssHeight = stage.renderer.domElement.clientHeight || 1
      const focal = cssHeight / (2 * Math.tan((camera.fov * Math.PI) / 360))

      const candidates: { id: number; distance: number; tall: number }[] = []
      const samples: ActorSample[] = []
      const talls: number[] = []
      for (const person of persons) {
        const s = sample(person.actor.id)
        samples.push(s)
        advance(person.playing, s.clip, s.phase, dt)
        const [x, y, z] = s.position
        const height = FIGURE_HEIGHT * person.actor.look.scale
        const depth = (x - eye.x) * forward.x + (y + height / 2 - eye.y) * forward.y + (z - eye.z) * forward.z
        const tall = depth > 0.1 ? (height * focal) / depth : 0
        talls.push(tall)
        candidates.push({ id: person.actor.id, distance: Math.hypot(x - eye.x, y - eye.y, z - eye.z), tall })
      }
      const current = new Set(persons.filter((p) => p.hero || p.pending).map((p) => p.actor.id))
      wantHero = allHeroes
        ? new Set(persons.map((p) => p.actor.id))
        : chooseHeroes(candidates, current, pinned, maxHeroes, opts.tall ? { tall: opts.tall, short: opts.tall * 0.8 } : {})

      let crowd = 0
      let held = 0
      for (const [i, person] of persons.entries()) {
        const s = samples[i] as ActorSample
        const want = wantHero.has(person.actor.id) && !person.failed
        if (want && !person.hero && !person.pending) makeHeroFor(person)
        if (!want && person.hero) {
          person.hero.dispose()
          person.hero = null
        }
        const [x, y, z] = s.position
        const scale = person.actor.look.scale
        blobs.place(i, x, y, z, scale)
        const hero = person.hero
        if (hero) {
          const root = hero.npc.root
          root.position.set(x, y, z)
          root.rotation.set(0, s.heading, 0)
          poseHero(hero.npc, person.playing)
          root.visible = true
          bodies.setVisibleAt(person.instance, false)
          for (const p of person.props) props.setVisibleAt(p.instance, false)
          continue
        }
        // The crowd member: its place, its rows in the bake, its props.
        bakePose(bake, person.playing, pose)
        const o = (i % PEOPLE_ROW) * TEXELS_PER_PERSON * 4 + Math.floor(i / PEOPLE_ROW) * PEOPLE_ROW * TEXELS_PER_PERSON * 4
        peopleData[o] = pose.now
        peopleData[o + 1] = pose.blendNow
        peopleData[o + 2] = pose.was
        peopleData[o + 3] = pose.blendWas
        peopleData[o + 4] = pose.fade
        turn.setFromAxisAngle(up, s.heading)
        place.compose(at.set(x, y, z), turn, size.setScalar(scale))
        bodies.setMatrixAt(person.instance, place)
        bodies.setVisibleAt(person.instance, true)
        crowd++
        const showProps = (talls[i] as number) >= PROP_MIN_PX
        for (const p of person.props) {
          const shown = showProps && propMatrix(bake, pose, person.playing.clip, p.prop, local)
          props.setVisibleAt(p.instance, shown)
          if (!shown) continue
          props.setMatrixAt(p.instance, world.multiplyMatrices(place, local))
          held++
        }
      }
      people.needsUpdate = true
      blobs.setCount(persons.length)
      last = { crowd, props: held }
    },
    setHeroes(ids) {
      pinned = new Set(ids)
    },
    stats: () => ({
      people: persons.length,
      heroes: persons.filter((p) => p.hero).length,
      pending: persons.filter((p) => p.pending).length,
      crowd: last.crowd,
      props: last.props,
      lod: bodies.lod,
      clips: bake.clips.length,
      rows: bake.texture.image.height,
      bakeBytes: bakeBytes(bake),
      vertices,
    }),
    dispose() {
      disposed = true
      for (const person of persons) person.hero?.dispose()
      for (const object of [bodies, props] as Object3D[]) object.removeFromParent()
      bodies.dispose()
      props.dispose()
      material.dispose()
      blobs.dispose()
      bake.texture.dispose()
      tint.dispose()
      outfits.dispose()
      people.dispose()
      rigBody.mixer.uncacheRoot(rigBody.root)
    },
  }
}
