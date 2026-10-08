import type { CiState, SeaEvent } from "@guildhall/core"

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

/** Story ms each passage takes. */
export const SAIL_OUT_MS = 16_000
export const ARRIVE_MS = 9_000
export const MERGE_MS = 12_000
export const LEAVE_MS = 14_000
export const GALLEON_MS = 11_000
/** How long a merged ship stays moored, and the galleon at anchor, before they go. */
export const MOORED_MS = 60_000
export const GALLEON_STAY_MS = 120_000
/** The release's flourish, after the galleon anchors. */
export const FLOURISH_MS = 9_000
/** Crates a cargo ship carries at most. */
export const MAX_CRATES = 6
/** Ships of one kind on the water at once: the newest win (the instanced layers' sizes). */
export const MAX_SHIPS = 4

export type Hull = "cargo" | "pr" | "galleon"

export interface Voyage {
  hull: Hull
  /** Stable while the ship is on the water: the event (push, release) or the pull request it is. */
  key: string
  /** Harbour frame (see `Harbour`), heading in radians (bow +z, as the Kenney ships face). */
  side: number
  out: number
  heading: number
  /** 1 on the water, 0 gone: shrinks and sinks below the horizon as it goes. */
  shown: number
  /** Under way (sails full) rather than at anchor or moored: the bob and lean follow it. */
  sailing: boolean
  crates: number
}

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

// ── the harbour's places, (side, out) from the quay ──

/** The quay's west side, where merged ships moor (a berth per ship, further along the shore). */
const BERTH = { side: -14, out: -3 }
const BERTH_STEP = -8
/** The quay's east side, where cargo is loaded. */
const LOADING = { side: 9, out: -6 }
/** Offshore anchorage for open pull requests, a berth each going west. */
const ANCHORAGE = { side: -32, out: 26 }
const ANCHORAGE_STEP = -14
/** Where the galleon drops anchor. */
const GALLEON = { side: 26, out: 28 }
/** Over the horizon: where ships come from and go to. */
const FAR = 120

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const easeOut = (t: number): number => 1 - (1 - t) ** 3
const easeInOut = (t: number): number => t * t * (3 - 2 * t)
/** 1 → 0 over the last `fraction` of a passage. */
const fadeOut = (p: number, fraction = 0.3): number => clamp01((1 - p) / fraction)

/** Heading from one harbour point toward another (bow +z). */
function course(fromSide: number, fromOut: number, toSide: number, toOut: number): number {
  return Math.atan2(toSide - fromSide, toOut - fromOut)
}

interface Leg {
  from: { side: number; out: number }
  to: { side: number; out: number }
}

/** A point along a leg at progress `p` (already eased), heading along it. */
function along({ from, to }: Leg, p: number): Pick<Voyage, "side" | "out" | "heading"> {
  return {
    side: lerp(from.side, to.side, p),
    out: lerp(from.out, to.out, p),
    heading: course(from.side, from.out, to.side, to.out),
  }
}

/** Turns from `a` to `b` the short way round. */
function turn(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a))
  return a + d * t
}

