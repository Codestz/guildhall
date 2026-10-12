/**
 * A settlement's frame on the island (ADR 011): the island's land within a disc round its centre, in
 * its own local frame (the centre at the origin), the water it borders with its harbour's first, and
 * the reach where its roads leave. Lakes are always in its water: they are holes in its land. The
 * layout stays local; `toIsland` and `toLocal` are the only transform (a translation: the harbour
 * bearing already orients a town, ADR 011).
 */
import { DMath } from "@guildhall/core"
import { distTo } from "../geom/line.ts"
import { area, clip, contains, type Ring } from "../geom/poly.ts"
import { add, snap, sub, type Vec2 } from "../geom/vec.ts"
import type { IslandSite, Settlement, TownFrame } from "./types.ts"

/** Sides of a frame's disc. */
const SIDES = 64

/** A disc round c, `reach` metres, counter-clockwise. */
export function disc(c: Vec2, reach: number): Ring {
  return Array.from({ length: SIDES }, (_, i) => {
    const t = (2 * Math.PI * i) / SIDES
    return snap([c[0] + reach * DMath.cos(t), c[1] + reach * DMath.sin(t)])
  })
}

/**
 * The frame of a settlement centred at `centre` (island coordinates) whose roads leave `reach` metres
 * out. `harbour`, a point in (or at the edge of) its harbour's water, a far bay's or a lake's, puts
 * the water ring holding it (else the nearest) first; the rest follow nearest first, the lakes always
 * among them.
 */
export function frameOf(site: IslandSite, centre: Vec2, reach: number, harbour?: Vec2): TownFrame {
  const local = (ring: Ring): Ring => ring.map((p) => snap(sub(p, centre)))
  const land = clip(
    site.land.map((poly) => poly.map(local)),
    disc([0, 0], reach),
    "intersection",
  )
  const near = (p: Vec2) => (ring: Ring) => distTo(p, ring, true)
  const water = [...site.sea, ...site.lakes].sort((a, b) => near(centre)(a) - near(centre)(b))
  if (harbour) {
    const first =
      water.find((ring) => contains(ring, harbour)) ??
      water.reduce((a, b) => (near(harbour)(b) < near(harbour)(a) ? b : a))
    water.splice(water.indexOf(first), 1)
    water.unshift(first)
  }
  return { land, water: water.map(local), reach }
}

/** The share of the frame's disc that is land. */
export function landShare(frame: TownFrame): number {
  const land = frame.land.reduce((sum, poly) => sum + poly.reduce((s, ring) => s + area(ring), 0), 0)
  return land / Math.abs(area(disc([0, 0], frame.reach)))
}

/** A settlement's local point in island coordinates. */
export const toIsland = (s: Pick<Settlement, "origin">, p: Vec2): Vec2 => snap(add(s.origin, p))

/** An island point in a settlement's local coordinates. */
export const toLocal = (s: Pick<Settlement, "origin">, p: Vec2): Vec2 => snap(sub(p, s.origin))
