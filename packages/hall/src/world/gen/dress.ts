import {
  type Cell,
  cellToWorld,
  type Field,
  type Island,
  type Landmark,
  type LandmarkKind,
  type LandPiece,
  type LandPlacement,
} from "../lands.ts"
import type { Post, Spot } from "../layout.ts"
import type { Biome, KitColour, Language } from "./biomes.ts"
import { direction, key, neighbours, rings, rng, step } from "./hex.ts"
import type { IslandPlan } from "./plan.ts"
import { COAST_TILES, contiguous, fit, PATH_TILES, turn } from "./tiles.ts"

/**
 * The adapter: an IslandPlan tiled and dressed into the shapes the hall already draws and walks —
 * lands.ts' `Island` (tiles, decor, water, meadow, landmarks, fields: scene/Island.tsx batches
 * `tiles` + `decor` as they are), its road graph (ROAD_NODES / ROAD_EDGES' shape), and a Site-shaped
 * entry per district. The per-hex rules are lands.ts' `island()` loop, read off the plan's chars
 * instead of the hand-drawn MAP.
 */

export interface District {
  /** The folder ("/" is the root's own files). */
  id: string
  label: string
  biome: Biome
  language: Language
  /** Its palette accent (the dominant language's colour). */
  accent: string
  files: number
  bytes: number
  hexes: number
  /** Its landmark's spot (the square when there's no room for one). */
  at: Spot
  /** The road node its road ends at (a key of `roads.nodes`). */
  node: string
  /** Where people stand to work, facing the landmark: lands.ts Site.posts' shape. */
  posts: Post[]
  landmark?: LandPiece
}

export interface RepoIsland {
  plan: IslandPlan
  /**
   * Terrace level of every raised hex by key (1 foothill or mountain, 2 high mountain; absent is
   * level ground), after foothills that can't slope sank to knolls: lands.ts `level`'s answer.
   */
  levels: ReadonlyMap<string, number>
  island: Island
  roads: { nodes: Record<string, Spot>; edges: (readonly [string, string])[] }
  districts: District[]
}

const LANDMARK: Record<Biome, (kit: KitColour) => LandPiece> = {
  harbour: () => "building_well_blue",
  village: (kit) => (kit === "red" || kit === "yellow" ? "building_market_red" : "building_market_blue"),
  proving: () => "building_archeryrange_blue",
  library: () => "building_tower_A_blue",
  quarry: () => "building_mine_blue",
  forest: () => "building_lumbermill_blue",
  farms: () => "building_windmill_blue",
  wilds: () => "tent",
}
/** Landmark kinds Life animates or dresses (lands.ts LANDMARK_OF's pieces the generator places). */
const KIND: Partial<Record<LandPiece, LandmarkKind>> = {
  building_windmill_blue: "windmill",
  building_lumbermill_blue: "lumbermill",
  building_mine_blue: "mine",
  building_tower_A_blue: "tower",
  building_well_blue: "well",
  building_market_blue: "market",
  building_market_red: "market",
  floor_wood_large: "dock",
}
const FLAG: Record<KitColour, LandPiece> = {
  blue: "flag_blue",
  red: "flag_red",
  yellow: "flag_yellow",
  green: "flag_yellow",
}

/** Height of one terrace (lands.ts TERRACE at HEX_SCALE 5). */
const TERRACE = 2.5
const LEVEL: Record<string, number> = { H: 1, m: 1, M: 2 }
const FIELD = new Set(["w", "d"])
const round = (value: number): number => Math.round(value * 100) / 100
const facing = (from: Spot, to: Spot): number => Math.atan2(to[0] - from[0], to[1] - from[1])

