/**
 * The map's plates, laid out (scene/archipelago/IslandMark.tsx): short names, and where each plate
 * goes on screen so that no two cover each other. Pure: screen pixels in, pixels out.
 *
 * A plate wants to sit just above its island. Where another is already there it tries the other
 * sides, then further out (a leader line then joins it to its island); the most important are placed
 * first (the core, then the biggest islands), and one that finds no room is dropped to a pip,
 * which a hover brings back in full.
 */

/**
 * An island's name as the map shows it: a package's own, without the repo's name in front of it
 * ("react-dom" in React is "dom", "react_compiler" is "compiler"). The core (named for the repo)
 * keeps its name.
 */
export function shortName(name: string, repoName: string): string {
  if (!repoName || name === repoName) return name
  const lead = new RegExp(`^${repoName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[-_.]+(?=.)`, "i")
  return name.replace(lead, "")
}

export interface LabelIn {
  /** The island: where its centre lies on screen, and how far its land reaches there (px). */
  x: number
  y: number
  radius: number
  /** The plate's size (px). */
  w: number
  h: number
  /** Higher is placed first and kept when room runs out. */
  priority: number
  /** Always shown, even over others (the core). */
  pinned?: boolean
}

export interface LabelOut {
  /** Where the plate's centre goes, from the island's centre (px). */
  dx: number
  dy: number
  /** Shown as a plate; else only a pip. */
  shown: boolean
  /** Far enough from its island to want a line back to it. */
  leader: boolean
}

/** Sea kept between two plates, and between a plate and the screen's edge (px). */
const GAP = 4
const EDGE = 8
/** Rings of candidate spots round an island, as multiples of the plate's own size. */
const RINGS = [0, 1.2, 2.2, 3.4]

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP

/** Where one plate could go, nearest the island first: above, below, to the sides, then the corners. */
function candidates(item: LabelIn, ring: number): readonly (readonly [number, number])[] {
  const up = item.radius * 0.35 + item.h / 2 + 4 + ring * item.h
  const side = item.radius * 0.8 + item.w / 2 + 4 + ring * item.h
  const corner = (item.w / 2) * 0.7 + item.radius * 0.3 + ring * item.h * 0.6
  return [
    [0, -up],
    [0, up],
    [side, 0],
    [-side, 0],
    [corner, -up],
    [-corner, -up],
    [corner, up],
    [-corner, up],
  ]
}

/**
 * Lays the plates out in `view` (px). Returns each item's place, aligned with `items`: the most
 * important first take their spot, the rest the first that is free; the pinned ones are always shown
 * (at their best spot even if it overlaps).
 */
export function layoutLabels(
  items: readonly LabelIn[],
  view: { w: number; h: number /** At most this many plates (the rest pips). */; max?: number },
  /** Screen rectangles no plate may cover (the HUD, the adventurers' chips). */
  avoid: readonly Rect[] = [],
): LabelOut[] {
  const out: LabelOut[] = items.map(() => ({ dx: 0, dy: 0, shown: false, leader: false }))
  const order = items
    .map((_, i) => i)
    .sort((a, b) => (items[b] as LabelIn).priority - (items[a] as LabelIn).priority || a - b)
  const taken: Rect[] = [...avoid]
  let shownCount = 0
  for (const i of order) {
    if (view.max !== undefined && shownCount >= view.max && !(items[i] as LabelIn).pinned) continue
    const item = items[i] as LabelIn
    const rect = (dx: number, dy: number): Rect => ({
      x: item.x + dx - item.w / 2,
      y: item.y + dy - item.h / 2,
      w: item.w,
      h: item.h,
    })
    const inside = (r: Rect): boolean =>
      r.x >= EDGE && r.y >= EDGE && r.x + r.w <= view.w - EDGE && r.y + r.h <= view.h - EDGE
    let best: readonly [number, number] | undefined
    for (const ring of RINGS) {
      best = candidates(item, ring).find(([dx, dy]) => {
        const r = rect(dx, dy)
        return inside(r) && !taken.some((other) => overlaps(r, other))
      })
      if (best) break
    }
    // The pinned plate is always shown: at its first choice, over whatever is there.
    const spot = best ?? (item.pinned ? candidates(item, 0)[0] : undefined)
    if (!spot) continue
    shownCount++
    taken.push(rect(spot[0], spot[1]))
    out[i] = {
      dx: spot[0],
      dy: spot[1],
      shown: true,
      leader: Math.hypot(spot[0], spot[1]) > item.radius + item.h / 2,
    }
  }
  return out
}
