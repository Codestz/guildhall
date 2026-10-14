/**
 * A rigged body that plays its rig's clips (ADR 010). KayKit bodies carry no clips of their own: the
 * clips live in the rig file (`rig-medium.glb`, bones only) and bind to the body by bone name.
 */
import { type CatalogEntry, type MountSlot, type RigEntry, SLOT_FRAMES } from "@guildhall/assets"
import { log } from "@guildhall/core"
import {
  type AnimationAction,
  AnimationClip,
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  type Object3D,
  PropertyBinding,
} from "three"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { loadPiece } from "../pieces.ts"
import { withCarry } from "./carry.ts"
import { type Mounted, mountClip } from "./mount.ts"
import { keepUpright } from "./upright.ts"

const logger = log("render:character")

export interface PlayOpts {
  /** Freeze the clip at this fraction of its length (deterministic shots); `update` then holds it. */
  t?: number
  /** Repeat (default) or play once and hold the last frame. */
  loop?: boolean
  /** Time scale (default 1). */
  speed?: number
  /** Seconds to cross-fade from the clip playing now (default 0: cut). */
  fade?: number
}

export interface Character {
  root: Object3D
  mixer: AnimationMixer
  clips: AnimationClip[]
  /** The clip last played, or null. */
  readonly clip: string | null
  /** Props attached with `attachMount`, in attach order. */
  readonly mounted: Mounted[]
  /** False (and nothing changed) when there is no such clip. Re-poses mounts for the clip's overrides. */
  play(clip: string, opts?: PlayOpts): boolean
  /** A slot's bone (`hand.r` → three node `handslotr`), or a bone by its glTF name. */
  bone(slotOrName: MountSlot | string): Object3D | undefined
  /** Advances the mixer, then levels upright mounts. */
  update(dt: number): void
}

/** A character over an already-loaded body and clip list (what `loadCharacter` wraps; tests use it bare). */
export function createCharacter(root: Object3D, clips: AnimationClip[]): Character {
  const mixer = new AnimationMixer(root)
  const mounted: Mounted[] = []
  let current: AnimationAction | null = null
  let clipName: string | null = null

  const update = (dt: number) => {
    mixer.update(dt)
    for (const m of mounted) keepUpright(m)
  }

  return {
    root,
    mixer,
    clips,
    mounted,
    get clip() {
      return clipName
    },
    play(name, opts = {}) {
      const clip = AnimationClip.findByName(clips, name)
      if (!clip) {
        logger.warn("no such clip", { clip: name })
        return false
      }
      const action = mixer.clipAction(clip)
      const frozen = opts.t !== undefined
      const once = frozen || opts.loop === false
      const fade = frozen ? 0 : (opts.fade ?? 0)
      const previous = current !== action ? current : null
      action.reset()
      // Frozen clips play once and clamp, so t = 1 holds the last frame instead of wrapping to the first.
      action.setLoop(once ? LoopOnce : LoopRepeat, Infinity)
      action.clampWhenFinished = once
      action.timeScale = opts.speed ?? 1
      if (frozen) {
        action.time = Math.min(Math.max(opts.t ?? 0, 0), 1) * clip.duration
        action.paused = true
      }
      action.play()
      if (previous && fade > 0) {
        action.fadeIn(fade)
        previous.fadeOut(fade)
      } else previous?.stop()
      current = action
      clipName = name
      for (const m of mounted) mountClip(m, name)
      update(0)
      return true
    },
    bone(slotOrName) {
      const name = slotOrName in SLOT_FRAMES ? SLOT_FRAMES[slotOrName as MountSlot].bone : slotOrName
      return root.getObjectByName(PropertyBinding.sanitizeNodeName(name))
    },
    update,
  }
}

let loader: GLTFLoader | null = null
const rigClips = new Map<string, Promise<AnimationClip[]>>()

/** A rig file's clips, loaded once per url; a failed load is forgotten so a retry refetches. */
function loadClips(url: string): Promise<AnimationClip[]> {
  let clips = rigClips.get(url)
  if (!clips) {
    loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    // with the carrying walk made from two of them (carry.ts)
    clips = loader.loadAsync(url).then((gltf) => withCarry(gltf.animations))
    rigClips.set(url, clips)
    clips.catch(() => rigClips.delete(url))
  }
  return clips
}

/**
 * A character body (`kind: "character"`) with its rig's clips, e.g.
 * `loadCharacter(entry, catalog.rig(entry.character.rig), libraryUrl)`. `url` maps a library-relative
 * path (`files.glb`, `rig.file`) to where it is served. The body is a fresh copy (`loadPiece`).
 */
export async function loadCharacter(
  entry: CatalogEntry,
  rig: RigEntry,
  url: (path: string) => string,
): Promise<Character> {
  if (entry.character && entry.character.rig !== rig.id)
    logger.warn("rig mismatch", { piece: entry.id, rig: rig.id, wants: entry.character.rig })
  const [root, clips] = await Promise.all([loadPiece(url(entry.files.glb)), loadClips(url(rig.file))])
  return createCharacter(root, [...root.animations, ...clips])
}
