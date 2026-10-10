import type { BufferGeometry } from "three"
import { type Bridge, DECK_EDGES, deckAt, PARAPET, RAIL_WIDTH } from "../../world/bridges.ts"
import type { Quay } from "../../world/linkStub.ts"
import { SEA_Y } from "../Ships.tsx"
import { COOL, courses, FLAG, PALE, SHADE, STONE, tone } from "./bridgeStone.ts"
import { jitter, Shapes, type V3 } from "./shapes.ts"

/**
 * Bridges as one mesh, in the island's own stone: dressed in courses (scene/links/bridgeStone.ts),
 * painted from the land pack's palette so the island's light and shadow fall on them as on its own
 * walls. Arched spans on chunky piers with cutwaters, a dark intrados under each arch ringed by its
 * voussoirs, a bevelled coping on the parapets, a paved deck with a kerb beside the rail bed, and
 * on a long bridge two towers at its middle pier. Every bridge of an archipelago is merged into one
 * geometry: one draw call, however many.
 */

/** A parapet's height; the coping is the top of it. */
export const PARAPET_H = 1.05
const COPING = 0.2
/** A tower rises this far over the parapet. */
const TOWER_H = 3.4
/** The slab under the deck. */
const SLAB = 0.8
/** How far down the piers and ramps go: into the seabed. */
const BOTTOM = -3.2
/** A pier is this thick along the axis, and its buttress stands out this far to either side of the body. */
const PIER_HALF = 1.9
const FLARE = 0.5
/** A cutwater's point stands out this far past the buttress. */
const PROW = 1.4
/** Mesh sampling along the axis. */
const STEP = 1.6
/** The arches spring from just over the water. */
const SPRING = SEA_Y + 0.5
/** The voussoirs' ring round an arch, and the coping's overhang and bevel. */
const RING = 0.6
const OVERHANG = 0.16
const BEVEL = 0.14

/** A bridge's frame: points and directions on the axis that starts at its first landing. */
interface Frame {
  /** The point at distance `s` along the axis, `side` to its right, `y` up. */
  at(s: number, side: number, y: number): V3
  /** A direction: `across` (to the axis's right), `along` it, and `up`. */
  dir(across: number, along: number, up: number): V3
  heading: number
}

function frameOf(bridge: Bridge, a: Quay): Frame {
  const ux = Math.sin(bridge.heading)
  const uz = Math.cos(bridge.heading)
  return {
    at: (s, side, y) => [a.land[0] + ux * s + uz * side, y, a.land[1] + uz * s - ux * side],
    dir: (across, along, up) => [uz * across + ux * along, up, -ux * across + uz * along],
    heading: bridge.heading,
  }
}

/** A piece of the axis: an arched span between piers, or solid (a pier, a ramp). */
interface Piece {
  from: number
  to: number
  arch: boolean
}

function piecesOf(bridge: Bridge): Piece[] {
  const { piers, length } = bridge
  const first = piers[0] as number
  const last = piers[piers.length - 1] as number
  const pieces: Piece[] = [{ from: 0, to: first + PIER_HALF, arch: false }]
  for (let i = 0; i + 1 < piers.length; i++) {
    const a = piers[i] as number
    const b = piers[i + 1] as number
    pieces.push({ from: a + PIER_HALF, to: b - PIER_HALF, arch: true })
    if (i + 2 < piers.length) pieces.push({ from: b - PIER_HALF, to: b + PIER_HALF, arch: false })
  }
  pieces.push({ from: last - PIER_HALF, to: length, arch: false })
  return pieces
}

const [LEFT, RIGHT] = DECK_EDGES
const BODY_L = LEFT - PARAPET
const BODY_R = RIGHT + PARAPET

