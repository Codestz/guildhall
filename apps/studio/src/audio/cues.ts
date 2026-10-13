/**
 * V2's world events as V1's moments (pure): `cueOf` reads one sim `WorldEvent` as the moment it makes a
 * sound for, and `infoOf` says where on the island it sounds, which instrument a deed plays and the
 * spot sound it makes there (V1 `sampleFor`, from the kind of place the work is at).
 *
 *   actor.join (a subagent)  join        actor.deed   deed, or deed-failed
 *   actor.quest              quest       actor.plea   plea · actor.answered  plea-answered
 *   actor.loot               loot        actor.fail   fail · actor.recover   recover
 *   actor.leave              leave       sea.pr merged  sea-merged · sea.release  sea-release
 *   sea.ci (its moment)      sea-red, sea-green          sea.push  sea-push
 *
 * A guildmaster's first sight is no `join` (V1: a join is a subagent joining a party); `actor.step`,
 * `actor.info`, `actor.rank` and `actor.resume` make no sound.
 *
 * Places: V1 named stations and sites (the keep's forge, the yard, the quarry, the forest, the library,
 * the tower); the V2 island has places of a kind (world zones.ts). `AT_OF_KIND` reads one as the other.
 */
import type { Craft } from "@guildhall/core"
import type { WorldEvent } from "@guildhall/sim"
import type { MomentCue, MomentInfo, Where } from "./engine.ts"
import { type CueKind, sigilOfCraft } from "./kinds.ts"
import { sampleFor } from "./samples.ts"

/** A moment, with what its event says about the work: its craft, its place (zone) and its paths. */
export interface Cue extends MomentCue {
  craft?: Craft
  zone?: number
  paths?: readonly string[]
}

export function cueOf(ev: WorldEvent): Cue | null {
  const kind = kindOf(ev)
  if (!kind) return null
  if (ev.kind === "actor.deed") {
    const zone = ev.places[0]
    return {
      kind,
      id: ev.id,
      call: ev.call,
      craft: ev.craft,
      paths: ev.paths,
      ...(ev.size === undefined ? {} : { size: ev.size }),
      ...(zone === undefined ? {} : { zone }),
    }
  }
  if (ev.kind.startsWith("sea.")) return { kind, id: SEA }
  return { kind, id: (ev as { id: string }).id }
}

/** Who a sea's cue is from. */
export const SEA = "sea"

function kindOf(ev: WorldEvent): CueKind | null {
  switch (ev.kind) {
    case "actor.join":
      return ev.parent === undefined ? null : "join"
    case "actor.quest":
      return "quest"
    case "actor.deed":
      return ev.failed ? "deed-failed" : "deed"
    case "actor.plea":
      return "plea"
    case "actor.answered":
      return "plea-answered"
    case "actor.loot":
      return "loot"
    case "actor.fail":
      return "fail"
    case "actor.recover":
      return "recover"
    case "actor.leave":
      return "leave"
    case "sea.push":
      return "sea-push"
    case "sea.pr":
      return ev.state === "merged" ? "sea-merged" : null
    case "sea.release":
      return "sea-release"
    case "sea.ci":
      return ev.moment ?? null
    default:
      return null
  }
}

/** A V1 station or site a V2 place's kind stands for (what its spot sounds are). */
export const AT_OF_KIND: Readonly<Record<string, { station?: string; site?: string }>> = {
  // the Guildhall: work that names no file is done here; reading in its halls turns pages
  castle: { site: "tower" },
  monastery: { station: "library" },
  camp: { station: "forge" },
  mine: { site: "quarry" },
  lumber: { site: "forest" },
  town: { site: "yard" },
  market: { site: "yard" },
  hamlet: { site: "yard" },
  farm: { site: "yard" },
  fishing: { site: "yard" },
  harbour: {},
}

/** What the island knows to place a cue: its places, its landmarks and where each hero is drawn. */
export interface IslandSpots {
  /** A zone's place: its kind and its heart. */
  zone(zone: number): { kind: string; at: Where } | undefined
  /** A path's place kind when the island binds no paths (the site's own demo guild). */
  pathKind?(path: string): string | undefined
  /** The Guildhall (the castle), where work with no place is done and newcomers gather. */
  castle: Where | null
  /** The harbour's quay: the sea's cues. */
  harbour: Where | null
  /** Where the bell tolls for the fallen and the dead creak back: a monastery, else the castle. */
  chapel: Where | null
  /** Where hero `id` is drawn now. */
  heroAt(id: string): Where | null
}

export function infoOf(cue: Cue, spots: IslandSpots): MomentInfo {
  const sea = cue.id === SEA
  const place = cue.zone === undefined ? undefined : spots.zone(cue.zone)
  const kind = place?.kind ?? (cue.paths?.[0] ? spots.pathKind?.(cue.paths[0]) : undefined) ?? "castle"
  const where = sea
    ? (spots.harbour ?? spots.castle ?? undefined)
    : (spots.heroAt(cue.id) ?? place?.at ?? spots.castle ?? undefined)
  const sigil = cue.kind === "deed" && cue.craft ? sigilOfCraft(cue.craft) : undefined
  const sample = sampleFor(cue.kind, cue.craft, AT_OF_KIND[kind] ?? {})
  const sampleAt =
    sample === "bell" || sample === "creak"
      ? (spots.chapel ?? spots.castle ?? undefined)
      : sample === "horn" || sample === "toll"
        ? (spots.harbour ?? undefined)
        : undefined
  return {
    ...(where ? { where } : {}),
    ...(sigil ? { sigil } : {}),
    sample,
    ...(sampleAt ? { sampleAt } : {}),
  }
}
