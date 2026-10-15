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
  type Texture,
  Vector3,
} from "three"
import { type StandInAttribute, standInGeometry } from "../batch.ts"
import { batchGeometry } from "../batchGeometry.ts"
import { LodBatchedMesh } from "../batchMesh.ts"
import { loadCharacter } from "../character/load.ts"
import { createNpc } from "../character/npc.ts"
import type { LodCounts } from "../lod.ts"
import { simplifierReady } from "../lodGeometry.ts"
import { paletteMaterial } from "../material.ts"
import { loadPiece } from "../pieces.ts"
import { createSlicer } from "../slice.ts"
import type { Stage } from "../stage.ts"
import { warmPrograms } from "../warm.ts"
import {
  type BakePose,
  type BoneBake,
  bakeBytes,
  bakeClipsSliced,
  boneMap,
  firstSkinned,
  frameAt,
} from "./bake.ts"
import { createBlobs } from "./blobs.ts"
import {
  chooseHeroes,
  ghostHero,
  glowSwatches,
  type Hero,
  heroShown,
  makeHero,
  type Playing,
  poseHero,
} from "./heroes.ts"
import {
  type CrowdUniforms,
  crowdMaterial,
  crowdUniforms,
  PEOPLE_ROW,
  TEXELS_PER_PERSON,
} from "./material.ts"
import { outfitTable, tintTable } from "./outfit.ts"
import { boneRiders, mergeParts, type PartsTier, simplifyParts, skinnedParts } from "./parts.ts"
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
  /** Not drawn this frame (indoors): no body, props, shadow, nor hero. */
  hidden?: boolean
  /**
   * A ghost (a fallen hero's: 0–1 how visible): drawn as its hero only, pale and see-through
   * (heroes.ts `ghostHero`), with no shadow; nothing while its hero is not made yet.
   */
  ghost?: number
  /**
   * The props in hand this frame (catalog ids, of its look's mounts): the others are not drawn (a hero's
   * book while it reads, its hammer while it hammers). None: every mount of its look.
   */
  props?: readonly string[]
  /**
   * Which of its look's mounts show this frame, bit k for `look.mounts[k]` (a townsfolk's routine: the
   * rod always, the fish once caught); none: all of them. With `props` too, a mount shows when both say so.
   */
  mask?: number
}

/** Whether mount k shows under a sample's `mask` (none: every mount). */
export const propShown = (mask: number | undefined, k: number): boolean =>
  mask === undefined || ((mask >>> k) & 1) === 1

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
  /** More clips to bake besides the looks' own (what a routine plays: sitting, fishing…). */
  clips?: readonly string[]
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
  /**
   * Where a point of actor `id`'s mount k (`look.mounts[k]`, in the piece's own space) was drawn last
   * update, world metres, into `out` (a rod's tip, for its line); false when that prop was not drawn.
   */
  propPoint(id: number, k: number, local: readonly [number, number, number], out: number[]): boolean
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
  /** Its drawn props: which look mount each is (`k`), its instance, its world matrix as last drawn. */
  props: { prop: HeldProp; instance: number; piece: string; k: number; world: Matrix4; drawn: boolean }[]
  playing: Playing
  hidden: number
  hero: Hero | null
  /** A hero being made for it (resolves null when that failed or was given up). */
  pending: Promise<Hero | null> | null
  failed: boolean
  /** Drawn as its hero (else as a crowd member). */
  shown: boolean
}

/** The attributes a merged crowd body carries (parts.ts `mergeParts`), for a stand-in that compiles the same program. */
const BODY_ATTRIBUTES: StandInAttribute[] = [
  ["position", 3, false, true],
  ["normal", 3, false, true],
  ["color", 3, true, false],
  ["skinIndex", 4, false, false, true],
  ["skinWeight", 4, false, true],
  ["_swatch", 1, false, false],
  ["_shade", 1, true, false],
  ["_part", 1, false, false],
]

