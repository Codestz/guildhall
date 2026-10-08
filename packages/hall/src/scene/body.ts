import {
  type AnimationAction,
  type AnimationClip,
  AnimationMixer,
  type ColorRepresentation,
  LoopOnce,
  type Object3D,
  type SkinnedMesh,
} from "three"
import { CARRY_WALK, carryClip } from "./activity.ts"
import type { Crowd, Gear } from "./crowd/Crowd.ts"
import { FADE_S, ONCE } from "./crowd/cast.ts"
import { GEAR_BONES, gearOf } from "./crowd/gear.ts"

/**
 * An adventurer's body: what draws the figure the brain (scene/brain.ts) walks. Two kinds, one
 * at a time (scene/crowd/lod.ts decides which):
 *
 *   hero    the rig itself — a SkinnedMesh posed by its own AnimationMixer, gear as real meshes on
 *           its bones. Exactly what Adventurer always drew.
 *   crowd   a slot in the cast's baked crowd (scene/crowd/Crowd.ts): the rig leaves the scene
 *           (no bone matrices updated, nothing raycast); the crowd draws the same clip at the same phase, at the root's
 *           place, holding what the rig's hands hold (crowd/gear.ts).
 *
 * The switch keeps the pose: hero → crowd starts the baked clip at the mixer's time; crowd → hero
 * sets the mixer's action to the baked clip's time. It waits until no crossfade is under way (at
 * most FADE_S), unless forced (a dissolve can't wait). Both clocks are the cast's crowd clock
 * (`now`, seconds) and this adventurer's tempo.
 */
export class Body {
  private readonly mixer: AnimationMixer
  private readonly actions = new Map<string, AnimationAction>()
  private current: AnimationAction | null = null
  /** The clip playing (resolved: a clip the rig has). */
  private playing: string | null = null
  /** Crowd-clock second the clip last changed: a crossfade runs FADE_S from then. */
  private since = Number.NEGATIVE_INFINITY
  /** Mixer time not yet stepped (off screen, or a skipped far frame): spent when next stepped. */
  private lag = 0
  private crowd: Crowd | null = null
  private member = -1
  private readonly sockets: Object3D[]
  private readonly gear: Gear[] = []
  /** Where the rig stands in the scene while it is out of it (in the crowd). */
  private stage: Object3D | null = null

  /** `tempo`: the mixer's time scale (each adventurer's own, so no two smiths strike in step). */
  constructor(
    readonly rig: Object3D,
    animations: readonly AnimationClip[],
    readonly tempo: number,
  ) {
    this.mixer = new AnimationMixer(rig)
    for (const clip of animations) this.actions.set(clip.name, this.mixer.clipAction(clip))
    const carry = carryClip(animations)
    if (carry) this.actions.set(CARRY_WALK, this.mixer.clipAction(carry))
    this.mixer.timeScale = tempo
    this.sockets = GEAR_BONES.map((name) => rig.getObjectByName(name)).filter((bone) => bone !== undefined)
  }

  get hero(): boolean {
    return this.member < 0
  }

  /** No crossfade under way at `now`: a switch now shows no cut. */
  settled(now: number): boolean {
    return now - this.since >= FADE_S
  }

  /** Plays `name` from this frame on (Idle_A when the rig has no such clip), in whichever body is on. */
  play(name: string, now: number): void {
    const clip = this.actions.has(name) ? name : "Idle_A"
    if (this.crowd && this.member >= 0) {
      if (clip !== this.playing) {
        this.crowd.play(this.member, clip, this.tempo)
        this.playing = clip
        this.since = now
      } else if (ONCE.has(clip) && this.finished()) {
        // As the mixer does (below): a held clip asked for again starts over.
        this.crowd.start(this.member, clip, 0, this.tempo)
      }
      return
    }
    const next = this.actions.get(clip)
    if (!next) return
    // Already playing it — unless something stopped it (a suspended tree, a finished fade): then
    // it must start again, or the rig falls back to its bind pose (KayKit's T-pose).
    if (next === this.current && next.isRunning()) return
    if (next === this.current) {
      next.reset().setEffectiveWeight(1).play()
      return
    }
    next.reset()
    if (ONCE.has(clip)) {
      next.setLoop(LoopOnce, 1)
      next.clampWhenFinished = true
    }
    next.fadeIn(FADE_S).play()
    this.current?.fadeOut(FADE_S)
    this.current = next
    this.playing = clip
    this.since = now
  }

