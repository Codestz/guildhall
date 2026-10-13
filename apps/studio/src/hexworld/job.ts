/**
 * The hex island's build, off the main thread (worker.ts runs it; the screen only uploads): the map
 * (hexIsland, hexZones, hexWorld), the ground mesh, the path and deck strips, the pools, the lanterns,
 * the placed pieces and the shore field's bytes. It arrives in stages, each posted as soon as it is
 * ready: `map` (the island's extent, its paths and pools: the sky, the sun and the post are set up and
 * their shaders compiled while the ground is still being built), `ground` (the ground mesh), `pieces`
 * (their models start loading), `shore` (the water's field), then, when the spec asks for life, `life`
 * (everyone's day on the walk graph, lifePlan.ts: the slowest part, a second or more of path searches
 * that would otherwise block the main thread). Everything posted is plain data, typed arrays handed
 * over, not copied. Pure.
 */
import { shoreBytes, type VertexMeshData, vertexMeshData } from "@guildhall/render/worker"
import {
  HEX_TILE_SIZE,
  type HexFineGround,
  type HexIsland,
  type HexIslandSpec,
  type HexNature,
  type HexWorld,
  heightsReader,
  hexCentre,
  hexGroundFine,
  hexGroundMesh,
  hexIsland,
  hexStructures,
  hexWorld,
  hexZones,
  installTilePrefabs,
  kindOf,
  NATURE_CHOSEN,
  type PlacedPiece,
  type TilePrefab,
} from "@guildhall/world"
import { type LifePlan, planLife } from "./lifePlan.ts"

type RGB = [number, number, number]
const TOP: Record<string, RGB> = {
  grass: [112, 156, 64],
  soil: [150, 112, 70],
  dirt: [196, 160, 108],
  paved: [196, 186, 166],
  sand: [232, 210, 150],
  rock: [150, 140, 128],
  cliff: [140, 128, 112],
  // under the water surface: the lake and river bed
  water: [150, 128, 92],
}
const SIDE: Record<string, RGB> = {
  rock: [118, 110, 100],
  cliff: [118, 110, 100],
  sand: [178, 144, 98],
  water: [90, 120, 140],
}
const SIDE_LAND: RGB = [122, 90, 60]
/** Inland water: the bed sits this far under its tile's top, the surface this far. */
const BED_DROP = 0.55
const SURFACE_DROP = 0.14
/** The sea's level, and the shore field's reach (metres) and texel (metres). */
export const SEA_LEVEL = -0.05
const SHORE_REACH = 9
const SHORE_TEXEL = 0.2
const SHORE_MAX_RES = 2048
/** How fast a river runs, metres a second. */
const RIVER_SPEED = 0.9
const LANTERN = "kaykit-halloween/post-lantern"

/** `?ground=`: fine small hexes (the default), the soft merged tiles, or one prism per tile. */
export type GroundMode = "fine" | "soft" | "hex"

export interface HexJobSpec {
  seed: number
  files: number
  ground: GroundMode
  /** Metres per height level (`?step=`). */
  step: number
  /** The fine ground paints every small hex its own colour (`?detail=0` turns it off). */
  paint: boolean
  /** The authored tile prefabs (the main thread's `loadTiles`), installed before the build; null: world's fallback. */
  tiles: TilePrefab[] | null
  /** The nature knobs (`natureOf`: `?tree= ?pine= ?bush= ?rock= ?grass= ?flower= ?woods= ?wild=`); left out: today's. */
  nature?: HexNature
  /** The island's shape knobs, as on the hex map (`?coast= ?hills= ?rain= ?forest=`); left out: the defaults. */
  shape?: IslandShape
  /** Plan the island's life as the last stage (lifePlan.ts); left out or false: no `life` stage (`?life=0`). */
  life?: boolean
}

/** The hex map's shape knobs (world `HexIslandSpec`), so the 3D island can show what `/lab/hexmap` drew. */
export type IslandShape = Partial<Pick<HexIslandSpec, "coast" | "hills" | "rain" | "forest">>

/** The shape knobs a page's query sets: only those given, each a finite number. */
export function shapeOf(query: Pick<URLSearchParams, "get">): IslandShape {
  const out: IslandShape = {}
  for (const k of ["coast", "hills", "rain", "forest"] as const) {
    const raw = query.get(k)
    const v = raw === null || raw === "" ? Number.NaN : Number(raw)
    if (Number.isFinite(v) && v >= 0) out[k] = v
  }
  return out
}

