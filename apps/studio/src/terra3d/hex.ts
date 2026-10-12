/**
 * The V1 skin (decisions.md "V1 look, V2 bones"): the island drawn as low-poly hex tiles, each coloured
 * by what is on it (grass toned by terrace, sand on the shore, rock, a road or a cobbled street, the
 * field, orchard or wood of its parcel), water laid on the river and lake tiles, and the buildings our
 * districts chose stood up as KayKit Medieval Hexagon buildings, one to a tile, turned to the nearest
 * of the tile's six sides.
 */
import type { BatchInstance, HexPrism } from "@guildhall/render"
import { hash2, type Terra, type TerraHexes, type TerraParcels, type TerraPlan } from "@guildhall/world"

type RGB = [number, number, number]
const hex = (s: string): RGB => [
  Number.parseInt(s.slice(1, 3), 16),
  Number.parseInt(s.slice(3, 5), 16),
  Number.parseInt(s.slice(5, 7), 16),
]

/** Tile tops by what is on them. */
const TOP: Record<string, RGB> = {
  grass: hex("#8fc356"),
  grass2: hex("#7db84c"),
  highGrass: hex("#9cb95a"),
  shore: hex("#e7cf94"),
  rock: hex("#a0907c"),
  crag: hex("#c2b8a8"),
  bed: hex("#6f8a5a"),
  road: hex("#d9c08c"),
  cobble: hex("#c4baa6"),
  field: hex("#d9b54f"),
  crop: hex("#a9c255"),
  orchard: hex("#79b04c"),
  pasture: hex("#a7cf68"),
  meadow: hex("#b8cf62"),
  wood: hex("#4f8a3c"),
  pine: hex("#477a3e"),
  vineyard: hex("#8fae58"),
  quarry: hex("#b3aa9c"),
  reeds: hex("#7fae66"),
  dune: hex("#e2cc8f"),
  town: hex("#86b552"),
}
const SIDE: Record<string, RGB> = { land: hex("#7a5a3c"), shore: hex("#b39062"), rock: hex("#7d7468") }

export interface HexInputs {
  t: Terra
  hx: TerraHexes
  plan: TerraPlan | null
  parcels: TerraParcels | null
  /** Street centrelines with half widths (built streets and paved ones), and the old town. */
  streets: { line: [number, number][]; half: number; paved?: boolean }[]
  core: { at: [number, number]; r: number } | null
}

/** Every land tile as a prism with its top coloured by what is on it. */
export function hexTiles(inp: HexInputs): HexPrism[] {
  const { t, hx, plan, parcels } = inp
  const seed = t.spec.seed
  // which tiles a road or street runs over
  const onRoad = new Map<string, "road" | "cobble">()
  const mark = (line: readonly (readonly [number, number])[], kind: "road" | "cobble") => {
    for (let k = 1; k < line.length; k++) {
      const a = line[k - 1]!
      const b = line[k]!
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (hx.size * 0.5))
      for (let j = 0; j <= n; j++) {
        const x = a[0] + ((b[0] - a[0]) * j) / n
        const z = a[1] + ((b[1] - a[1]) * j) / n
        const tile = hx.tileAt(x, z)
        if (!tile || !Number.isNaN(tile.water)) continue
        // a path tile only where the line runs through the tile's middle, so paths stay one tile wide
        if (Math.hypot(x - tile.at[0], z - tile.at[1]) > hx.size * 0.45) continue
        const key = `${tile.q},${tile.r}`
        const inCore = inp.core && Math.hypot(x - inp.core.at[0], z - inp.core.at[1]) < inp.core.r + 4
        if (onRoad.get(key) !== "cobble") onRoad.set(key, kind === "cobble" || inCore ? "cobble" : "road")
      }
    }
  }
  for (const r of plan?.roads ?? []) mark(r.line, "road")
  for (const s of inp.streets) if (s.half > 0) mark(s.line, s.paved ? "cobble" : "road")
  for (const tr of parcels?.trails ?? []) mark(tr.line, "road")
  const parcelUse = new Map<number, string>()
  if (parcels) for (const p of parcels.parcels) parcelUse.set(p.id + 1, p.use)
  const out: HexPrism[] = []
  for (const tile of hx.tiles) {
    const v = 0.93 + 0.12 * hash2(seed + 77, tile.q, tile.r)
    let top: RGB
    let side = SIDE.land!
    const road = onRoad.get(`${tile.q},${tile.r}`)
    if (tile.kind === "river" || tile.kind === "lake") top = TOP.bed!
    else if (tile.kind === "shore") {
      top = TOP.shore!
      side = SIDE.shore!
    } else if (tile.kind === "rock") {
      top = TOP.rock!
      side = SIDE.rock!
    } else if (tile.kind === "crag") {
      top = TOP.crag!
      side = SIDE.rock!
    } else if (road) top = road === "cobble" ? TOP.cobble! : TOP.road!
    else {
      const ix = Math.floor((tile.at[0] - t.origin[0]) / t.cell)
      const iz = Math.floor((tile.at[1] - t.origin[1]) / t.cell)
      const use = parcels ? parcelUse.get(parcels.cell[iz * t.w + ix] ?? 0) : undefined
      if (use === "field" || use === "terrace-field")
        top = hash2(seed + 5, tile.q * 3, tile.r) < 0.5 ? TOP.field! : TOP.crop!
      else if (use && TOP[use]) top = TOP[use]!
      else if (inp.core && Math.hypot(tile.at[0] - inp.core.at[0], tile.at[1] - inp.core.at[1]) < inp.core.r)
        top = TOP.town!
      else if (tile.level > 0) top = TOP.highGrass!
      else top = hash2(seed + 9, tile.q, tile.r) < 0.5 ? TOP.grass! : TOP.grass2!
    }
    out.push({
      x: tile.at[0],
      z: tile.at[1],
      top: tile.top,
      color: [top[0] * v, top[1] * v, top[2] * v],
      side,
    })
  }
  return out
}

