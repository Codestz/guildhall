/**
 * The hex island built: every tile of the map (hexIsland + hexZones) turned into what stands on it, the
 * tile prefab its job and its place ask for, facing the nearest street, at its height. Pure data: the
 * ground prisms, the path strips, the water tiles and the pieces, for the 3D screen to draw.
 */
import { hash2 } from "../geom/noise.ts"
import { hexCentre } from "./grid.ts"
import { type HexIsland, kindOf } from "./island.ts"
import {
  BUILDING_REACH,
  growNature,
  type HexNature,
  isBuildingPiece,
  isDefaultNature,
  natureOdds,
} from "./nature.ts"
import {
  castleWalls,
  edgeDressing,
  HEX_TILE_SIZE,
  type PlacedPiece,
  placeTile,
  type TileGround,
  tilePath,
  tilePrefab,
  worldSide,
} from "./tiles.ts"
import { castleTier, type HexZones, type TileUse, useOf } from "./zones.ts"

/** Metres per height level (the default; `hexWorld(h, z, { step })` tries others). */
export const LEVEL_STEP = 0.8

/** A bridge deck's (and the walk graph's bridge node's) lift over its banks' road. */
const DECK_LIFT = 0.08

/**
 * A straight walkway a walker climbs or crosses off the ground: a flight of road stairs or a leg of a
 * bridge deck, from (ax, az) at height ay to (bx, bz) at by, `half` metres either side of its line.
 */
export interface HexWalkway {
  kind: "stairs" | "deck"
  ax: number
  az: number
  ay: number
  bx: number
  bz: number
  by: number
  half: number
  /** Stairs only: how many steps the flight has. */
  steps?: number
}

/** A bridge over one river tile: its deck legs (centre to bank) and the river bed its posts stand in. */
export interface HexBridge {
  tile: number
  legs: HexWalkway[]
  /** The bed under the deck (posts reach down to it). */
  bed: number
}

/** The top of a shallows tile's bed, where a dock's posts stand. */
const SEA_TOP = -0.4

export interface HexWorldTile {
  i: number
  x: number
  z: number
  /** Top of the ground, metres. */
  top: number
  ground: TileGround | "cliff" | "shore"
  prefab: string | null
  /** Sides (0–5) a path strip runs out through (roads and squares). */
  paths?: number[]
  /** The side (0–5) a building's door faces. */
  door?: number
  /** The prefab's turn about +y, radians (placeTile's `rot`): its spots and blockers turn with it. */
  rot: number
}

export interface HexWorld {
  tiles: HexWorldTile[]
  pieces: PlacedPiece[]
  /** Path strips (triangle positions) over road tiles. */
  paths: number[]
  /** Road stairs where a road steps down a level: built as ground (ground.ts `hexStructures`). */
  stairs: HexWalkway[]
  /** Bridges over the rivers: built as ground (ground.ts `hexStructures`). */
  bridges: HexBridge[]
  /** Metres per height level this world was built with. */
  step: number
  /** The island's ground height at a point (the top of the tile under it; 0 off the island). */
  heightAt(x: number, z: number): number
  /** A walker's height on a road step's stairs or a bridge's deck at (x, z), or null off them. */
  stairAt(x: number, z: number): number | null
  stats: {
    tiles: number
    pieces: number
    prefabs: Record<string, number>
    /** With `nature` knobs: the nature pieces grown, and those held back from a road or a building. */
    nature?: { grown: number; held: number }
  }
}

