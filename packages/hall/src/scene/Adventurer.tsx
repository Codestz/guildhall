import { gearAt, pipsOf } from "@guildhall/roster"
import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  type BufferGeometry,
  type Camera,
  Color,
  CylinderGeometry,
  DoubleSide,
  Frustum,
  Group,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  RingGeometry,
  Shape,
  ShapeGeometry,
  Sphere,
  SphereGeometry,
  Vector3,
} from "three"
import { PROBE } from "../guild/mode.ts"
import type { AdventurerView } from "../guild/store.ts"
import { positions, useGuildStore } from "../guild/useGuild.ts"
import { verbOf } from "../hud/format.ts"
import { Icon } from "../hud/icons.tsx"
import { placeOf, Routine, seedOf, shifted } from "../world/behaviours.ts"
import { ANIMS_URL, AUTOMATON, figureOf, figureUrl, MODELS, modelUrl } from "../world/cast.ts"
import { districtPlaceOf } from "../world/districtWork.ts"
import type { Piece } from "../world/furniture.ts"
import { SITE_DEFS } from "../world/sites.ts"
import { attachHands, type Hands, probed, release, reserve } from "./activity.ts"
import { construct } from "./automaton.ts"
import { useBlob } from "./Blobs.tsx"
import { Body } from "./body.ts"
import { Brain, clipFor } from "./brain.ts"
import { Pennant, Pips } from "./ChipMarks.tsx"
import { addChip, CHIP_HEIGHT, chipSlot, removeChip } from "./chips.ts"
import type { Crowd } from "./crowd/Crowd.ts"
import { castClock } from "./crowd/cast.ts"
import { FIGURE_HEIGHT, heroic } from "./crowd/lod.ts"
import { useDeedEffect } from "./DeedEffect.tsx"
import { Dissolver, Fade, fadeSeconds } from "./dissolve.ts"
import { dyeOf } from "./dye.ts"
import { attachGrip, isHeldPiece, KIT_GRIPS, keepUpright, NIGHT_LANTERN, RESTING_MUG } from "./grips.ts"
import { clonePiece, useKit } from "./Kit.tsx"
import { Label } from "./Label.tsx"
import { BEAT_HEIGHT, emitBeat } from "./life/work.ts"
import { carryLantern } from "./lights/carried.ts"
import { type RingLook, useRing } from "./Rings.tsx"
import { cloneRig } from "./rig.ts"

/** Where the hands are, for a beat that happens there (a page turned, an arrow loosed). */
const HANDS_AHEAD = 0.45
const HANDS_UP = 1.4
/** A leaver starts to dissolve this far before the end of the avenue walk, still walking. */
const DISSOLVE_FROM = 2.5
/** Fades (scene/dissolve.ts): in from the avenue while still far off, summoned, gone down the road. */
const ARRIVE_FADE_S = 0.4
const SUMMON_FADE_S = 0.6
const LEAVE_FADE_S = 0.8
/** Summoned: they rise out of the summons (Spawn_Ground) beside the guildmaster before stepping off. */
const SUMMON_S = 1.1

useGLTF.preload(ANIMS_URL)
// Every model up front: a model loading mid-run would suspend and hide the whole cast.
for (const model of MODELS) useGLTF.preload(modelUrl(model))

/**
 * What an adventurer is drawn from. Everything here is a plain value the cast (scene/Scene.tsx)
 * reads off the store, so a figure re-renders only when one of them really changes: not on every
 * store refresh (≈10×/s).
 */
export interface AdventurerProps {
  view: AdventurerView
  onGone?: ((id: string) => void) | undefined
  /** This one is selected (followed by the camera). */
  selected: boolean
  /** The party being followed (store.following), or null for all. */
  following: string | null
  /** Several parties on the island: banners and pennants show. */
  banners: boolean
  /** After dark: a free left hand carries a lantern. */
  dark: boolean
  /**
   * The cast's baked crowd, when the cast is big enough to use it (scene/crowd/lod.ts): this one
   * joins it unless it must stay a hero. Null: always a hero.
   */
  crowd?: Crowd | null
}

