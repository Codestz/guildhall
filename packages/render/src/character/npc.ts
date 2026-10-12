/**
 * A townsperson from an NpcLook (assets `resolveNpc`): the KayKit body re-tinted by the look's outfit
 * (ADR 008; `recolour` keeps the skinning attributes), its hidden parts off, its props on their slots
 * (ADR 010), scaled, and its clips started at the look's phase so a crowd does not move in step.
 */
import {
  type Catalog,
  type Mount,
  type MountSlot,
  type NpcLook,
  PALETTE,
  rampMapToSwatchMap,
} from "@guildhall/assets"
import { AnimationClip, type Object3D, PropertyBinding } from "three"
import { loadPiece } from "../pieces.ts"
import { recolourPiece } from "../tint.ts"
import { type Character, loadCharacter, type PlayOpts } from "./load.ts"
import { attachMount } from "./mount.ts"

export type NpcActivity = keyof NpcLook["clips"]

export interface Npc {
  look: NpcLook
  character: Character
  /** The body: place and turn this; the look's scale is on it. */
  root: Object3D
  /**
   * Plays the look's clip for `kind` from the look's phase (or frozen at `opts.t`); walking runs at
   * the look's speed. False when the rig has no such clip.
   */
  play(kind: NpcActivity, opts?: Omit<PlayOpts, "speed">): boolean
  /** Advances the mixer and keeps upright props level. */
  update(dt: number): void
  /** Stops the clips and takes the body out of the scene (geometry belongs to the piece cache). */
  dispose(): void
}

/** A loaded prop and the mount and slot it rides. */
export interface NpcProp {
  piece: Object3D
  mount: Mount
  slot: MountSlot
}

/**
 * Dresses an already-loaded character as `look` (what `createNpc` wraps; tests use it bare): re-tint,
 * hide parts, attach `props`, scale. It plays nothing until `play`.
 */
export function dressNpc(character: Character, look: NpcLook, props: readonly NpcProp[]): Npc {
  const { root } = character
  recolourPiece(root, rampMapToSwatchMap(PALETTE, look.rampMap))
  for (const part of look.hide) {
    const node = root.getObjectByName(PropertyBinding.sanitizeNodeName(part))
    if (node) node.visible = false
  }
  for (const p of props) attachMount(character, p.piece, p.mount, p.slot)
  root.scale.setScalar(look.scale)

  return {
    look,
    character,
    root,
    play(kind, opts = {}) {
      const name = look.clips[kind]
      const speed = kind === "walk" ? look.speed : 1
      if (!character.play(name, { ...opts, speed })) return false
      if (opts.t === undefined) {
        const clip = AnimationClip.findByName(character.clips, name)
        const action = clip && character.mixer.existingAction(clip)
        if (clip && action) action.time = look.phase * clip.duration
        character.update(0)
      }
      return true
    },
    update: (dt) => character.update(dt),
    dispose() {
      character.mixer.stopAllAction()
      character.mixer.uncacheRoot(root)
      root.removeFromParent()
    },
  }
}

/**
 * Loads `look`'s body (with its rig's clips) and props from the catalog and dresses it. `url` maps a
 * library-relative path to where it is served, as for `loadCharacter`. Throws when the body, its rig or
 * a prop's mount is missing from the catalog.
 */
export async function createNpc(look: NpcLook, cat: Catalog, url: (path: string) => string): Promise<Npc> {
  const body = cat.get(look.body)
  const rig = body?.character && cat.rig(body.character.rig)
  if (!body || !rig) throw new Error(`createNpc(${look.recipe}): no body or rig for "${look.body}"`)
  const props = look.mounts.map(async ({ piece, slot }): Promise<NpcProp> => {
    const entry = cat.get(piece)
    const mount = entry?.compose.mount
    if (!entry || !mount) throw new Error(`createNpc(${look.recipe}): no mount for "${piece}"`)
    return { piece: await loadPiece(url(entry.files.glb)), mount, slot }
  })
  const [character, loaded] = await Promise.all([loadCharacter(body, rig, url), Promise.all(props)])
  return dressNpc(character, look, loaded)
}
