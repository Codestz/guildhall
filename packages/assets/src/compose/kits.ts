/**
 * Kit profiles (ADR 005): the one place that encodes a modular kit's conventions. A second kit is a
 * second profile here, not a new code path in the compiler.
 *
 * Kenney Fantasy Town 2.0, measured from the GLBs in library/ (one kit unit = UNIT m, pivot kept):
 * - every module's origin is its cell's centre at floor level; a cell and a storey are one unit;
 * - a wall panel lies on the cell's +x edge (x 0.4..0.5 u, z ±0.5 u) and its dressed face is +x, so
 *   turning it to a side puts its outer face on that side's edge;
 * - `wall-corner-detail` is a post on the cell's (+x, +z) corner, centred in the wall's thickness, so
 *   it stands 0.1 m proud of both faces;
 * - `roof` / `roof-high` is one slope over the cell, low on -x, its ridge on the +x edge (along z),
 *   with a gable triangle under each z end;
 * - `roof-gable*` has its ridge along x through the centre; `-end` hips the -x end, ridge running +x;
 * - `roof-corner` / `roof-high-corner` (hip corners, unused) peak at a point below the slopes' ridge;
 * - `roof-flat`, `roof-point` are centred;
 * - `chimney` (1 u) and `chimney-top` (0.63 u, its pot from 0.38 u up) stand off-centre toward +x,
 *   their shaft at x 0.25..0.42 u (0.88..1.47 m), z ±0.13 u; the pot reaches x 0.21 u, z ±0.17 u.
 */
import type { FAMILIES, ROOF_STYLES } from "./blueprint.ts"

type Family = (typeof FAMILIES)[number]
type RoofStyle = (typeof ROOF_STYLES)[number]

/** Wall panels of one family: a blind panel, windows by style, doors by style. */
export interface WallSet {
  blind: string
  windows: Record<string, string>
  /** The window style a seed uses when the blueprint gives no `vary.openings`. */
  window: string
  /** The large window a shop front uses. */
  shop: string
  doors: { round: string; square: string; wide: string }
  /**
   * The family's colours over the kit's bake (ramp → ramp): stone and plaster share one bake, so this
   * is what tells them apart. It also tints the storey's posts and, on the top storey, the roof's gable
   * ends and fascia. A house's own `rampSwaps` win over it.
   */
  look: Record<string, string>
}

/** The pieces one roof style draws with (see the header for their native orientation). */
export interface RoofSet {
  /** One cell across the ridge: the whole gable, ridge along x. */
  gable?: string
  /** The hipped cap at either end of a one-across ridge run. */
  gableEnd?: string
  /** Two cells across the ridge: one slope per cell, ridge on its +x edge, gable triangles at its ends. */
  slope?: string
  /** Any footprint: one piece per cell. */
  flat?: string
  /** 1×1 only. */
  point?: string
  /**
   * The roof's top above the wall top, metres: at the ridge with one or two cells across it (flat and
   * point roofs use `one`). With the kit's `eave` this bounds the roof surface for the chimney.
   */
  peak: { one: number; two: number }
}

export interface KitProfile {
  id: string
  /** Metres per cell, and per storey. */
  module: number
  storey: number
  walls: Record<Family, WallSet>
  /** Corner post for the four outer corners of every storey. */
  corner: string
  /** Metres a family's posts move in from the outer corner, to sit flush on a plain face. */
  cornerInset: Record<Family, number>
  roofs: Record<RoofStyle, RoofSet>
  /** Roof surface height at the wall line, metres above the wall top (an upper bound). */
  eave: number
  /** `top` crowns the stack; `shaft` (one storey tall) fills below it. Both stand like `chimney`. */
  chimney: { shaft: string; top: string; topHeight: number }
  /**
   * Roofings a house picks from by seed, each a ramp map over the roof pieces' bake. A house whose
   * `vary.rampSwaps` names one of the baked roof ramps keeps its own choice instead.
   */
  roofings: Record<string, string>[]
}

