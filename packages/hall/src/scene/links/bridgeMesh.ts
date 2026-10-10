import type { BufferGeometry } from "three"
import { type Bridge, DECK_EDGES, deckAt, PARAPET, RAIL_WIDTH } from "../../world/bridges.ts"
import type { Quay } from "../../world/linkStub.ts"
import { SEA_Y } from "../Ships.tsx"
import { jitter, Shapes, type V3 } from "./shapes.ts"

/**
 * Bridges as one mesh: a stone body (fascia, an arched underside between piers, solid piers and
 * ramps), a paved deck and parapets on both sides, in the island kit's muted stone. Every bridge of
 * an archipelago is merged into one geometry, so they all cost one draw call.
 */

const STONE = 0x9a9488
const FASCIA = 0x8a857a
const PAVING = 0xb9b09d
const CAP = 0xc9c1ae
const DARK = 0x5d5a54
const BALLAST = 0x77705f
/** A parapet's height, and a lantern post's above it. */
export const PARAPET_H = 1.05
export const POST_H = 2.5
/** A tower rises this far over the parapet. */
const TOWER_H = 3.4
/** The slab under the deck. */
const SLAB = 0.8
/** How far down the piers and ramps go: into the seabed. */
const BOTTOM = -3.2
/** A pier is this thick along the axis. */
const PIER_HALF = 1.5
/** Mesh sampling along the axis. */
const STEP = 1.6
/** The arches spring from just over the water. */
const SPRING = SEA_Y + 0.5

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

/** Adds `bridge`, which starts at quay `a`'s landing, to `shapes`. */
export function addBridge(shapes: Shapes, bridge: Bridge, a: Quay): void {
  const ux = Math.sin(bridge.heading)
  const uz = Math.cos(bridge.heading)
  /** The point `side` to the right of the axis at distance `s`, at height `y`. */
  const at = (s: number, side: number, y: number): V3 => [
    a.land[0] + ux * s + uz * side,
    y,
    a.land[1] + uz * s - ux * side,
  ]
  const [leftEdge, rightEdge] = DECK_EDGES
  const bodyL = leftEdge - PARAPET
  const bodyR = rightEdge + PARAPET
  const outRight: V3 = [uz, 0, -ux]
  const outLeft: V3 = [-uz, 0, ux]
  const forward: V3 = [ux, 0, uz]
  const back: V3 = [-ux, 0, -uz]

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
    for (let k = 0; k < n; k++) {
      const s0 = piece.from + ((piece.to - piece.from) * k) / n
      const s1 = piece.from + ((piece.to - piece.from) * (k + 1)) / n
      const y0 = deckAt(bridge, s0)
      const y1 = deckAt(bridge, s1)
      const block = Math.floor(s0 / STEP)
      const stone = 0.9 + 0.2 * jitter(block, piece.from)
      // Paved deck between the parapets.
      shapes.quad(
        at(s0, leftEdge, y0),
        at(s1, leftEdge, y1),
        at(s1, rightEdge, y1),
        at(s0, rightEdge, y0),
        [0, 1, 0],
        PAVING,
        0.95 + 0.1 * jitter(block, 3),
      )
      // The rail lane's bed: ballast laid along the right, a kerb between it and the walkway.
      const bed = rightEdge - RAIL_WIDTH + 0.3
      shapes.quad(
        at(s0, bed, y0 + 0.04),
        at(s1, bed, y1 + 0.04),
        at(s1, rightEdge, y1 + 0.04),
        at(s0, rightEdge, y0 + 0.04),
        [0, 1, 0],
        BALLAST,
        0.9 + 0.2 * jitter(block, 11),
      )
      shapes.box(
        at((s0 + s1) / 2, bed - 0.12, (y0 + y1) / 2 + 0.1),
        [0.12, 0.1, (s1 - s0) / 2],
        bridge.heading,
        CAP,
      )
      for (const side of [-1, 1] as const) {
        const out = side > 0 ? outRight : outLeft
        // Parapet: top, outer and inner faces; the fascia below runs from the underside up to the deck.
        const inner = side < 0 ? leftEdge : rightEdge
        const outer = side < 0 ? bodyL : bodyR
        shapes.quad(
          at(s0, inner, y0 + PARAPET_H),
          at(s1, inner, y1 + PARAPET_H),
          at(s1, outer, y1 + PARAPET_H),
          at(s0, outer, y0 + PARAPET_H),
          [0, 1, 0],
          CAP,
          0.95 + 0.1 * jitter(block, 5),
        )
        shapes.quad(
          at(s0, outer, y0 + PARAPET_H),
          at(s1, outer, y1 + PARAPET_H),
          at(s1, outer, y1),
          at(s0, outer, y0),
          out,
          STONE,
          stone,
        )
        shapes.quad(
          at(s0, inner, y0 + PARAPET_H),
          at(s1, inner, y1 + PARAPET_H),
          at(s1, inner, y1),
          at(s0, inner, y0),
          [-out[0], 0, -out[2]],
          STONE,
          stone * 0.95,
        )
        shapes.quad(
          at(s0, outer, y0),
          at(s1, outer, y1),
          at(s1, outer, under(s1)),
          at(s0, outer, under(s0)),
          out,
          FASCIA,
          stone,
        )
      }
      if (piece.arch) {
        // The arch's underside, dark in its shade.
        const lo0 = under(s0)
        const lo1 = under(s1)
        shapes.quad(
          at(s0, bodyL, lo0),
          at(s1, bodyL, lo1),
          at(s1, bodyR, lo1),
          at(s0, bodyR, lo0),
          [0, -1, 0],
          DARK,
          0.9 + 0.2 * jitter(block, 7),
        )
      }
    }
    // The faces across the axis: a pier's or ramp's ends, and an arch's spandrel ends.
    for (const [s, out] of [
      [piece.from, back],
      [piece.to, forward],
    ] as const) {
      if (piece.arch) continue
      const y = deckAt(bridge, s)
      shapes.quad(
        at(s, bodyL, BOTTOM),
        at(s, bodyR, BOTTOM),
        at(s, bodyR, y),
        at(s, bodyL, y),
        out,
        DARK,
        0.85,
      )
    }
  }
}

