import type { Craft, Session } from "@guildhall/core"
import { islandOfPath, isleOf, type Sea, toSea } from "../world/abroad.ts"
import { spotById, spotFor } from "../world/hall/spots.ts"
import type { Post } from "../world/layout.ts"
import type { VenueDoor } from "../world/venues.ts"

/**
 * Who works abroad, and where in the hall they work. Work that belongs to a package of a split
 * repo (a deed on a file under its folder: world/abroad.ts `islandOfPath`) is done on that package's
 * island, in its hall (world/hall): the agent crosses to it (scene/voyage.ts), takes a free seat or
 * station that suits the deed (world/hall/spots.ts) and keeps it while they stay; a deed on no
 * package, or on the home island's own, keeps them home. They stay `ABROAD_MS` past their last deed
 * on the package, then go home as they came. Deterministic: sessions are served in the order the
 * views give them (by join), and one who already has a spot keeps it while they stay.
 */

/** How long after its last deed on a package an agent stays on its island. */
export const ABROAD_MS = 45_000

/** What a view says about working abroad; read by scene/Adventurer.tsx and scene/voyage.ts. Coordinates are the archipelago's. */
export interface HallVisit {
  /** The far island's id. */
  island: string
  /** The seat or station they work at; undefined: the hall is full, they wait at the gate. */
  spot?: string
  /** They sit there (a chair, a stool), else they stand at work. */
  seat: boolean
  /** The clip they play there. */
  clip: string
  /** The hall's gate (step outside, sill within). */
  door: VenueDoor
}

/** The path a tool call is about, if it names one. */
function pathOf(input: Record<string, unknown>): string | undefined {
  for (const key of ["filePath", "path", "file"]) {
    const value = input[key]
    if (typeof value === "string" && value) return value
  }
  return undefined
}

/**
 * The far island a session is working on now: that of its latest deed that names a path, if the
 * deed is still going or ended less than ABROAD_MS ago and the path belongs to one.
 */
export function islandOfSession(s: Session, now: number, sea: Sea): string | undefined {
  for (let i = s.entries.length - 1; i >= 0; i--) {
    const entry = s.entries[i]
    if (entry?.kind !== "tool") continue
    const path = pathOf(entry.input)
    if (!path) continue
    const live = entry.state === "running" || entry.state === "pending"
    if (!live && now - (entry.ended ?? entry.at) > ABROAD_MS) return undefined
    const island = islandOfPath(sea.far, path)
    return island && isleOf(sea, island)?.world.hall ? island : undefined
  }
  return undefined
}

/** One pass's bookkeeping: the spots taken in each hall. */
export class HallVisits {
  private readonly taken = new Map<string, Set<string>>()
  private readonly kept = new Map<string, string>()

  /**
   * `wants`: where each session of the pass is bound (its island), and `previous` the views of the pass
   * before: whoever is still bound for the island they had a spot on keeps it, so nobody is shuffled.
   */
  constructor(
    private readonly sea: Sea | undefined,
    wants: ReadonlyMap<string, string>,
    previous: readonly { id: string; hall?: HallVisit }[],
  ) {
    for (const { id, hall } of previous)
      if (hall?.spot && wants.get(id) === hall.island) {
        this.claim(hall.island, hall.spot)
        this.kept.set(id, hall.spot)
      }
  }

  private claim(island: string, spot: string): void {
    const set = this.taken.get(island) ?? new Set<string>()
    set.add(spot)
    this.taken.set(island, set)
  }

  /** The visit of `who` bound for `island`, doing a deed of `craft`: a spot suited to it, or a place at the gate. */
  visit(
    who: string,
    island: string,
    craft: Craft | undefined,
  ): { visit: HallVisit; target: Post } | undefined {
    const isle = this.sea ? isleOf(this.sea, island) : undefined
    const hall = isle?.world.hall
    if (!isle || !hall) return undefined
    const mine = this.kept.get(who)
    const spot =
      (mine ? spotById(hall, mine) : undefined) ?? spotFor(hall, craft, this.taken.get(island) ?? NONE)
    if (spot && !mine) this.claim(island, spot.id)
    const door: VenueDoor = {
      ...hall.door,
      step: toSea(isle, hall.door.step),
      sill: toSea(isle, hall.door.sill),
    }
    const base = { island, door, seat: spot?.seat ?? false, clip: spot?.clip ?? "Idle_A" }
    if (!spot) {
      // The hall is full: they wait on the step, facing the gate.
      return { visit: base, target: [door.step[0], door.step[1], door.inward] }
    }
    const [x, z] = toSea(isle, [spot.post[0], spot.post[1]])
    return {
      visit: { ...base, spot: spot.id },
      target: [round(x), round(z), spot.post[2]],
    }
  }
}

const NONE: ReadonlySet<string> = new Set()
const round = (value: number): number => Math.round(value * 100) / 100

/** Where each of `sessions` is bound: the far island of every one that works abroad (a guildmaster never does, nor one not at work). */
export function boundFor(
  sessions: readonly Session[],
  now: number,
  sea: Sea | undefined,
  master: (s: Session) => boolean,
): Map<string, string> {
  const out = new Map<string, string>()
  if (!sea) return out
  for (const s of sessions) {
    if (master(s) || s.status !== "running") continue
    const island = islandOfSession(s, now, sea)
    if (island) out.set(s.id, island)
  }
  return out
}
