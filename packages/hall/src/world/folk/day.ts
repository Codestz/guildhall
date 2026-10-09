import type { Folk, Role, Slot } from "./types.ts"

/**
 * A folk's day, from the world clock alone (pure: the same seed and hour always say the same).
 * Each role has a timetable of the hours its day changes; a folk's own `jitter` moves all of them,
 * so a street does not empty at one stroke.
 *
 *   dawn      out of the door and on the way to work
 *   work      the district's venue, the fields, the quay, the road with a barrow, the wall
 *   dusk      the square, then the inn (or the square again, where there is none)
 *   night     indoors, the windows lit; the night watch is out on the wall instead
 *   rain      the inn (or home) for whoever would be out, but the watch
 */

type Timetable = readonly (readonly [hour: number, slot: Slot])[]

const VILLAGER: Timetable = [
  [6.5, "work"],
  [17.5, "plaza"],
  [19.5, "inn"],
  [22.5, "home"],
]
const TIMETABLES: Readonly<Record<Role, Timetable>> = {
  villager: VILLAGER,
  farmer: [
    [5.5, "work"],
    [16.5, "plaza"],
    [18.5, "inn"],
    [21.5, "home"],
  ],
  miner: [
    [7, "work"],
    [16.5, "plaza"],
    [18.5, "inn"],
    [22, "home"],
  ],
  fisher: [
    [5, "work"],
    [15, "plaza"],
    [17.5, "inn"],
    [21, "home"],
  ],
  trader: [
    [7, "work"],
    [18.5, "plaza"],
    [19.5, "inn"],
    [22, "home"],
  ],
  guard: [
    [6.5, "work"],
    [17.5, "plaza"],
    [18.5, "inn"],
    [21, "home"],
  ],
}
/** The night watch sleeps the day through and is on the wall from dusk to dawn. */
const WATCH: Timetable = [
  [6.5, "home"],
  [16.5, "plaza"],
  [17.5, "work"],
]

/**
 * The part of the day `folk` is in at `hour` (0–24, the world clock's). In `wet` weather (rain, a
 * storm) whoever would be out in the open, the watch apart, takes shelter in the inn.
 */
export function slotAt(folk: Pick<Folk, "role" | "night" | "jitter">, hour: number, wet = false): Slot {
  const slot = dryAt(folk, hour)
  return wet && folk.role !== "guard" && (slot === "work" || slot === "plaza") ? "inn" : slot
}

function dryAt(folk: Pick<Folk, "role" | "night" | "jitter">, hour: number): Slot {
  const table = folk.night ? WATCH : TIMETABLES[folk.role]
  const h = (((hour - folk.jitter) % 24) + 24) % 24
  let slot = table[table.length - 1]?.[1] ?? "home"
  for (const [from, next] of table) {
    if (h < from) break
    slot = next
  }
  return slot
}

/**
 * Does the window of a home nobody modelled glow at `hour`? A share of the houses show a lit
 * window of an evening (each its own hours) and again at dawn, so the town round the folk reads as
 * lived in. `unit`: 0…1, stable per house.
 */
export function windowLit(unit: number, hour: number): boolean {
  if (unit > 0.62) return false
  const dusk = 17.5 + unit * 4
  const bed = dusk + 2.5 + unit * 2.5
  if (hour >= dusk && hour < bed) return true
  return unit < 0.3 && hour >= 5 + unit * 2 && hour < 6.4 + unit * 2
}
