import type { CiState, SeaEvent } from "@guildhall/core"
import { CAPS, type Caps, docketAt, MAX_BERTHS } from "../../guild/docket.ts"
import { pushedClear, type Wall } from "../../world/bridgeWalls.ts"
import {
  along,
  BERTH,
  clamp01,
  easeInOut,
  easeOut,
  FAR,
  fadeOut,
  GALLEON,
  GALLEON_MS,
  GALLEON_STAY_MS,
  type Hull,
  LEAVE_MS,
  LOADING,
  SAIL_OUT_MS,
  turn,
  type Voyage,
} from "./passage.ts"
import { pullVoyage } from "./pulls.ts"

/**
 * The GitHub sea as the scene draws it (PROTOCOL.md §7): a pure reading of the store's sightings at a
 * run time, so a seek, a paused probe shot and a replay all show the same water. No three, no React.
 *
 *   push        a cargo ship casts off from the quay, crates on deck (one per commit, capped), and
 *               sails out over the horizon
 *   pr_opened   a ship sails in and anchors offshore, one berth per open pull request
 *   pr_merged   that ship sails into the harbour under full sail and moors beside the quay
 *   pr_closed   it weighs anchor and sails away
 *   ci          the lighthouse: the newest run's state (steady warm when passed, a slow red pulse when
 *               failed, a spinning amber while queued or running)
 *   release     a galleon arrives with its flag up, and a short flourish of sparks once it anchors
 *
 * Voyages are placed in the harbour's own frame (`Harbour`): `side` along the shore, `out` away from
 * the island, both from the quay. So the hand map and a repo's island share one choreography.
 */

/** The release's flourish, after the galleon anchors. */
export const FLOURISH_MS = 9_000
/** Crates a cargo ship carries at most. */
export const MAX_CRATES = 6
/** Cargo ships on the water at once: the newest win (the instanced layer's size). */
export const MAX_SHIPS = 4
/** Pull request ships on the water at once: the berths, and those merged or closed and still passing. */
export const MAX_PULL_SHIPS = MAX_BERTHS + 6

export {
  ARRIVE_MS,
  BERTH,
  GALLEON_MS,
  GALLEON_STAY_MS,
  type Hull,
  LEAVE_MS,
  MERGE_MS,
  MOORED_MS,
  SAIL_OUT_MS,
  type Voyage,
} from "./passage.ts"

export interface Lighthouse {
  /** The newest CI state reached, or undefined before the first run (the lamp is dark). */
  state: CiState | undefined
  /** Run time it moved to that state. */
  since: number
}

export interface SeaView {
  voyages: Voyage[]
  light: Lighthouse
  /** The release's flourish: ms since it began, while it plays. */
  flourish: number | undefined
  /** Where the galleon is, for the flourish. */
  galleon: Voyage | undefined
}

/** A sighting as the store keeps it: the event at run time `at`. */
export interface SeaSighting {
  event: SeaEvent
  at: number
}

/** The sea at run time `time`: what has been sighted by then, and where it has got to. */
export function seaAt(sightings: readonly SeaSighting[], time: number, caps: Caps = CAPS[2]): SeaView {
  const voyages: Voyage[] = []
  const light: Lighthouse = { state: undefined, since: 0 }
  let flourish: number | undefined
  let galleon: Voyage | undefined

  for (const { event, at } of sightings) {
    if (at > time) break
    switch (event.kind) {
      case "ci":
        light.state = event.state
        light.since = at
        break
      case "push": {
        const age = time - at
        if (age >= SAIL_OUT_MS) break
        voyages.push(cargo(event.id, Math.min(MAX_CRATES, Math.max(1, event.commits)), age / SAIL_OUT_MS))
        break
      }
      case "release": {
        const age = time - at
        const total = GALLEON_MS + GALLEON_STAY_MS + LEAVE_MS
        if (age >= total) break
        galleon = arrival(event.id, age)
        if (age >= GALLEON_MS && age < GALLEON_MS + FLOURISH_MS) flourish = age - GALLEON_MS
        else flourish = undefined
        break
      }
    }
  }
  if (galleon) voyages.push(galleon)

  // Open pull requests lie at their berths on the docket; merged ones take the quay's, in turn.
  let moored = 0
  for (const pull of docketAt(sightings, time, caps).pulls) {
    const voyage = pullVoyage(pull, time, () => moored++)
    if (voyage) voyages.push(voyage)
  }
  return { voyages: newest(voyages), light, flourish, galleon }
}

const LIMIT: Record<Hull, number> = { cargo: MAX_SHIPS, pr: MAX_PULL_SHIPS, galleon: 1 }

/** At most LIMIT of each hull, the newest (the latest in the list) kept. */
function newest(voyages: Voyage[]): Voyage[] {
  const counts = new Map<Hull, number>()
  const kept: Voyage[] = []
  for (let i = voyages.length - 1; i >= 0; i--) {
    const v = voyages[i] as Voyage
    const n = counts.get(v.hull) ?? 0
    if (n >= LIMIT[v.hull]) continue
    counts.set(v.hull, n + 1)
    kept.unshift(v)
  }
  return kept
}

/** A push: cast off slowly, then out to sea, sinking below the horizon at the end. */
function cargo(key: string, crates: number, p: number): Voyage {
  const away = { side: LOADING.side + 30, out: FAR }
  const castOff = 0.15
  if (p < castOff) {
    // Easing off the quay, turning seaward.
    const k = easeInOut(p / castOff)
    const leg = { from: LOADING, to: { side: LOADING.side + 2, out: LOADING.out + 6 } }
    const at = along(leg, k)
    return {
      hull: "cargo",
      key,
      ...at,
      heading: turn(Math.PI, at.heading, k),
      shown: 1,
      sailing: true,
      crates,
    }
  }
  const k = (p - castOff) / (1 - castOff)
  const leg = { from: { side: LOADING.side + 2, out: LOADING.out + 6 }, to: away }
  return { hull: "cargo", key, ...along(leg, k * k), shown: fadeOut(k), sailing: true, crates }
}