export function dress(plan: IslandPlan): RepoIsland {
  const random = rng(plan.seed ^ 0x9e3779b9)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T
  const spin = (): number => turn(Math.floor(random() * 6))
  const at = (cell: Cell): string => plan.land.get(key(cell))?.char ?? "~"
  const isSea = (cell: Cell): boolean => !plan.land.has(key(cell))

  // ---- Roads: links per hex, the walking graph ----
  const roadLinks = new Map<string, Set<number>>()
  const link = (cell: Cell, dir: number): void => {
    const set = roadLinks.get(key(cell)) ?? new Set<number>()
    set.add(dir)
    roadLinks.set(key(cell), set)
  }
  const squares = new Map(plan.districts.map((district, i) => [key(district.square), i]))
  const nodeName = (cell: Cell): string => {
    const i = squares.get(key(cell))
    if (i === 0) return "HARBOUR"
    if (i !== undefined) return `D:${plan.districts[i]?.folder.name}`
    return `R${cell[0]}_${cell[1]}`
  }
  const nodes: Record<string, Spot> = { HARBOUR: cellToWorld(plan.hub) }
  const edges: (readonly [string, string])[] = []
  const walked = new Set<string>()
  for (const road of plan.roads)
    for (let i = 0; i < road.length; i++) {
      const b = road[i]
      if (!b) continue
      nodes[nodeName(b)] = cellToWorld(b)
      const a = road[i - 1]
      if (!a) continue
      link(a, direction(a, b))
      link(b, direction(b, a))
      const edge = [nodeName(a), nodeName(b)].sort().join("|")
      if (walked.has(edge)) continue
      walked.add(edge)
      edges.push([nodeName(a), nodeName(b)])
    }
  // The quay: the hub's road opens south onto it (a drawn stub, like lands.ts' DOCKS).
  link(plan.hub, direction(plan.hub, plan.quay))

  // ---- Levels, foothills that can't slope sinking to knolls (lands.ts' rule) ----
  const levels = new Map<string, number>()
  for (const [id, hex] of plan.land) if (LEVEL[hex.char]) levels.set(id, LEVEL[hex.char] ?? 0)
  const level = (cell: Cell): number => levels.get(key(cell)) ?? 0
  const rampOf = (cell: Cell, lower: readonly number[]): number | undefined => {
    if (lower.length === 0 || lower.length > 3) return undefined
    if (lower.some((dir) => isSea(step(cell, dir)))) return undefined
    const run = contiguous(lower)
    return run ? run.start + Math.floor((run.length - 1) / 2) : undefined
  }
  const lowerOf = (cell: Cell, height: number): number[] =>
    [0, 1, 2, 3, 4, 5].filter((dir) => level(step(cell, dir)) < height)
  for (let changed = true; changed; ) {
    changed = false
    for (const [id, height] of levels) {
      if (plan.land.get(id)?.char !== "H") continue
      const cell = id.split(",").map(Number) as unknown as Cell
      const lower = lowerOf(cell, height)
      if (lower.length > 0 && rampOf(cell, lower) === undefined) {
        levels.delete(id)
        changed = true
      }
    }
  }

  // ---- Every hex, tiled and dressed ----
  const tiles: LandPlacement[] = []
  const decor: LandPlacement[] = []
  const water: Spot[] = []
  const meadow: Spot[] = []
  const fields: Field[] = []
  const reach = plan.radius + 2
  const sites = new Map<string, number>()
  plan.districts.forEach((district, i) => {
    if (district.site) sites.set(key(district.site), i)
  })

  for (let q = -reach; q <= reach; q++)
    for (let line = -2 * reach; line <= 2 * reach; line++) {
      const cell: Cell = [q, line]
      if ((q - line) % 2 !== 0 || rings(cell) > reach) continue
      const char = at(cell)
      const [x, z] = cellToWorld(cell)
      const district = plan.districts[plan.land.get(key(cell))?.district ?? 0]
      const kit = district?.folder.language.kit ?? "blue"
      const tile = (piece: LandPiece, m = 0, y = 0) =>
        tiles.push({ piece, x, z, rot: turn(m), ...(y ? { y } : {}) })
      const add = (piece: LandPiece, dx = 0, dz = 0, rot = spin(), y = 0, scale?: number) =>
        decor.push({
          piece,
          x: round(x + dx),
          z: round(z + dz),
          rot,
          ...(y ? { y } : {}),
          ...(scale ? { scale } : {}),
        })
      const offset = (distance: number): [number, number] => {
        const angle = random() * Math.PI * 2
        return [Math.cos(angle) * distance, Math.sin(angle) * distance]
      }

      if (char === "~") {
        tile("hex_water")
        water.push([x, z])
        continue
      }
      if (char === "=") {
        const edges = roadLinks.get(key(cell)) ?? new Set<number>()
        const fitted = fit(PATH_TILES, edges)
        if (!fitted) throw new Error(`road at ${key(cell)}: no tile opens onto ${[...edges]}`)
        tile(`hex_road_${fitted.tile}` as LandPiece, fitted.m)
        continue
      }

      const height = level(cell)
      if (height > 0) {
        const lower = lowerOf(cell, height)
        const ramp = char === "H" ? rampOf(cell, lower) : undefined
        if (ramp !== undefined) {
          tile("hex_grass_sloped_low", ramp + 3, (height - 1) * TERRACE)
          if (random() < 0.5)
            add(
              pick(["tree_single_A", "tree_single_B"] as const),
              ...offset(2),
              spin(),
              (height - 0.6) * TERRACE,
            )
          continue
        }
        tile("hex_grass", 0, height * TERRACE)
        for (let below = height - 2; below >= 0; below -= 2) tile("hex_grass", 0, below * TERRACE)
        const y = height * TERRACE
        if (char === "M")
          add(pick(["mountain_A", "mountain_B", "mountain_C", "mountain_C_grass"] as const), 0, 0, spin(), y)
        else if (char === "m")
          add(
            pick([
              "mountain_A_grass_trees",
              "mountain_B_grass_trees",
              "mountain_A_grass",
              "mountain_B_grass",
              "mountain_C_grass_trees",
            ] as const),
            0,
            0,
            spin(),
            y,
          )
        else add(pick(["hills_A_trees", "hills_B_trees", "hills_C_trees"] as const), 0, 0, spin(), y)
        continue
      }

      const wet = [0, 1, 2, 3, 4, 5].filter((dir) => isSea(step(cell, dir)))
      const site = sites.get(key(cell))
      if (wet.length > 0) {
        const coast = fit(COAST_TILES, wet)
        if (!coast) throw new Error(`coast at ${key(cell)}: no tile opens onto ${wet}`)
        tile(`hex_coast_${coast.tile}` as LandPiece, coast.m)
        if (site === undefined) {
          if (coast.tile === "A" && (char === "F" || char === "f")) {
            const away = (((wet[0] ?? 0) + 3) * Math.PI) / 3 + Math.PI / 6
            add(pick(["trees_A_small", "trees_B_small"] as const), Math.cos(away) * 2, Math.sin(away) * 2)
          } else if (coast.tile === "A" && random() < 0.5)
            add(pick(["rock_single_A", "rock_single_C"] as const), ...offset(2.5))
          continue
        }
      } else tile("hex_grass")

      if (site !== undefined) {
        const owner = plan.districts[site]
        if (owner)
          decor.push(...siteDressing(owner.biome, owner.folder.language.kit, cell, owner.square, random))
        continue
      }
      const square = district ? cellToWorld(district.square) : ([0, 0] as Spot)
      switch (char) {
        case "F":
          add(pick(["trees_A_large", "trees_B_large", "trees_A_large", "trees_B_medium"] as const))
          break
        case "f":
          if (random() < 0.55)
            add(pick(["trees_A_medium", "trees_B_medium", "trees_A_small", "trees_B_small"] as const))
          else {
            add(pick(["tree_single_A", "tree_single_B"] as const), ...offset(2.5))
            add(pick(["tree_single_A", "tree_single_B"] as const), ...offset(2.8))
            meadow.push([x, z])
          }
          break
        case "h":
        case "H":
          add(pick(["hills_A_trees", "hills_B_trees", "hills_C_trees"] as const))
          break
        case "w":
        case "d":
          add("building_dirt", 0, 0, turn(0))
          fields.push({ kind: char === "w" ? "wheat" : "crops", x, z })
          for (let dir = 0; dir < 6; dir++) {
            const next = step(cell, dir)
            const nextChar = at(next)
            if (FIELD.has(nextChar) || nextChar === "=" || isSea(next)) continue
            add(dir === 1 ? "fence_wood_straight_gate" : "fence_wood_straight", 0, 0, turn(dir - 3))
          }
          break
        case "v": {
          // A home in the district's colour, its door to the nearest road (or its square).
          const road = neighbours(cell).find((next) => at(next) === "=")
          const look = road ? cellToWorld(road) : square
          add(pick([`building_home_A_${kit}`, `building_home_B_${kit}`] as const), 0, 0, facing([x, z], look))
          if (random() < 0.3) add(pick(["barrel", "crate_A_small", "sack"] as const), ...offset(3.6))
          break
        }
        case "s":
          // Training ground (the proving grounds' spare hexes): a target or a tent.
          if (random() < 0.6) add("target", ...offset(1.5), facing([x, z], square), 0, 1.4)
          else add("tent", ...offset(1))
          break
        case ".": {
          meadow.push([x, z])
          const roll = random()
          if (district?.biome === "quarry" && roll < 0.5)
            add(
              pick(["rock_single_D", "rock_single_E", "rock_single_B"] as const),
              ...offset(3),
              spin(),
              0,
              1.3,
            )
          else if (roll < 0.22) add(pick(["tree_single_A", "tree_single_B"] as const), ...offset(3))
          else if (roll < 0.34)
            add(pick(["rock_single_A", "rock_single_B", "rock_single_C"] as const), ...offset(3))
          break
        }
      }
    }

  // ---- The quay: planks south off the hub into the bay ----
  const [hx, hz] = cellToWorld(plan.hub)
  for (const dz of [6, 10, 14, 18]) decor.push(place("floor_wood_large", hx, hz + dz, 0, 0.2, -0.45))
  decor.push(place("floor_wood_large", hx - 4, hz + 18, 0, 0.2, -0.45))
  decor.push(place("floor_wood_large", hx + 4, hz + 18, 0, 0.2, -0.45))
  decor.push(place("barrel", hx + 1.3, hz + 6.5, 0, 1, -0.4))
  decor.push(place("crate_long_A", hx - 4.5, hz + 17.5, 1.6, 1, -0.4))

  const landmarks: Landmark[] = [
    { kind: "dock", piece: "floor_wood_large", x: hx, z: hz + 18, y: -0.45, rot: 0 },
  ]
  for (const placement of decor) {
    const kind = KIND[placement.piece]
    if (!kind || kind === "dock") continue
    landmarks.push({ kind, piece: placement.piece, x: placement.x, z: placement.z, rot: placement.rot ?? 0 })
  }

  const districts: District[] = plan.districts.map((district) => {
    const square = cellToWorld(district.square)
    const siteAt = district.site ? cellToWorld(district.site) : undefined
    const folder = district.folder
    return {
      id: folder.name,
      label: folder.name === "/" ? "Harbour" : folder.name,
      biome: district.biome,
      language: folder.language,
      accent: folder.language.colour,
      files: folder.files,
      bytes: folder.bytes,
      hexes: district.hexes,
      at: siteAt ?? square,
      node: nodeName(district.square),
      posts: siteAt ? postsAround(siteAt, square) : [[square[0], square[1], 0]],
      ...(siteAt ? { landmark: LANDMARK[district.biome](folder.language.kit) } : {}),
    }
  })

  return {
    plan,
    levels,
    island: { tiles, decor, water, meadow, landmarks, fields },
    roads: { nodes, edges },
    districts,
  }
}

