/**
 * The hex island built: every tile of the map (hexIsland + hexZones) turned into what stands on it, the
 * tile prefab its job and its place ask for, facing the nearest street, at its height. Pure data: the
 * ground prisms, the path strips, the water tiles and the pieces, for the 3D screen to draw.
 */
import { hash2 } from "../geom/noise.ts"
import { boardPieces, type NoticeBoardPlace, noticeBoard } from "./board.ts"
import { COURT_THEMES, type CourtKind, type CourtTile, courtDressing } from "./castleyard.ts"
import { DOOR_HALF, DOOR_RUN } from "./checks.ts"
import {
  fitToTiles,
  flightSteps,
  pieceSolids,
  SolidGrid,
  solidDistance,
  solidKind,
  walkwayAt,
  walkwaySolids,
} from "./collide.ts"
import { type CurtainBody, curtainWall } from "./curtain.ts"
import { doorwayOf } from "./doorways.ts"
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
import { GRAZE, type Strip, StripGrid, stripIntrusion, tileStrips, wayStrip } from "./roads.ts"

/** The castle's curtain wall and its gate (tiles.ts `castleWalls`): laid clear of its ways as it is built. */
const CURTAIN = /^kaykit-hexagon\/(wall-|building-tower-base)/
/** How near a strip a building's footprint point may stand (its points sit a little inside its outline). */
const ROAD_MARGIN = 0.15