/** A release: the galleon sails in, anchors, and after its stay sails off. */
function arrival(key: string, age: number): Voyage {
  const from = { side: GALLEON.side + 60, out: FAR }
  const base = { hull: "galleon" as const, key, crates: 0 }
  if (age < GALLEON_MS) {
    const p = age / GALLEON_MS
    const at = along({ from, to: GALLEON }, easeOut(p))
    // Swing broadside to the island for the last stretch.
    const heading = turn(at.heading, Math.PI / 2, easeInOut(clamp01((p - 0.6) / 0.4)))
    return { ...base, ...at, heading, shown: clamp01(p / 0.15), sailing: p < 0.95 }
  }
  const stay = age - GALLEON_MS
  if (stay < GALLEON_STAY_MS) return { ...base, ...GALLEON, heading: Math.PI / 2, shown: 1, sailing: false }
  const p = (stay - GALLEON_STAY_MS) / LEAVE_MS
  return {
    ...base,
    ...along({ from: GALLEON, to: { side: GALLEON.side + 90, out: FAR } }, p * p),
    shown: fadeOut(p),
    sailing: true,
  }
}

/** The lighthouse's look at run time `time`: lamp colour, glow 0–1, and the beam's turn (radians). */
export function lampOf(
  light: Lighthouse,
  time: number,
): { color: number; glow: number; beam: number; spin: boolean } {
  const s = (time - light.since) / 1000
  switch (light.state) {
    case "passed":
      return { color: 0xffd9a0, glow: 1, beam: 0, spin: false }
    case "failed":
      // A slow red pulse: ~2.5 s a beat, never fully out.
      return {
        color: 0xff3020,
        glow: 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(s * ((2 * Math.PI) / 2.5))),
        beam: 0,
        spin: false,
      }
    case "queued":
    case "running":
      return { color: 0xffa020, glow: 0.9, beam: s * 1.6, spin: true }
    default:
      return { color: 0x000000, glow: 0, beam: 0, spin: false }
  }
}

// ── from the harbour's frame to the world ──

/** The harbour's frame in the world: the quay, `out` (away from the island) and `side` (along the shore). */
export interface Harbour {
  x: number
  z: number
  outX: number
  outZ: number
  sideX: number
  sideZ: number
}

/** The frame round a quay: out is from the island's centre (the origin) through the quay. */
export function harbourOf(quay: readonly [number, number]): Harbour {
  const length = Math.hypot(quay[0], quay[1]) || 1
  const outX = quay[0] / length
  const outZ = quay[1] / length
  return { x: quay[0], z: quay[1], outX, outZ, sideX: outZ, sideZ: -outX }
}

/** A harbour point and heading, in world x, z and heading (bow +z). */
export function toWorld(
  h: Harbour,
  side: number,
  out: number,
  heading = 0,
): { x: number; z: number; heading: number } {
  const dx = Math.sin(heading)
  const dz = Math.cos(heading)
  return {
    x: h.x + h.sideX * side + h.outX * out,
    z: h.z + h.sideZ * side + h.outZ * out,
    heading: Math.atan2(h.sideX * dx + h.outX * dz, h.sideZ * dx + h.outZ * dz),
  }
}

/**
 * `toWorld`, kept off the bridges' walls (world/bridgeWalls.ts): a ship never sails through one, so a
 * place or a leg that would is moved clear of it, to the side the ship is on.
 */
export function toWorldClear(
  h: Harbour,
  walls: readonly Wall[],
  side: number,
  out: number,
  heading = 0,
): { x: number; z: number; heading: number } {
  const at = toWorld(h, side, out, heading)
  if (walls.length === 0) return at
  const [x, z] = pushedClear(walls, at.x, at.z)
  return { x, z, heading: at.heading }
}

/** Where the lighthouse should stand, in the harbour's frame: on the shore east of the quay. */
const LIGHTHOUSE_NEAR = { side: 70, out: -24 }

/**
 * The lighthouse's spot: the beach hex (a coast tile) nearest the shore east of the quay with
 * nothing placed on it, so it stands where the land meets the sea. Undefined on an island without
 * a free coast.
 */
export function lighthouseSpot(
  island: {
    tiles: readonly { piece: string; x: number; z: number }[]
    decor: readonly { x: number; z: number }[]
  },
  h: Harbour,
): { x: number; z: number } | undefined {
  const near = toWorld(h, LIGHTHOUSE_NEAR.side, LIGHTHOUSE_NEAR.out)
  let best: { x: number; z: number } | undefined
  let bestD = Number.POSITIVE_INFINITY
  for (const tile of island.tiles) {
    if (!tile.piece.startsWith("hex_coast")) continue
    if (island.decor.some((d) => Math.hypot(d.x - tile.x, d.z - tile.z) < 5)) continue
    if (Math.hypot(tile.x - h.x, tile.z - h.z) < 18) continue
    const d = Math.hypot(tile.x - near.x, tile.z - near.z)
    if (d < bestD) {
      bestD = d
      best = { x: tile.x, z: tile.z }
    }
  }
  return best
}

/** Where a sea moment happens, in the harbour's frame: the quay's berth for a merge, the galleon's anchorage for a release. */
export function harbourSpotOf(kind: string): { side: number; out: number } | undefined {
  if (kind === "sea-merged") return { side: BERTH.side, out: BERTH.out + 10 }
  if (kind === "sea-release") return GALLEON
  return undefined
}
