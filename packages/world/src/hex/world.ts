/**
 * The hex island built: every tile of the map (hexIsland + hexZones) turned into what stands on it, the
 * tile prefab its job and its place ask for, facing the nearest street, at its height. Pure data: the
 * ground prisms, the path strips, the water tiles and the pieces, for the 3D screen to draw.
 */
import { hash2 } from "../geom/noise.ts"
import { hexCentre } from "./grid.ts"
import { type HexIsland, kindOf } from "./island.ts"
import { HEX_TILE_SIZE, placeTile, type TileGround, tilePath, tilePrefab } from "./tiles.ts"
import { type HexZones, useOf } from "./zones.ts"

/** Metres per height level. */
export const LEVEL_STEP = 1.1

export interface HexWorldTile {
  i: number
  x: number
  z: number
  /** Top of the ground, metres. */
  top: number
  ground: TileGround | "cliff" | "shore"
  prefab: string | null
}

export interface HexWorld {
  tiles: HexWorldTile[]
  pieces: { piece: string; x: number; y: number; z: number; rot: number; scale: number }[]
  /** Path strips (triangle positions) over road tiles. */
  paths: number[]
  /** Bridge decks (triangle positions), drawn in plank colour. */
  decks: number[]
  /** The island's ground height at a point (the top of the tile under it; 0 off the island). */
  heightAt(x: number, z: number): number
  stats: { tiles: number; pieces: number; prefabs: Record<string, number> }
}

/** What a building tile of each place builds (picked by the tile's hash). */
const BUILDS: Record<string, string[]> = {
  town: ["house", "townhouse", "cottage", "house", "townhouse", "tavern", "smithy", "market"],
  harbour: ["warehouse", "cottage", "house"],
  castle: ["barracks"],
  farm: ["farmstead", "cottage"],
  fishing: ["cottage", "cottage", "house"],
  mine: ["cottage", "smithy"],
  lumber: ["cottage", "lumber", "hunter"],
  monastery: ["monastery", "cottage", "graveyard"],
  camp: ["barracks", "fort-tower", "archery", "cottage"],
  hamlet: ["cottage", "homestead", "house", "farmstead"],
  market: ["market", "tavern", "townhouse", "house", "smithy", "cottage"],
}

/** The town builds by district: tall houses, shops and inns at its heart; workshops by the water; cottages at its edge. */
const TOWN_HEART = ["townhouse", "market", "tavern", "townhouse", "house", "chapel"]
const TOWN_WATER = ["warehouse", "smithy", "house", "construction"]
const TOWN_EDGE = ["cottage", "house", "homestead", "cottage", "smithy", "construction"]

/** What a place's heart tile is. */
const HEART: Record<string, string | null> = {
  town: "well-square",
  market: "market",
  monastery: "chapel",
  camp: "archery",
  harbour: "well-square",
  hamlet: "well-square",
  farm: "well-square",
  fishing: "well-square",
  mine: "mine",
  lumber: "lumber",
}

const COLOURS = ["red", "red", "blue", "blue", "green", "yellow"]

/** The prefab for a tile's use (besides buildings and roads). */
const BY_USE: Record<string, string> = {
  field: "field",
  orchard: "orchard",
  pasture: "pasture",
  woods: "woods",
  grove: "meadow",
  meadow: "meadow",
  hillside: "hillside",
  hunter: "hunter",
  shepherd: "shepherd",
  homestead: "homestead",
  crag: "rocky",
  quarry: "rocky",
  beach: "beach",
  bluff: "rocky",
  reeds: "reeds",
  farmstead: "farmstead",
  windmill: "windmill",
  lighthouse: "lighthouse",
  watchtower: "watchtower",
  ruins: "ruins",
  shrine: "meadow",
  campsite: "campsite",
  sawmill: "lumber",
  market: "market",
  well: "well-square",
  garden: "meadow",
  yard: "meadow",
  dock: "dock",
}

