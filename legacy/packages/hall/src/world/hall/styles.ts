import type { Craft } from "@guildhall/core"
import type { Piece } from "../furniture.ts"
import type { HallStyle, SpotKind } from "./types.ts"

/**
 * The halls' characters, as data: which landmark's hall is which style, and what each is furnished
 * with. A style is the kit's own pieces (the same the great hall is built from, world/furniture.ts):
 * the walls' rhythm and what is hung on them, the floor, and the stations the floor plan repeats
 * (world/hall/build.ts) down both sides, along the back wall and in the middle. A station is a place
 * to sit at a table or to stand at a bench, anvil or shelf, with the clip the work there plays and the
 * crafts it suits (a seat for reading and writing, an anvil for edits).
 */

/** The hall each landmark (prefabs/composite) keeps. */
export const STYLE_OF: Readonly<Record<string, HallStyle>> = {
  "castle-grand": "great-hall",
  "guildhouse-plaza": "great-hall",
  "castle-keep": "keep-yard",
  "forge-works": "workshop",
  academy: "scriptorium",
  observatory: "observatory",
  "harbour-fortress": "harbour-hall",
  cathedral: "chapel",
  "islet-shrine": "chapel",
  "islet-lighthouse": "lantern-loft",
  "islet-fort": "watch-post",
}

/** A prop on a station's table, or beside it: relative to the table's centre, in the station's frame (+z the way it faces). */
export interface Prop {
  piece: Piece
  /** Across, and along the way the station faces. */
  dx?: number
  dz?: number
  /** True: on the table's top; else on the floor. */
  top?: true
  rot?: number
}

export interface Station {
  kind: SpotKind
  /** What they sit on: a chair or stool, or nothing (they stand). */
  seat?: Piece
  /** What they work at: a table, an anvil, a shelf, a map. */
  table: Piece
  /** The table's own turn, on top of facing it (a shelf faces back at them). */
  turn?: number
  /** How far the table's centre lies from where they stand. */
  reach?: number
  props?: readonly Prop[]
  clip: string
  crafts: readonly Craft[]
}

const SIT = "Sit_Chair_Idle"
const BOOK: Prop = { piece: "book_set", top: true, dx: -0.3 }
const CANDLE: Prop = { piece: "candle_lit", top: true, dx: 0.6, dz: 0.2 }

const desk = (props: readonly Prop[] = [BOOK, CANDLE]): Station => ({
  kind: "desk",
  seat: "chair",
  table: "table_medium",
  props,
  clip: SIT,
  crafts: ["read", "search", "write", "plan", "consult", "fetch", "edit"],
})
/** A long table along a wall, stools to it: for the outer rows only (it would shut the inner rows' lanes). */
const bench: Station = {
  kind: "bench",
  seat: "stool",
  table: "table_long",
  turn: Math.PI / 2,
  props: [{ piece: "mug_full", top: true, dx: 0.3 }],
  clip: SIT,
  crafts: ["run", "lint", "test", "other", "delegate"],
}
const stool: Station = { ...bench, table: "table_medium", turn: 0 }
/** A weapon table or the like: something small stands on a small table, to be worked at. */
const rack = (top: Piece, crafts: readonly Craft[], clip = "Use_Item"): Station => ({
  kind: "stand",
  table: "table_small_decorated_A",
  props: [{ piece: top, top: true }],
  reach: 1.3,
  clip,
  crafts,
})
const shelf = (piece: Piece = "shelf_B_large_decorated"): Station => ({
  kind: "shelf",
  table: piece,
  turn: Math.PI,
  reach: 1.7,
  clip: "Working_B",
  crafts: ["read", "search", "fetch", "consult"],
})
const mapTable: Station = {
  kind: "table",
  table: "table_medium",
  props: [
    { piece: "map", top: true, dx: -0.2 },
    { piece: "compass_base", top: true, dx: 0.5, dz: 0.8 },
  ],
  reach: 1.5,
  clip: "Working_B",
  crafts: ["plan", "consult", "search", "read"],
}
const anvil: Station = {
  kind: "anvil",
  table: "anvil",
  turn: Math.PI / 2,
  reach: 1.2,
  props: [{ piece: "tongs", top: true, dx: 0.2, rot: 0.6 }],
  clip: "Hammering",
  crafts: ["edit", "write", "run"],
}
const grind: Station = {
  kind: "stand",
  table: "grindstone",
  turn: -Math.PI / 2,
  reach: 1.5,
  clip: "Use_Item",
  crafts: ["edit", "lint", "test"],
}
const stand = (table: Piece, crafts: readonly Craft[], clip = "Use_Item", reach = 1.5): Station => ({
  kind: "stand",
  table,
  reach,
  clip,
  crafts,
})
const pew: Station = {
  kind: "pew",
  seat: "chair",
  table: "candle_lit",
  reach: 1.9,
  clip: SIT,
  crafts: ["read", "plan", "consult", "write", "search", "edit", "other"],
}