/** Adds `bridge`, which starts at quay `a`'s landing, to `shapes`. */
export function addBridge(shapes: Shapes, bridge: Bridge, a: Quay): void {
  const f = frameOf(bridge, a)
  for (const piece of piecesOf(bridge)) {
    const n = Math.max(1, Math.round((piece.to - piece.from) / STEP))
    const centre = (piece.from + piece.to) / 2
    const reach = (piece.to - piece.from) / 2
    /** The underside at `s`: an arch's curve, else the seabed. */
    const under = (s: number): number => {
      if (!piece.arch) return BOTTOM
      const top = deckAt(bridge, s) - SLAB
      const rise = (top - SPRING) * 0.82
      const u = Math.min(1, Math.abs(s - centre) / reach)
      return SPRING + rise * Math.sqrt(1 - u * u)
    }
    /** Where the plain courses stop: an arch's voussoir ring starts there. */
    const stoneTo = (s: number): number =>
      piece.arch ? Math.min(under(s) + RING, deckAt(bridge, s) - 0.3) : BOTTOM
    const wallTop = (s: number): number => deckAt(bridge, s) + PARAPET_H - COPING
    const deck = (s: number): number => deckAt(bridge, s)
    for (let k = 0; k < n; k++) {
      const s0 = piece.from + ((piece.to - piece.from) * k) / n
      const s1 = piece.from + ((piece.to - piece.from) * (k + 1)) / n
      const block = Math.floor(s0 / STEP)
      paveDeck(shapes, f, [s0, s1], [deck(s0), deck(s1)], block)
      for (const side of [-1, 1] as const) {
        const inner = side < 0 ? LEFT : RIGHT
        const outer = side < 0 ? BODY_L : BODY_R
        const plane = (c: number) => (s: number, y: number) => f.at(s, c, y)
        // The outer face in courses from the coping down to the arch's ring (or the seabed), the inner down to the deck.
        courses(shapes, plane(outer), [s0, s1], wallTop, stoneTo, f.dir(side, 0, 0), block)
        courses(shapes, plane(inner), [s0, s1], wallTop, deck, f.dir(-side, 0, 0), block, 0.95)
        const y0 = deck(s0)
        const y1 = deck(s1)
        coping(shapes, f, [s0, s1], [y0, y1], [inner, outer], side, block)
        // A projecting band where the parapet meets the fascia: a shadow line the length of the bridge.
        const lip = outer + side * 0.14
        const along = (c: number, h: number): readonly [V3, V3] => [f.at(s0, c, y0 + h), f.at(s1, c, y1 + h)]
        const [o0, o1] = along(outer, 0.22)
        const [l0, l1] = along(lip, 0.22)
        const [d0, d1] = along(lip, 0)
        shapes.quad(o0, o1, l1, l0, [0, 1, 0], PALE, 1.05)
        shapes.quad(l0, l1, d1, d0, f.dir(side, 0, 0), PALE, 0.95)
        if (piece.arch) {
          // The voussoirs: alternate blocks of the ring round the arch, pale and cool.
          const ring = tone(block % 2 === 0 ? PALE : COOL, 0.1 + (jitter(block, 9) - 0.5) * 0.12)
          shapes.quad(
            f.at(s0, outer, stoneTo(s0)),
            f.at(s1, outer, stoneTo(s1)),
            f.at(s1, outer, under(s1)),
            f.at(s0, outer, under(s0)),
            f.dir(side, 0, 0),
            ring,
          )
        }
      }
      if (piece.arch)
        // The arch's underside, dark in its shade.
        shapes.quad(
          f.at(s0, BODY_L, under(s0)),
          f.at(s1, BODY_L, under(s1)),
          f.at(s1, BODY_R, under(s1)),
          f.at(s0, BODY_R, under(s0)),
          [0, -1, 0],
          tone(SHADE, (jitter(block, 7) - 0.5) * 0.14),
        )
    }
    // The faces across the axis: a pier's or ramp's ends.
    if (!piece.arch)
      for (const [s, along] of [
        [piece.from, -1],
        [piece.to, 1],
      ] as const)
        shapes.quad(
          f.at(s, BODY_L, BOTTOM),
          f.at(s, BODY_R, BOTTOM),
          f.at(s, BODY_R, deckAt(bridge, s)),
          f.at(s, BODY_L, deckAt(bridge, s)),
          f.dir(0, along, 0),
          SHADE,
          0.95,
        )
  }
  for (const s of bridge.piers) pier(shapes, f, s)
}

/**
 * The paved deck between the parapets: one surface of light grey flagstones, each block a touch
 * lighter or darker, with only a fine kerb line along it where the rail lane (RAIL_WIDTH, on the
 * right) will run one day: no colour of its own.
 */
function paveDeck(
  shapes: Shapes,
  f: Frame,
  [s0, s1]: readonly [number, number],
  [y0, y1]: readonly [number, number],
  block: number,
): void {
  const kerb = RIGHT - RAIL_WIDTH + 0.3
  const up: V3 = [0, 1, 0]
  // Two flags across, the one beside the kerb and the one beyond it, each its own tone.
  for (const [from, to, salt] of [
    [LEFT, kerb, 3],
    [kerb, RIGHT, 11],
  ] as const)
    shapes.quad(
      f.at(s0, from, y0),
      f.at(s1, from, y1),
      f.at(s1, to, y1),
      f.at(s0, to, y0),
      up,
      tone(FLAG, (jitter(block, salt) - 0.5) * 0.16),
    )
  shapes.quad(
    f.at(s0, kerb - 0.05, y0 + 0.02),
    f.at(s1, kerb - 0.05, y1 + 0.02),
    f.at(s1, kerb + 0.05, y1 + 0.02),
    f.at(s0, kerb + 0.05, y0 + 0.02),
    up,
    tone(FLAG, 0.22),
  )
}

/**
 * A parapet's coping on `side`: a pale stone that overhangs the wall a little, with a bevel each side
 * of its flat top (`inner` and `outer`: the parapet's faces across the axis).
 */
