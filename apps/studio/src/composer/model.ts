/**
 * The tile composer's document: one tile prefab (world `TilePrefab`, saved as `data/tiles/<id>.json`)
 * and pure edits on it. Every edit returns a new prefab; nothing here touches the stage.
 */
import {
  blockerShapes,
  HEX_TILE_SIZE,
  isBlockerBox,
  isBlockerOf,
  pieceOutline,
  shapeDistance,
  type TileBlocker,
  type TilePiece,
  type TilePrefab,
  type TileSpot,
} from "@guildhall/world"

/** What the composer can select: a piece, a spot or a blocker, by its index in its list. */
export type Layer = "pieces" | "spots" | "blockers"
export interface Selection {
  layer: Layer
  i: number
}

export type SpotKind = TileSpot["kind"]

/** The clip a new spot of each kind plays (KayKit rig-medium names). */
export const KIND_CLIP: Record<SpotKind, string> = {
  sit: "Sit_Chair_Idle",
  work: "Working_A",
  stand: "Idle_A",
  talk: "Idle_B",
  sleep: "Lie_Idle",
}

/** A spot kind's marker colour: distinct in hue and in lightness, so they read apart without colour too. */
export const KIND_COLOUR: Record<SpotKind, string> = {
  sit: "#4fc3f7",
  work: "#ffb74d",
  stand: "#e6ee9c",
  talk: "#f48fb1",
  sleep: "#b39ddb",
}
export const BLOCKER_COLOUR = "#ff6e5a"

/** Numbers as the files keep them: millimetres. */
const mm = (v: number) => Math.round(v * 1000) / 1000

/** The deep link's tile id (`/composer/<id>`), or null when it is missing or not a kebab id. */
export function parseTileId(raw: string | null): string | null {
  return raw && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(raw) ? raw : null
}

/** A copy of `t` with every number rounded to the millimetre (what save writes). */
export function tidy(t: TilePrefab): TilePrefab {
  const round = (v: unknown): unknown =>
    typeof v === "number"
      ? mm(v)
      : Array.isArray(v)
        ? v.map(round)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v)
                .filter(([, x]) => x !== undefined)
                .map(([k, x]) => [k, round(x)]),
            )
          : v
  return round(t) as TilePrefab
}

/** `list` of `t` with item `i` replaced by `f(item)`. */
function edit<K extends Layer>(
  t: TilePrefab,
  layer: K,
  i: number,
  f: (item: NonNullable<TilePrefab[K]>[number]) => NonNullable<TilePrefab[K]>[number],
): TilePrefab {
  const list = [...((t[layer] ?? []) as NonNullable<TilePrefab[K]>[number][])]
  if (!list[i]) return t
  list[i] = f(list[i]!)
  return { ...t, [layer]: list }
}

/** Patches one piece (undefined fields are dropped, so `odds: undefined` clears the odds). */
export function patchPiece(t: TilePrefab, i: number, patch: Partial<TilePiece>): TilePrefab {
  return edit(t, "pieces", i, (q) => strip({ ...q, ...patch }))
}
export function patchSpot(t: TilePrefab, i: number, patch: Partial<TileSpot>): TilePrefab {
  return edit(t, "spots", i, (s) => strip({ ...s, ...patch }))
}
export function patchBlocker(
  t: TilePrefab,
  i: number,
  patch: { [K in "x" | "z" | "r" | "w" | "d" | "rot" | "pad"]?: number },
): TilePrefab {
  return edit(t, "blockers", i, (b) => strip({ ...b, ...patch }) as TileBlocker)
}

const strip = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T

/**
 * Moves whatever `sel` names to (x, z) and, for a piece, a spot or a box, turns it to `rot` (radians). A
 * blocker that is a piece's own shape moves with its piece, not on its own: it stays.
 */
export function moveTo(t: TilePrefab, sel: Selection, x: number, z: number, rot?: number): TilePrefab {
  if (sel.layer === "pieces")
    return patchPiece(t, sel.i, { x: mm(x), z: mm(z), ...(rot === undefined ? {} : { rot: mm(rot) }) })
  if (sel.layer === "spots")
    return patchSpot(t, sel.i, { x: mm(x), z: mm(z), ...(rot === undefined ? {} : { facing: mm(rot) }) })
  const b = t.blockers?.[sel.i]
  if (!b || isBlockerOf(b)) return t
  return patchBlocker(t, sel.i, {
    x: mm(x),
    z: mm(z),
    ...(rot !== undefined && isBlockerBox(b) ? { rot: mm(rot) } : {}),
  })
}

/** Adds a piece at (x, z); returns the prefab and the new piece's index. */
export function addPiece(t: TilePrefab, piece: string, x = 0, z = 0, scale = 0.5): [TilePrefab, number] {
  const pieces = [...t.pieces, { piece, x: mm(x), z: mm(z), rot: 0, scale }]
  return [{ ...t, pieces }, pieces.length - 1]
}