/**
 * The nature a page builds with (nature.ts `HexNature`): the chosen nature (`NATURE_CHOSEN`, or today's
 * with `?nature=today`), each knob the query gives (a positive number) over it.
 */
export function natureOf(query: Pick<URLSearchParams, "get">): HexNature {
  const out: HexNature = query.get("nature") === "today" ? {} : { ...NATURE_CHOSEN }
  for (const k of NATURE_KNOBS) {
    const raw = query.get(k)
    const v = raw === null || raw === "" ? Number.NaN : Number(raw)
    if (Number.isFinite(v) && v > 0 && v <= 4) out[k] = v
  }
  return out
}
const NATURE_KNOBS = [
  "tree",
  "pine",
  "bush",
  "rock",
  "grass",
  "flower",
  "woods",
  "wild",
] as const satisfies readonly (keyof HexNature)[]

/** Heights on a hex grid: what the camera and the townsfolk stand on (`heightsAt` reads it). */
export type HexHeights = HexFineGround["heights"]

/**
 * The placed pieces, packed: variant `kinds[index[k]]` (a piece and its re-tint) at `place[5k ..]` =
 * x, y, z, rot, scale.
 */
export interface PackedPieces {
  /** Each distinct piece as placed: its re-tint and its lean (a few bows in racks) travel with the kind. */
  kinds: Pick<PlacedPiece, "piece" | "swatchMap" | "tilt" | "stretch">[]
  index: Uint16Array
  place: Float32Array
  /** Per piece, the tile cluster it belongs to (`clusters`), or -1 for a loose piece. */
  cluster: Int32Array
  /** Tiles drawn as one shell when far (see CLUSTERED): their centre and their look-alike key. */
  clusters: { key: string; x: number; y: number; z: number }[]
}

/** One hex prism (`?ground=hex`), as render's `createHexGround` takes it. */
export interface Prism {
  x: number
  z: number
  top: number
  color: RGB
  side: RGB
}

/** What the map alone gives, posted before the ground is built: the frame the rest is set in. */
export interface MapStage {
  /** Half the island's extent, metres, with a margin of sea. */
  span: number
  /** The first zone's heart tile: x, top, z. */
  heart: [number, number, number] | null
  paths: Float32Array
  /** Stone stairs where roads step down, plank bridges over the rivers: built like the ground. */
  structures: VertexMeshData | null
  /** Inland water surfaces: one hex each, at its height, a river's with the way it runs (m/s). */
  pools: { x: number; z: number; y: number; flow?: [number, number] }[]
  /** Where each lantern's light hangs (lanterns stand on flat tiles: the ground built under them keeps them there). */
  lamps: [number, number, number][]
  stats: {
    land: number
    tiles: number
    prefabs: Record<string, number>
    /** With nature knobs: the nature pieces grown and those held back from a road or a building. */
    nature?: { grown: number; held: number }
  }
}

export interface GroundStage {
  /** The ground mesh (fine or soft) ready to upload, or the prisms render builds it from (hex). */
  mesh: VertexMeshData | null
  prisms: Prism[] | null
  heights: HexHeights
  /** Milliseconds per step. */
  times: Record<string, number>
}

export interface ShoreStage {
  min: [number, number]
  size: number
  res: number
  reach: number
  data: Uint8Array
  ms: number
}

export type ToWorker = { type: "job"; spec: HexJobSpec }
export type FromWorker =
  | { type: "map"; map: MapStage }
  | { type: "ground"; ground: GroundStage }
  | { type: "pieces"; pieces: PackedPieces }
  | { type: "shore"; shore: ShoreStage }
  | { type: "life"; life: LifePlan }
  | { type: "fail"; message: string }

const SQ3 = Math.sqrt(3)

/** The axial hex (pointy top, cube rounding) of radius `size` under a point. */
export function axialAt(x: number, z: number, size: number): [number, number] {
  const qf = ((SQ3 / 3) * x - z / 3) / size
  const rf = ((2 / 3) * z) / size
  const sf = -qf - rf
  let q = Math.round(qf)
  let r = Math.round(rf)
  const s = Math.round(sf)
  const dq = Math.abs(q - qf)
  const dr = Math.abs(r - rf)
  if (dq > dr && dq > Math.abs(s - sf)) q = -r - s
  else if (dr > Math.abs(s - sf)) r = -q - s
  return [q, r]
}

/** The ground height at a point, read from `heights` (0 off it). */
export function heightsAt(heights: HexHeights): (x: number, z: number) => number {
  // the fine ground's own reader (world ground.ts): seats and cut small hexes as the mesh is built
  return heightsReader(heights)
}

