import { type Cell, cellToWorld, type Field, type LandPiece, type LandPlacement } from "../../lands.ts"
import type { Spot } from "../../layout.ts"
import { instantiate, prefab } from "../../prefabs/index.ts"
import { key, neighbours, noise, rings, step } from "../hex.ts"
import type { IslandPlan } from "../plan.ts"
import { COAST_TILES, fit, PATH_TILES, turn } from "../tiles.ts"
import { facing, round, siteDressing } from "./sites.ts"
import type { Terrace } from "./terrace.ts"
import type { Lot } from "./town.ts"

/** Height of one terrace (lands.ts TERRACE at HEX_SCALE 5). */
const TERRACE = 2.5
const FIELD = new Set(["w", "d"])

/** Every hex out to two rings past the land, tiled and dressed: lands.ts `island()`'s per-hex rules. */
export interface DressedHexes {
  tiles: LandPlacement[]
  decor: LandPlacement[]
  water: Spot[]
  meadow: Spot[]
  fields: Field[]
}

export function dressHexes(
  plan: IslandPlan,
  links: ReadonlyMap<string, ReadonlySet<number>>,
  terrace: Terrace,
  random: () => number,
  lots?: ReadonlyMap<string, Lot>,
  venues?: ReadonlyMap<string, readonly LandPlacement[]>,
): DressedHexes {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T
  const spin = (): number => turn(Math.floor(random() * 6))
  const at = (cell: Cell): string => plan.land.get(key(cell))?.char ?? "~"
  const isSea = (cell: Cell): boolean => !plan.land.has(key(cell))
  const { level, lowerOf, rampOf } = terrace
  const tiles: LandPlacement[] = []
  const decor: LandPlacement[] = []
  const water: Spot[] = []
  const meadow: Spot[] = []
  const fields: Field[] = []
  const reach = plan.radius + 2
  const mills = new Map<unknown, number>()
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
      // Hill country: a lot or meadow on a terrace stands on its top, and so does what is added to it.
      const terraced = plan.land.get(key(cell))?.level !== undefined && level(cell) > 0
      const lift = terraced ? level(cell) * TERRACE : 0
      const add = (piece: LandPiece, dx = 0, dz = 0, rot = spin(), y = 0, scale?: number) =>
        decor.push({
          piece,
          x: round(x + dx),
          z: round(z + dz),
          rot,
          ...(y + lift ? { y: y + lift } : {}),
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
        const edges = links.get(key(cell)) ?? new Set<number>()
        const fitted = fit(PATH_TILES, edges)
        if (!fitted) throw new Error(`road at ${key(cell)}: no tile opens onto ${[...edges]}`)
        tile(`hex_road_${fitted.tile}` as LandPiece, fitted.m)
        continue
      }

      if (char === "K") {
        // The keep: level grass under Room (scene/Room.tsx), never a shore (land rings it).
        tile("hex_grass")
        continue
      }
      const height = level(cell)
      if (terraced) {
        // A meadow on the edge of a terrace slopes down to the lower ground; the rest are flat tops.
        const ramp = char === "." ? rampOf(cell, lowerOf(cell, height)) : undefined
        if (ramp !== undefined) {
          tile("hex_grass_sloped_low", ramp + 3, (height - 1) * TERRACE)
          continue
        }
        tile("hex_grass", 0, lift)
        for (let below = height - 2; below >= 0; below -= 2) tile("hex_grass", 0, below * TERRACE)
      } else if (height > 0) {
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
      // Generator v2: a district's venue stands on its landmark's hex, or on a free one beside the square.
      const venue = venues?.get(key(cell))
      if (wet.length > 0) {
        const coast = fit(COAST_TILES, wet)
        if (!coast) throw new Error(`coast at ${key(cell)}: no tile opens onto ${wet}`)
        tile(`hex_coast_${coast.tile}` as LandPiece, coast.m)
        if (site === undefined && venue === undefined && char !== "V") {
          if (coast.tile === "A" && (char === "F" || char === "f")) {
            const away = (((wet[0] ?? 0) + 3) * Math.PI) / 3 + Math.PI / 6
            add(pick(["trees_A_small", "trees_B_small"] as const), Math.cos(away) * 2, Math.sin(away) * 2)
          } else if (coast.tile === "A" && random() < 0.5)
            add(pick(["rock_single_A", "rock_single_C"] as const), ...offset(2.5))
          continue
        }
      } else if (!terraced) tile("hex_grass")

      if (venue) {
        decor.push(...venue)
        continue
      }
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
            if (!terraced) meadow.push([x, z])
          }
          break
        case "h":
        case "H":
          add(pick(["hills_A_trees", "hills_B_trees", "hills_C_trees"] as const))
          break
        case "w":
        case "d":
          // Generator 2: now and then a windmill from the second town kit stands in the fields, at most two a district.
          if (
            lots &&
            char === "w" &&
            noise(plan.seed, cell, "mill") < 0.25 &&
            (mills.get(district) ?? 0) < 2
          ) {
            mills.set(district, (mills.get(district) ?? 0) + 1)
            decor.push(...instantiate(prefab("windmill-hex"), [x, z], facing([x, z], square), kit, lift))
            break
          }
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
          // Generator v2: a lot from the prefab catalogue (dress/town.ts), in the district's colour.
          const lot = lots?.get(key(cell))
          if (lot) {
            decor.push(...instantiate(lot.prefab, [x, z], lot.rot, kit, lift, lot.seed))
            break
          }
          // A lot the civic centre, a venue or the wall took the room of stays open ground.
          if (lots) {
            if (!terraced) meadow.push([x, z])
            break
          }
          // A home in the district's colour, its door to the nearest road (or its square).
          const road = neighbours(cell).find((next) => at(next) === "=")
          const look = road ? cellToWorld(road) : square
          add(pick([`building_home_A_${kit}`, `building_home_B_${kit}`] as const), 0, 0, facing([x, z], look))
          if (random() < 0.3) add(pick(["barrel", "crate_A_small", "sack"] as const), ...offset(3.6))
          break
        }
        case "V":
          // The lots round the keep: open ground (the wilds grow there, clear of its walls).
          if (!terraced) meadow.push([x, z])
          break
        case "s":
          // Training ground (the proving grounds' spare hexes): a target or a tent.
          if (random() < 0.6) add("target", ...offset(1.5), facing([x, z], square), 0, 1.4)
          else add("tent", ...offset(1))
          break
        case ".": {
          if (!terraced) meadow.push([x, z])
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
  return { tiles, decor, water, meadow, fields }
}
