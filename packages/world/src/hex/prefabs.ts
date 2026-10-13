/**
 * Tile prefabs as data (`data/tiles/<id>.json`, edited in the tile composer): the validator every file
 * passes before the world builds from it (the studio's `/data/` endpoint refuses a write that fails it),
 * and the parse that turns a set of files into prefabs for `installTilePrefabs`.
 */
import { DRILLS, pairedDrill } from "./drills.ts"
import type { TileGround, TilePrefab } from "./tiles.ts"

export const TILE_GROUNDS: readonly TileGround[] = ["grass", "soil", "dirt", "paved", "sand", "rock", "water"]
export const TILE_GROUPS = ["town", "country", "ground", "landmark", "road"] as const
export const SPOT_KINDS = ["sit", "work", "stand", "sleep", "talk"] as const

/** How far from its tile's centre anything may stand, metres (a tile is 3.1 to its corner; footprints reach further). */
const REACH = 3.2
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/
const PIECE = /^[a-z0-9-]+\/[a-z0-9-]+$/

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** Every problem with `json` as a tile prefab (none: it is one). `file` names the file it came from, if any. */
export function validateTilePrefab(json: unknown, file?: string): string[] {
  const out: string[] = []
  if (!isObj(json)) return ["tile: expected an object"]
  const t = json
  const at = (path: string, msg: string) => out.push(`${path}: ${msg}`)
  if (typeof t.id !== "string" || !ID.test(t.id)) at("id", "a kebab-case id")
  else if (file !== undefined && file !== t.id) at("id", `"${t.id}" is not the file's name "${file}"`)
  if (typeof t.name !== "string" || !t.name.trim()) at("name", "a name")
  if (!TILE_GROUNDS.includes(t.ground as TileGround)) at("ground", `one of ${TILE_GROUNDS.join(", ")}`)
  if (t.group !== undefined && !TILE_GROUPS.includes(t.group as (typeof TILE_GROUPS)[number]))
    at("group", `one of ${TILE_GROUPS.join(", ")}`)
  // a footprint reaches a whole neighbour further: two apothems
  const reach = REACH + (Array.isArray(t.footprint) && t.footprint.length ? 5.4 : 0)
  const point = (path: string, o: Obj) => {
    if (!isNum(o.x) || !isNum(o.z)) return at(path, "x and z in metres")
    if (Math.hypot(o.x, o.z) > reach)
      at(path, `stands ${Math.hypot(o.x, o.z).toFixed(2)} m out, past the tile`)
  }
  if (t.path !== undefined) {
    if (!Array.isArray(t.path) || t.path.some((d) => !Number.isInteger(d) || d < 0 || d > 5))
      at("path", "sides 0–5")
    else if (new Set(t.path).size !== t.path.length) at("path", "a side twice")
  }
  if (!Array.isArray(t.pieces)) at("pieces", "a list")
  else
    t.pieces.forEach((q, k) => {
      const path = `pieces[${k}]`
      if (!isObj(q)) {
        at(path, "an object")
        return
      }
      if (typeof q.piece !== "string" || !PIECE.test(q.piece)) at(`${path}.piece`, "a catalog id (pack/name)")
      point(path, q)
      if (!isNum(q.rot)) at(`${path}.rot`, "radians")
      if (!isNum(q.scale) || q.scale <= 0 || q.scale > 4) at(`${path}.scale`, "a scale in (0, 4]")
      if (q.y !== undefined && (!isNum(q.y) || Math.abs(q.y) > 3)) at(`${path}.y`, "metres within ±3")
      if (
        q.tilt !== undefined &&
        (!Array.isArray(q.tilt) ||
          q.tilt.length !== 2 ||
          !q.tilt.every((a) => isNum(a) && Math.abs(a) <= Math.PI))
      )
        at(`${path}.tilt`, "[about x, about z] radians within ±π")
      if (q.odds !== undefined && (!isNum(q.odds) || q.odds <= 0 || q.odds > 1))
        at(`${path}.odds`, "in (0, 1]")
      if (q.tone !== undefined && typeof q.tone !== "boolean") at(`${path}.tone`, "true or false")
      if (q.pin !== undefined && typeof q.pin !== "boolean") at(`${path}.pin`, "true or false")
      if (q.swatchMap !== undefined && !swatchMap(q.swatchMap)) at(`${path}.swatchMap`, "swatch → swatch")
    })
  if (t.tones !== undefined && (!Array.isArray(t.tones) || !t.tones.every(swatchMap)))
    at("tones", "a list of swatch maps")
  if (t.variants !== undefined) {
    if (!Array.isArray(t.variants) || t.variants.some((v) => typeof v !== "string" || !ID.test(v)))
      at("variants", "a list of tile ids")
  }
  if (t.spots !== undefined) {
    if (!Array.isArray(t.spots)) at("spots", "a list")
    else
      t.spots.forEach((s, k) => {
        const path = `spots[${k}]`
        if (!isObj(s)) {
          at(path, "an object")
          return
        }
        if (!SPOT_KINDS.includes(s.kind as (typeof SPOT_KINDS)[number]))
          at(`${path}.kind`, `one of ${SPOT_KINDS.join(", ")}`)
        point(path, s)
        if (!isNum(s.facing)) at(`${path}.facing`, "radians")
        if (s.clip !== undefined && (typeof s.clip !== "string" || !s.clip)) at(`${path}.clip`, "a clip name")
        if (s.prop !== undefined && (typeof s.prop !== "string" || !PIECE.test(s.prop)))
          at(`${path}.prop`, "a catalog id (pack/name)")
        if (
          s.roles !== undefined &&
          (!Array.isArray(s.roles) || s.roles.some((r) => typeof r !== "string" || !ID.test(r)))
        )
          at(`${path}.roles`, "a list of npc role ids")
        if (s.y !== undefined && (!isNum(s.y) || Math.abs(s.y) > 3)) at(`${path}.y`, "metres within ±3")
        if (s.hours !== undefined && !hoursOk(s.hours))
          at(`${path}.hours`, "[from, to] day hours 0–24, or a list of such windows")
        if (s.drill !== undefined && (typeof s.drill !== "string" || !DRILLS[s.drill]))
          at(`${path}.drill`, `one of ${Object.keys(DRILLS).join(", ")}`)
        if (s.pair !== undefined && (typeof s.pair !== "string" || !ID.test(s.pair)))
          at(`${path}.pair`, "a pair name (kebab-case)")
      })
    // a duel's two sides: each pair name twice, both playing a two-sided drill
    const pairs = new Map<string, Obj[]>()
    for (const s of Array.isArray(t.spots) ? t.spots : [])
      if (isObj(s) && typeof s.pair === "string") pairs.set(s.pair, [...(pairs.get(s.pair) ?? []), s])
    for (const [name, list] of pairs) {
      if (list.length !== 2) at("spots", `pair "${name}" has ${list.length} spots, not 2`)
      if (list.some((s) => typeof s.drill !== "string" || !pairedDrill(s.drill)))
        at("spots", `pair "${name}" plays no two-sided drill`)
    }
  }
  if (t.blockers !== undefined) {
    if (!Array.isArray(t.blockers)) at("blockers", "a list")
    else
      t.blockers.forEach((b, k) => {
        const path = `blockers[${k}]`
        if (!isObj(b)) {
          at(path, "an object")
          return
        }
        point(path, b)
        if (!isNum(b.r) || b.r <= 0 || b.r > 3) at(`${path}.r`, "a radius in (0, 3] m")
      })
  }
  if (t.decks !== undefined) {
    if (!Array.isArray(t.decks)) at("decks", "a list")
    else
      t.decks.forEach((d, k) => {
        const path = `decks[${k}]`
        if (!isObj(d)) {
          at(path, "an object")
          return
        }
        point(`${path}.a`, { x: d.ax, z: d.az })
        point(`${path}.b`, { x: d.bx, z: d.bz })
        if (!isNum(d.half) || d.half <= 0 || d.half > 3) at(`${path}.half`, "a half width in (0, 3] m")
      })
  }
  if (t.tier !== undefined && (!Number.isInteger(t.tier) || (t.tier as number) < 1 || (t.tier as number) > 4))
    at("tier", "a castle tier 1–4")
  if (t.footprint !== undefined) {
    if (!Array.isArray(t.footprint) || t.footprint.some((k) => !Number.isInteger(k) || k < 0 || k > 5))
      at("footprint", "a list of tile sides 0–5")
    else if (new Set(t.footprint).size !== t.footprint.length) at("footprint", "a side twice")
  }
  return out
}