/** The world's tile heights as a grid at tile size (what `HexWorld.heightAt` answers). */
function tileHeights(h: HexIsland, w: HexWorld): HexHeights {
  const g = h.grid
  let q0 = Number.POSITIVE_INFINITY
  let r0 = Number.POSITIVE_INFINITY
  let q1 = Number.NEGATIVE_INFINITY
  let r1 = Number.NEGATIVE_INFINITY
  for (const t of w.tiles) {
    q0 = Math.min(q0, g.q[t.i]!)
    q1 = Math.max(q1, g.q[t.i]!)
    r0 = Math.min(r0, g.r[t.i]!)
    r1 = Math.max(r1, g.r[t.i]!)
  }
  if (!w.tiles.length) return { size: HEX_TILE_SIZE, q0: 0, r0: 0, cols: 0, rows: 0, y: new Float32Array(0) }
  const cols = q1 - q0 + 1
  const y = new Float32Array(cols * (r1 - r0 + 1))
  for (const t of w.tiles) y[(g.r[t.i]! - r0) * cols + g.q[t.i]! - q0] = Math.max(0, t.top)
  return { size: HEX_TILE_SIZE, q0, r0, cols, rows: r1 - r0 + 1, y }
}

/**
 * Inland water (lakes, rivers, docks above the sea): a bed sunk under the tile and a surface over it.
 * The pools' tiles, and the world with their beds sunk, which the soft and fine grounds read.
 */
export function sinkPools(w: HexWorld): { pools: HexWorld["tiles"]; pooled: Set<number>; sunk: HexWorld } {
  const pools = w.tiles.filter((t) => t.ground === "water" && t.top - SURFACE_DROP > SEA_LEVEL)
  const pooled = new Set(pools.map((t) => t.i))
  const sunk = { ...w, tiles: w.tiles.map((t) => (pooled.has(t.i) ? { ...t, top: t.top - BED_DROP } : t)) }
  return { pools, pooled, sunk }
}

/**
 * The tile prefabs whose pieces are grouped per tile, drawn as one merged shell when far (render's batch
 * clusters): a field's crop rows are thousands of small pieces that would otherwise vanish in the distance
 * (render culls detail), leaving bare soil.
 */
const CLUSTERED = new Set(["field"])

/**
 * Groups the pieces standing on CLUSTERED tiles by tile. Tiles whose pieces lie alike (the same pieces at
 * the same places, to the metre) share a key, so they share one shell.
 */
function clusterTiles(h: HexIsland, w: HexWorld): Pick<PackedPieces, "cluster" | "clusters"> {
  const g = h.grid
  const tileOf = new Map<number, HexWorld["tiles"][number]>()
  for (const t of w.tiles) if (t.prefab && CLUSTERED.has(t.prefab)) tileOf.set(t.i, t)
  const cluster = new Int32Array(w.pieces.length).fill(-1)
  const slots = new Map<number, number>()
  const members: number[][] = []
  const tiles: HexWorld["tiles"] = []
  w.pieces.forEach((p, k) => {
    const [q, r] = axialAt(p.x, p.z, HEX_TILE_SIZE)
    const t = tileOf.get(g.index(q, r))
    if (!t) return
    let slot = slots.get(t.i)
    if (slot === undefined) {
      slot = members.length
      slots.set(t.i, slot)
      members.push([])
      tiles.push(t)
    }
    cluster[k] = slot
    members[slot]!.push(k)
  })
  const clusters = tiles.map((t, slot) => {
    const look = members[slot]!.map((k) => {
      const p = w.pieces[k]!
      const at = [p.x - t.x, p.z - t.z, (p.y - t.top) * 2].map(Math.round).join(",")
      return `${p.piece}${p.swatchMap ? JSON.stringify(p.swatchMap) : ""}@${at}`
    })
    return { key: `${t.prefab}|${look.sort().join(";")}`, x: t.x, y: t.top, z: t.z }
  })
  return { cluster, clusters }
}

/** A river tile's current: downhill toward the tile it drains into, RIVER_SPEED m/s; none off a river. */
function flowOf(h: HexIsland, i: number): [number, number] | undefined {
  const d = h.down[i]!
  if (kindOf(h, i) !== "river" || d < 0) return undefined
  const [ax, az] = hexCentre({ q: h.grid.q[i]!, r: h.grid.r[i]! })
  const [bx, bz] = hexCentre({ q: h.grid.q[d]!, r: h.grid.r[d]! })
  const l = Math.hypot(bx - ax, bz - az) || 1
  return [((bx - ax) / l) * RIVER_SPEED, ((bz - az) / l) * RIVER_SPEED]
}

