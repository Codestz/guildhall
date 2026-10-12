import type { PackId } from "./scales.ts"

/** One model file, placed in the piece's raw units (before the pack scale). */
export interface Part {
  /** Path under `/raw/` (the packs folder). */
  file: string
  at?: [number, number, number]
  /** Degrees about +y. */
  turn?: number
  /** A clip whose first frame the rigged model is frozen in (bind poses read badly). */
  pose?: string
}

/** One slot of the lineup: a single model, or several composed into one piece. */
export interface Slot {
  pack: PackId
  piece: string
  /** Omitted for the hero silhouette, which is built, not loaded. */
  parts?: Part[]
}

const ADVENTURERS = "KayKit_Adventurers_2.0_FREE/KayKit_Adventurers_2.0_FREE/Characters/gltf"
const HEXAGON =
  "KayKit_Medieval_Hexagon_Pack_1.0_FREE/KayKit_Medieval_Hexagon_Pack_1.0_FREE/Assets/gltf/buildings/blue"
const TOWN = "kenney_fantasy-town-kit_2.0/Models/GLB format"
const CASTLE = "kenney_castle-kit/Models/GLB format"
const RTS = "quaternius_ultimatefantasyrts/glTF"
const CHARACTERS = "quaternius_ultimatedanimatedcharacter/glTF"
const FOREST = "KayKit_Forest_Nature_Pack_1.0_FREE/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf"
const NATURE = "quaternius_ultimatestylizednature/glTF"
const KENNEY_NATURE = "kenney_nature-kit/Models/GLTF format"
const PIRATE = "kenney_pirate-kit/Models/GLB format"

const one = (pack: PackId, piece: string, file: string): Slot => ({ pack, piece, parts: [{ file }] })

/**
 * Kenney Fantasy Town has no complete house, so one is composed on its 1-unit grid: 2 x 2 cells, a
 * stone ground floor, a timber upper floor, a steep roof whose ridge runs front to back, and timber
 * gables. A wall piece sits on the +x edge of its cell; `turn` swings it to the other edges.
 */
function kenneyHouse(): Part[] {
  const parts: Part[] = []
  // Edges as [cell centre x, cell centre z, turn]: +x 0, -z 90, -x 180, +z -90 (front).
  const front = [-0.5, 0.5]
  const edges: { x: number; z: number; turn: number; side: "front" | "other" }[] = []
  for (const x of front)
    edges.push({ x, z: 0.5, turn: -90, side: "front" }, { x, z: -0.5, turn: 90, side: "other" })
  for (const z of [-0.5, 0.5])
    edges.push({ x: 0.5, z, turn: 0, side: "other" }, { x: -0.5, z, turn: 180, side: "other" })
  for (const { x, z, turn, side } of edges) {
    const door = side === "front" && x < 0
    const ground = door ? "wall-door" : side === "front" ? "wall-window-shutters" : "wall"
    const upper = side === "front" ? "wall-wood-window-shutters" : "wall-wood"
    parts.push({ file: `${TOWN}/${ground}.glb`, at: [x, 0, z], turn })
    parts.push({ file: `${TOWN}/${upper}.glb`, at: [x, 1, z], turn })
  }
  for (const z of [-0.5, 0.5]) {
    parts.push({ file: `${TOWN}/roof-high.glb`, at: [-0.5, 2, z], turn: 0 })
    parts.push({ file: `${TOWN}/roof-high.glb`, at: [0.5, 2, z], turn: 180 })
  }
  // A gable half rises toward one end only, so the left and right halves face opposite ways: the
  // turned-around ones sit 0.9 further out so they land on the same face (front z 1, back z -1).
  for (const [x, z, turn] of [
    [-0.5, 1.4, 90],
    [0.5, 0.5, -90],
    [-0.5, -0.5, 90],
    [0.5, -1.4, -90],
  ] as const)
    parts.push({ file: `${TOWN}/wall-wood-slope.glb`, at: [x, 2, z], turn })
  return parts
}

/** Kenney Castle: a square tower stacked base, mid, roofed top. */
const castleTower: Part[] = [
  { file: `${CASTLE}/tower-square-base.glb` },
  { file: `${CASTLE}/tower-square-mid-windows.glb`, at: [0, 1, 0] },
  { file: `${CASTLE}/tower-square-top-roof.glb`, at: [0, 2, 0] },
]

/** Left to right: the heroes, buildings by pack, villagers, trees, the ship. */
export const LINEUP: readonly Slot[] = [
  { pack: "hero", piece: "2.2 m silhouette" },
  one("kaykit-adventurers", "Knight", `${ADVENTURERS}/Knight.glb`),
  one("kaykit-hexagon", "home B", `${HEXAGON}/building_home_B_blue.gltf`),
  one("kaykit-hexagon", "tavern", `${HEXAGON}/building_tavern_blue.gltf`),
  one("kaykit-hexagon", "castle", `${HEXAGON}/building_castle_blue.gltf`),
  { pack: "kenney-town", piece: "house (composed)", parts: kenneyHouse() },
  { pack: "kenney-castle", piece: "tower", parts: castleTower },
  {
    pack: "kenney-castle",
    piece: "wall + doorway",
    parts: [
      { file: `${CASTLE}/wall-doorway.glb`, turn: 90 },
      { file: `${CASTLE}/wall.glb`, at: [1, 0, 0] },
    ],
  },
  one("quaternius-rts", "house", `${RTS}/Houses_SecondAge_1_Level1.gltf`),
  one("quaternius-rts", "long house", `${RTS}/Houses_SecondAge_2_Level3.gltf`),
  one("quaternius-rts", "castle", `${RTS}/Barracks_SecondAge_Level3.gltf`),
  {
    pack: "quaternius-characters",
    piece: "worker",
    parts: [{ file: `${CHARACTERS}/Worker_Male.gltf`, pose: "Idle" }],
  },
  {
    pack: "quaternius-characters",
    piece: "villager",
    parts: [{ file: `${CHARACTERS}/Casual2_Female.gltf`, pose: "Idle" }],
  },
  one("kaykit-forest", "tree 1A", `${FOREST}/Tree_1_A_Color1.gltf`),
  one("kaykit-forest", "tree 4A", `${FOREST}/Tree_4_A_Color1.gltf`),
  one("quaternius-nature", "maple 1", `${NATURE}/MapleTree_1.gltf`),
  one("kenney-nature", "tree default", `${KENNEY_NATURE}/tree_default.glb`),
  // The kit's own doorway, the scale reference for the ship.
  one("kenney-pirate", "castle door", `${PIRATE}/castle-door.glb`),
  {
    pack: "kenney-pirate",
    piece: "pirate ship",
    parts: [{ file: `${PIRATE}/ship-pirate-large.glb`, turn: 90 }],
  },
]