import { GRAVEYARD_SCENE, graveyardPrefab, type HexGraveyard, placeGraveyard } from "./graveyard.ts"
import { bodyRadius, castleFoot, footprint, settlePieces } from "./sites.ts"
import {
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
  /** Decks only: its rails start this far along from its centre end (a bend's mitre, a hub's opening). */
  rails?: number
  /** Stairs only: how many of its lowest steps have no cheek on its left and its right (a turning foot). */
  open?: [number, number]
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

/**
 * A building's front door in the world (doorways.ts, from its mesh): the middle of its foot on the
 * door's face, its width and height, the way it looks out (radians about +y, 0 = +z), on `tile`.
 */
export interface HexDoorway {
  tile: number
  x: number
  y: number
  z: number
  w: number
  h: number
  facing: number
}

export interface HexWorld {
  tiles: HexWorldTile[]
  /** Every building's front door (a building tile's main building, as placed). */
  doorways: HexDoorway[]
  pieces: PlacedPiece[]
  /** Path strips (triangle positions) over road tiles. */
  paths: number[]
  /** Road stairs where a road steps down a level: built as ground (ground.ts `hexStructures`). */
  stairs: HexWalkway[]
  /** Bridges over the rivers: built as ground (ground.ts `hexStructures`). */
  bridges: HexBridge[]
  /** Decks a scene's own pieces build out over the water (a quay's stone deck): walked, not built here. */
  decks: HexWalkway[]
  /**
   * The Guildhall's notice board (board.ts): where it stands and faces; its pieces are among `pieces`.
   * Null where none fits; left out by a world built without one.
   */
  board?: NoticeBoardPlace | null
  /** The graveyard (graveyard.ts): its tiles, its gate and its graves in the world; null without one. */
  graveyard: HexGraveyard | null
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

/** The castle's yards in the order they are given out, nearest its heart first. */
const YARD_THEMES = ["castle-well", "castle-drill", "castle-stables", "castle-stores"]

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
/**
 * The training arena (decisions.md "training arena"): where knights and guards spar, drill and practise.
 * One an island: at the first camp with room for it, else beside the castle (the building nearest it of
 * a place within CASTLE_REACH steps).
 */
const ARENA = "training-arena"
const BESIDE_CASTLE = new Set(["town", "camp", "hamlet", "market"])
const CASTLE_REACH = 8
/** The scenes each kind of place has once, wherever a building of it has room for one. */
const PLACE_SCENES: Partial<Record<string, string[]>> = {
  town: ["market-square", "town-hall-plaza", "tavern-garden", "smithy-works"],
  market: ["tavern-garden"],
  harbour: ["harbour-quay", "tavern-garden"],
  camp: [ARENA, "archery-range"],
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
  /** One an island, at the first place that has room (the training arena). */
  once?: boolean
}
const SCENE_FIT: Partial<Record<string, SceneFit>> = {
  "harbour-quay": { sea: true, turn: true },
  "monastery-compound": { country: ["hillside", "woods"], absorb: true, turn: true },
  "farmstead-yard": { spare: ["field"], turn: true },
  // on the ring street round the town's square, the hall facing its plaza
  "town-hall-plaza": { turn: true, near: "ring" },
  // the training arena: once an island, at any street its building fronts, either way round
  [ARENA]: { turn: true, once: true },
  "market-square": { clear: true },
}
/** Kinds a place builds once at most (a camp's archery range: two side by side crammed into each other). */
const ONCE_A_PLACE = new Set(["archery"])
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

const GRAVEYARD_FALLBACK = graveyardPrefab()
/** A prefab by id: the authored one, else the code's; the graveyard's built from its graves (graveyard.ts). */
const prefabOf = (id: string): TilePrefab | undefined =>
  tilePrefab(id) ?? (id === GRAVEYARD_SCENE ? GRAVEYARD_FALLBACK : undefined)

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
  watermill: "watermill",
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
  // the graveyard as built (graveyard.ts `placeGraveyard`), once its front tile is placed
  let builtGraveyard: HexGraveyard | null = null
  const pieces: HexWorld["pieces"] = []
  const paths: number[] = []
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
  /** The sides of tile i its roads run on through (toward the tiles consecutive with it on a road). */
  const linkedSides = (i: number): number[] => {
    const nb = g.neighbours(i)
    return [0, 1, 2, 3, 4, 5].filter((d) => nb[d]! >= 0 && (links.get(i)?.has(nb[d]!) ?? false))
  }
  // ---- the ways first (decisions.md "roads are sacred"): every road's, square's and court's strip, its
  // stairs and its bridges, laid before anything is placed, so nothing is placed over them ----
  const bridges: HexBridge[] = []
  const strips: Strip[] = []
  {
    const e = (HEX_TILE_SIZE * Math.sqrt(3)) / 2
    for (let i = 0; i < g.size; i++) {
      const u = useOf(z, i)
      if (kindOf(h, i) === "sea") continue
      const sides = linkedSides(i)
      const nb = g.neighbours(i)
      const x = at(i)[0]
      const zz = at(i)[1]
      const t = top(i)
      const zone = z.zoneOf[i] ? z.zones[z.zoneOf[i]! - 1] : undefined
      if (u === "road") {
        const legs = sides.length ? sides : [0, 3]
        strips.push(...tileStrips(i, [x, zz], legs, (d) => nb[d]!))
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
          const flight = (r: number): HexWalkway => ({
            kind: "stairs",
            ax: x + ux * e,
            az: zz + uz * e,
            ay: t,
            bx: x + ux * (e + r),
            bz: zz + uz * (e + r),
            by: top(j),
            half: 0.95,
            steps: Math.max(2, Math.round(drop / 0.17)),
          })
          // its cheeks clear of the ways on from its foot (the lower road turning off, another flight
          // coming down beside it): a shorter, steeper flight where they would cross one
          const on = tileStrips(j, at(j), linkedSides(j), (k) => g.neighbours(j)[k]!)
          const crosses = (st: HexWalkway) =>
            walkwaySolids(st).some((c) => on.some((s) => stripIntrusion(s, c) > GRAZE))
          let r = run
          while (r > drop * 0.85 && crosses(flight(r))) r -= 0.05
          // still: the side the road turns off has its lowest steps open, as few as it takes
          const st = flight(r)
          const n = flightSteps(st)
          for (let k = 1; k < n && crosses(st); k++)
            st.open = (
              [
                [k, 0],
                [0, k],
              ] as [number, number][]
            ).find((o) => !crosses({ ...st, open: o })) ?? [k, k]
          stairs.push(st)
        }
      } else if (u === "bridge") {
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
        // the rails clear of the way on: a two-leg bridge's are mitred at its bend, a hub's stand off it
        // (structures.ts `bridgeInto`)
        // (a rail stands this far out of the deck's line; legs 60° apart need it 1.94 m out, 120° 0.65 m)
        const off = (bridge.legs[0]?.half ?? 1) + 0.12
        for (const [k, d] of legs.entries()) {
          const apart = Math.min(
            ...legs.filter((_, m) => m !== k).map((o) => Math.min((o - d + 6) % 6, (d - o + 6) % 6)),
          )
          const mitre = apart >= 3 ? 0 : off / Math.tan((apart * Math.PI) / 6)
          const rails = legs.length !== 2 ? Math.max(1.3, mitre) : mitre
          if (rails > 0) bridge.legs[k]!.rails = rails
        }
        bridges.push(bridge)
      } else if (sides.length && (u === "square" || (u === "court" && zone?.kind === "castle")))
        strips.push(...tileStrips(i, [x, zz], sides, (d) => nb[d]!))
    }
    for (const s of stairs) strips.push(wayStrip(s))
    for (const b of bridges) for (const leg of b.legs) strips.push(wayStrip(leg))
  }
  const ways = new StripGrid(strips)
  /** Whether a placed piece keeps off every strip (a building's own doorstep aside: its door's tile `from`). */
  const offRoad = (q: PlacedPiece, own = -1, from = -1) =>
    solidKind(q.piece) === "building"
      ? ways.pieceIntrusion(q, own, from) <= GRAZE
      : ways.pieceIntrusion(q) <= GRAZE
  /**
   * A tile's pieces kept off the roads: a building still over a strip (its outline, exactly) is drawn in
   * toward the tile's middle and made smaller until it is clear (at most to half its size); anything
   * else people bump into that stands over one (a fence, a crate, a bench, a lamp) is left out.
   */
  const keepOffRoads = (placed: PlacedPiece[], [cx, cz]: [number, number], own: number, from: number) =>
    placed.filter((q) => {
      const kind = solidKind(q.piece)
      if (!kind || offRoad(q, own, from)) return true
      if (kind !== "building") return false
      const s0 = q.scale
      const ox = q.x - cx
      const oz = q.z - cz
      for (let k = 1; k <= 8 && !offRoad(q, own, from); k++) {
        const f = 0.5 ** (k / 8)
        q.scale = s0 * f
        q.x = cx + ox * f
        q.z = cz + oz * f
      }
      return offRoad(q, own, from)
    })
  /**
   * A square's well and its lamp, where no way across it runs: each in the widest gap between its
   * strips it fits in, on its own tile, the well facing the middle (none where neither fits).
   */
  const squareWell = (i: number, [x, zz]: [number, number], t: number): PlacedPiece[] => {
    const out: PlacedPiece[] = []
    const strip = linkedSides(i).map((d) => (Math.PI / 3) * d)
    /** How far round from the nearest strip an angle is (radians). */
    const gap = (a: number) =>
      Math.min(...strip.map((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))))
    const turns = Array.from({ length: 24 }, (_, k) => (Math.PI / 12) * k).sort(
      (a, b) => gap(b) - gap(a) || a - b,
    )
    const put = (piece: string, scale: number, faceIn: boolean, apart: (q: PlacedPiece) => boolean) => {
      for (const a of turns)
        for (const f of [0.55, 0.62, 0.48]) {
          const e = HEX_TILE_SIZE * f
          const q: PlacedPiece = {
            piece,
            x: x + Math.cos(a) * e,
            y: t,
            z: zz - Math.sin(a) * e,
            rot: faceIn ? Math.atan2(-Math.cos(a), Math.sin(a)) : 0,
            scale,
          }
          if (!apart(q) || !offRoad(q) || tileAt(q.x, q.z) !== i) continue
          // clear of the buildings standing round the square (and those to come keep clear of it)
          const r = bodyRadius(q)
          if (bodies.near(q.x, q.z).some(([bx, bz, br]) => Math.hypot(bx - q.x, bz - q.z) < br + r - 0.05))
            continue
          bodies.add(q.x, q.z, r)
          out.push(q)
          return
        }
    }
    put(recolour("kaykit-hexagon/building-well-yellow", i), 0.32, true, () => true)
    put("kaykit-halloween/post-lantern", 0.55, false, (q) =>
      out.every((o) => Math.hypot(o.x - q.x, o.z - q.z) > 1.1),
    )
    return out
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
  /** A watermill's turn on tile i: the door side and mirroring that put its race side onto a river neighbour. */
  const watermillTurn = (i: number): { door: number; mirror: boolean } => {
    const nb = g.neighbours(i)
    const p = tilePrefab("watermill")
    const options: { door: number; mirror: boolean; score: number }[] = []
    for (const mirror of [false, true])
      for (let door = 0; door < 6; door++) {
        const wet = nb[worldSide(mirror ? mirrorSide(3) : 3, door)]!
        if (wet < 0 || kindOf(h, wet) !== "river") continue
        const street = nb[door]! >= 0 && roadLike(nb[door]!) ? 2 : 0
        const fits = p && standsOn(mirror ? mirrorPrefab(p) : p, i, door) ? 1 : 0
        options.push({ door, mirror, score: street + fits })
      }
    options.sort((a, b) => b.score - a.score)
    return options[0] ?? { door: facing(i), mirror: false }
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
  /** Whether place zi has a `kind` already: a tile built as one, or the scene it grows into. */
  const placeHas = (zi: number, kind: string): boolean =>
    z.zones[zi]!.tiles.some(
      (j) => built.get(j) === kind || (!!SCENES[kind] && scenes.get(j) === SCENES[kind]),
    )
  /** Places whose compound scene landed (a monastery's): their heart is a plain square, no second chapel. */
  const compound = new Set<number>()
  /** The kinds a building tile picks from, and the one its hash picks first. */
  const choice = (i: number): { list: string[]; at: number } => {
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
    return { list, at: Math.floor(hash2(seed + 5, g.q[i]!, g.r[i]!) * list.length) % list.length }
  }
  const buildOf = (i: number): string => {
    const have = built.get(i)
    if (have) return have
    const zone = zoneAt(i)
    const { list, at } = choice(i)
    let kind = list[at]!
    // a place whose own compound stands already builds no second chapel or graveyard: a cottage
    if (zone && compound.has(z.zoneOf[i]! - 1) && (kind === "monastery" || kind === "graveyard"))
      kind = "cottage"
    // one archery range a place (user: a camp's ranges stacked into each other): the next kind instead
    if (ONCE_A_PLACE.has(kind) && zone && placeHas(z.zoneOf[i]! - 1, kind))
      for (let k = 1; k < list.length && ONCE_A_PLACE.has(kind); k++) kind = list[(at + k) % list.length]!
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
  /** The castle's site and foot (sites.ts castleFoot): no scene spreads over them. */
  const castleGround = new Set([...h.sites.castle, ...castleFoot(g, h.sites.castle)])
  const claimable = (i: number, j: number, fit: SceneFit = {}) => {
    if (j < 0 || claimedBy.has(j) || scenes.has(j) || castleGround.has(j)) return false
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
        // and every piece of it off the roads (decisions.md "roads are sacred")
        const bad = placeTile(mirror ? mirrorPrefab(p) : p, at(i), top(i), rotOf(door), i, true, odds).filter(
          (q) => !offRoad(q, i, nb[door]!),
        )
        if (bad.length) continue
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
  const placed = (scene: string) => [...scenes.values()].includes(scene)
  for (const [zi, zone] of z.zones.entries())
    for (const scene of PLACE_SCENES[zone.kind] ?? []) {
      if (SCENE_FIT[scene]?.once && placed(scene)) continue
      const near = SCENE_FIT[scene]?.near
      buildings(zi, near).some((i) => claim(i, scene, true)) ||
        buildings(zi, near).some((i) => byLane(i) && claim(i, scene))
    }
  // an island's one training arena where no camp had room for it (or there is no camp): beside the
  // castle, on the building nearest it of a place round it
  const castleAt = z.zones.find((zz) => zz.kind === "castle")?.tile
  if (castleAt !== undefined && !placed(ARENA)) {
    const near = z.zones
      .flatMap((zone, zi) =>
        BESIDE_CASTLE.has(zone.kind) ? buildings(zi).filter((i) => steps(i, castleAt) <= CASTLE_REACH) : [],
      )
      .sort((a, b) => steps(a, castleAt) - steps(b, castleAt) || a - b)
    near.some((i) => claim(i, ARENA, true)) || near.some((i) => byLane(i) && claim(i, ARENA))
  }
  // a place's landmark (a camp's archery range, a mine's head, a lumber camp's mill, a market's hall, a
  // chapel) stood on its heart, where its roads end: the heart is open ground now (decisions.md "roads
  // are sacred"), the landmark on a building tile beside it, its door onto the square
  const landmarkDoor = new Map<number, number>()
  for (const [zi, zone] of z.zones.entries()) {
    const mark = HEART[zone.kind]
    if (!mark || mark === "well-square" || compound.has(zi) || !linkedSides(zone.tile).length) continue
    if (placeHas(zi, mark)) continue
    const nb = g.neighbours(zone.tile)
    const prefab = tilePrefab(mark)
    // (a tile that would grow a scene of its own, a tavern's garden or a smithy's yard, last)
    const grows = (j: number) => {
      const { list, at } = choice(j)
      return SCENES[list[at]!] ? 1 : 0
    }
    const order = [...nb.entries()].sort((a, b) => grows(a[1]) - grows(b[1]) || a[0] - b[0])
    for (const [d, j] of order) {
      if (j < 0 || useOf(z, j) !== "building" || z.zoneOf[j] !== zi + 1 || scenes.has(j) || claimedBy.has(j))
        continue
      if (Math.abs(h.level[j]! - h.level[zone.tile]!) > 1) continue
      const door = (d + 3) % 6
      if (prefab && !standsOn(prefab, j, door)) continue
      built.set(j, mark)
      landmarkDoor.set(j, door)
      break
    }
  }
  // then every other tavern, smithy and archery range the tiles picked, where there is room
  for (let i = 0; i < g.size; i++) {
    if (useOf(z, i) !== "building" || scenes.has(i)) continue
    const kind = buildOf(i)
    const scene = SCENES[kind]
    // (one archery range a place: the tile the camp's landmark stands on grows into it, else one other)
    if (ONCE_A_PLACE.has(kind) && [...scenes].some(([j, sc]) => sc === scene && z.zoneOf[j] === z.zoneOf[i]))
      continue
    if (scene && (onStreet(i) || byLane(i)) && claim(i, scene)) landmarkDoor.delete(i)
  }
  // the graveyard (graveyard.ts): zones gave it its tiles and its gate's side; its scene covers them
  const graveyard = z.graveyard
  if (graveyard) {
    scenes.set(graveyard.tile, GRAVEYARD_SCENE)
    for (const j of graveyard.cover) claimedBy.set(j, graveyard.tile)
  }
  /** The first of `ids` the castle's tier has (a castle piece's `tier`: the first tier that uses it). */
  const atTier = (...ids: string[]): string | null =>
    ids.find((id) => {
      const p = tilePrefab(id)
      return p !== undefined && (p.tier ?? 1) <= tier
    }) ?? null

  /**
   * The castle's yards, each composed for what it is (decisions.md backlog "castle yards"): the one
   * nearest its heart the well with benches, then the drill yard, the stables, the stores, by turns.
   */
  const yards = new Map<number, string>()
  if (z.castle) {
    const plan = z.castle
    const list = plan.tiles
      .filter((i) => plan.role.get(i) === "yard")
      .sort((a, b) => steps(a, plan.heart) - steps(b, plan.heart) || a - b)
    list.forEach((i, k) => {
      const id = YARD_THEMES[k % YARD_THEMES.length]!
      if (atTier(id)) yards.set(i, id)
    })
  }
  /** The sides of a castle tile the curtain wall stands on (tier 2 up): those leaving the castle. */
  const walledSides = (i: number): number[] => {
    const plan = z.castle!
    const nb = g.neighbours(i)
    return plan.tier >= 2 ? [0, 1, 2, 3, 4, 5].filter((e) => nb[e]! < 0 || !plan.role.has(nb[e]!)) : []
  }
  /** The sides of a castle tile a building's door opens through onto it (that building's role). */
  const doorSides = (i: number, role?: string): number[] => {
    const plan = z.castle!
    const nb = g.neighbours(i)
    return [0, 1, 2, 3, 4, 5].filter(
      (e) =>
        nb[e]! >= 0 &&
        plan.door.get(nb[e]!) === (e + 3) % 6 &&
        (role === undefined || plan.role.get(nb[e]!) === role),
    )
  }
  /**
   * What each castle court is for (castleyard.ts), so its things read as one yard of one trade along
   * the wall: by the gate, the heart, the drill before the barracks' door; every other court against
   * the curtain wall, nearest the heart first, with up to two such courts beside it (one no way joins it
   * to first: their shared side is the most room the castle has) one yard of one trade, dressed as one:
   * the biggest yard first, a trade no yard tile or court has yet, then by turns; an open court inside,
   * plain.
   */
  const courtKinds = new Map<number, CourtKind>()
  /** The courts dressed together, by their first (the one nearest the heart); and each court's first. */
  const courtYards = new Map<number, number[]>()
  const yardOf = new Map<number, number>()
  if (z.castle) {
    const plan = z.castle
    const given = new Set<CourtKind>(COURT_THEMES.filter((k) => [...yards.values()].includes(`castle-${k}`)))
    const courts = plan.tiles
      .filter((i) => plan.role.get(i) === "court")
      .sort((a, b) => steps(a, plan.heart) - steps(b, plan.heart) || a - b)
    for (const i of courts) {
      const kind: CourtKind | undefined =
        i === plan.gate
          ? "gate"
          : i === plan.heart
            ? "heart"
            : doorSides(i, "barracks").length
              ? "drill"
              : undefined
      if (kind) courtKinds.set(i, kind)
      if (kind === "drill") given.add(kind)
    }
    let turn = 0
    const free = (j: number) =>
      j >= 0 && plan.role.get(j) === "court" && !courtKinds.has(j) && walledSides(j).length > 0
    for (const i of courts) {
      if (!free(i)) continue
      const yard = [i]
      courtKinds.set(i, "plain")
      while (yard.length < 3) {
        const next = yard
          .flatMap((a) => [...g.neighbours(a)].map((j) => ({ j, joined: links.get(a)?.has(j) ?? false })))
          .filter((c) => free(c.j))
          .sort((a, b) => Number(a.joined) - Number(b.joined) || a.j - b.j)[0]
        if (!next) break
        yard.push(next.j)
        courtKinds.set(next.j, "plain")
      }
      courtYards.set(i, yard)
    }
    // the biggest yard first (the stables want the most room), then nearest the heart
    for (const [i, yard] of [...courtYards].sort((a, b) => b[1].length - a[1].length)) {
      const fresh = COURT_THEMES.filter((k) => !given.has(k))
      const kind = fresh[0] ?? COURT_THEMES[turn++ % COURT_THEMES.length]!
      for (const j of yard) {
        courtKinds.set(j, kind)
        yardOf.set(j, i)
      }
      given.add(kind)
    }
  }
  /** The castle's colour: its keep's (every castle tile takes it). */
  const castleZone = z.zones.find((q) => q.kind === "castle")
  const castleColour = recolour(
    "kaykit-hexagon/building-castle-blue",
    castleZone?.tile ?? z.castle?.keep ?? 0,
  )
    .split("-")
    .pop()!
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
  /** Each building tile's door piece (its doorway is read once every piece is fitted). */
  const doorPieces: [number, PlacedPiece][] = []
  /** The buildings standing on the castle's tiles, as settled: its curtain wall meets them. */
  const castleBodies: CurtainBody[] = []
  /** The castle's courts' dressing (castleyard.ts), made once its curtain wall stands. */
  const courts: ((blocked: (x: number, z: number, r: number) => boolean) => PlacedPiece[])[] = []
  const courtTiles = new Map<number, CourtTile>()
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
      const p = prefabOf(scenes.get(origin)!)!
      if ((p.ground === "dirt" || p.ground === "paved" || p.ground === "sand") && dryLand(i))
        ground = p.ground
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
      else if (role === "yard") {
        // a yard composed for its place in the castle (yardThemes), its back to the curtain wall
        prefab = yards.get(i) ?? atTier("castle-ward", "castle-yard")
        const out = [0, 1, 2, 3, 4, 5].filter((e) => nb[e]! < 0 || !plan.role.has(nb[e]!))
        if (out.length) {
          let sx = 0
          let sz = 0
          for (const e of out) {
            sx += Math.cos((Math.PI / 3) * e)
            sz += Math.sin((Math.PI / 3) * e)
          }
          const back = Math.atan2(sz, sx)
          rot = rotOf(((Math.round((back + Math.PI) / (Math.PI / 3)) % 6) + 6) % 6)
        }
      } else {
        // a court: paved through along its ways (and out of the gate), dressed round them (castleyard.ts)
        const sides = linkedSides(i)
        if (sides.length) {
          paths.push(...tilePath([x, zz], t + 0.07, sides, 1.1))
          pathSides = sides
        }
        const kind = courtKinds.get(i) ?? "plain"
        // a building whose door opens onto this court keeps its way to it clear, as a path does
        courtTiles.set(i, {
          at: [x, zz],
          y: t,
          paths: [...new Set([...sides, ...doorSides(i)])],
          walls: walledSides(i),
        })
        // (once the curtain wall stands, clear of it as built: below; a yard of courts by its first,
        // once all of its courts are known)
        const lead = yardOf.get(i) ?? i
        if (lead === i)
          courts.push((blocked) =>
            courtDressing(
              (courtYards.get(i) ?? [i]).map((j) => courtTiles.get(j)!),
              kind,
              castleColour,
              seed + i,
              blocked,
            ),
          )
      }
    } else if (u === "graveyard" && graveyard?.tile === i) {
      prefab = GRAVEYARD_SCENE
      door = graveyard.door
      rot = rotOf(door)
      builtGraveyard = placeGraveyard(graveyard, [x, zz], t, rot)
    } else if (u === "building") {
      prefab = scenes.get(i) ?? buildOf(i)
      const turn = turned.get(i)
      door = turn?.door ?? (scenes.has(i) ? facing(i) : (landmarkDoor.get(i) ?? doorFor(prefab, i)))
      rot = rotOf(door)
      if (turn?.mirror) mirror = true
    } else if (zone?.kind === "harbour" && (u === "yard" || u === "garden" || u === "well" || u === "market"))
      prefab = "quay"
    else if (u === "square") {
      prefab = (compound.has(z.zoneOf[i]! - 1) ? null : HEART[zone?.kind ?? "town"]) ?? "well-square"
      ground = "paved"
      // a square the roads come to: open ground, paved through to each of them, its well and its lamp
      // standing where no way runs (its place's own landmark fronts it from a tile beside: `landmarks`)
      const sides = linkedSides(i)
      if (sides.length) {
        prefab = null
        paths.push(...tilePath([x, zz], t + 0.07, sides, 1.1))
        pathSides = sides
        pieces.push(...squareWell(i, [x, zz], t))
      }
    } else if (u === "road") {
      const legs = linkedSides(i)
      if (!legs.length) legs.push(0, 3)
      paths.push(...tilePath([x, zz], t + 0.07, legs))
      pathSides = legs
    } else if (u === "dock" && !quayed.has(i)) {
      prefab = "dock"
      // the pier runs out from the shore: its land end toward the dry tile beside it, a harbour's first
      const nb = g.neighbours(i)
      const dry = (j: number) => j >= 0 && kindOf(h, j) !== "shallows" && kindOf(h, j) !== "sea"
      let d = [0, 1, 2, 3, 4, 5].find((e) => dry(nb[e]!) && z.zoneOf[nb[e]!]! > 0)
      if (d === undefined) d = [0, 1, 2, 3, 4, 5].find((e) => dry(nb[e]!))
      rot = rotOf(d ?? 4)
    } else if (
      (u === "meadow" || BY_USE[u] === "meadow") &&
      (grounds.has(i) || [...g.neighbours(i)].some((j) => j >= 0 && zoneAt(j)?.kind === "castle"))
    ) {
      // the castle's ground its next tiers take, and the foot of its curtain wall: kept open, its
      // approach clear (a bench there would have only the castle's ways, behind the wall, to reach it)
      prefab = null
    } else if (BY_USE[u] && !quayed.has(i)) {
      prefab = BY_USE[u]!
      if (prefab === "farmstead" || prefab === "market" || prefab === "windmill") {
        door = facing(i)
        rot = rotOf(door)
      } else if (prefab === "watermill") {
        // its race leaves through tile side 3 (side 5 mirrored), so the mill turns to put that side on a
        // river tile; of those turns, one fronting a road and standing on its floor first
        const turn = watermillTurn(i)
        door = turn.door
        rot = rotOf(door)
        if (turn.mirror) mirror = true
      }
    } else if (k === "forest") prefab = "woods"
    else if (k === "rock") prefab = "rocky"
    else if (k === "sand") prefab = "beach"
    else if (k === "lake" && hash2(seed + 7, g.q[i]!, g.r[i]!) < 0.15) prefab = null
    if (prefab === "dock" || prefab === "field") ground = prefab === "dock" ? "water" : "soil"
    const authored = prefab ? prefabOf(prefab) : undefined
    const p = authored && mirror ? mirrorPrefab(authored) : authored
    if (p) {
      if (p.ground === "dirt" || p.ground === "paved" || p.ground === "sand") ground = p.ground
      // a prefab's own pieces, minus those that would float on water tiles it was not made for
      // a castle's tiles all take its keep's colour
      const hue = zone?.kind === "castle" ? zone.tile : i
      const placed = placeTile(p, [x, zz], prefab === "dock" ? SEA_TOP : t, rot, i, true, odds)
      // every building on its floor: dry ground at its own level, off the roads (its doorstep aside),
      // clear of the buildings beside it
      const from = door !== undefined ? g.neighbours(i)[door]! : -1
      if (prefab !== "dock")
        settlePieces(
          placed,
          [x, zz],
          (px, pz) => floorAt(px, pz, t) && !ways.on(px, pz, ROAD_MARGIN, i, from),
          bodies,
        )
      const own = keepOffRoads(placed, [x, zz], i, from).map((q) => ({ ...q, piece: recolour(q.piece, hue) }))
      pieces.push(...own)
      // a building's front door: its biggest building piece's (its doorway once every piece is fitted)
      if (door !== undefined) {
        let best: PlacedPiece | undefined
        for (const q of own) {
          const d = doorwayOf(q.piece)
          if (d && (!best || q.scale * d.w > best.scale * doorwayOf(best.piece)!.w)) best = q
        }
        if (best) doorPieces.push([i, best])
      }
      // the castle's buildings: what its curtain wall runs up to
      if (zone?.kind === "castle")
        for (const q of own) if (q.piece.startsWith("kaykit-hexagon/building-")) castleBodies.push(q)
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
  /** The pieces off the roads before the seats are fitted: none is moved onto one. */
  const doorFrom = (p: PlacedPiece): [number, number] => {
    const own = tileAt(p.x, p.z)
    const t = own >= 0 && byTile.has(own) ? tiles[byTile.get(own)!]! : undefined
    return [own, t?.door !== undefined ? g.neighbours(own)[t.door]! : -1]
  }
  const offBefore = new Set(pieces.filter((p) => offRoad(p, ...doorFrom(p))))
  const topOf = (i: number) => tiles[byTile.get(i)!]!.top
  const fit = (only: (p: PlacedPiece) => boolean) =>
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
      only,
      (p) => {
        if (offBefore.has(p) && !offRoad(p, ...doorFrom(p))) return false
        const r = bodyRadius(p)
        if (!r) return true
        return pieces.every((o) => {
          if (o === p) return true
          const ro = bodyRadius(o)
          return !ro || Math.hypot(o.x - p.x, o.z - p.z) >= r + ro - 0.05
        })
      },
    )
  fit(() => true)
  // ---- the Guildhall's curtain wall (tier 2 up): one line round its site, meeting its buildings ----
  const plan = z.castle
  if (plan && plan.tier >= 2 && tier >= 2) {
    const colour = castleColour
    const wall = curtainWall({
      grid: g,
      tiles: plan.tiles,
      centre: at,
      R,
      y: top(plan.keep),
      gate: plan.gate !== plan.keep ? { tile: plan.gate, side: plan.gateSide } : null,
      bodies: castleBodies,
      colour,
      // a court's way or a door's approach across the side between two of its tiles
      crossed: (a, b) => {
        const d = g.neighbours(a).indexOf(b)
        const ta = byTile.has(a) ? tiles[byTile.get(a)!] : undefined
        const tb = byTile.has(b) ? tiles[byTile.get(b)!] : undefined
        return (
          d >= 0 &&
          (!!ta?.paths?.includes(d) ||
            !!tb?.paths?.includes((d + 3) % 6) ||
            plan.door.get(a) === d ||
            plan.door.get(b) === (d + 3) % 6)
        )
      },
      // open dry ground outside, at the castle's level or above, nothing on it, no way over it
      spill: (j) => {
        const t = byTile.has(j) ? tiles[byTile.get(j)!] : undefined
        return (
          !!t &&
          t.prefab === null &&
          !t.paths?.length &&
          (t.ground === "grass" || t.ground === "paved" || t.ground === "dirt" || t.ground === "sand") &&
          !claimedBy.has(j) &&
          useOf(z, j) !== "road" &&
          useOf(z, j) !== "bridge" &&
          t.top >= top(plan.keep) - 0.01
        )
      },
    })
    pieces.push(...wall.pieces)
    // its corner towers on their seats as well (the wall's runs already keep to the site)
    const towers = new Set<PlacedPiece>(wall.pieces.filter((q) => q.piece.includes("building-tower-base")))
    fit((q) => towers.has(q))
  }
  // ---- every building's front door, as its building finally stands ----
  const doorways: HexDoorway[] = doorPieces.map(([tile, best]) => {
    const d = doorwayOf(best.piece)!
    const c = Math.cos(best.rot)
    const n = Math.sin(best.rot)
    return {
      tile,
      x: best.x + (d.x * c + d.z * n) * best.scale,
      y: best.y + d.y * best.scale,
      z: best.z + (-d.x * n + d.z * c) * best.scale,
      w: d.w * best.scale,
      h: d.h * best.scale,
      facing: best.rot + d.facing,
    }
  })
  // ---- the castle's courts dressed round its ways, clear of its wall and buildings as they stand ----
  if (courts.length) {
    const built = new SolidGrid(
      pieces
        .filter(
          (q) =>
            CURTAIN.test(q.piece) ||
            (q.piece.startsWith("kaykit-hexagon/building-") && zoneAt(tileAt(q.x, q.z))?.kind === "castle"),
        )
        .flatMap((q) => pieceSolids(q)),
    )
    // and the castle's doors' approaches (checks.ts DOOR_RUN, DOOR_HALF)
    const fronts = doorways
      .filter((d) => zoneAt(d.tile)?.kind === "castle")
      .map((d): [number, number, number, number] => [
        d.x,
        d.z,
        d.x + Math.sin(d.facing) * DOOR_RUN,
        d.z + Math.cos(d.facing) * DOOR_RUN,
      ])
    const blocked = (px: number, pz: number, r: number) =>
      built.near(px, pz, r).some((so) => solidDistance(so, px, pz) < r) ||
      fronts.some(([ax, az, bx, bz]) => {
        const l2 = (bx - ax) ** 2 + (bz - az) ** 2
        const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / l2))
        return Math.hypot(px - ax - (bx - ax) * t, pz - az - (bz - az) * t) < DOOR_HALF + r
      })
    for (const make of courts) pieces.push(...make(blocked))
  }
  const heightAt = (x: number, zz: number): number => {
    const i = tileAt(x, zz)
    const k = i >= 0 ? byTile.get(i) : undefined
    return k === undefined ? 0 : Math.max(0, tiles[k]!.top)
  }
  const walkways = [...stairs, ...bridges.flatMap((b) => b.legs), ...decks]
  const grown = nature ? growNatureOn(nature) : undefined
  // the last word: nothing left standing over a road (a tree grown to its edge, a piece the seats moved)
  {
    const kept: PlacedPiece[] = []
    const byOwn = new Map<number, PlacedPiece[]>()
    for (const p of pieces) {
      const kind = solidKind(p.piece)
      // (the castle's curtain wall is laid clear of its ways as it is built: `castleWall`)
      if (!kind || CURTAIN.test(p.piece) || offRoad(p, ...doorFrom(p))) {
        kept.push(p)
        continue
      }
      if (kind !== "building") continue
      const [own] = doorFrom(p)
      if (!byOwn.has(own)) byOwn.set(own, [])
      byOwn.get(own)!.push(p)
    }
    for (const [own, list] of byOwn) {
      const t = own >= 0 && byTile.has(own) ? tiles[byTile.get(own)!]! : undefined
      const from = t?.door !== undefined ? g.neighbours(own)[t.door]! : -1
      kept.push(...keepOffRoads(list, t ? [t.x, t.z] : [list[0]!.x, list[0]!.z], own, from))
    }
    if (kept.length !== pieces.length) {
      const keep = new Set(kept)
      const left = pieces.filter((p) => keep.has(p))
      pieces.length = 0
      pieces.push(...left)
    }
  }
  /** The tread a foot stands on (collide.ts: the numbers structures.ts builds the steps from). */
  const stairAt = (px: number, pz: number): number | null => {
    for (const st of walkways) {
      const y = walkwayAt(st, px, pz)
      if (y !== null) return y
    }
    return null
  }
  // ---- the Guildhall's notice board, before its gathering, where the hall's view sees it ----
  const board = noticeBoard({ h, z, w: { tiles, pieces, doorways, stairs, bridges, decks, stairAt } })
  if (board) pieces.push(...boardPieces(board))
  return {
    tiles,
    doorways,
    pieces,
    paths,
    stairs,
    bridges,
    decks,
    board,
    graveyard: builtGraveyard,
    step: STEP,
    heightAt,
    stairAt,
    stats: { tiles: tiles.length, pieces: pieces.length, prefabs, ...(grown ? { nature: grown } : {}) },
  }
}