/** One window [from, to] in day hours 0–24. */
const windowOk = (v: unknown): boolean =>
  Array.isArray(v) && v.length === 2 && v.every((h) => isNum(h) && h >= 0 && h <= 24)
/** A window, or a non-empty list of windows. */
const hoursOk = (v: unknown): boolean =>
  windowOk(v) || (Array.isArray(v) && v.length > 0 && v.every(windowOk))

const swatchMap = (v: unknown): boolean =>
  isObj(v) &&
  Object.entries(v).every(([k, s]) => /^\d+$/.test(k) && Number.isInteger(s) && (s as number) >= 0)

/**
 * The prefabs among `files` (id → parsed JSON) that pass the validator, and the problems of those that
 * do not (they are left out, so one bad file does not take the rest down).
 */
export function parseTilePrefabs(files: Readonly<Record<string, unknown>>): {
  prefabs: TilePrefab[]
  problems: string[]
} {
  const prefabs: TilePrefab[] = []
  const problems: string[] = []
  for (const [id, json] of Object.entries(files)) {
    const bad = validateTilePrefab(json, id)
    if (bad.length) problems.push(...bad.map((p) => `tiles/${id}.json ${p}`))
    else prefabs.push(json as TilePrefab)
  }
  return { prefabs, problems }
}