  /**
   * Hero: the mixer's step this frame — "full" spends the time owed, "skip" keeps it (owed time is
   * capped at a second). True when the rig was posed (what is levelled may be levelled now).
   */
  step(delta: number, pace: "full" | "skip"): boolean {
    this.lag = Math.min(this.lag + delta, 1)
    if (pace === "skip") return false
    this.mixer.update(this.lag)
    this.lag = 0
    return true
  }

  /** Crowd: the member stands where `root` is and holds what the rig's hands hold. */
  follow(root: Object3D): void {
    if (!this.crowd || this.member < 0) return
    // Its parent (the scene) was brought up to date by last frame's render: only the root itself moved.
    root.updateWorldMatrix(false, false)
    this.crowd.place(this.member, root.matrixWorld)
    this.crowd.carry(this.member, gearOf(this.sockets, this.gear))
  }

  /**
   * Into `crowd` as a member tinted `tint`, at the mixer's pose: the time it owes for this frame
   * (`delta`) is the crowd's to draw. Nothing until the first clip has played.
   */
  toCrowd(crowd: Crowd, model: string, tint: ColorRepresentation, root: Object3D, delta: number): void {
    const action = this.current
    if (!action || !this.playing || this.member >= 0) return
    const owed = Math.min(this.lag + delta, 1) * this.tempo
    this.member = crowd.join(model, tint)
    this.crowd = crowd
    crowd.start(this.member, this.playing, action.time + owed, this.tempo)
    this.lag = 0
    this.show(false)
    this.follow(root)
  }

  /**
   * Back to the rig, at the crowd's pose a frame ago (`delta`): this frame's mixer step brings it
   * to now.
   */
  toHero(now: number, delta: number): void {
    const crowd = this.crowd
    if (!crowd || this.member < 0) return
    const { clip, time } = crowd.phaseOf(this.member, now - delta)
    crowd.leave(this.member)
    this.member = -1
    this.crowd = null
    const action = this.actions.get(clip)
    this.mixer.stopAllAction()
    this.current = action ?? null
    this.playing = action ? clip : null
    this.lag = 0
    if (action) {
      action.reset()
      if (ONCE.has(clip)) {
        action.setLoop(LoopOnce, 1)
        action.clampWhenFinished = true
      }
      action.play()
      action.time = time
      this.mixer.update(0)
    }
    this.show(true)
  }

  /** The crowd member's tint (its cape and hat), when in the crowd. */
  tint(color: ColorRepresentation): void {
    if (this.crowd && this.member >= 0) this.crowd.tint(this.member, color)
  }

  /** Frees the mixer and the skeleton's bone texture (made for this body alone); leaves the crowd. */
  dispose(): void {
    if (this.crowd && this.member >= 0) this.crowd.leave(this.member)
    this.crowd = null
    this.member = -1
    this.show(true)
    this.current = null
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.rig)
    this.rig.traverse((child) => {
      const skinned = child as SkinnedMesh
      if (skinned.isSkinnedMesh) skinned.skeleton.dispose()
    })
  }

  /** Has the crowd member's clip (played once) reached its end? */
  private finished(): boolean {
    if (!this.crowd || this.member < 0 || !this.playing) return false
    const duration = this.actions.get(this.playing)?.getClip().duration ?? 0
    return this.crowd.phaseOf(this.member).time >= duration
  }

  /**
   * The rig in the scene (hero) or out of it (crowd). Hidden alone it would still cost its bones'
   * matrices every frame: three updates a hidden subtree's world matrices all the same.
   */
  private show(drawn: boolean): void {
    if (!drawn) {
      this.stage = this.rig.parent ?? this.stage
      this.rig.removeFromParent()
    } else if (this.stage && !this.rig.parent) this.stage.add(this.rig)
  }
}