const P = "kenney-town/"

/**
 * The import's scale for this pack (tools/import/packs/kenney-town.ts): wall-door's opening, 0.75 of
 * a unit, is set to 2.6 m, so one unit (a cell, a storey) is 2.6 / 0.75 ≈ 3.47 m.
 */
const UNIT = 2.6 / 0.75

/** Window styles shared by the plain (`wall-`) and wood (`wall-wood-`) panels. */
const windows = (prefix: string): Record<string, string> => ({
  glass: `${P}${prefix}window-glass`,
  round: `${P}${prefix}window-round`,
  shutters: `${P}${prefix}window-shutters`,
  small: `${P}${prefix}window-small`,
  stone: `${P}${prefix}window-stone`,
})

const doors = (prefix: string): WallSet["doors"] => ({
  round: `${P}${prefix}door`,
  square: `${P}${prefix}doorway-square`,
  wide: `${P}${prefix}doorway-square-wide`,
})

/**
 * The kit bakes its timbers orange (terracotta, sandstone) and its plaster and stone slate blue: every
 * family takes brown timbers; stone reads grey and plaster cream (the target's look).
 */
const TIMBER: Record<string, string> = { sandstone: "timber", terracotta: "timber" }

/**
 * The kit has two panel families (plain and wood). Stone and plaster share the plain panels and part
 * on their default window (stone frames) and blind face (timber cross); ramps re-tint the rest.
 */
export const KIT_PROFILES: Readonly<Record<"kenney-town", KitProfile>> = {
  "kenney-town": {
    id: "kenney-town",
    module: UNIT,
    storey: UNIT,
    walls: {
      stone: {
        blind: `${P}wall`,
        windows: windows("wall-"),
        window: "stone",
        shop: `${P}wall-window-glass`,
        doors: doors("wall-"),
        look: { ...TIMBER, cobble: "grey", slate: "grey" },
      },
      plaster: {
        blind: `${P}wall-detail-cross`,
        windows: windows("wall-"),
        window: "shutters",
        shop: `${P}wall-window-glass`,
        doors: doors("wall-"),
        look: { ...TIMBER, cobble: "sand", slate: "sand" },
      },
      wood: {
        blind: `${P}wall-wood`,
        windows: windows("wall-wood-"),
        window: "shutters",
        shop: `${P}wall-wood-window-glass`,
        doors: doors("wall-wood-"),
        // Cobble and slate here are the posts and the roof's gable ends: timber on a wooden house.
        look: { ...TIMBER, cobble: "timber", slate: "timber" },
      },
    },
    corner: `${P}wall-corner-detail`,
    // A plain stone face has no timbers for the post to sit among: it keeps 1.4 cm proud (no z-fight).
    cornerInset: { stone: 0.09, plaster: 0, wood: 0 },
    roofs: {
      gable: {
        gable: `${P}roof-gable`,
        gableEnd: `${P}roof-gable-end`,
        slope: `${P}roof`,
        peak: { one: 1.98, two: 2.17 },
      },
      "high-gable": {
        gable: `${P}roof-high-gable`,
        gableEnd: `${P}roof-high-gable-end`,
        slope: `${P}roof-high`,
        peak: { one: 3.85, two: 3.95 },
      },
      flat: { flat: `${P}roof-flat`, peak: { one: 0.44, two: 0.44 } },
      point: { point: `${P}roof-point`, peak: { one: 1.73, two: 1.73 } },
    },
    eave: 0.4,
    chimney: { shaft: `${P}chimney`, top: `${P}chimney-top`, topHeight: 2.17 },
    // Low roofs are baked teal (base tone), high roofs in the accent ramp's light tone (banner red), so
    // each roofing names a partner for both: red tiles, slate, blue tiles, thatch.
    roofings: [
      { accent: "accent", teal: "terracotta" },
      { accent: "cobble", teal: "slate" },
      { accent: "roof-blue", teal: "roof-blue" },
      { accent: "thatch", teal: "thatch" },
    ],
  },
}