export function hexWorld(h: HexIsland, z: HexZones): HexWorld {
  const g = h.grid
  const R = HEX_TILE_SIZE
  const tiles: HexWorldTile[] = []
  const pieces: HexWorld["pieces"] = []
  const paths: number[] = []
  const decks: number[] = []
  const prefabs: Record<string, number> = {}
  const seed = h.spec.seed
  const at = (i: number): [number, number] => {
    const [x, y] = hexCentre({ q: g.q[i]!, r: g.r[i]! })
    return [x * R, y * R]
  }
  const top = (i: number) => {
    const k = kindOf(h, i)
    const L = Math.max(0, h.level[i]!)
    if (k === "lake" || k === "river") return 0.35 + L * LEVEL_STEP - 0.45
    if (k === "sea" || k === "shallows") return -0.6
    return 0.35 + L * LEVEL_STEP
  }
  const roadLike = (i: number) => {
    const u = useOf(z, i)
    return u === "road" || u === "bridge" || u === "square"
  }
  /** The side (0–5) toward the nearest street, else toward the place's heart, else south. */
  const facing = (i: number): number => {
    const nb = g.neighbours(i)
    for (let d = 0; d < 6; d++) if (nb[d]! >= 0 && roadLike(nb[d]!)) return d
    return 4
  }
  const rotOf = (d: number) => {
    const a = (Math.PI / 180) * (60 * d)
    return Math.atan2(Math.cos(a), -Math.sin(a))
  }
  const steps = (a: number, b: number) => {
    const dq = g.q[a]! - g.q[b]!
    const dr = g.r[a]! - g.r[b]!
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
  }
  /** A KayKit hex building in another of its four colours, by the tile. */
  const recolour = (piece: string, i: number): string => {
    const m = /^(kaykit-hexagon\/building-.+)-(red|blue|green|yellow)$/.exec(piece)
    if (!m) return piece
    return `${m[1]}-${COLOURS[Math.floor(hash2(seed + 41, g.q[i]!, g.r[i]!) * COLOURS.length) % COLOURS.length]}`
  }
  // which tiles each road tile joins: consecutive tiles along every road
  const links = new Map<number, Set<number>>()
  const link = (a: number, b: number) => {
    if (!links.has(a)) links.set(a, new Set())
    links.get(a)!.add(b)
  }
  for (const r of z.roads)
    for (let k = 1; k < r.tiles.length; k++) {
      link(r.tiles[k - 1]!, r.tiles[k]!)
      link(r.tiles[k]!, r.tiles[k - 1]!)
    }
  const byTile = new Map<number, number>()
  for (let i = 0; i < g.size; i++) {
    const k = kindOf(h, i)
    if (k === "sea") continue
    const [x, zz] = at(i)
    const t = top(i)
    const u = useOf(z, i)
    const zone = z.zoneOf[i] ? z.zones[z.zoneOf[i]! - 1] : undefined
    let ground: HexWorldTile["ground"] = "grass"
    if (k === "shallows") ground = "water"
    else if (k === "lake" || k === "river") ground = "water"
    else if (k === "sand") ground = "sand"
    else if (k === "rock") ground = "rock"
    else if (k === "cliff") ground = "cliff"
    let prefab: string | null = null
    let rot = rotOf(Math.floor(hash2(seed + 3, g.q[i]!, g.r[i]!) * 6))
    const pick = (list: string[]) =>
      list[Math.floor(hash2(seed + 5, g.q[i]!, g.r[i]!) * list.length) % list.length]!
    if (u === "building") {
      if (zone?.kind === "town") {
        const d = steps(i, zone.tile)
        const byWater = [...g.neighbours(i)].some(
          (j) => j >= 0 && (kindOf(h, j) === "river" || kindOf(h, j) === "lake"),
        )
        prefab = pick(d <= 3 ? TOWN_HEART : byWater ? TOWN_WATER : TOWN_EDGE)
      } else prefab = pick(BUILDS[zone?.kind ?? "town"] ?? BUILDS.town!)
      rot = rotOf(facing(i))
    } else if (u === "landmark") prefab = "castle"
    else if (u === "square") {
      prefab = HEART[zone?.kind ?? "town"] ?? "well-square"
      ground = "paved"
      // a square streets meet on: paved through, the well standing in a corner no street runs to
      const nb = g.neighbours(i)
      const sides = [0, 1, 2, 3, 4, 5].filter((d) => nb[d]! >= 0 && (links.get(i)?.has(nb[d]!) ?? false))
      if (prefab === "well-square" && sides.length >= 2) {
        prefab = null
        paths.push(...tilePath([x, zz], t + 0.03, sides, 1.1))
        const free = [0, 1, 2, 3, 4, 5].filter((d) => !sides.includes(d))
        // the free side furthest from every street: the middle of the widest gap
        const d = free.length ? free[Math.floor(free.length / 2)]! : 0
        const a = (Math.PI / 180) * (60 * d)
        const e = HEX_TILE_SIZE * 0.55
        pieces.push(
          {
            piece: recolour("kaykit-hexagon/building-well-yellow", i),
            x: x + Math.cos(a) * e,
            y: t,
            z: zz - Math.sin(a) * e,
            rot: rotOf((d + 3) % 6),
            scale: 0.32,
          },
          {
            piece: "kaykit-halloween/post-lantern",
            x: x + Math.cos(a + 0.9) * e,
            y: t,
            z: zz - Math.sin(a + 0.9) * e,
            rot: 0,
            scale: 0.55,
          },
        )
      }
    } else if (u === "road" || u === "bridge") {
      const nb = g.neighbours(i)
      // a path only toward the tiles its own roads run on to: no web where two roads lie side by side
      const sides = [0, 1, 2, 3, 4, 5].filter((d) => nb[d]! >= 0 && (links.get(i)?.has(nb[d]!) ?? false))
      if (u === "road") paths.push(...tilePath([x, zz], t + 0.03, sides.length ? sides : [0, 3]))
      else {
        // a wooden bridge: a plank deck from the centre out through each side its road crosses, at the banks'
        // height, so it meets the road strips on both banks exactly; rails along both sides of each leg
        let bank = 0
        let n = 0
        for (const d of sides) {
          const j = nb[d]!
          if (j >= 0) {
            bank += top(j)
            n++
          }
        }
        bank = n ? bank / n : t + 0.4
        const legs = sides.length ? sides : [0, 3]
        decks.push(...tilePath([x, zz], bank + 0.08, legs, 0.95))
        for (const d of legs) {
          const a = (Math.PI / 180) * (60 * d)
          const ux = Math.cos(a)
          const uz = -Math.sin(a)
          for (const side of [-1, 1])
            for (const f of [0.35, 0.75])
              pieces.push({
                piece: "kenney-nature/fence-simple",
                x: x + ux * HEX_TILE_SIZE * f * 0.87 - uz * side * 1.05,
                y: bank + 0.08,
                z: zz + uz * HEX_TILE_SIZE * f * 0.87 + ux * side * 1.05,
                rot: Math.atan2(ux, uz) + Math.PI / 2,
                scale: 0.32,
              })
        }
      }
    } else if (u === "dock") prefab = "dock"
    else if (BY_USE[u]) {
      prefab = BY_USE[u]!
      if (prefab === "farmstead" || prefab === "market" || prefab === "windmill") rot = rotOf(facing(i))
    } else if (k === "forest") prefab = "woods"
    else if (k === "rock") prefab = "rocky"
    else if (k === "sand") prefab = "beach"
    else if (k === "lake" && hash2(seed + 7, g.q[i]!, g.r[i]!) < 0.15) prefab = null
    if (prefab === "dock" || prefab === "field") ground = prefab === "dock" ? "water" : "soil"
    const p = prefab ? tilePrefab(prefab) : undefined
    if (p) {
      if (p.ground === "dirt" || p.ground === "paved") ground = p.ground
      // a prefab's own pieces, minus those that would float on water tiles it was not made for
      for (const q of placeTile(p, [x, zz], prefab === "dock" ? 0.1 : t, rot, i))
        pieces.push({ ...q, piece: recolour(q.piece, i) })
      prefabs[prefab!] = (prefabs[prefab!] ?? 0) + 1
    }
    byTile.set(i, tiles.length)
    tiles.push({ i, x, z: zz, top: k === "shallows" ? -0.4 : t, ground, prefab })
  }
  const heightAt = (x: number, zz: number): number => {
    // pixel → axial (pointy top), cube rounding
    const qf = ((Math.sqrt(3) / 3) * x - zz / 3) / R
    const rf = ((2 / 3) * zz) / R
    const sf = -qf - rf
    let q = Math.round(qf)
    let r = Math.round(rf)
    const s = Math.round(sf)
    const dq = Math.abs(q - qf)
    const dr = Math.abs(r - rf)
    const ds = Math.abs(s - sf)
    if (dq > dr && dq > ds) q = -r - s
    else if (dr > ds) r = -q - s
    const i = g.index(q, r)
    const k = i >= 0 ? byTile.get(i) : undefined
    return k === undefined ? 0 : Math.max(0, tiles[k]!.top)
  }
  return {
    tiles,
    pieces,
    paths,
    decks,
    heightAt,
    stats: { tiles: tiles.length, pieces: pieces.length, prefabs },
  }
}