/**
 * Do two views draw the same figure? The same object (the store keeps an unchanged view's
 * identity), or equal field by field: a refresh that rebuilt the view without changing it. Arrays
 * and objects (the target, the deed's look, the entrance) are compared a level or two down.
 */
export function sameView(a: AdventurerView, b: AdventurerView): boolean {
  return same(a, b, 3)
}

function same(a: unknown, b: unknown, depth: number): boolean {
  if (a === b) return true
  if (depth === 0 || typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const key of ka) {
    if (!same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], depth - 1))
      return false
  }
  return true
}

/** The memo test: re-render only for a changed view or a changed cast-level fact. */
export function sameProps(a: AdventurerProps, b: AdventurerProps): boolean {
  return (
    a.selected === b.selected &&
    a.following === b.following &&
    a.banners === b.banners &&
    a.dark === b.dark &&
    a.onGone === b.onGone &&
    a.crowd === b.crowd &&
    sameView(a.view, b.view)
  )
}

/**
 * One frame's view of the stage, shared by every adventurer (written once a frame by the cast, at
 * FRAME.SKY, before any of them reads it): the camera's frustum and position. Off screen, a mixer
 * doesn't step; far, it steps every other frame; its time is kept and spent when it is seen again.
 */
export const sight = {
  frame: 0,
  frustum: new Frustum(),
  camera: new Vector3(),
  /** Where the camera looks: its view's centre on the ground (y = 0). */
  target: new Vector3(),
  /** CSS px per world unit at the target (how big a figure there is drawn). */
  scale: 1,
}
const projection = new Matrix4()
const forward = new Vector3()

/**
 * Reads `camera` into `sight`: once a frame, before the cast's own frame callbacks. `height`: the
 * canvas's height in CSS px.
 */
export function lookFrom(camera: Camera, height: number): void {
  sight.frame++
  sight.frustum.setFromProjectionMatrix(
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  )
  sight.camera.setFromMatrixPosition(camera.matrixWorld)
  // Read off the matrix the last frame drew with: getWorldDirection would update the camera's
  // matrices here, before the rig moves it, and change what everything after this reads.
  forward.setFromMatrixColumn(camera.matrixWorld, 2).normalize().negate()
  const along = forward.y < -1e-3 ? -sight.camera.y / forward.y : 0
  sight.target.copy(sight.camera).addScaledVector(forward, along)
  sight.scale = height / viewHeight(camera, along)
}

/** World units the view spans top to bottom at `distance` along its axis. */
function viewHeight(camera: Camera, distance: number): number {
  const ortho = camera as OrthographicCamera
  if (ortho.isOrthographicCamera) return Math.max(1e-6, (ortho.top - ortho.bottom) / ortho.zoom)
  const persp = camera as PerspectiveCamera
  const fov = persp.isPerspectiveCamera ? persp.getEffectiveFOV() : 50
  return Math.max(1e-6, 2 * Math.max(distance, 1e-3) * Math.tan((fov * Math.PI) / 360))
}

/** Beyond this distance from the camera, a mixer steps every other frame (as the townsfolk's). */
const FAR = 38

/**
 * How a mixer steps this frame: "full" (every frame), "skip" (not this frame: its time is kept), by
 * whether it is seen and how far. The selected adventurer always steps in full. Pure, for tests.
 */
export function mixerStep(
  seen: boolean,
  distanceSq: number,
  frame: number,
  index: number,
  selected: boolean,
): "full" | "skip" {
  if (selected) return "full"
  if (!seen) return "skip"
  if (distanceSq > FAR * FAR && (frame + index) % 2 === 1) return "skip"
  return "full"
}

/** Shared by every adventurer's hit area (never freed): clicks land on the ring under their feet. */
const HIT = {
  ring: new RingGeometry(0.75, 0.9, 40),
  selected: new RingGeometry(0.75, 1.05, 40),
  material: new MeshBasicMaterial({ visible: false }),
}