function pack(pieces: HexWorld["pieces"], grouped: Pick<PackedPieces, "cluster" | "clusters">): PackedPieces {
  const kinds: PackedPieces["kinds"] = []
  const slot = new Map<string, number>()
  const index = new Uint16Array(pieces.length)
  const place = new Float32Array(pieces.length * 5)
  pieces.forEach((p, k) => {
    const key = `${p.piece}|${p.swatchMap ? JSON.stringify(p.swatchMap) : ""}|${p.tilt ?? ""}|${p.stretch ?? ""}`
    let s = slot.get(key)
    if (s === undefined) {
      s = kinds.length
      kinds.push({
        piece: p.piece,
        ...(p.swatchMap ? { swatchMap: p.swatchMap } : {}),
        ...(p.tilt ? { tilt: p.tilt } : {}),
        ...(p.stretch !== undefined ? { stretch: p.stretch } : {}),
      })
      slot.set(key, s)
    }
    index[k] = s
    place.set([p.x, p.y, p.z, p.rot, p.scale], k * 5)
  })
  return { kinds, index, place, ...grouped }
}

/** The packed pieces back as placements (cluster parts included, in the world). */
export function unpack(p: PackedPieces): PlacedPiece[] {
  return Array.from(p.index, (s, k) => ({
    ...(p.kinds[s] as PackedPieces["kinds"][number]),
    x: p.place[k * 5] as number,
    y: p.place[k * 5 + 1] as number,
    z: p.place[k * 5 + 2] as number,
    rot: p.place[k * 5 + 3] as number,
    scale: p.place[k * 5 + 4] as number,
  }))
}

/** A tile cluster as the batch takes it: its parts in its own space, placed at the tile's centre. */
export interface TileCluster {
  key: string
  x: number
  y: number
  z: number
  rot: number
  scale: number
  parts: PlacedPiece[]
}

/** The packed pieces as the batch takes them: the loose ones, and the tile clusters (`keep` filters both). */
export function batchSets(
  p: PackedPieces,
  keep: (piece: PlacedPiece) => boolean = () => true,
): { loose: PlacedPiece[]; clusters: TileCluster[] } {
  const all = unpack(p)
  const clusters: TileCluster[] = p.clusters.map((c) => ({ ...c, rot: 0, scale: 1, parts: [] }))
  const loose: PlacedPiece[] = []
  all.forEach((piece, k) => {
    if (!keep(piece)) return
    const c = clusters[p.cluster[k] as number]
    if (!c) loose.push(piece)
    else c.parts.push({ ...piece, x: piece.x - c.x, y: piece.y - c.y, z: piece.z - c.z })
  })
  return { loose, clusters: clusters.filter((c) => c.parts.length > 0) }
}

/** The typed arrays a stage hands over when posted. */
export function transferables(msg: FromWorker): ArrayBuffer[] {
  if (msg.type === "shore") return [msg.shore.data.buffer as ArrayBuffer]
  if (msg.type === "map") {
    const s = msg.map.structures
    return [msg.map.paths, ...(s ? [s.position, s.color, s.normal] : [])].map((a) => a.buffer as ArrayBuffer)
  }
  if (msg.type === "pieces")
    return [msg.pieces.index, msg.pieces.place, msg.pieces.cluster].map((a) => a.buffer as ArrayBuffer)
  if (msg.type !== "ground") return []
  const g = msg.ground
  const arrays = g.mesh ? [g.heights.y, g.mesh.position, g.mesh.color, g.mesh.normal] : [g.heights.y]
  return arrays.map((a) => a.buffer as ArrayBuffer)
}

/**
 * Builds the island for `spec`, posting each stage as it is ready (`post` is the worker's postMessage,
 * or a callback when it runs inline).
 */