/** What hangs on or stands against the walls, and the floor and the posts the walls' rhythm is set by. */
export interface Fabric {
  plain: Piece
  window: Piece
  /** A buttress, pillar or post at every `every`th joint of the long walls. */
  post?: Piece
  every?: number
  /** Hung on the back wall, between the windows. */
  banner?: Piece
  torch?: boolean
  /** Every other segment is left open: a yard's arcade, not a closed room. */
  open?: boolean
}

export interface Style {
  id: HallStyle
  label: string
  floor: Piece
  fabric: Fabric
  /** The stations down the sides, nearest the lane first, and along the back wall, outwards from the middle. */
  inner: readonly Station[]
  outer: readonly Station[]
  back: readonly Station[]
  /** What stands about the floor besides the stations, for a hall `w` across and `d` deep. */
  dress: Dress
}

/** A piece standing at a spot of the hall's own frame (x across, z from its middle). */
export interface Item {
  piece: Piece
  x: number
  z: number
  rot?: number
  y?: number
}
type Dress = (w: number, d: number) => Item[]

/** The same `piece` in both corners by the gate, turned to face the middle. */
const gateCorners =
  (piece: Piece, inset = 1.6): Dress =>
  (w, d) =>
    [-1, 1]
      .map((side) => ({ piece, x: side * (w / 2 - inset), z: d / 2 - inset, rot: (-side * Math.PI) / 4 }))
      // A second pair stands clear of the inner stations' tables, or not at all.
      .filter((item) => inset <= 2 || Math.abs(item.x) > 5.4)

/** `piece` laid along the middle lane, `count` of them down the hall, `turn` radians from lying across. */
const laneRugs =
  (piece: Piece, count: number, turn = 0): Dress =>
  (_w, d) =>
    Array.from({ length: count }, (_, i) => ({
      piece,
      x: 0,
      z: -d / 2 + 7 + ((d - 11) * (i + 0.5)) / count,
      rot: turn,
    }))

const dressed =
  (...parts: Dress[]): Dress =>
  (w, d) =>
    parts.flatMap((part) => part(w, d))