/** Towers flanking the deck at a long bridge's middle pier: two stone turrets with a cap. */
function addTowers(shapes: Shapes, bridge: Bridge, a: Quay): void {
  const ux = Math.sin(bridge.heading)
  const uz = Math.cos(bridge.heading)
  const [left, right] = DECK_EDGES
  for (const s of bridge.towers) {
    const top = bridge.deck + PARAPET_H + TOWER_H
    for (const side of [left - PARAPET - 0.2, right + PARAPET + 0.2]) {
      const at = (y: number): V3 => [a.land[0] + ux * s + uz * side, y, a.land[1] + uz * s - ux * side]
      shapes.box(at((top - 1) / 2), [1.2, (top + 1) / 2, 1.4], bridge.heading, STONE, 1.05)
      shapes.box(at(top + 0.2), [1.5, 0.2, 1.7], bridge.heading, CAP)
    }
  }
}

/** The lantern posts on a bridge's parapets (iron pole, a small house) and where their flames burn. */
function addLamps(shapes: Shapes, bridge: Bridge): V3[] {
  return bridge.lamps.map(([x, z, y]) => {
    const base = y + PARAPET_H
    shapes.box([x, base + POST_H / 2, z], [0.13, POST_H / 2, 0.13], bridge.heading, 0x3c3a3e)
    shapes.box([x, base + POST_H + 0.22, z], [0.22, 0.22, 0.22], bridge.heading, 0xffd9a0, 1.4)
    return [x, base + POST_H + 0.25, z]
  })
}

/** Every bridge of an archipelago in one geometry, and its lanterns' flames (null when there are no bridges). */
export function bridgeGeometry(
  bridges: readonly { bridge: Bridge; from: Quay }[],
): { geometry: BufferGeometry; flames: V3[] } | null {
  if (bridges.length === 0) return null
  const shapes = new Shapes()
  const flames: V3[] = []
  for (const { bridge, from } of bridges) {
    addBridge(shapes, bridge, from)
    addTowers(shapes, bridge, from)
    flames.push(...addLamps(shapes, bridge))
  }
  return { geometry: shapes.geometry(), flames }
}