const place = (
  piece: LandPiece,
  x: number,
  z: number,
  rot: number,
  scale: number,
  y: number,
): LandPlacement => ({
  piece,
  x: round(x),
  z: round(z),
  rot,
  scale,
  y,
})

/** Three posts on the square's side of a landmark, 4 from it (inside its hex), facing it. */
function postsAround(site: Spot, square: Spot): Post[] {
  const toSquare = Math.atan2(square[0] - site[0], square[1] - site[1])
  return [-0.6, 0, 0.6].map((spread) => {
    const angle = toSquare + spread
    const x = round(site[0] + Math.sin(angle) * 4)
    const z = round(site[1] + Math.cos(angle) * 4)
    return [x, z, facing([x, z], site)] as Post
  })
}

/** A district's landmark hex: its building facing the square, the biome's props, its flag. */
function siteDressing(
  biome: Biome,
  kit: KitColour,
  cell: Cell,
  square: Cell,
  random: () => number,
): LandPlacement[] {
  const [x, z] = cellToWorld(cell)
  const look = cellToWorld(square)
  const toSquare = facing([x, z], look)
  const at = (angle: number, distance: number): [number, number] => [
    round(x + Math.sin(toSquare + angle) * distance),
    round(z + Math.cos(toSquare + angle) * distance),
  ]
  const out: LandPlacement[] = [{ piece: LANDMARK[biome](kit), x, z, rot: toSquare }]
  const [fx, fz] = at(Math.PI / 2, 3.8)
  out.push({ piece: FLAG[kit], x: fx, z: fz, rot: 0 })
  const prop = (piece: LandPiece, angle: number, distance: number, scale?: number): void => {
    const [px, pz] = at(angle, distance)
    out.push({ piece, x: px, z: pz, rot: random() * Math.PI * 2, ...(scale ? { scale } : {}) })
  }
  switch (biome) {
    case "proving":
      for (const angle of [2.4, 3.1, 3.8]) {
        const [tx, tz] = at(angle, 3.5)
        out.push({ piece: "target", x: tx, z: tz, rot: facing([tx, tz], [x, z]), scale: 1.4 })
      }
      break
    case "quarry":
      prop("resource_stone", -Math.PI / 2, 3.6)
      prop("rock_single_D", -2.2, 3.4, 1.4)
      break
    case "forest":
      prop("resource_lumber", -Math.PI / 2, 3.6)
      prop("tree_single_A_cut", 2.6, 3.4)
      break
    case "farms":
      prop("sack", -Math.PI / 2, 3.4)
      prop("sack", -2, 3.2, 1.1)
      break
    case "village":
      prop("crate_A_big", -Math.PI / 2, 3.6)
      prop("barrel", -2.2, 3.4)
      break
    case "harbour":
      prop("barrel", -Math.PI / 2, 3.4)
      prop("crate_open", -2.2, 3.4)
      break
    default:
      break
  }
  return out
}