/** What a building tile of each place builds (picked by the tile's hash). */
const BUILDS: Record<string, string[]> = {
  town: ["house", "townhouse", "cottage", "house", "townhouse", "tavern", "smithy", "market"],
  harbour: ["storehouse", "house", "warehouse", "cottage", "tavern", "boathouse"],
  castle: ["castle-ward", "castle-yard", "barracks"],
  farm: ["farmstead", "cottage"],
  fishing: ["cottage", "cottage", "house"],
  mine: ["cottage", "smithy", "warehouse", "homestead", "house"],
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

/**
 * The scene a tile's prefab grows into when the tiles its footprint covers are free (decisions.md
 * "Prefabs are composed scenes"): a canteen with its beer garden, a smithy with its working yard, the
 * camp's archery range with its butts, the town's market square (one per town).
 */
const SCENES: Record<string, string> = {
  tavern: "tavern-garden",
  smithy: "smithy-works",
  archery: "archery-range",
}
/** The scenes each kind of place has once, wherever a building of it has room for one. */
const PLACE_SCENES: Partial<Record<string, string[]>> = {
  town: ["market-square", "tavern-garden", "smithy-works"],
  market: ["tavern-garden"],
  harbour: ["tavern-garden"],
  camp: ["archery-range"],
  mine: ["smithy-works"],
}
/** The prefab a tile a neighbour's scene covers takes: nothing of its own, no spots, no blockers. */
const SCENE_PART = "scene-part"
/** What a scene may spread over: its own place's open ground, or the open country. */
const OPEN_IN_PLACE = new Set<TileUse>(["yard", "garden", "well", "market"])
const OPEN_COUNTRY = new Set<TileUse>(["meadow", "grove", "pasture", "orchard", "field"])

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

/**
 * `agents` (default 3) is how many agents the guild has: with the repo's files it sets the Guildhall's
 * tier (`castleTier`; give hexZones the same count so its castle zone is that tier's size). `nature`
 * scales and thins the nature (nature.ts; give hexZones its `wild`): left out, today's island.
 */
export function hexWorld(
  h: HexIsland,
  z: HexZones,
  opts: { step?: number; agents?: number; nature?: HexNature } = {},
): HexWorld {
  const STEP = opts.step ?? LEVEL_STEP
  const tier = opts.agents === undefined ? z.tier : castleTier(h.spec.files, opts.agents)
  const g = h.grid
  const R = HEX_TILE_SIZE
  const tiles: HexWorldTile[] = []
  const pieces: HexWorld["pieces"] = []
  const paths: number[] = []
  const bridges: HexBridge[] = []
  const prefabs: Record<string, number> = {}
  const seed = h.spec.seed
  const nature = isDefaultNature(opts.nature) ? undefined : opts.nature
  const odds = natureOdds(nature)
  const at = (i: number): [number, number] => {
    const [x, y] = hexCentre({ q: g.q[i]!, r: g.r[i]! })
    return [x * R, y * R]
  }
  const top = (i: number) => {
    const k = kindOf(h, i)
    const L = Math.max(0, h.level[i]!)
    if (k === "lake" || k === "river") return 0.35 + L * STEP - 0.45
    if (k === "sea" || k === "shallows") return -0.6
    return 0.35 + L * STEP
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
  const stairs: HexWalkway[] = []
  /** A bridge tile's deck at its centre: its banks' road height, as the walk graph lays it (walk.ts). */
  const deckY = (i: number): number => {
    let bank = 0
    let n = 0
    for (const j of links.get(i) ?? []) {
      if (useOf(z, j) === "bridge") continue
      bank += Math.max(0, top(j))
      n++
    }
    return (n ? bank / n : Math.max(0, top(i)) + 0.4) + DECK_LIFT
  }
  const dryLand = (i: number) => {
    const k = kindOf(h, i)
    return k !== "sea" && k !== "shallows" && k !== "lake" && k !== "river" && k !== "rock" && k !== "cliff"
  }
  const zoneAt = (i: number) => (z.zoneOf[i] ? z.zones[z.zoneOf[i]! - 1] : undefined)
  /** What a building tile builds: by district in the town, by the place's kind elsewhere. */
  const buildOf = (i: number): string => {
    const zone = zoneAt(i)
    const pick = (list: string[]) =>
      list[Math.floor(hash2(seed + 5, g.q[i]!, g.r[i]!) * list.length) % list.length]!
    if (zone?.kind !== "town") return pick(BUILDS[zone?.kind ?? "town"] ?? BUILDS.town!)
    const byWater = [...g.neighbours(i)].some(
      (j) => j >= 0 && (kindOf(h, j) === "river" || kindOf(h, j) === "lake"),
    )
    return pick(steps(i, zone.tile) <= 3 ? TOWN_HEART : byWater ? TOWN_WATER : TOWN_EDGE)
  }
  // ---- scenes bigger than a tile: each claims the neighbours across its footprint's sides, when they
  // are free open ground on its own level (never a road, water or another building), else it stays
  // its one-tile self ----
  const scenes = new Map<number, string>()
  const claimedBy = new Map<number, number>()
  const claimable = (i: number, j: number) => {
    if (j < 0 || claimedBy.has(j) || scenes.has(j) || !dryLand(j) || h.level[j] !== h.level[i]) return false
    const u = useOf(z, j)
    return z.zoneOf[j] === 0
      ? OPEN_COUNTRY.has(u)
      : z.zoneOf[j] === z.zoneOf[i] && OPEN_IN_PLACE.has(u) && zoneAt(j)!.kind !== "castle"
  }
  /** Puts `scene` on building tile i if its footprint fits there. */
  const claim = (i: number, scene: string): boolean => {
    const p = tilePrefab(scene)
    if (!p?.footprint?.length || !tilePrefab(SCENE_PART) || scenes.has(i) || claimedBy.has(i)) return false
    const nb = g.neighbours(i)
    // the side the building turns to (walk.ts puts its door there too)
    const door = facing(i)
    const cover = p.footprint.map((k) => nb[worldSide(k, door)]!)
    if (!cover.every((j) => claimable(i, j))) return false
    scenes.set(i, scene)
    for (const j of cover) claimedBy.set(j, i)
    return true
  }
  const buildings = (zi: number) =>
    z.zones[zi]!.tiles.filter((i) => useOf(z, i) === "building").sort(
      (a, b) => steps(a, z.zones[zi]!.tile) - steps(b, z.zones[zi]!.tile) || a - b,
    )
  // each place's own scenes first, on the building nearest its heart they fit beside
  for (const [zi, zone] of z.zones.entries())
    for (const scene of PLACE_SCENES[zone.kind] ?? []) buildings(zi).some((i) => claim(i, scene))
  // then every other tavern, smithy and archery range the tiles picked, where there is room
  for (let i = 0; i < g.size; i++) {
    if (useOf(z, i) !== "building") continue
    const scene = SCENES[buildOf(i)]
    if (scene) claim(i, scene)
  }
  /** The first of `ids` the castle's tier has (a castle piece's `tier`: the first tier that uses it). */
  const atTier = (...ids: string[]): string | null =>
    ids.find((id) => {
      const p = tilePrefab(id)
      return p !== undefined && (p.tier ?? 1) <= tier
    }) ?? null

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
    let pathSides: number[] | undefined
    let door: number | undefined
    let rot = rotOf(Math.floor(hash2(seed + 3, g.q[i]!, g.r[i]!) * 6))
    const origin = claimedBy.get(i)
    if (origin !== undefined) {
      // under a neighbour's scene: its ground, nothing of its own
      prefab = SCENE_PART
      const p = tilePrefab(scenes.get(origin)!)!
      if (p.ground === "dirt" || p.ground === "paved") ground = p.ground
    } else if (u === "building") {
      prefab = scenes.get(i) ?? buildOf(i)
      door = facing(i)
      rot = rotOf(door)
    } else if (u === "landmark" && zone) {
      // the Guildhall: its keep on the castle's first tile, its great hall (tier 3 up) at its heart
      const nb = g.neighbours(i)
      if (i === zone.tiles[0]) {
        prefab = "castle"
        const d = nb.indexOf(zone.tile)
        if (d >= 0) rot = rotOf(d)
      } else {
        prefab = atTier("great-hall", "castle-yard", "castle-ward")
        // its door toward the road coming in, its back to the keep
        const d = [0, 1, 2, 3, 4, 5].find((e) => nb[e]! >= 0 && roadLike(nb[e]!))
        door = d ?? (nb.indexOf(zone.tiles[0]!) + 3) % 6
        rot = rotOf(door)
      }
    } else if (
      zone?.kind === "castle" &&
      (u === "yard" || u === "garden" || u === "well" || u === "market")
    ) {
      // the castle's other tiles: its bailey (tier 2), its wards (3), towers on the citadel's ring (4)
      const nb = g.neighbours(i)
      const out = [0, 1, 2, 3, 4, 5].filter((d) => nb[d]! < 0 || z.zoneOf[nb[d]!] !== z.zoneOf[i])
      const ring = out.length >= 2 && hash2(seed + 43, g.q[i]!, g.r[i]!) < 0.65
      prefab = ring
        ? atTier("castle-tower", "castle-ward", "castle-yard")
        : atTier("castle-ward", "castle-yard")
      const d = nb.indexOf(zone.tile)
      rot = rotOf(d >= 0 ? d : 4)
    } else if (zone?.kind === "harbour" && (u === "yard" || u === "garden" || u === "well" || u === "market"))
      prefab = "quay"
    else if (u === "square") {
      prefab = HEART[zone?.kind ?? "town"] ?? "well-square"
      ground = "paved"
      // a square streets meet on: paved through, the well standing in a corner no street runs to
      const nb = g.neighbours(i)
      const sides = [0, 1, 2, 3, 4, 5].filter((d) => nb[d]! >= 0 && (links.get(i)?.has(nb[d]!) ?? false))
      if (prefab === "well-square" && sides.length >= 2) {
        prefab = null
        paths.push(...tilePath([x, zz], t + 0.07, sides, 1.1))
        pathSides = sides
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
      const e = (HEX_TILE_SIZE * Math.sqrt(3)) / 2
      if (u === "road") {
        const legs = sides.length ? sides : [0, 3]
        paths.push(...tilePath([x, zz], t + 0.07, legs))
        pathSides = legs
        // stairs down every side where the road steps to a lower road tile: built into the ground from the
        // shared edge straight out along the lower tile's road strip (never across a hex edge), one stone
        // step per ~17 cm of drop, about 36° steep
        for (const d of sides) {
          const j = nb[d]!
          const drop = t - top(j)
          // a bridge's deck meets the bank's road at its own height: no stairs onto it
          if (drop < 0.3 || useOf(z, j) === "bridge") continue
          const a = (Math.PI / 180) * (60 * d)
          const ux = Math.cos(a)
          const uz = -Math.sin(a)
          const run = Math.min(e * 0.8, drop * 1.35)
          stairs.push({
            kind: "stairs",
            ax: x + ux * e,
            az: zz + uz * e,
            ay: t,
            bx: x + ux * (e + run),
            bz: zz + uz * (e + run),
            by: top(j),
            half: 0.95,
            steps: Math.max(2, Math.round(drop / 0.17)),
          })
        }
      } else {
        // a wooden bridge: a plank deck from the centre out through each side its road crosses, from bank to
        // bank (each leg runs a little onto its bank's road), sloping between the banks' heights; posts and
        // rails are built with it (ground.ts `hexStructures`)
        const legs = sides.length ? sides : [0, 3]
        const mid = deckY(i)
        const bridge: HexBridge = { tile: i, legs: [], bed: t - 0.6 }
        for (const d of legs) {
          const j = nb[d]!
          const a = (Math.PI / 180) * (60 * d)
          const ux = Math.cos(a)
          const uz = -Math.sin(a)
          const onto = j >= 0 && useOf(z, j) === "bridge"
          const reach = onto ? e : e + 0.45
          bridge.legs.push({
            kind: "deck",
            ax: x,
            az: zz,
            ay: mid,
            bx: x + ux * reach,
            bz: zz + uz * reach,
            by: onto ? (mid + deckY(j)) / 2 : j >= 0 ? Math.max(0, top(j)) + DECK_LIFT : mid,
            half: 1,
          })
        }
        bridges.push(bridge)
      }
    } else if (u === "dock") {
      prefab = "dock"
      // the pier runs out from the shore: its land end toward the dry tile beside it, a harbour's first
      const nb = g.neighbours(i)
      const dry = (j: number) => j >= 0 && kindOf(h, j) !== "shallows" && kindOf(h, j) !== "sea"
      let d = [0, 1, 2, 3, 4, 5].find((e) => dry(nb[e]!) && z.zoneOf[nb[e]!]! > 0)
      if (d === undefined) d = [0, 1, 2, 3, 4, 5].find((e) => dry(nb[e]!))
      rot = rotOf(d ?? 4)
    } else if (BY_USE[u]) {
      prefab = BY_USE[u]!
      if (prefab === "farmstead" || prefab === "market" || prefab === "windmill") {
        door = facing(i)
        rot = rotOf(door)
      }
    } else if (k === "forest") prefab = "woods"
    else if (k === "rock") prefab = "rocky"
    else if (k === "sand") prefab = "beach"
    else if (k === "lake" && hash2(seed + 7, g.q[i]!, g.r[i]!) < 0.15) prefab = null
    if (prefab === "dock" || prefab === "field") ground = prefab === "dock" ? "water" : "soil"
    const p = prefab ? tilePrefab(prefab) : undefined
    if (p) {
      if (p.ground === "dirt" || p.ground === "paved") ground = p.ground
      // a prefab's own pieces, minus those that would float on water tiles it was not made for
      // a castle's tiles all take its keep's colour
      const hue = zone?.kind === "castle" ? zone.tile : i
      for (const q of placeTile(p, [x, zz], prefab === "dock" ? SEA_TOP : t, rot, i, true, odds))
        pieces.push({ ...q, piece: recolour(q.piece, hue) })
      prefabs[prefab!] = (prefabs[prefab!] ?? 0) + 1
    }
    if (
      ground !== "water" &&
      u !== "road" &&
      u !== "bridge" &&
      u !== "square" &&
      u !== "building" &&
      !zone &&
      origin === undefined
    ) {
      // reeds along a river's or lake's banks, fallen rocks at the foot of a high step
      const nb = g.neighbours(i)
      const wet = (j: number) => j >= 0 && (kindOf(h, j) === "river" || kindOf(h, j) === "lake")
      const banks = [0, 1, 2, 3, 4, 5].filter((d) => wet(nb[d]!))
      const feet = [0, 1, 2, 3, 4, 5].filter(
        (d) => nb[d]! >= 0 && !wet(nb[d]!) && h.level[nb[d]!]! - h.level[i]! >= 2,
      )
      if (banks.length || feet.length) pieces.push(...edgeDressing([x, zz], t, banks, feet, i))
    }
    if (zone?.kind === "castle" && tier >= 2) {
      // the curtain wall (a walled keep up): along every side that faces out of the castle, a gate where a road comes in: along every side that faces out of the castle, a gate where a road comes in
      const nb = g.neighbours(i)
      const out = [0, 1, 2, 3, 4, 5].filter((d) => nb[d]! < 0 || z.zoneOf[nb[d]!] !== z.zoneOf[i])
      const gates = out.filter((d) => nb[d]! >= 0 && roadLike(nb[d]!))
      const colour = recolour("kaykit-hexagon/building-castle-blue", zone.tile).split("-").pop()!
      pieces.push(
        ...castleWalls(
          [x, zz],
          t,
          out.filter((d) => !gates.includes(d)),
          gates,
          colour,
        ),
      )
      if (u === "road") ground = "paved"
    }
    byTile.set(i, tiles.length)
    tiles.push({
      i,
      x,
      z: zz,
      top: k === "shallows" ? -0.4 : t,
      ground,
      prefab,
      rot,
      ...(pathSides ? { paths: pathSides } : {}),
      ...(door !== undefined ? { door } : {}),
    })
  }
  /** The tile under a point (pixel → axial, pointy top, cube rounding), or -1 off the grid. */
  function tileAt(x: number, zz: number): number {
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
    return g.index(q, r)
  }
  /**
   * The nature knobs' sizes (nature.ts `growNature`): nothing grows into a road, a bridge, a square, a
   * building's tile, a castle tile, a dock or a scene's ground, nor into a building on its own tile,
   * further than it reaches at its authored size.
   */
  function growNatureOn(n: HexNature): { grown: number; held: number } {
    const hard = new Uint8Array(g.size)
    for (const t of tiles) {
      const u = useOf(z, t.i)
      if (
        u === "road" ||
        u === "bridge" ||
        u === "square" ||
        u === "building" ||
        u === "landmark" ||
        u === "dock" ||
        claimedBy.has(t.i) ||
        zoneAt(t.i)?.kind === "castle"
      )
        hard[t.i] = 1
    }
    const discs = new Map<number, [number, number, number][]>()
    for (const p of pieces) {
      if (!isBuildingPiece(p.piece)) continue
      const i = tileAt(p.x, p.z)
      if (i < 0) continue
      if (!discs.has(i)) discs.set(i, [])
      discs.get(i)!.push([p.x, p.z, BUILDING_REACH * p.scale])
    }
    return growNature(pieces, n, {
      hardNear(x, zz) {
        const own = tileAt(x, zz)
        if (own < 0) return { own: false, tiles: [] }
        // the tiles within two steps: a canopy at a tile's corner can reach the next ring's corner
        const near = new Set<number>()
        for (const j of g.neighbours(own)) {
          if (j < 0) continue
          near.add(j)
          for (const k of g.neighbours(j)) if (k >= 0 && k !== own) near.add(k)
        }
        return { own: hard[own] === 1, tiles: [...near].filter((j) => hard[j] === 1).map(at) }
      },
      buildingsNear(x, zz) {
        const own = tileAt(x, zz)
        if (own < 0) return []
        return [own, ...g.neighbours(own)].flatMap((j) => (j >= 0 ? (discs.get(j) ?? []) : []))
      },
    })
  }
  const heightAt = (x: number, zz: number): number => {
    const i = tileAt(x, zz)
    const k = i >= 0 ? byTile.get(i) : undefined
    return k === undefined ? 0 : Math.max(0, tiles[k]!.top)
  }
  const walkways = [...stairs, ...bridges.flatMap((b) => b.legs)]
  const grown = nature ? growNatureOn(nature) : undefined
  return {
    tiles,
    pieces,
    paths,
    stairs,
    bridges,
    step: STEP,
    heightAt,
    stairAt(px: number, pz: number) {
      for (const st of walkways) {
        const lx = st.bx - st.ax
        const lz = st.bz - st.az
        const len = Math.hypot(lx, lz)
        const dx = px - st.ax
        const dz = pz - st.az
        const along = (dx * lx + dz * lz) / len
        if (along < -0.05 || along > len + 0.05) continue
        if (Math.abs((dx * -lz + dz * lx) / len) > st.half + (st.kind === "stairs" ? 0.4 : 0.05)) continue
        const f = Math.min(1, Math.max(0, along / len))
        return st.ay + (st.by - st.ay) * f
      }
      return null
    },
    stats: { tiles: tiles.length, pieces: pieces.length, prefabs, ...(grown ? { nature: grown } : {}) },
  }
}
