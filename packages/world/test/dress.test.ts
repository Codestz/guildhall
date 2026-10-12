import { describe, expect, test } from "bun:test"
import { PALETTE, type Recipe, rampMapToSwatchMap } from "@guildhall/assets"
import {
  area,
  dressTown,
  EDGE_KITS,
  edgeKits,
  edgePieces,
  LEVELS,
  PLANT_ROLES,
  recipeKey,
  round3,
  type TownLayout,
  type TownSpecInput,
  townMetrics,
} from "../src/index.ts"
import { CATALOG, COMPILED, LIB, PRESETS, town } from "./town.fixture.ts"

/** world town: dressTown (plan → the flat draw list render reads). */

/** A plan with nothing in it but what a case adds. */
function bare(over: Partial<TownLayout> = {}): TownLayout {
  return {
    spec: { seed: 1, tier: "town", landmark: null, harbour: null },
    bounds: [
      [-50, -50],
      [50, -50],
      [50, 50],
      [-50, 50],
    ],
    water: [],
    plazas: [],
    streets: { nodes: [], edges: [] },
    blocks: [],
    lots: [],
    placements: [],
    edges: [],
    fields: [],
    nature: [],
    stations: [],
    plots: [],
    sizes: {},
    walk: { nodes: [], edges: [] },
    hash: "",
    ...over,
  }
}

const recipe = (id: string, seed = 0): Recipe => ({
  id,
  seed,
  sockets: [],
  instances: [
    { piece: "kit/wall", x: 1, y: 0, z: 2, rot: 0, scale: 1 },
    { piece: "kit/roof", x: 0, y: 3, z: 0, rot: Math.PI / 2, scale: 1, rampMap: { [rampA()]: rampB() } },
  ],
})
const rampA = () => PALETTE.ramps[0]?.name as string
const rampB = () => PALETTE.ramps[1]?.name as string

describe("dressTown", () => {
  test("expands a compiled prefab into its placement's frame, its ramp map baked to swatches", () => {
    const plan = bare({
      placements: [{ prefab: "house", seed: 4, at: [10, 5], rot: Math.PI / 2, role: "house" }],
    })
    const draw = dressTown(plan, new Map([["house", recipe("house")]]))
    const wall = draw.pieces.find((p) => p.piece === "kit/wall")
    const roof = draw.pieces.find((p) => p.piece === "kit/roof")
    // rot π/2: local +x is world (0, −1), local +z is world (1, 0).
    expect(wall).toMatchObject({ x: 12, z: 4, y: 0, rot: round3(Math.PI / 2) })
    expect(roof).toMatchObject({ x: 10, z: 5, y: 3, rot: round3(Math.PI) })
    expect(roof?.swatchMap).toEqual(rampMapToSwatchMap(PALETTE, { [rampA()]: rampB() }))
    expect(wall?.swatchMap).toBeUndefined()
  })

  test("prefers the placement's own variant (prefab#seed) over the prefab's one recipe", () => {
    const plan = bare({ placements: [{ prefab: "house", seed: 4, at: [0, 0], rot: 0 }] })
    const variant: Recipe = {
      ...recipe("house", 4),
      instances: [{ piece: "kit/other", x: 0, y: 0, z: 0, rot: 0, scale: 1 }],
    }
    const draw = dressTown(
      plan,
      new Map([
        ["house", recipe("house")],
        [recipeKey("house", 4), variant],
      ]),
    )
    expect(draw.pieces.map((p) => p.piece)).toEqual(["kit/other"])
  })

  test("draws a placement naming a catalog piece (crop, tree, the keep's stand-in) as that one piece", () => {
    const plan = bare({
      placements: [{ prefab: "kenney-pirate/crate", seed: 1, at: [3, -2], rot: 0.5, role: "crate" }],
      nature: [{ prefab: "kenney-town/tree", seed: 2, at: [-7, 1], rot: 1, role: "tree" }],
    })
    expect(dressTown(plan, new Map()).pieces).toEqual([
      { piece: "kenney-pirate/crate", x: 3, y: 0, z: -2, rot: 0.5, scale: 1 },
      { piece: "kenney-town/tree", x: -7, y: 0, z: 1, rot: 1, scale: 1 },
    ])
  })

  test("lays edges out through the tier's kits", () => {
    const edge = {
      id: 0,
      kind: "wall" as const,
      points: [
        [0, 0],
        [40, 0],
        [40, 30],
      ] as [number, number][],
      closed: false,
      gaps: [],
    }
    const draw = dressTown(bare({ edges: [edge] }), new Map())
    expect(draw.pieces.length).toBe(edgePieces(edge, edgeKits("town").wall).length)
    const city = dressTown(bare({ edges: [edge] }), new Map(), edgeKits("city"))
    expect(city.pieces.some((p) => p.piece === EDGE_KITS.stone.segment)).toBe(true)
  })

  test("ground: the lake is a hole, streets and plots are painted, buildings and walls leave footprints", () => {
    const plan = town(PRESETS[3] as TownSpecInput)
    const draw = dressTown(plan, COMPILED)
    expect(plan.water.length).toBeGreaterThan(0)
    expect(Math.abs(area(draw.ground.land))).toBeLessThan(Math.abs(area(plan.bounds)))
    const kinds = new Set(draw.ground.overlays.map((o) => o.kind))
    for (const k of ["cobble", "dirt", "plaza", "field", "garden", "sand"])
      expect(kinds.has(k as never), k).toBe(true)
    const buildings = plan.placements.filter((p) => COMPILED.has(p.prefab) || p.role === "keep").length
    const walls = plan.edges.filter((e) => e.kind === "wall").length
    expect(draw.ground.footprints.length).toBeGreaterThan(buildings + walls)
    expect(draw.water.level).toBe(LEVELS.water)
    // The shore lines never run along the bounds.
    const h = 1.3 * 150
    for (const line of draw.water.shore)
      for (let i = 0; i + 1 < line.length; i++) {
        const [a, b] = [line[i], line[i + 1]] as [[number, number], [number, number]]
        const onSide = (k: 0 | 1) =>
          Math.abs(Math.abs(a[k]) - h) < 1e-3 && Math.abs(Math.abs(b[k]) - h) < 1e-3
        expect(onSide(0) || onSide(1)).toBe(false)
      }
  })

  test("a whole town: pieces grouped by id, every id drawable, and the draw survives JSON", () => {
    const plan = town(PRESETS[2] as TownSpecInput)
    const draw = dressTown(plan, COMPILED)
    const ids = draw.pieces.map((p) => p.piece)
    expect(ids).toEqual([...ids].sort())
    for (const id of new Set(ids)) expect(CATALOG.get(id), id).toBeDefined()
    expect(JSON.parse(JSON.stringify(draw))).toEqual(draw)
    const plants = [...plan.placements, ...plan.nature].filter((p) => PLANT_ROLES.has(p.role ?? "")).length
    const m = townMetrics(plan, { draw, tris: LIB.tris })
    expect(m.pieces).toBeGreaterThan(plants)
    expect(m.estTris).toBeGreaterThan(0)
  })

  test("is deterministic", () => {
    const plan = town(PRESETS[1] as TownSpecInput)
    expect(JSON.stringify(dressTown(plan, COMPILED))).toBe(JSON.stringify(dressTown(plan, COMPILED)))
  })
})