export const STYLES: Readonly<Record<HallStyle, Style>> = {
  "great-hall": {
    id: "great-hall",
    label: "Great hall",
    floor: "floor_tile_large",
    fabric: {
      plain: "wall",
      window: "wall_archedwindow_open",
      post: "pillar_decorated",
      every: 2,
      banner: "banner_shield_blue",
      torch: true,
    },
    inner: [desk([{ piece: "plate_food_A", top: true }])],
    outer: [{ ...bench, table: "table_long_tablecloth_decorated_A" }],
    back: [mapTable, { ...desk(), seat: "armchair", table: "table_medium" }],
    dress: dressed(laneRugs("rug_rectangle_stripes_A", 2, Math.PI / 2), gateCorners("lamp_standing")),
  },
  "keep-yard": {
    id: "keep-yard",
    label: "Keep yard",
    floor: "floor_tile_large",
    fabric: { plain: "wall", window: "wall", post: "pillar", every: 1, torch: true, open: true },
    inner: [rack("sword_A", ["test", "lint"]), stool],
    outer: [stand("barrel_large", ["run", "test"], "Interact", 1.6), bench],
    back: [rack("shield_badge_color", ["test", "lint"]), rack("crossbow_1handed", ["run", "test"])],
    dress: dressed(gateCorners("barrel_large"), gateCorners("crates_stacked", 3.4)),
  },
  workshop: {
    id: "workshop",
    label: "Workshop",
    floor: "floor_wood_large",
    fabric: { plain: "wall", window: "wall_window_open", post: "pillar", every: 3, torch: true },
    inner: [anvil, { ...desk([{ piece: "hammer_A", top: true, dx: 0.2 }]), seat: "stool" }],
    outer: [grind, anvil],
    back: [stand("barrel_large", ["run", "edit"], "Interact", 1.6), anvil, grind],
    dress: dressed(gateCorners("barrel_large"), gateCorners("bucket_metal", 3.2)),
  },
  scriptorium: {
    id: "scriptorium",
    label: "Scriptorium",
    floor: "floor_wood_large",
    fabric: { plain: "wall", window: "wall_window_open", banner: "banner_patternA_blue", torch: false },
    inner: [desk(), desk([{ piece: "journal_open", top: true }, CANDLE])],
    outer: [{ ...desk(), table: "table_long", turn: Math.PI / 2 }, shelf("shelf_large")],
    back: [shelf(), shelf("cabinet_medium_decorated"), shelf()],
    dress: dressed(laneRugs("rug_oval_A", 2, Math.PI / 2), gateCorners("lamp_standing")),
  },
  observatory: {
    id: "observatory",
    label: "Observatory",
    floor: "floor_tile_large",
    fabric: { plain: "wall", window: "wall_archedwindow_open", post: "pillar", every: 2, torch: false },
    inner: [
      {
        ...mapTable,
        props: [
          { piece: "compass_base", top: true },
          { piece: "magnifying_glass", top: true, dx: 0.6 },
        ],
      },
      desk([{ piece: "blueprint_stacked", top: true }, CANDLE]),
    ],
    outer: [desk(), { ...mapTable, table: "table_medium" }],
    back: [
      stand("compass_base", ["search", "consult"], "Working_B", 1.2),
      shelf("shelves"),
      shelf("cabinet_medium_decorated"),
    ],
    dress: dressed(
      laneRugs("rug_oval_A", 1, Math.PI / 2),
      gateCorners("lamp_standing"),
      gateCorners("book_set", 3.2),
    ),
  },
  "harbour-hall": {
    id: "harbour-hall",
    label: "Harbour hall",
    floor: "floor_wood_large",
    fabric: { plain: "wall", window: "wall_window_open", post: "pillar", every: 1, torch: false },
    inner: [
      { ...desk([{ piece: "coin_stack_medium", top: true }, BOOK]), table: "table_medium" },
      {
        ...mapTable,
        props: [
          { piece: "map", top: true },
          { piece: "map_rolled", top: true, dx: 0.6, dz: 0.8 },
        ],
      },
    ],
    outer: [bench, stand("crates_stacked", ["run", "fetch", "other"], "Interact", 1.8)],
    back: [
      stand("keg_decorated", ["run", "fetch"], "Interact", 1.8),
      stand("box_stacked", ["run", "other"], "Interact", 2.2),
    ],
    dress: dressed(gateCorners("crates_stacked"), gateCorners("barrel_small_stack", 3.4)),
  },
  chapel: {
    id: "chapel",
    label: "Chapel",
    floor: "floor_tile_large",
    fabric: {
      plain: "wall",
      window: "wall_archedwindow_open",
      post: "pillar_decorated",
      every: 1,
      torch: false,
    },
    inner: [pew],
    outer: [pew],
    back: [
      {
        ...stand("table_small_decorated_A", ["read", "plan", "consult"], "Working_B", 1.3),
        props: [{ piece: "spellbook_open", top: true }],
      },
      {
        ...stand("table_small_decorated_A", ["write", "search"], "Working_B", 1.3),
        props: [{ piece: "candle_triple", top: true }],
      },
    ],
    dress: dressed(laneRugs("rug_rectangle_stripes_A", 3, Math.PI / 2), gateCorners("candle_triple")),
  },
  "lantern-loft": {
    id: "lantern-loft",
    label: "Lantern loft",
    floor: "floor_wood_large",
    fabric: { plain: "wall", window: "wall_window_open", torch: false },
    inner: [desk([{ piece: "lantern", top: true }, BOOK])],
    outer: [{ ...mapTable, table: "table_medium" }],
    back: [
      stand("lamp_standing", ["search", "consult", "read"], "Working_B", 1.2),
      stand("compass_base", ["plan", "search"], "Working_B", 1.2),
    ],
    dress: dressed(laneRugs("rug_oval_A", 1, Math.PI / 2), gateCorners("lantern")),
  },
  "watch-post": {
    id: "watch-post",
    label: "Watch post",
    floor: "floor_tile_large",
    fabric: { plain: "wall", window: "wall_window_open", post: "pillar", every: 2, torch: true, open: true },
    inner: [
      { ...stool, table: "table_small_decorated_A" },
      stand("barrel_large", ["run", "test"], "Interact", 1.6),
    ],
    outer: [rack("shield_A", ["test", "lint"]), bench],
    back: [
      rack("crossbow_1handed", ["test", "lint", "run"]),
      stand("lamp_standing", ["search", "read"], "Interact", 1.3),
    ],
    dress: dressed(gateCorners("crates_stacked"), gateCorners("barrel_large", 3.4)),
  },
}