/**
 * Starts linking the crowd's programs (the bodies' skinned one for a rig of `bones` bones, the props'
 * palette one) on one-triangle stand-ins, and resolves when they are ready: compiled ahead, the real
 * meshes' warm-up finds them made (three shares a program between materials with the same key).
 */
export async function warmCrowdPrograms(
  stage: Pick<Stage, "scene" | "camera" | "renderer"> & Partial<Pick<Stage, "drawTarget">>,
  bones: number,
): Promise<void> {
  if (bones <= 0) return
  const uniforms: CrowdUniforms = {
    crowdBones: { value: null as unknown as Texture },
    crowdPeople: { value: null },
    crowdTint: { value: null as unknown as Texture },
    crowdOutfits: { value: null },
    crowdPivots: { value: Array.from({ length: bones }, () => new Vector3()) },
  }
  const material = crowdMaterial(uniforms)
  const body = new LodBatchedMesh(1, 3, 3, material)
  const bodyGeometry = standInGeometry(BODY_ATTRIBUTES)
  body.addInstance(body.addGeometry(bodyGeometry))
  const held = new BatchedMesh(1, 3, 3, paletteMaterial("batched"))
  const heldGeometry = standInGeometry()
  held.addInstance(held.addGeometry(heldGeometry))
  for (const mesh of [body, held]) {
    mesh.receiveShadow = true
    mesh.visible = false
  }
  try {
    await Promise.all([
      warmPrograms(stage, body, undefined, { prefetch: false }),
      warmPrograms(stage, held, undefined, { prefetch: false }),
    ])
  } finally {
    body.dispose()
    held.dispose()
    bodyGeometry.dispose()
    heldGeometry.dispose()
    material.dispose()
  }
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

/** Moves `playing` on to the sample's clip and phase, starting a fade on a clip change (not on the first: clip ""). */
export function advance(playing: Playing, clip: string, phase: number, dt: number): void {
  if (playing.clip === "") playing.clip = clip
  else if (clip !== playing.clip) {
    playing.was = playing.clip
    playing.wasPhase = playing.phase
    playing.fade = 0
    playing.clip = clip
  } else if (playing.fade < 1) playing.fade = Math.min(1, playing.fade + dt / FADE)
  playing.phase = phase - Math.floor(phase)
}

export async function createCrowd(
  stage: Pick<Stage, "scene" | "camera" | "renderer"> & Partial<Pick<Stage, "timing" | "drawTarget">>,
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
  // The bodies' and the props' programs take ~1 s to compile in the GPU process (ANGLE/Metal): started
  // now, on stand-ins, that runs while the clips bake and the bodies merge, and the real meshes below
  // find the programs made (three shares a program between materials with the same key).
  const early = warmCrowdPrograms(stage, firstSkinned(rigBody.root)?.skeleton.bones.length ?? 0)
  const wanted = [...new Set([...lookClips(actors.map((a) => a.look)), ...(opts.clips ?? [])])].sort()
  const clips = wanted.flatMap((name) => rigBody.clips.filter((c) => c.name === name))
  for (const name of wanted)
    if (!clips.some((c) => c.name === name)) logger.warn("clip not in the rig", { clip: name })
  // the build is sliced across frames (slice.ts): the same bake and bodies, no long task on this thread
  const slicer = createSlicer()
  const bake = await bakeClipsSliced(rigBody.root, clips, opts.fps ?? 30, slicer)
  const tint = tintTable()
  const uniforms = crowdUniforms(bake, tint)

  // Body geometries, every part kept (people hide theirs by mask) and joints in the bake's order.
  await simplifierReady
  const roots = await Promise.all(bodyIds.map((id) => loadPiece(url(entryOf(id).files.glb))))
  const geometries: BufferGeometry[][] = []
  const partNames: string[][] = []
  for (const [i, root] of roots.entries()) {
    // (a skeleton's helmet, hat, hood or cape rides a bone: a part too, `boneRiders`)
    const parts = [...skinnedParts(root), ...boneRiders(root)]
    const joints = parts[0] ? boneMap(bake, parts[0]) : null
    if (!joints) throw new Error(`createCrowd: body "${bodyIds[i]}" is not on the baked rig`)
    const base = mergeParts(parts, joints)
    await slicer.yield()
    // each coarser tier its own slice: a body's simplify is ~10–20 ms (the undead's crowd is built
    // while the world is in view)
    const tiers = [base]
    for (const tier of BODY_TIERS) {
      tiers.push(simplifyParts(base, tier))
      await slicer.yield()
    }
    geometries.push(tiers)
    partNames.push(parts.map((p) => p.name))
  }
  const vertices = geometries.flat().reduce((n, g) => n + g.getAttribute("position").count, 0)
  const indices = geometries.flat().reduce((n, g) => n + (g.index?.count ?? 0), 0)

  const material = crowdMaterial(uniforms)
  const bodies = new LodBatchedMesh(
    Math.max(1, actors.length),
    Math.max(1, vertices),
    Math.max(1, indices),
    material,
  )
  bodies.name = "crowd:bodies"
  bodies.perObjectFrustumCulled = true
  // culled per person (perObjectFrustumCulled) only: three's whole-batch bounding sphere is computed once,
  // on the first draw, and a crowd drawn before its first update (a life that is slow to be ready) would
  // keep the sphere of everyone at the origin, and be culled whole wherever the camera goes after
  bodies.frustumCulled = false
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
  const props = new BatchedMesh(
    Math.max(1, propCount),
    Math.max(1, propVertices),
    Math.max(1, propIndices),
    paletteMaterial("batched"),
  )
  props.name = "crowd:props"
  props.perObjectFrustumCulled = true
  props.frustumCulled = false
  props.sortObjects = false
  props.castShadow = false
  props.receiveShadow = true
  const propGeometryId = new Map<string, number>()
  for (const [id, g] of propGeometry) {
    propGeometryId.set(id, props.addGeometry(g))
    g.dispose()
  }

  const blobs = createBlobs(actors.length)
  // their programs link in the background before the first draw, which would otherwise wait for them (warm.ts)
  for (const o of [bodies, props, blobs.mesh]) o.visible = false
  stage.scene.add(bodies, props, blobs.mesh)
  for (const o of [bodies, props, blobs.mesh]) stage.timing?.gpu.tag(o, "crowd")
  await early
  await Promise.all([bodies, props, blobs.mesh].map((o) => warmPrograms(stage, o)))
  for (const o of [bodies, props, blobs.mesh]) o.visible = true

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

  const slotBone = (slot: MountSlot) =>
    bake.bones.indexOf(PropertyBinding.sanitizeNodeName(SLOT_FRAMES[slot].bone))
  const persons: Person[] = actors.map((actor, i) => {
    const body = bodyOf.get(actor.look.body) as Body
    const instance = bodies.addInstance(body.geometry)
    let hidden = 0
    for (const part of actor.look.hide) {
      const bit = body.parts.get(PropertyBinding.sanitizeNodeName(part))
      if (bit !== undefined) hidden += 2 ** bit
    }
    const held = actor.look.mounts.flatMap(({ piece, slot }, k) => {
      const mount = catalog.get(piece)?.compose.mount
      const bone = slotBone(slot)
      if (!mount || bone < 0) {
        logger.warn("prop left out", { piece, slot })
        return []
      }
      return [
        {
          prop: { mount, slot, bone },
          instance: props.addInstance(propGeometryId.get(piece) as number),
          piece,
          k,
          world: new Matrix4(),
          drawn: false,
        },
      ]
    })
    const at =
      (i % PEOPLE_ROW) * TEXELS_PER_PERSON * 4 +
      Math.floor(i / PEOPLE_ROW) * PEOPLE_ROW * TEXELS_PER_PERSON * 4
    peopleData[at + 4] = 1
    peopleData[at + 5] = hidden
    peopleData[at + 6] = i
    return {
      actor,
      body: body.geometry,
      instance,
      props: held,
      playing: { clip: "", phase: actor.look.phase, was: null, wasPhase: 0, fade: 1 },
      hidden,
      hero: null,
      pending: null,
      failed: false,
      shown: false,
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
  const turn = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const at = new Vector3()
  const size = new Vector3()
  const eye = new Vector3()
  const forward = new Vector3()
  let last = { crowd: 0, props: 0 }

  /**
   * Heroes are made one after another, a slice at a time (slice.ts): a dozen wanted in the same frame
   * (the first update) would otherwise be built in one task (measured 230–500 ms: the bodies cloned
   * and merged, their programs linked). Each one's programs link in the background before it is shown.
   */
  let heroTurn: Promise<unknown> = Promise.resolve()
  const makeHeroFor = (person: Person) => {
    const { look } = person.actor
    const made = heroTurn.then(async () => {
      await slicer.yield()
      // no longer wanted while it waited its turn (walked off, or the crowd went): nothing to make
      if (disposed || !wantHero.has(person.actor.id)) return null
      const npc = await createNpc(look, catalog, url)
      if (disposed) {
        npc.dispose()
        return null
      }
      const hero = makeHero(
        npc,
        look.mounts.map((m) => m.piece),
      )
      await warmPrograms(stage, hero.npc.root)
      return hero
    })
    heroTurn = made.catch(() => {})
    person.pending = made.catch((error: unknown) => {
      logger.warn("hero failed; stays in the crowd", { id: person.actor.id, error: String(error) })
      person.failed = true
      return null
    })
    void person.pending.then((hero) => {
      person.pending = null
      if (!hero) return
      // Given up while it loaded: let it go. Otherwise it waits, hidden, for update to swap it in.
      if (disposed || !wantHero.has(person.actor.id)) {
        hero.dispose()
        return
      }
      person.hero = hero
      hero.npc.root.visible = false
      stage.scene.add(hero.npc.root)
      stage.timing?.gpu.tag(hero.npc.root, "crowd")
    })
  }
  let wantHero = new Set<number>()
  // the frame's lists, kept from frame to frame (no allocation per person per frame: GC pauses were
  // the hitches on the far views): each person's candidate record, sample, drawn height
  const records = persons.map((p) => ({ id: p.actor.id, distance: 0, tall: 0 }))
  const candidates: { id: number; distance: number; tall: number }[] = []
  const samples: ActorSample[] = new Array(persons.length)
  const talls = new Float32Array(persons.length)
  const current = new Set<number>()

  return {
    update(dt, sample) {
      if (disposed) return
      const camera = stage.camera as PerspectiveCamera
      camera.updateMatrixWorld()
      eye.setFromMatrixPosition(camera.matrixWorld)
      forward.setFromMatrixColumn(camera.matrixWorld, 2).negate()
      const cssHeight = stage.renderer.domElement.clientHeight || 1
      const focal = cssHeight / (2 * Math.tan((camera.fov * Math.PI) / 360))

      candidates.length = 0
      for (const [i, person] of persons.entries()) {
        const s = sample(person.actor.id)
        samples[i] = s
        advance(person.playing, s.clip, s.phase, dt)
        if (s.hidden) {
          talls[i] = 0
          continue
        }
        const x = s.position[0]
        const y = s.position[1]
        const z = s.position[2]
        const height = FIGURE_HEIGHT * person.actor.look.scale
        const depth = (x - eye.x) * forward.x + (y + height / 2 - eye.y) * forward.y + (z - eye.z) * forward.z
        const tall = depth > 0.1 ? (height * focal) / depth : 0
        talls[i] = tall
        const record = records[i] as { id: number; distance: number; tall: number }
        const dx = x - eye.x
        const dy = y - eye.y
        const dz = z - eye.z
        record.distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
        record.tall = tall
        candidates.push(record)
      }
      current.clear()
      for (const p of persons) if (p.hero || p.pending) current.add(p.actor.id)
      wantHero = allHeroes
        ? new Set(persons.map((p) => p.actor.id))
        : chooseHeroes(
            candidates,
            current,
            pinned,
            maxHeroes,
            opts.tall ? { tall: opts.tall, short: opts.tall * 0.8 } : {},
          )

      let crowd = 0
      let held = 0
      for (const [i, person] of persons.entries()) {
        const s = samples[i] as ActorSample
        if (s.hidden) {
          person.hero?.dispose()
          person.hero = null
          person.shown = false
          bodies.setVisibleAt(person.instance, false)
          for (const p of person.props) {
            props.setVisibleAt(p.instance, false)
            p.drawn = false
          }
          blobs.place(i, 0, -1000, 0, 0)
          continue
        }
        const want = wantHero.has(person.actor.id) && !person.failed
        if (want && !person.hero && !person.pending) makeHeroFor(person)
        person.shown = heroShown(want, !!person.hero, person.shown, person.playing.fade)
        if (!person.shown && person.hero) {
          if (want) person.hero.npc.root.visible = false
          else {
            person.hero.dispose()
            person.hero = null
          }
        }
        const [x, y, z] = s.position
        const scale = person.actor.look.scale
        const ghost = s.ghost
        if (ghost === undefined) blobs.place(i, x, y, z, scale)
        else blobs.place(i, 0, -1000, 0, 0)
        const hero = person.shown ? person.hero : null
        if (person.hero) ghostHero(person.hero, ghost)
        if (!hero && ghost !== undefined) {
          // a ghost is its hero or nothing (the crowd's body is opaque)
          bodies.setVisibleAt(person.instance, false)
          for (const p of person.props) {
            props.setVisibleAt(p.instance, false)
            p.drawn = false
          }
          continue
        }
        if (hero) {
          const root = hero.npc.root
          root.position.set(x, y, z)
          root.rotation.set(0, s.heading, 0)
          poseHero(hero.npc, person.playing)
          const held = s.props
          const mounted = hero.npc.character.mounted
          for (const [m, mount] of person.actor.look.mounts.entries()) {
            const piece = mounted[m]?.piece
            if (piece) piece.visible = (!held || held.includes(mount.piece)) && propShown(s.mask, m)
          }
          root.visible = true
          bodies.setVisibleAt(person.instance, false)
          for (const p of person.props) {
            props.setVisibleAt(p.instance, false)
            p.drawn = false
          }
          continue
        }
        // The crowd member: its place, its rows in the bake, its props.
        bakePose(bake, person.playing, pose)
        const o =
          (i % PEOPLE_ROW) * TEXELS_PER_PERSON * 4 +
          Math.floor(i / PEOPLE_ROW) * PEOPLE_ROW * TEXELS_PER_PERSON * 4
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
          const shown =
            showProps &&
            (!s.props || s.props.includes(p.piece)) &&
            propShown(s.mask, p.k) &&
            propMatrix(bake, pose, person.playing.clip, p.prop, local)
          props.setVisibleAt(p.instance, shown)
          p.drawn = shown
          if (!shown) continue
          props.setMatrixAt(p.instance, p.world.multiplyMatrices(place, local))
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
    propPoint(id, k, local, out) {
      const person = persons[id]
      if (!person) return false
      const hero = person.shown ? person.hero : null
      if (hero) {
        const m = hero.npc.character.mounted[k]
        if (!m || !m.pivot.visible || !m.piece.visible || !hero.npc.root.visible) return false
        m.piece.updateWorldMatrix(true, false)
        at.set(local[0], local[1], local[2]).applyMatrix4(m.piece.matrixWorld)
      } else {
        const p = person.props.find((q) => q.k === k)
        if (!p?.drawn) return false
        at.set(local[0], local[1], local[2]).applyMatrix4(p.world)
      }
      out[0] = at.x
      out[1] = at.y
      out[2] = at.z
      return true
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
