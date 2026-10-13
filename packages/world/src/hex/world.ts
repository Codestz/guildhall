/**
 * The hex island built: every tile of the map (hexIsland + hexZones) turned into what stands on it, the
 * tile prefab its job and its place ask for, facing the nearest street, at its height. Pure data: the
 * ground prisms, the path strips, the water tiles and the pieces, for the 3D screen to draw.
 */
import { hash2 } from "../geom/noise.ts"
import { fitToTiles, walkwayAt } from "./collide.ts"
import { hexCentre } from "./grid.ts"
import { seatTiles } from "./ground.ts"
import { type HexIsland, kindOf } from "./island.ts"
import {
  BUILDING_REACH,
  growNature,
  type HexNature,
  isBuildingPiece,
  isDefaultNature,
  natureOdds,
} from "./nature.ts"
import { bodyRadius, footprint, settlePieces } from "./sites.ts"
import {
  castleWalls,
  edgeDressing,
  HEX_TILE_SIZE,
  mirrorPrefab,
  mirrorSide,
  type PlacedPiece,
  placeTile,
  type TileGround,
  type TilePrefab,
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
  /** The prefab stands mirrored left for right (tiles.ts `mirrorPrefab`) to fit its footprint. */
  mirror?: boolean
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
  /** Decks a scene's own pieces build out over the water (a quay's stone deck): walked, not built here. */
  decks: HexWalkway[]
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
  town: ["market-square", "town-hall-plaza", "tavern-garden", "smithy-works"],
  market: ["tavern-garden"],
  harbour: ["harbour-quay", "tavern-garden"],
  camp: ["archery-range"],
  mine: ["smithy-works"],
  monastery: ["monastery-compound"],
  farm: ["farmstead-yard"],
}
/** How a scene may fit beyond the plain rule (`claimable`: its place's open ground or the open country). */
interface SceneFit {
  /** Its footprint is the shallows off the coast (a quay over the sea), from a tile at sea level. */
  sea?: boolean
  /** Country uses it may also cover. */
  country?: TileUse[]
  /** Country uses it leaves alone (a farm's fields stay fields round it). */
  spare?: TileUse[]
  /** It takes in its own place's other buildings (a monastery's chapel and graveyard become its compound). */
  absorb?: boolean
  /** It clears its own place's houses for its ground (the town's market square, where the town has no open ground left). */
  clear?: boolean
  /** It may turn to any street its tile fronts, and be mirrored, to fit. */
  turn?: boolean
  /** Which of its place's buildings it tries first (default: nearest the heart). */
  near?: "ring"
}
const SCENE_FIT: Partial<Record<string, SceneFit>> = {
  "harbour-quay": { sea: true, turn: true },
  "monastery-compound": { country: ["hillside", "woods"], absorb: true, turn: true },
  "farmstead-yard": { spare: ["field"], turn: true },
  // on the ring street round the town's square, the hall facing its plaza
  "town-hall-plaza": { turn: true, near: "ring" },
  "market-square": { clear: true },
}
/** Steps from a town's square out to its ring street (zones.ts). */
const RING_STEPS = 3
/** Drinking places: no two stand within DRINK_APART steps of each other (the next kind is picked instead). */
const DRINKS = new Set(["tavern", "tavern-yard", "tavern-garden"])
const DRINK_APART = 2
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
  /** Whether a building tile fronts a street it has a door onto (walk.ts: a step up or down at most). */
  const onStreet = (i: number): boolean => {
    const nb = g.neighbours(i)
    for (let d = 0; d < 6; d++)
      if (nb[d]! >= 0 && roadLike(nb[d]!)) return Math.abs(h.level[nb[d]!]! - h.level[i]!) <= 1
    return false
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
  const decks: HexWalkway[] = []
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
  /** Whether the ground at a point is dry land at a building's base `y` or above (not water, not a step down). */
  const floorAt = (px: number, pz: number, y: number): boolean => {
    const j = tileAt(px, pz)
    if (j < 0) return false
    const k = kindOf(h, j)
    if (k === "sea" || k === "shallows" || k === "lake" || k === "river") return false
    return top(j) >= y - 0.05
  }
  /** Whether every solid piece of `prefab` on tile i, its front turned to side `door`, stands on its floor. */
  const standsOn = (prefab: TilePrefab, i: number, door: number): boolean =>
    placeTile(prefab, at(i), top(i), rotOf(door), i, true, odds).every((q) =>
      (footprint(q) ?? []).every(([px, pz]) => floorAt(px, pz, top(i))),
    )
  /** The sides a building on tile i can have its door on: toward a street a step up or down at most. */
  const streetSides = (i: number): number[] => {
    const nb = g.neighbours(i)
    return [0, 1, 2, 3, 4, 5].filter(
      (d) => nb[d]! >= 0 && roadLike(nb[d]!) && Math.abs(h.level[nb[d]!]! - h.level[i]!) <= 1,
    )
  }
  /** The door side for `prefab` on building tile i: the first street side it stands on its floor facing, else the first street side. */
  const doorFor = (prefab: string, i: number): number => {
    const p = tilePrefab(prefab)
    if (p) for (const d of streetSides(i)) if (standsOn(p, i, d)) return d
    return facing(i)
  }
  const dryLand = (i: number) => {
    const k = kindOf(h, i)
    return k !== "sea" && k !== "shallows" && k !== "lake" && k !== "river" && k !== "rock" && k !== "cliff"
  }
  const zoneAt = (i: number) => (z.zoneOf[i] ? z.zones[z.zoneOf[i]! - 1] : undefined)
  /** What a building tile builds: by district in the town, by the place's kind elsewhere. */
  // ---- drinking places (a tavern, a canteen with its garden) keep DRINK_APART steps from each other:
  // every tile one stands on, a scene's footprint included ----
  const drinks: number[] = []
  const nearDrink = (tiles: readonly number[], self = -1) =>
    drinks.some((d) => d !== self && tiles.some((t) => steps(t, d) <= DRINK_APART))
  const built = new Map<number, string>()
  /** Places whose compound scene landed (a monastery's): their heart is a plain square, no second chapel. */
  const compound = new Set<number>()
  const buildOf = (i: number): string => {
    const have = built.get(i)
    if (have) return have
    const zone = zoneAt(i)
    const byWater = [...g.neighbours(i)].some(
      (j) => j >= 0 && (kindOf(h, j) === "river" || kindOf(h, j) === "lake"),
    )
    const list =
      zone?.kind !== "town"
        ? (BUILDS[zone?.kind ?? "town"] ?? BUILDS.town!)
        : steps(i, zone.tile) <= 3
          ? TOWN_HEART
          : byWater
            ? TOWN_WATER
            : TOWN_EDGE
    const at = Math.floor(hash2(seed + 5, g.q[i]!, g.r[i]!) * list.length) % list.length
    let kind = list[at]!
    // a place whose own compound stands already builds no second chapel or graveyard: a cottage
    if (zone && compound.has(z.zoneOf[i]! - 1) && (kind === "monastery" || kind === "graveyard"))
      kind = "cottage"
    // a second drinking place too near the first: the next kind on the list that is not one
    if (DRINKS.has(kind) && nearDrink([i]))
      for (let k = 1; k < list.length && DRINKS.has(kind); k++) kind = list[(at + k) % list.length]!
    if (DRINKS.has(kind)) {
      if (nearDrink([i])) kind = "house"
      else drinks.push(i)
    }
    built.set(i, kind)
    return kind
  }
  // ---- scenes bigger than a tile: each claims the neighbours across its footprint's sides, when they
  // are free open ground on its own level (never a road, water or another building), else it stays
  // its one-tile self ----
  const scenes = new Map<number, string>()
  const claimedBy = new Map<number, number>()
  const claimable = (i: number, j: number, fit: SceneFit = {}) => {
    if (j < 0 || claimedBy.has(j) || scenes.has(j)) return false
    const u = useOf(z, j)
    if (fit.sea) return kindOf(h, j) === "shallows" && (u === "none" || u === "dock")
    if (!dryLand(j) || h.level[j] !== h.level[i]) return false
    if (z.zoneOf[j] === 0)
      return (OPEN_COUNTRY.has(u) || !!fit.country?.includes(u)) && !fit.spare?.includes(u)
    if (z.zoneOf[j] !== z.zoneOf[i] || zoneAt(j)!.kind === "castle") return false
    return OPEN_IN_PLACE.has(u) || ((!!fit.absorb || !!fit.clear) && u === "building")
  }
  /** The street sides a building may turn to: its first (where it faces anyway), then the others a door reaches. */
  const streets = (i: number): number[] => {
    const nb = g.neighbours(i)
    const out = [facing(i)]
    for (let d = 0; d < 6; d++)
      if (
        !out.includes(d) &&
        nb[d]! >= 0 &&
        roadLike(nb[d]!) &&
        Math.abs(h.level[nb[d]!]! - h.level[i]!) <= 1
      )
        out.push(d)
    return out
  }
  /** A scene's turn when it is not its tile's own: the street it faces and whether it is mirrored. */
  const turned = new Map<number, { door: number; mirror: boolean }>()
  /** A quay's place's dock tiles: left open water. */
  const quayed = new Set<number>()
  /** The castle's reserved ground outside its walls (island.ts sites): open, nothing grows on it. */
  const grounds = new Set(h.sites.castle.filter((i) => z.zones[z.zoneOf[i]! - 1]?.kind !== "castle"))
  /** Puts `scene` on building tile i if its footprint fits there (with `street`, only on one fronting a street). */
  const claim = (i: number, scene: string, street = false): boolean => {
    const p = tilePrefab(scene)
    if (!p?.footprint?.length || !tilePrefab(SCENE_PART) || scenes.has(i) || claimedBy.has(i)) return false
    const nb = g.neighbours(i)
    if (street && !onStreet(i)) return false
    const fit = SCENE_FIT[scene] ?? {}
    if (fit.sea && h.level[i] !== 0) return false
    // the side the building turns to (walk.ts puts its door there too); a scene that may turn tries
    // every street it fronts, as authored and mirrored
    for (const door of streets(i))
      for (const mirror of [false, true]) {
        const cover = p.footprint.map((k) => nb[worldSide(mirror ? mirrorSide(k) : k, door)]!)
        if (!cover.every((j) => claimable(i, j, fit))) continue
        const drink = DRINKS.has(scene)
        if (drink && nearDrink([i, ...cover], i)) return false
        // every building of it on its floor (sites.ts): dry ground at its level
        if (!standsOn(mirror ? mirrorPrefab(p) : p, i, door)) continue
        scenes.set(i, scene)
        for (const j of cover) claimedBy.set(j, i)
        if (drink) drinks.push(i, ...cover)
        if (door !== facing(i) || mirror) turned.set(i, { door, mirror })
        if (fit.absorb && z.zoneOf[i]) compound.add(z.zoneOf[i]! - 1)
        // the place's docks give way to its quay: open water round its boats, its fishers on its stone
        if (fit.sea)
          for (const j of [...cover, ...(zoneAt(i)?.tiles ?? [])])
            for (const k of g.neighbours(j)) if (k >= 0 && useOf(z, k) === "dock") quayed.add(k)
        return true
      }
    return false
  }
  const buildings = (zi: number, near?: SceneFit["near"]) => {
    const zone = z.zones[zi]!
    const d = (i: number) =>
      near === "ring" ? Math.abs(steps(i, zone.tile) - RING_STEPS) : steps(i, zone.tile)
    return zone.tiles.filter((i) => useOf(z, i) === "building").sort((a, b) => d(a) - d(b) || a - b)
  }
  /** A building a short lane reaches: a street within two steps, over open ground on its level. */
  const byLane = (i: number) =>
    [...g.neighbours(i)].some(
      (j) =>
        j >= 0 &&
        useOf(z, j) !== "building" &&
        dryLand(j) &&
        Math.abs(h.level[j]! - h.level[i]!) <= 1 &&
        [...g.neighbours(j)].some((k) => k >= 0 && roadLike(k)),
    )
  // each place's own scenes first, on the building nearest its heart they fit beside: one with a door
  // onto a street people come in by first, else one a lane reaches (life.ts workTiles)
  for (const [zi, zone] of z.zones.entries())
    for (const scene of PLACE_SCENES[zone.kind] ?? []) {
      const near = SCENE_FIT[scene]?.near
      buildings(zi, near).some((i) => claim(i, scene, true)) ||
        buildings(zi, near).some((i) => byLane(i) && claim(i, scene))
    }
  // then every other tavern, smithy and archery range the tiles picked, where there is room
  for (let i = 0; i < g.size; i++) {
    if (useOf(z, i) !== "building" || scenes.has(i)) continue
    const scene = SCENES[buildOf(i)]
    if (scene && (onStreet(i) || byLane(i))) claim(i, scene)
  }
  /** The first of `ids` the castle's tier has (a castle piece's `tier`: the first tier that uses it). */
  const atTier = (...ids: string[]): string | null =>
    ids.find((id) => {
      const p = tilePrefab(id)
      return p !== undefined && (p.tier ?? 1) <= tier
    }) ?? null

  /** The buildings standing so far, by tile: their bodies (sites.ts bodyRadius). */
  const standing = new Map<number, [number, number, number][]>()
  const bodies = {
    near(px: number, pz: number) {
      const own = tileAt(px, pz)
      if (own < 0) return []
      return [own, ...g.neighbours(own)].flatMap((j) => (j >= 0 ? (standing.get(j) ?? []) : []))
    },
    add(px: number, pz: number, r: number) {
      const own = tileAt(px, pz)
      if (own < 0 || r <= 0) return
      if (!standing.has(own)) standing.set(own, [])
      standing.get(own)!.push([px, pz, r])
    },
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
    let pathSides: number[] | undefined
    let door: number | undefined
    let mirror = false
    let rot = rotOf(Math.floor(hash2(seed + 3, g.q[i]!, g.r[i]!) * 6))
    const origin = claimedBy.get(i)
    if (origin !== undefined) {
      // under a neighbour's scene: its ground, nothing of its own
      prefab = SCENE_PART
      const p = tilePrefab(scenes.get(origin)!)!
      if ((p.ground === "dirt" || p.ground === "paved") && dryLand(i)) ground = p.ground
    } else if (zone?.kind === "castle" && z.castle) {
      // the Guildhall, as composed for its site (sites.ts composeCastle): each tile its role, the doors
      // onto the paved ways, the curtain wall round the yard with its gatehouse where the road comes in
      const plan = z.castle
      const role = plan.role.get(i)
      const d = plan.door.get(i)
      const nb = g.neighbours(i)
      if (d !== undefined) {
        door = d
        rot = rotOf(d)
      } else {
        const toHeart = nb.indexOf(plan.heart)
        if (toHeart >= 0) rot = rotOf(toHeart)
      }
      ground = "paved"
      if (role === "keep") prefab = "castle"
      else if (role === "hall") prefab = atTier("great-hall", "castle-ward")
      else if (role === "tower") prefab = atTier("castle-tower", "castle-ward")
      else if (role === "barracks") prefab = "barracks"
      else if (role === "yard") prefab = atTier("castle-ward", "castle-yard")
      else {
        // a court: paved through along its ways (and out of the gate)
        const sides = [0, 1, 2, 3, 4, 5].filter((e) => nb[e]! >= 0 && (links.get(i)?.has(nb[e]!) ?? false))
        if (sides.length) {
          paths.push(...tilePath([x, zz], t + 0.07, sides, 1.1))
          pathSides = sides
        }
      }
      const sides = plan.walls.get(i)
      if (sides && tier >= 2) {
        const gate = i === plan.gate && sides.includes(plan.gateSide) ? [plan.gateSide] : []
        const colour = recolour("kaykit-hexagon/building-castle-blue", zone.tile).split("-").pop()!
        pieces.push(
          ...castleWalls(
            [x, zz],
            t,
            sides.filter((e) => !gate.includes(e)),
            gate,
            colour,
          ),
        )
      }
    } else if (u === "building") {
      prefab = scenes.get(i) ?? buildOf(i)
      const turn = turned.get(i)
      door = turn?.door ?? (scenes.has(i) ? facing(i) : doorFor(prefab, i))
      rot = rotOf(door)
      if (turn?.mirror) mirror = true
    } else if (zone?.kind === "harbour" && (u === "yard" || u === "garden" || u === "well" || u === "market"))
      prefab = "quay"
    else if (u === "square") {
      prefab = (compound.has(z.zoneOf[i]! - 1) ? null : HEART[zone?.kind ?? "town"]) ?? "well-square"
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
          // (a road that must climb three levels at once, zones.ts, gets a longer flight)
          const run = Math.min(e * (drop > 2 * STEP + 0.01 ? 0.95 : 0.8), drop * 1.35)
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
    } else if (u === "dock" && !quayed.has(i)) {
      prefab = "dock"
      // the pier runs out from the shore: its land end toward the dry tile beside it, a harbour's first
      const nb = g.neighbours(i)
      const dry = (j: number) => j >= 0 && kindOf(h, j) !== "shallows" && kindOf(h, j) !== "sea"
      let d = [0, 1, 2, 3, 4, 5].find((e) => dry(nb[e]!) && z.zoneOf[nb[e]!]! > 0)
      if (d === undefined) d = [0, 1, 2, 3, 4, 5].find((e) => dry(nb[e]!))
      rot = rotOf(d ?? 4)
    } else if (grounds.has(i) && u === "meadow") {
      // the castle's ground its next tiers take: kept open, its approach clear
      prefab = null
    } else if (BY_USE[u] && !quayed.has(i)) {
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
    const authored = prefab ? tilePrefab(prefab) : undefined
    const p = authored && mirror ? mirrorPrefab(authored) : authored
    if (p) {
      if (p.ground === "dirt" || p.ground === "paved") ground = p.ground
      // a prefab's own pieces, minus those that would float on water tiles it was not made for
      // a castle's tiles all take its keep's colour
      const hue = zone?.kind === "castle" ? zone.tile : i
      const placed = placeTile(p, [x, zz], prefab === "dock" ? SEA_TOP : t, rot, i, true, odds)
      // every building on its floor: dry ground at its own level, clear of the buildings beside it
      if (prefab !== "dock") settlePieces(placed, [x, zz], (px, pz) => floorAt(px, pz, t), bodies)
      for (const q of placed) pieces.push({ ...q, piece: recolour(q.piece, hue) })
      prefabs[prefab!] = (prefabs[prefab!] ?? 0) + 1
      // a quay's deck out over the water: walked at the tile's top, like a bridge's
      const cr = Math.cos(rot)
      const sr = Math.sin(rot)
      const out = (px: number, pz: number): [number, number] => [
        x + px * cr + pz * sr,
        zz - px * sr + pz * cr,
      ]
      for (const d of p.decks ?? []) {
        const [ax, az] = out(d.ax, d.az)
        const [bx, bz] = out(d.bx, d.bz)
        decks.push({ kind: "deck", ax, az, ay: t, bx, bz, by: t, half: d.half })
      }
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
      ...(mirror ? { mirror } : {}),
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
        zoneAt(t.i)?.kind === "castle" ||
        grounds.has(t.i)
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
  // every wall and tower on its own tile's seat too: none reaches over a step, water or the shore
  const seats = seatTiles(h, { tiles, pieces })
  const topOf = (i: number) => tiles[byTile.get(i)!]!.top
  fitToTiles(
    pieces,
    {
      R,
      tileAt: (x, zz) => {
        const i = tileAt(x, zz)
        return i >= 0 && byTile.has(i) ? i : -1
      },
      centre: (i) => {
        const t = tiles[byTile.get(i)!]!
        return [t.x, t.z]
      },
      neighbour: (i, d) => g.neighbours(i)[d]!,
      shares: (i, j) => seats.has(j) && byTile.has(j) && Math.abs(topOf(j) - topOf(i)) <= 0.05,
    },
    // a building the site settled (sites.ts settlePieces) already stands on its floor, clear of its
    // neighbours: what is left is the rest (walls, towers, hedges, a scene's pieces)
    () => true,
    (p) => {
      const r = bodyRadius(p)
      if (!r) return true
      return pieces.every((o) => {
        if (o === p) return true
        const ro = bodyRadius(o)
        return !ro || Math.hypot(o.x - p.x, o.z - p.z) >= r + ro - 0.05
      })
    },
  )
  const heightAt = (x: number, zz: number): number => {
    const i = tileAt(x, zz)
    const k = i >= 0 ? byTile.get(i) : undefined
    return k === undefined ? 0 : Math.max(0, tiles[k]!.top)
  }
  const walkways = [...stairs, ...bridges.flatMap((b) => b.legs), ...decks]
  const grown = nature ? growNatureOn(nature) : undefined
  return {
    tiles,
    pieces,
    paths,
    stairs,
    bridges,
    decks,
    step: STEP,
    heightAt,
    stairAt(px: number, pz: number) {
      // the tread a foot stands on (collide.ts: the numbers structures.ts builds the steps from)
      for (const st of walkways) {
        const y = walkwayAt(st, px, pz)
        if (y !== null) return y
      }
      return null
    },
    stats: { tiles: tiles.length, pieces: pieces.length, prefabs, ...(grown ? { nature: grown } : {}) },
  }
}