/** Adds a spot of `kind` at (x, z) facing the street (+z), with its kind's clip. */
export function addSpot(t: TilePrefab, kind: SpotKind, x = 0, z = 0.8): [TilePrefab, number] {
  const spots = [...(t.spots ?? []), { kind, x: mm(x), z: mm(z), facing: 0, clip: KIND_CLIP[kind] }]
  return [{ ...t, spots }, spots.length - 1]
}

export function addBlocker(t: TilePrefab, x = 0, z = 0, r = 0.5): [TilePrefab, number] {
  const blockers = [...(t.blockers ?? []), { x: mm(x), z: mm(z), r: mm(r) }]
  return [{ ...t, blockers }, blockers.length - 1]
}

/** Adds a box blocker (written out by hand: `w` along its own x, `d` along its z) at (x, z). */
export function addBox(t: TilePrefab, x = 0, z = 0, w = 0.8, d = 0.6): [TilePrefab, number] {
  const blockers = [...(t.blockers ?? []), { x: mm(x), z: mm(z), w: mm(w), d: mm(d), rot: 0 }]
  return [{ ...t, blockers }, blockers.length - 1]
}

/**
 * A blocker for piece `i`: its own shape (`{ of: i }`, world blockers.ts: a box or a circle per part,
 * from its outline as placed), which follows the piece. One it already has is picked instead.
 */
export function blockerFor(t: TilePrefab, i: number): [TilePrefab, number] {
  if (!t.pieces[i]) return [t, -1]
  const have = (t.blockers ?? []).findIndex((b) => isBlockerOf(b) && b.of === i)
  if (have >= 0) return [t, have]
  const blockers = [...(t.blockers ?? []), { of: i }]
  return [{ ...t, blockers }, blockers.length - 1]
}

/**
 * Blocker `i`, a piece's own shape, written out as the boxes and circles it is now (a manual override:
 * they stay where they are when the piece moves, and can be sized by hand). Returns its first index.
 */
export function writeOut(t: TilePrefab, i: number): [TilePrefab, number] {
  const b = t.blockers?.[i]
  if (!b || !isBlockerOf(b)) return [t, i]
  const shapes = blockerShapes(b, t.pieces).map(
    (sh): TileBlocker =>
      sh.kind === "circle"
        ? { x: mm(sh.x), z: mm(sh.z), r: mm(sh.r) }
        : { x: mm(sh.x), z: mm(sh.z), w: mm(sh.w), d: mm(sh.d), rot: mm(sh.rot) },
  )
  if (!shapes.length) return [t, i]
  const blockers = [...(t.blockers ?? [])]
  blockers.splice(i, 1, ...shapes)
  return [{ ...t, blockers }, i]
}

/** What a blocker is, for the lists: the piece it is the shape of, a box, a circle. */
export function blockerLabel(t: TilePrefab, b: TileBlocker): { what: string; num: string } {
  if (isBlockerOf(b)) {
    const n = blockerShapes(b, t.pieces).length
    return {
      what: `${t.pieces[b.of]?.piece.split("/")[1] ?? "?"}`,
      num: `piece ${b.of + 1}${n > 1 ? ` · ${n} parts` : ""}${b.pad ? ` · +${b.pad}` : ""}`,
    }
  }
  if (isBlockerBox(b))
    return { what: "box", num: `${b.w.toFixed(2)}×${b.d.toFixed(2)} · ${b.x.toFixed(1)},${b.z.toFixed(1)}` }
  return { what: "circle", num: `r ${b.r.toFixed(2)} · ${b.x.toFixed(1)},${b.z.toFixed(1)}` }
}

/**
 * Removes the selected item; an emptied optional list is dropped from the file. A piece takes its own
 * blocker with it, and the blockers of the pieces after it follow them down the list.
 */
export function remove(t: TilePrefab, sel: Selection): TilePrefab {
  if (sel.layer === "pieces" && t.blockers?.some(isBlockerOf)) {
    const blockers = t.blockers
      .filter((b) => !isBlockerOf(b) || b.of !== sel.i)
      .map((b) => (isBlockerOf(b) && b.of > sel.i ? { ...b, of: b.of - 1 } : b))
    const { blockers: _old, ...rest } = t
    t = blockers.length ? { ...rest, blockers } : (rest as TilePrefab)
  }
  const list = ((t[sel.layer] ?? []) as unknown[]).filter((_, k) => k !== sel.i)
  if (sel.layer !== "pieces" && list.length === 0) {
    const { [sel.layer]: _gone, ...rest } = t
    return rest as TilePrefab
  }
  return { ...t, [sel.layer]: list }
}

/** A copy of the selected item a little to its side; returns its index. */
export function duplicate(t: TilePrefab, sel: Selection): [TilePrefab, number] {
  const list = [...((t[sel.layer] ?? []) as { x: number; z: number }[])]
  const item = list[sel.i]
  // (a piece's own shape is the piece's: copy the piece)
  if (!item || (sel.layer === "blockers" && isBlockerOf(item as TileBlocker))) return [t, -1]
  list.push({ ...item, x: mm(item.x + 0.5) })
  return [{ ...t, [sel.layer]: list }, list.length - 1]
}