export function runHexJob(
  spec: HexJobSpec,
  post: (msg: FromWorker) => void,
  now: () => number = () => performance.now(),
): void {
  const times: Record<string, number> = {}
  let t0 = now()
  const lap = (name: string) => {
    const t = now()
    times[name] = Math.round(t - t0)
    t0 = t
  }
  if (spec.tiles) installTilePrefabs(spec.tiles)
  const h = hexIsland({ ...spec.shape, seed: spec.seed, files: spec.files })
  lap("island")
  const z = hexZones(h, { wild: spec.nature?.wild })
  lap("zones")
  const w = hexWorld(h, z, { step: spec.step, nature: spec.nature })
  lap("world")
  const R = HEX_TILE_SIZE
  const { pools, pooled, sunk } = sinkPools(w)
  let span = 0
  for (const t of w.tiles) span = Math.max(span, Math.abs(t.x), Math.abs(t.z))
  span += R * 4
  const heartTile = z.zones[0] ? w.tiles.find((t) => t.i === z.zones[0]!.tile) : undefined
  const built = hexStructures(w, spec.seed)
  post({
    type: "map",
    map: {
      span,
      heart: heartTile ? [heartTile.x, heartTile.top, heartTile.z] : null,
      paths: new Float32Array(w.paths),
      structures: built.position.length ? vertexMeshData(built.position, built.color) : null,
      pools: pools.map((t) => ({ x: t.x, z: t.z, y: t.top - SURFACE_DROP, flow: flowOf(h, t.i) })),
      // the night: a light in every lantern the tiles hold
      lamps: w.pieces
        .filter((p) => p.piece === LANTERN)
        .map((p) => [p.x, p.y + 2.03 * p.scale, p.z] as [number, number, number]),
      stats: {
        land: h.stats.land,
        tiles: w.tiles.length,
        prefabs: w.stats.prefabs,
        ...(w.stats.nature ? { nature: w.stats.nature } : {}),
      },
    },
  })
  const palette = { top: TOP, side: SIDE, sideLand: SIDE_LAND, slope: TOP.sand! }
  let mesh: GroundStage["mesh"] = null
  let prisms: Prism[] | null = null
  let heights = tileHeights(h, w)
  let groundAt: ((x: number, z: number) => number) | null = null
  if (spec.ground === "hex")
    prisms = w.tiles.map((t) => {
      const v = 0.95 + 0.1 * (((t.i * 2654435761) >>> 0) / 4294967296)
      const c = TOP[t.ground] ?? TOP.grass!
      return {
        x: t.x,
        z: t.z,
        top: pooled.has(t.i) ? t.top - BED_DROP : t.top,
        color: [c[0] * v, c[1] * v, c[2] * v],
        side: SIDE[t.ground] ?? SIDE_LAND,
      }
    })
  else if (spec.ground === "soft") {
    const m = hexGroundMesh(h, sunk, palette)
    mesh = vertexMeshData(m.position, m.color)
  } else {
    // fine ground: small hexes, low terraces on the hills, land falling to the shore; nature stands on it
    const m = hexGroundFine(h, sunk, palette, 3, -2.5, spec.paint)
    mesh = vertexMeshData(m.position, m.color)
    groundAt = m.heightAt
    heights = m.heights
  }
  lap("ground")
  post({
    type: "ground",
    ground: {
      mesh,
      prisms,
      heights,
      times,
    },
  })
  // the pieces: nature stands on the fine ground as built, each kept as far over it as its tile put it
  // (a shield hung on a straw bale, papers pinned on a board, a flower in its pot). Life plans on the
  // pieces as the world placed them (their solids stand on the tile), so their heights are kept.
  const placedY = w.pieces.map((p) => p.y)
  if (groundAt)
    for (const p of w.pieces) {
      const y = groundAt(p.x, p.z)
      const shift = y - w.heightAt(p.x, p.z)
      if (y > 0 && Math.abs(shift) < 3) p.y += shift
    }
  post({ type: "pieces", pieces: pack(w.pieces, clusterTiles(h, w)) })
  // The shore field: how far every point of the water is from land (anything but a water tile).
  t0 = now()
  const g = h.grid
  const land = new Uint8Array(g.size)
  for (const t of w.tiles) if (t.ground !== "water") land[t.i] = 1
  const size = span * 2
  const res = Math.min(SHORE_MAX_RES, Math.ceil(size / SHORE_TEXEL))
  const min: [number, number] = [-span, -span]
  const data = shoreBytes({
    min,
    size,
    res,
    reach: SHORE_REACH,
    isLand: (x, zz) => {
      const [q, r] = axialAt(x, zz, R)
      const i = g.index(q, r)
      return i >= 0 && land[i] === 1
    },
  })
  post({ type: "shore", shore: { min, size, res, reach: SHORE_REACH, data, ms: Math.round(now() - t0) } })
  if (spec.life) {
    const placed = { ...w, pieces: w.pieces.map((p, k) => ({ ...p, y: placedY[k] as number })) }
    post({ type: "life", life: planLife(h, z, placed, spec.seed, now) })
  }
}