/**
 * A KayKit adventurer: the role's model with its gear, animated from the shared Rig_Medium clips.
 * Walks to `view.target`, then plays what the phase and current deed call for. While working at a
 * site or station they run its behaviour's loop (world/behaviours.ts, ADR 0009): chop, carry, put
 * down, walk back — thinking or calling tools, never just standing there.
 */
export const Adventurer = memo(Figure, sameProps)

function Figure({ view, onGone, selected, following, banners, dark, crowd = null }: AdventurerProps) {
  const store = useGuildStore()
  const id = view.id
  const root = useRef<Group>(null)
  const model = figureOf(view.character)
  const { scene: loaded } = useGLTF(figureUrl(model))
  // The Automaton is a re-cast copy (scene/automaton.ts); the crowd, if any, learns its body.
  const scene = model === AUTOMATON ? construct(loaded) : loaded
  useLayoutEffect(() => crowd?.muster(model, scene), [crowd, model, scene])
  /** The cape's dye: the archetype's colour, deeper with rank (scene/dye.ts). */
  const dye = dyeOf(view.color, view.rank)
  const { animations } = useGLTF(ANIMS_URL)
  const kit = useKit()

  /** The rig: drawn as is by a hero body, hidden (its hands still kept) in the crowd. */
  const rig = useMemo(() => cloneRig(scene), [scene])
  /** What draws them (scene/body.ts). Made in a layout effect, below: a mount (StrictMode's second one too) gets its own. */
  const body = useRef<Body | null>(null)
  /** Where they walk and which way they face (scene/brain.ts). */
  const [brain] = useState(() => new Brain(id))
  /** The work loop at this adventurer's place, and what their hands show (scene/activity.ts). */
  const routine = useRef<Routine | null>(null)
  const hands = useRef<Hands | null>(null)
  const beatsSeen = useRef(0)
  // How they came on stage, read once at mount (guild/store.ts `Entrance`): from out on the avenue,
  // summoned at the guildmaster's side, or (rebuilt by a seek or a load) already at their post. A
  // leaver mounted by a rebuild is already gone.
  const [arrival] = useState(() => ({
    kind: view.enter?.kind,
    summoning: view.enter?.kind === "dais" ? SUMMON_S : 0,
    fade: new Fade(view.enter || view.phase === "leaving" ? 0 : 1),
    // Frozen: R3F re-applies a changed `position` prop, which would teleport them to each new target.
    start: view.enter?.at ?? view.target,
    /** Reported dissolved (once). */
    gone: false,
  }))
  const start = arrival.start
  const [dissolver] = useState(() => new Dissolver())
  // Declared before the tint below, so on unmount the originals are back before the tint lets go.
  useEffect(() => {
    const node = root.current
    return () => dissolver.dispose(node)
  }, [dissolver])

  // The archetype's dye on cape and hat; shadows on. The tinted clones are this adventurer's own: on
  // unmount (or a new colour) they are disposed and the model's shared materials put back.
  useEffect(() => {
    const tint = new Color(dye)
    const tinted: [Mesh, Material, Material][] = []
    rig.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh) return
      // Characters move every frame; the shadow map is static (atmosphere/shadows.ts). A soft blob
      // under their feet grounds them instead.
      mesh.castShadow = false
      if (/Tinted/.test(mesh.name)) {
        const shared = mesh.material as MeshStandardMaterial
        const own = shared.clone()
        own.color = tint.clone().lerp(new Color("#ffffff"), 0.25)
        mesh.material = own
        tinted.push([mesh, shared, own])
      }
    })
    return () => {
      for (const [mesh, shared, own] of tinted) {
        own.dispose()
        mesh.material = shared
      }
    }
  }, [rig, dye])

  // The body (its mixer and actions) lives exactly as long as this mount: made here, before the first
  // frame (no bind-pose flash), and freed on unmount with each skeleton's bone texture — all made for
  // this rig alone — leaving the crowd if it was in it. Geometry and untinted materials are shared
  // with the loaded model (SkeletonUtils.clone), held gear with the kit: never disposed here.
  // StrictMode's unmount-and-mount gets a fresh body, so nothing keeps using a disposed mixer.
  useLayoutEffect(() => {
    // A touch of each one's own tempo: two smiths side by side never strike in step.
    const made = new Body(rig, animations, 0.94 + (seedOf(id) % 1000) * 0.00012)
    body.current = made
    return () => {
      if (body.current === made) body.current = null
      made.dispose()
    }
  }, [rig, animations, id])
  // A crowd member's cape and hat follow a new colour too.
  useEffect(() => body.current?.tint(dye), [dye])

  // Where they work, and the loop they run there (a new place: a new routine, berth reserved).
  const [tx, tz, tf] = view.target
  const place = useMemo(
    () =>
      view.district
        ? districtPlaceOf(view.district, [tx, tz, tf])
        : placeOf(view.site, view.station, [tx, tz, tf]),
    [view.district, view.site, view.station, tx, tz, tf],
  )
  useEffect(() => {
    if (!place) return
    const lap = reserve(place, id)
    const work = new Routine(shifted(place, lap), seedOf(id))
    const held = attachHands(rig, place.behaviour)
    routine.current = work
    hands.current = held
    beatsSeen.current = 0
    if (import.meta.env.DEV) probed.set(id, { title: id, routine: work, body: rig })
    return () => {
      if (import.meta.env.DEV) probed.delete(id)
      release(place, id)
      held.dispose()
      if (routine.current === work) routine.current = null
      if (hands.current === held) hands.current = null
    }
  }, [place, id, rig])

  // Several parties on the island: each guildmaster wears their party's banner on their back.
  useBackBanner(rig, view.banner, view.master && banners)

  // Gear in the hand slots; a mug instead while resting in the tavern.
  const atWork = view.site && (view.phase === "working" || view.phase === "waiting")
  const gear =
    (atWork && view.site ? SITE_DEFS[view.site].gear : undefined) ?? gearAt(view.archetype, view.rank)
  const right = view.phase === "resting" ? RESTING_MUG : (gear.right as Piece | undefined)
  const rightHeld = useHeld(rig, kit, right)
  // After dark, a free left hand carries a lantern: you can always find your agents at night (an
  // archer's left hand holds the bow).
  const bow = atWork && place?.behaviour.tool === "bow"
  const left =
    view.phase === "resting"
      ? undefined
      : ((gear.left as Piece | undefined) ?? (dark && !bow ? NIGHT_LANTERN : undefined))
  const leftHeld = useHeld(rig, kit, left)

  // The blob under their feet fades with them as they dissolve (scene/dissolve.ts).
  const presence = useCallback(() => arrival.fade.value, [arrival])
  useBlob(root, 0.85, undefined, presence)
  // The ring under their feet and the deed's motes: drawn with everyone's (scene/Rings, DeedEffect).
  const [ring] = useState<RingLook>(() => ({ color: view.color, selected }))
  ring.color = view.master && banners ? view.banner : view.color
  ring.selected = selected
  useRing(root, ring, presence)
  useDeedEffect(root, view.phase === "working" ? view.look?.effect : undefined, presence)
  /** Where they stand in the cast's mixer schedule (far ones alternate frames, staggered by this). */
  const [index] = useState(() => seedOf(id) % 2)

  useEffect(() => {
    const id = view.id
    const node = root.current
    if (node) positions.set(id, node.position)
    return () => {
      positions.delete(id)
    }
  }, [view.id])

  // The name chip joins the declutter (scene/chips.ts), which nudges and folds it directly in the DOM.
  const chip = useMemo(chipSlot, [])
  /** The chip's own fade: a wrapper's opacity, so the chip's classes keep theirs. */
  const fading = useMemo(() => ({ el: null as HTMLElement | null, shown: -1 }), [])
  const fadeRef = useCallback(
    (el: HTMLDivElement | null) => {
      fading.el = el
      fading.shown = -1
    },
    [fading],
  )
  const chipRef = useCallback(
    (el: HTMLDivElement | null) => {
      chip.el = el
    },
    [chip],
  )
  const moreRef = useCallback(
    (el: HTMLElement | null) => {
      chip.more = el
    },
    [chip],
  )
  useEffect(() => {
    chip.anchor = root.current
    addChip(chip)
    return () => {
      removeChip(chip)
      chip.anchor = null
    }
  }, [chip])

  useFrame((_, delta) => {
    const node = root.current
    if (!node) return
    // Summoned: they stand where they appeared until they have risen out of it.
    const holding = arrival.summoning > 0
    if (holding) arrival.summoning -= delta
    const work = routine.current
    const active = work !== null && view.phase === "working" && !brain.visit.engaged
    // Off work (a plea, loot, a failure): the loop starts over, hands emptied, when they're back.
    if (work && !active && work.started) work.reset()
    const looping = active && work.started
    // A paused probe walks in fixed steps: a walk stops within a stride of its post, so frame timing moved the stop (and the follow camera).
    const step = PROBE && store.speed === 0 ? 1 / 30 : delta
    const { walking, speed, remaining, carrying } = brain.walk(node, view, work, looping, holding, step)
    const leaving = view.phase === "leaving"

    // In and out by dissolving (scene/dissolve.ts), never by scale: a leaver fades over the last
    // steps down the avenue; a newcomer fades in as they set off (or as they are summoned).
    const goal = leaving && remaining < DISSOLVE_FROM ? 0 : brain.visit.goal
    const seconds = goal === 0 ? LEAVE_FADE_S : arrival.kind === "dais" ? SUMMON_FADE_S : ARRIVE_FADE_S
    const shown = arrival.fade.step(goal, delta, fadeSeconds(seconds))
    node.visible = shown > 0
    // Hero or crowd (scene/crowd/lod.ts), before the dissolve: only a hero dissolves.
    const drawn = body.current
    if (drawn) cast(drawn, node, shown < 1, delta)
    dissolver.set(node, shown)
    // Dissolved away down the avenue: the stage may let a leaver it was keeping go (scene/exits.ts).
    if (leaving && !arrival.gone && arrival.fade.state === "gone") {
      arrival.gone = true
      onGone?.(id)
    }
    // The chip goes with them; gone, it leaves the declutter (no "+N" for someone not there).
    chip.anchor = shown > 0 ? node : null
    const opacity = Math.round(shown * 20) / 20
    if (fading.el && opacity !== fading.shown) {
      fading.shown = opacity
      fading.el.style.opacity = opacity >= 1 ? "" : String(opacity)
    }
    if (!node.visible) return

    if (active) {
      work.update(delta, { thinking: view.thinking, tool: view.tool, arrived: !walking })
      if (work.beats !== beatsSeen.current) {
        beatsSeen.current = work.beats
        beat(work, node)
      }
    }
    const clip = holding ? "Spawn_Ground" : clipFor(view, walking, speed, looping ? work : null)
    hands.current?.show(looping ? work.held : null, active, clip)
    // Carrying takes both hands: the trade's own gear is put away meanwhile.
    if (rightHeld.current) rightHeld.current.visible = !carrying
    if (!drawn) return
    drawn.play(clip, castClock.now)
    if (!drawn.hero) {
      // In the crowd: the slot follows the root and holds what the (hidden) hands hold.
      drawn.follow(node)
      return
    }
    // ---- Animate: every frame near, every other frame far, never off screen ----
    bounds.center.set(node.position.x, node.position.y + 1, node.position.z)
    const seen = sight.frustum.intersectsSphere(bounds)
    const pace = mixerStep(seen, node.position.distanceToSquared(sight.camera), sight.frame, index, selected)
    if (!drawn.step(delta, pace)) return
    // Posed: what hangs level (a mug, a lantern, a bucket) is levelled for this frame's pose.
    keepUpright(rightHeld.current)
    keepUpright(leftHeld.current)
    hands.current?.settle()
  })

  /**
   * Hero or crowd this frame (scene/crowd/lod.ts), switching when no crossfade is under way — at
   * once when it must be a hero to dissolve, or the crowd has gone.
   */
  function cast(drawn: Body, node: Object3D, dissolving: boolean, delta: number): void {
    const now = castClock.now
    const tall = sight.scale * FIGURE_HEIGHT
    const distance = Math.hypot(node.position.x - sight.target.x, node.position.z - sight.target.z)
    const pinned = !crowd || selected || dissolving
    const hero = heroic(drawn.hero, pinned, distance, tall)
    if (hero === drawn.hero) return
    if (hero) {
      if (dissolving || !crowd || drawn.settled(now)) drawn.toHero(now, delta)
    } else if (crowd && drawn.settled(now)) drawn.toCrowd(crowd, model, dye, node, delta)
  }

  /** A beat of work (world/behaviours.ts): where it lands, for scene/life/WorkFx to draw. */
  function beat(work: Routine, node: Object3D): void {
    const kind = work.beat
    if (!kind) return
    const at = work.beatAt
    const hx = node.position.x + Math.sin(node.rotation.y) * HANDS_AHEAD
    const hz = node.position.z + Math.cos(node.rotation.y) * HANDS_AHEAD
    if (kind === "arrow") {
      emitBeat("arrow", at?.[0] ?? hx, BEAT_HEIGHT.arrow, at?.[1] ?? hz, hx, HANDS_UP, hz)
      return
    }
    if (!at) {
      emitBeat(kind, hx, HANDS_UP, hz)
      return
    }
    // From where they stand: a chop knows which way to lean the tree.
    emitBeat(kind, at[0], BEAT_HEIGHT[kind], at[1], node.position.x, 0, node.position.z)
  }

  /** Resting and leaving adventurers keep a softer label so the busy ones stay readable. */
  const quiet = view.phase === "resting" || view.phase === "leaving"
  /** Rank pips on the name's banner: one for a journeyman, two for a master (roster ranks.ts). */
  const pips = pipsOf(view.rank)
  const pleading = view.phase === "waiting"
  // Read by the declutter on its next run (refs, not state: no re-render for it).
  chip.pinned = selected || pleading
  chip.selected = selected
  // Its deed sigil (scene/Sigils.tsx) finds this chip by id, to sit under it and follow its lift.
  chip.id = view.id
  const { verb, glyph } = verbOf(view)
  const Glyph = Icon[glyph]
  /** The full deed, for Detailed mode and whoever you follow; Minimal shows the verb instead. */
  const deed = view.doing && !quiet ? view.doing : ""
  /** Following another party: this one's chip steps back so the followed party reads first. */
  const aside = following !== null && view.party !== following && !selected && !pleading
  // Speech, for the declutter's bubble rule (scene/chips.ts speaks); softer labels never speak.
  chip.bubble = Boolean(view.bubble) && !quiet && !aside

  return (
    <group
      ref={root}
      position={[start[0], 0, start[1]]}
      rotation-y={start[2]}
      onClick={(event) => {
        event.stopPropagation()
        store.select(selected ? null : view.id)
      }}
      onPointerOver={() => {
        document.body.style.cursor = "pointer"
      }}
      onPointerOut={() => {
        document.body.style.cursor = ""
      }}
    >
      <primitive object={rig} />
      {/* The ring is drawn with everyone's (scene/Rings.tsx); this invisible twin keeps it clickable. */}
      <mesh
        position-y={0.06}
        rotation-x={-Math.PI / 2}
        geometry={selected ? HIT.selected : HIT.ring}
        material={HIT.material}
      />
      {/* Decorative: the roster is the accessible list of who is here and what they are doing. */}
      <Label position={[0, CHIP_HEIGHT, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div ref={fadeRef}>
          <div
            ref={chipRef}
            aria-hidden="true"
            className={`chip${selected ? " selected" : ""}${quiet && !selected ? " quiet" : ""}${deed ? " has-deed" : ""}${aside ? " aside" : ""}`}
            data-tone={glyph}
          >
            {pleading && <div className="plea">!</div>}
            {view.bubble && <div className="bubble">{view.bubble}</div>}
            <div className="name" style={{ borderColor: view.color }}>
              {banners && <Pennant color={view.banner} />}
              <b>
                {view.title}
                {pips > 0 && <Pips n={pips} />}
                <i className="more" ref={moreRef} />
              </b>
              <em className="verb">
                <Glyph />
                {verb}
              </em>
              {deed && <span className="deed">{deed}</span>}
            </div>
          </div>
        </div>
      </Label>
    </group>
  )
}

/**
 * Keeps `piece` in the hand its grip names (scene/grips.ts), turned and placed to sit right there:
 * kit pieces are modelled for the floor, not the hand. Nothing when undefined.
 */
function useHeld(
  body: Object3D,
  kit: Record<string, Object3D>,
  piece: Piece | undefined,
): { readonly current: Object3D | null } {
  const held = useRef<Object3D | null>(null)
  useEffect(() => {
    if (!piece || !isHeldPiece(piece)) return
    const grip = KIT_GRIPS[piece]
    const bone = body.getObjectByName(grip.bone)
    if (!bone || !kit[piece]) return
    const root = attachGrip(bone, clonePiece(kit, piece), grip)
    held.current = root
    // A lantern gives light while held (scene/lights/carried.ts).
    const putDown = piece === NIGHT_LANTERN ? carryLantern(root, body) : undefined
    // Materials are shared with the kit: detach only, never dispose.
    return () => {
      putDown?.()
      bone.remove(root)
      if (held.current === root) held.current = null
    }
  }, [body, kit, piece])
  return held
}

/** A figure's bounds for the frustum test (centre set per adventurer, per frame). */
const bounds = new Sphere(new Vector3(), 1.6)

/** Shared by every back-banner, for the app's lifetime (never freed). */
let bannerParts: {
  staff: BufferGeometry
  flag: BufferGeometry
  knob: BufferGeometry
  wood: Material
  gold: Material
} | null = null

function partsOfBanner() {
  if (bannerParts) return bannerParts
  const flag = new Shape()
  // A swallowtail pennant flying sideways from the staff: 0.95 long, 0.56 deep.
  flag.moveTo(0, 0)
  flag.lineTo(0.95, -0.05)
  flag.lineTo(0.68, -0.28)
  flag.lineTo(0.95, -0.51)
  flag.lineTo(0, -0.56)
  flag.closePath()
  bannerParts = {
    staff: new CylinderGeometry(0.026, 0.026, 2.2, 6),
    flag: new ShapeGeometry(flag),
    knob: new SphereGeometry(0.05, 8, 6),
    wood: new MeshStandardMaterial({ color: "#5a3a22", roughness: 0.9 }),
    gold: new MeshStandardMaterial({ color: "#e0b84a", roughness: 0.4, metalness: 0.6 }),
  }
  return bannerParts
}

/**
 * A guildmaster's back-banner (a sashimono): a staff on the chest bone, rising behind the head, with
 * the party's pennant flying sideways so it reads from the isometric camera. Only while several
 * parties share the island; the pennant's material is this guildmaster's own.
 */
function useBackBanner(body: Object3D, color: string, on: boolean): void {
  useEffect(() => {
    if (!on) return
    const chest = body.getObjectByName("chest")
    if (!chest) return
    const parts = partsOfBanner()
    const cloth = new MeshStandardMaterial({ color, roughness: 0.75, side: DoubleSide })
    const group = new Group()
    group.name = "back-banner"
    const staff = new Mesh(parts.staff, parts.wood)
    // Tall enough to fly over the widest hat (the guildmaster's brim reaches ~2.6 up).
    staff.position.set(0, 1.15, -0.36)
    const knob = new Mesh(parts.knob, parts.gold)
    knob.position.set(0, 2.27, -0.36)
    const flag = new Mesh(parts.flag, cloth)
    flag.position.set(0.02, 2.2, -0.36)
    for (const mesh of [staff, knob, flag]) {
      mesh.castShadow = false
      group.add(mesh)
    }
    chest.add(group)
    return () => {
      group.removeFromParent()
      cloth.dispose()
    }
  }, [body, color, on])
}