function coping(
  shapes: Shapes,
  f: Frame,
  [s0, s1]: readonly [number, number],
  [y0, y1]: readonly [number, number],
  [inner, outer]: readonly [number, number],
  side: -1 | 1,
  block: number,
): void {
  const a = inner - side * OVERHANG
  const b = outer + side * OVERHANG
  const tint = tone(PALE, (jitter(block, 5) - 0.5) * 0.12)
  // [across, height above the deck] of the coping's profile, from its inner foot up and over to the outer foot.
  const profile: readonly (readonly [number, number])[] = [
    [a, PARAPET_H - COPING],
    [a, PARAPET_H - 0.08],
    [a + side * BEVEL, PARAPET_H],
    [b - side * BEVEL, PARAPET_H],
    [b, PARAPET_H - 0.08],
    [b, PARAPET_H - COPING],
  ]
  for (let i = 0; i + 1 < profile.length; i++) {
    const [c0, h0] = profile[i] as readonly [number, number]
    const [c1, h1] = profile[i + 1] as readonly [number, number]
    // Outward from the stone: to the left of the way the profile runs.
    const out = f.dir(-(h1 - h0) * side, 0, (c1 - c0) * side)
    shapes.quad(
      f.at(s0, c0, y0 + h0),
      f.at(s1, c0, y1 + h0),
      f.at(s1, c1, y1 + h1),
      f.at(s0, c1, y0 + h1),
      out,
      tint,
      1.06,
    )
  }
}

/**
 * A pier at distance `s`: a buttress a little wider than the body, down to the seabed and up to the
 * arches' springing, capped with a pale impost, and on each side a cutwater, a prow of stone that
 * parts the tide.
 */
function pier(shapes: Shapes, f: Frame, s: number): void {
  const top = SPRING + 1
  const mid = (BODY_L + BODY_R) / 2
  const half = (BODY_R - BODY_L) / 2 + FLARE
  const l = PIER_HALF + 0.25
  shapes.box(f.at(s, mid, (BOTTOM + top) / 2), [half, (top - BOTTOM) / 2, l], f.heading, STONE, 1.02)
  shapes.box(f.at(s, mid, top + 0.1), [half + 0.18, 0.1, l + 0.18], f.heading, PALE)
  for (const side of [-1, 1] as const) {
    const edge = mid + side * half
    const tip = mid + side * (half + PROW)
    const peak = SPRING + 0.2
    // Two sloping faces meeting at the prow, and its sloping top.
    shapes.quad(
      f.at(s - l, edge, BOTTOM),
      f.at(s, tip, BOTTOM),
      f.at(s, tip, peak),
      f.at(s - l, edge, top),
      f.dir(side, -0.7, 0),
      STONE,
      0.95,
    )
    shapes.quad(
      f.at(s + l, edge, BOTTOM),
      f.at(s, tip, BOTTOM),
      f.at(s, tip, peak),
      f.at(s + l, edge, top),
      f.dir(side, 0.7, 0),
      STONE,
      0.9,
    )
    shapes.tri(
      f.at(s - l, edge, top),
      f.at(s + l, edge, top),
      f.at(s, tip, peak),
      f.dir(side * 0.3, 0, 1),
      PALE,
      1.02,
    )
  }
}

/** Towers flanking the deck at a long bridge's middle pier: two stone turrets with a cap and a low roof. */
function addTowers(shapes: Shapes, bridge: Bridge, a: Quay): void {
  const f = frameOf(bridge, a)
  for (const s of bridge.towers) {
    const top = bridge.deck + PARAPET_H + TOWER_H
    for (const side of [LEFT - PARAPET - 0.2, RIGHT + PARAPET + 0.2]) {
      shapes.box(f.at(s, side, (top - 1) / 2), [1.2, (top + 1) / 2, 1.4], f.heading, STONE, 1.05)
      shapes.box(f.at(s, side, top + 0.2), [1.5, 0.2, 1.7], f.heading, PALE)
      // A low cap in the coping's own pale stone, each face a little lighter or darker than the next.
      const peak = f.at(s, side, top + 1.5)
      const corners = [
        f.at(s - 1.5, side - 1.3, top + 0.4),
        f.at(s - 1.5, side + 1.3, top + 0.4),
        f.at(s + 1.5, side + 1.3, top + 0.4),
        f.at(s + 1.5, side - 1.3, top + 0.4),
      ]
      const outs = [f.dir(0, -1, 0.6), f.dir(1, 0, 0.6), f.dir(0, 1, 0.6), f.dir(-1, 0, 0.6)]
      for (const [i, out] of outs.entries())
        shapes.tri(corners[i] as V3, corners[(i + 1) % 4] as V3, peak, out, PALE, 0.94 + 0.04 * i)
    }
  }
}

/** Where a bridge's torches stand: the base of each, on a parapet's coping. */
const lampPosts = (bridge: Bridge): V3[] => bridge.lamps.map(([x, z, y]): V3 => [x, y + PARAPET_H, z])

/** Every bridge of an archipelago in one geometry, and where its torches stand; null when there are no bridges. */
export function bridgeGeometry(
  bridges: readonly { bridge: Bridge; from: Quay }[],
): { geometry: BufferGeometry; posts: V3[] } | null {
  if (bridges.length === 0) return null
  const shapes = new Shapes()
  const posts: V3[] = []
  for (const { bridge, from } of bridges) {
    addBridge(shapes, bridge, from)
    addTowers(shapes, bridge, from)
    posts.push(...lampPosts(bridge))
  }
  return { geometry: shapes.geometry(), posts }
}