/** Whether a point (tile space) is on the tile: inside its hexagon (pointy-top, corner at HEX_TILE_SIZE). */
export function onTile(x: number, z: number, inset = 0): boolean {
  const R = HEX_TILE_SIZE - inset
  const ax = Math.abs(x)
  const az = Math.abs(z)
  // tile space has its corners on ±x and a side across +z (tiles.ts TILE_SIDES)
  return az <= (R * Math.sqrt(3)) / 2 && az <= Math.sqrt(3) * (R - ax)
}

/** Everything wrong with the document a save would still accept, as warnings for the readout. */
export function lint(
  t: TilePrefab,
  known: { piece(id: string): boolean; clip(name: string): boolean; prop(id: string): boolean },
): string[] {
  const out: string[] = []
  t.pieces.forEach((q, k) => {
    if (!known.piece(q.piece)) out.push(`piece ${k + 1}: ${q.piece} is not in the library`)
    if (!onTile(q.x, q.z) && !t.footprint?.length)
      out.push(`piece ${k + 1} (${q.piece.split("/")[1]}) stands off the tile`)
  })
  t.spots?.forEach((s, k) => {
    if (s.clip && !known.clip(s.clip)) out.push(`spot ${k + 1}: no clip "${s.clip}" on rig-medium`)
    if (s.prop && !known.prop(s.prop)) out.push(`spot ${k + 1}: ${s.prop} has no grip (data/mounts.json)`)
    if (!onTile(s.x, s.z, 0.15) && !t.footprint?.length) out.push(`spot ${k + 1} is off the tile`)
    // (a sitter is in its seat's shape, a sleeper on its bed's: the seat and the bed are what they use)
    for (const [j, b] of (t.blockers ?? []).entries())
      if (
        s.kind !== "sit" &&
        s.kind !== "sleep" &&
        blockerShapes(b, t.pieces).some((sh) => shapeDistance(sh, s.x, s.z) < -0.05)
      )
        out.push(`spot ${k + 1} stands inside blocker ${j + 1}`)
  })
  t.blockers?.forEach((b, j) => {
    if (!isBlockerOf(b)) return
    const q = t.pieces[b.of]
    if (!q) out.push(`blocker ${j + 1}: there is no piece ${b.of + 1}`)
    else if (!blockerShapes(b, t.pieces).length)
      out.push(
        `blocker ${j + 1}: ${q.piece.split("/")[1]} has ${pieceOutline(q.piece) ? "no parts to walk round" : "no outline"}: write a box or a circle`,
      )
  })
  return out
}

/**
 * Piece `i` set on the tile edge nearest it (side d's middle at `inset` of the apothem), turned so its
 * length (local x) runs along the edge; with `length` (its catalog width at scale 1) it is also scaled
 * to span the edge exactly, so a ring of them closes with no gaps.
 */
export function snapToEdge(t: TilePrefab, i: number, inset = 0.95, length?: number): TilePrefab {
  const q = t.pieces[i]
  if (!q) return t
  // tile side k faces 30° + 60°·k counter-clockwise from +x, toward -z (tiles.ts sideDir)
  const a0 = Math.atan2(-q.z, q.x)
  const k = Math.round((a0 - Math.PI / 6) / (Math.PI / 3))
  const a = Math.PI / 6 + (Math.PI / 3) * k
  const apothem = (HEX_TILE_SIZE * Math.sqrt(3)) / 2
  const patch: Partial<TilePiece> = {
    x: mm(Math.cos(a) * apothem * inset),
    z: mm(-Math.sin(a) * apothem * inset),
    rot: mm(a - Math.PI / 2),
  }
  if (length) patch.scale = mm((HEX_TILE_SIZE * inset) / length)
  return patchPiece(t, i, patch)
}

/** Grid snap for a typed or dragged point: to `step` metres. */
export const snap = (v: number, step = 0.05): number => mm(Math.round(v / step) * step)

/** An undo history of documents: `push` a new state, step `back` and `forward`. */
export interface History {
  past: TilePrefab[]
  now: TilePrefab
  future: TilePrefab[]
}
const DEPTH = 200
export const history = (now: TilePrefab): History => ({ past: [], now, future: [] })
export const push = (h: History, next: TilePrefab): History =>
  next === h.now ? h : { past: [...h.past, h.now].slice(-DEPTH), now: next, future: [] }
export const back = (h: History): History =>
  h.past.length
    ? { past: h.past.slice(0, -1), now: h.past[h.past.length - 1]!, future: [h.now, ...h.future] }
    : h
export const forward = (h: History): History =>
  h.future.length ? { past: [...h.past, h.now], now: h.future[0]!, future: h.future.slice(1) } : h

/** A copy of `t` under a new id and name (the composer's "duplicate prefab"); variants are not carried over. */
export function copyAs(t: TilePrefab, id: string, name?: string): TilePrefab {
  const { variants: _v, ...rest } = t
  return { ...rest, id, name: name ?? `${t.name} (copy)` }
}