/** The sea at run time `time`: what has been sighted by then, and where it has got to. */
export function seaAt(sightings: readonly SeaSighting[], time: number): SeaView {
  const voyages: Voyage[] = []
  const light: Lighthouse = { state: undefined, since: 0 }
  let flourish: number | undefined
  let galleon: Voyage | undefined
  /** Pull requests by repo#number: opened when, and how they ended. */
  const prs = new Map<string, { opened: number; ended?: { kind: "pr_merged" | "pr_closed"; at: number } }>()

  for (const { event, at } of sightings) {
    if (at > time) break
    switch (event.kind) {
      case "ci":
        light.state = event.state
        light.since = at
        break
      case "pr_opened":
        if (!prs.has(prKey(event))) prs.set(prKey(event), { opened: at })
        break
      case "pr_merged":
      case "pr_closed": {
        // Opened before the hall was watching: it is found at anchor as it ends.
        const pr = prs.get(prKey(event)) ?? { opened: at - ARRIVE_MS }
        pr.ended ??= { kind: event.kind, at }
        prs.set(prKey(event), pr)
        break
      }
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

  // Open pull requests take the anchorage berths in the order they opened; merged ones the quay's.
  let anchored = 0
  let moored = 0
  for (const [key, pr] of prs) {
    const voyage = prVoyage(
      key,
      pr,
      time,
      () => anchored++,
      () => moored++,
    )
    if (voyage) voyages.push(voyage)
  }
  return { voyages: newest(voyages), light, flourish, galleon }
}

function prKey(event: { repo: string; number: number }): string {
  return `${event.repo}#${event.number}`
}

/** At most MAX_SHIPS of each hull, the newest (the latest in the list) kept. */
function newest(voyages: Voyage[]): Voyage[] {
  const counts = new Map<Hull, number>()
  const kept: Voyage[] = []
  for (let i = voyages.length - 1; i >= 0; i--) {
    const v = voyages[i] as Voyage
    const n = counts.get(v.hull) ?? 0
    if (n >= MAX_SHIPS) continue
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

/** A pull request's ship: arriving, at anchor, sailing in to moor, moored, or sailing away. */
function prVoyage(
  key: string,
  pr: { opened: number; ended?: { kind: "pr_merged" | "pr_closed"; at: number } },
  time: number,
  anchorage: () => number,
  berth: () => number,
): Voyage | undefined {
  const base = { hull: "pr" as const, key, crates: 0 }
  const ended = pr.ended && pr.ended.at <= time ? pr.ended : undefined
  if (!ended) {
    const slot = anchorage()
    const to = { side: ANCHORAGE.side + slot * ANCHORAGE_STEP, out: ANCHORAGE.out }
    const p = clamp01((time - pr.opened) / ARRIVE_MS)
    const from = { side: to.side - 50, out: FAR }
    if (p < 1) {
      const at = along({ from, to }, easeOut(p))
      return {
        ...base,
        ...at,
        heading: turn(at.heading, Math.PI / 2, easeInOut(clamp01((p - 0.6) / 0.4))),
        shown: clamp01(p / 0.15),
        sailing: p < 0.95,
      }
    }
    return { ...base, ...to, heading: Math.PI / 2, shown: 1, sailing: false }
  }
  // Where it lay at anchor: the berth it had (the first, when it never anchored while watched).
  const anchor = { side: ANCHORAGE.side, out: ANCHORAGE.out }
  const age = time - ended.at
  if (ended.kind === "pr_closed") {
    if (age >= LEAVE_MS) return undefined
    const p = age / LEAVE_MS
    const at = along({ from: anchor, to: { side: anchor.side - 70, out: FAR } }, p * p)
    return {
      ...base,
      ...at,
      heading: turn(Math.PI / 2, at.heading, clamp01(p * 4)),
      shown: fadeOut(p),
      sailing: true,
    }
  }
  if (age >= MERGE_MS + MOORED_MS + LEAVE_MS) return undefined
  const slot = berth()
  const moor = { side: BERTH.side + slot * BERTH_STEP, out: BERTH.out }
  // Into the harbour: out a little to clear the anchorage, then in to the quay, bow to the island.
  const approach = { side: moor.side, out: moor.out + 22 }
  if (age < MERGE_MS) {
    const p = easeInOut(age / MERGE_MS)
    const first = p < 0.5
    const leg = first ? { from: anchor, to: approach } : { from: approach, to: moor }
    const at = along(leg, first ? p * 2 : (p - 0.5) * 2)
    const heading = first ? turn(Math.PI / 2, at.heading, clamp01(p * 6)) : at.heading
    return { ...base, ...at, heading, shown: 1, sailing: true }
  }
  if (age < MERGE_MS + MOORED_MS) return { ...base, ...moor, heading: Math.PI, shown: 1, sailing: false }
  const p = (age - MERGE_MS - MOORED_MS) / LEAVE_MS
  const at = along({ from: moor, to: { side: moor.side - 40, out: FAR } }, p * p)
  return { ...base, ...at, shown: fadeOut(p), sailing: true }
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