/** Flat hexagons of water over the river and lake tiles. */
export function hexWater(hx: TerraHexes): Float32Array {
  const pos: number[] = []
  const s = hx.size * 1.02
  for (const tile of hx.tiles) {
    if (Number.isNaN(tile.water)) continue
    const y = tile.water - 0.15
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 180) * (60 * k - 30)
      const b = (Math.PI / 180) * (60 * (k + 1) - 30)
      pos.push(tile.at[0], y, tile.at[1])
      pos.push(tile.at[0] + Math.cos(b) * s, y, tile.at[1] + Math.sin(b) * s)
      pos.push(tile.at[0] + Math.cos(a) * s, y, tile.at[1] + Math.sin(a) * s)
    }
  }
  return new Float32Array(pos)
}

/** Our recipe ids → the KayKit hexagon building that plays the part. */
const KAYKIT: [RegExp, string[]][] = [
  [/castle/, ["building-castle"]],
  [/church|chapel/, ["building-church"]],
  [/tavern|inn/, ["building-tavern"]],
  [/market|guildhall|merchant/, ["building-market"]],
  [/smithy|works/, ["building-blacksmith"]],
  [/warehouse/, ["building-lumbermill", "building-home-b"]],
  [/watermill/, ["building-watermill"]],
  [/windmill/, ["building-windmill"]],
  [/tower|lookout/, ["building-tower-a", "building-tower-b"]],
  [/stables|barracks/, ["building-barracks"]],
  [/well|fountain/, ["building-well"]],
  [/narrow|townhouse|corner|timber|stone|bakery/, ["building-home-b", "building-home-a", "building-home-b"]],
  [/cottage|farmhouse|long-house/, ["building-home-a", "building-home-a", "building-home-b"]],
]
/** Roof colours, weighted: red and blue lead, green and yellow accent. */
const COLOURS = ["red", "red", "blue", "blue", "green", "yellow"]

/**
 * Each building as one KayKit hex building on the tile under it (the first to claim a tile keeps it;
 * landmarks first), turned to the nearest sixth. Buildings with no KayKit part (the vignettes) are
 * returned in `keep` for their recipe to draw.
 */
export function hexBuildings(
  t: Terra,
  hx: TerraHexes,
  buildings: readonly { prefab: string; at: [number, number]; rot: number; landmark: boolean }[],
  have: (id: string) => boolean,
): { pieces: BatchInstance[]; keep: Set<number> } {
  const taken = new Set<string>()
  const pieces: BatchInstance[] = []
  const keep = new Set<number>()
  const order = buildings
    .map((b, i) => i)
    .sort((a, b) => Number(buildings[b]!.landmark) - Number(buildings[a]!.landmark))
  for (const i of order) {
    const b = buildings[i]!
    const match = KAYKIT.find(([re]) => re.test(b.prefab))
    if (!match) {
      keep.add(i)
      continue
    }
    const tile = hx.tileAt(b.at[0], b.at[1])
    if (!tile || !Number.isNaN(tile.water)) continue
    const key = `${tile.q},${tile.r}`
    if (taken.has(key)) continue
    const u = hash2(t.spec.seed + 31, tile.q, tile.r)
    const base = match[1][Math.floor(u * match[1].length) % match[1].length]!
    const colour =
      COLOURS[Math.floor(hash2(t.spec.seed + 37, tile.q, tile.r) * COLOURS.length) % COLOURS.length]!
    const id = have(`kaykit-hexagon/${base}-${colour}`)
      ? `kaykit-hexagon/${base}-${colour}`
      : `kaykit-hexagon/${base}`
    if (!have(id)) continue
    taken.add(key)
    const sixth = Math.PI / 3
    pieces.push({
      piece: id,
      x: tile.at[0],
      y: tile.top,
      z: tile.at[1],
      rot: Math.round(b.rot / sixth) * sixth,
      scale: 1,
    })
  }
  return { pieces, keep }
}

/** A KayKit bridge on every river tile a road crosses, laid along the road. */
export function hexBridges(hx: TerraHexes, plan: TerraPlan, have: (id: string) => boolean): BatchInstance[] {
  const id = "kaykit-hexagon/building-bridge-a"
  if (!have(id)) return []
  const out: BatchInstance[] = []
  const done = new Set<string>()
  for (const r of plan.roads)
    for (let k = 1; k < r.line.length; k++) {
      const p = r.line[k]!
      const tile = hx.tileAt(p[0], p[1])
      if (!tile || tile.kind !== "river") continue
      const key = `${tile.q},${tile.r}`
      if (done.has(key)) continue
      done.add(key)
      const a = r.line[k - 1]!
      const sixth = Math.PI / 3
      const rot = Math.round(Math.atan2(p[0] - a[0], p[1] - a[1]) / sixth) * sixth
      out.push({ piece: id, x: tile.at[0], y: tile.water - 0.6, z: tile.at[1], rot, scale: 0.7 })
    }
  return out
}
