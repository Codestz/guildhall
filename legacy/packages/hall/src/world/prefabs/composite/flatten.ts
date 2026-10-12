import { DMath } from "../../dmath.ts"
import type { KitColour } from "../../gen/biomes.ts"
import { HEX_SCALE, PIECES } from "../../lands.ts"
import { type Door, type Fixture, type Part, type Prefab, pieceOf } from "../types.ts"
import { KITS, resolve, roll } from "../variants.ts"
import {
  type Composed,
  type Composite,
  type Group,
  isGroup,
  isRef,
  type Node,
  type Tree,
  type Variant,
} from "./types.ts"

/**
 * Flattening a composite (types.ts) to a plain prefab for one seed: the seed's choices are made
 * (variantOf), the groups' transforms are folded into each piece, child prefabs and composites are
 * resolved by id (their own seeds drawn from this one) and the whole plan is flipped if the seed says
 * so. What comes out is a `Prefab` in the same frame, so instantiate, doorsOf and statsOf take it as is.
 */

/** A prefab or composite by id, or nothing: how a `Ref` is resolved (composite/index.ts binds it to the catalogue). */
export type Lookup = (id: string) => Prefab | Composite | undefined

const FLAGS = ["blue", "red", "yellow"] as const
/** The share of tinted composites that keep their district's colour (as variants.ts). */
const KEEP_KIT = 0.5

const round = (value: number): number => Math.round(value * 100) / 100

/** The seed's choices for one composite. Pure: each is drawn from the seed and its own salt. */
export function variantOf(composite: Composite, seed: number, kit: KitColour): Variant {
  const plain = seed === 0
  const tint = !plain && composite.variation.tint === true
  const swapped: string[] = []
  return {
    seed,
    swapped,
    kit:
      tint && roll(seed, "tint") >= KEEP_KIT
        ? (KITS[Math.floor(roll(seed, "colour") * KITS.length)] ?? kit)
        : kit,
    flag: tint ? (FLAGS[Math.floor(roll(seed, "flag") * FLAGS.length)] ?? "blue") : "blue",
    int: (salt, base, lo, hi) => (plain ? base : lo + Math.floor(roll(seed, `int:${salt}`) * (hi - lo + 1))),
    pick: (salt, list) => {
      const n = plain ? 0 : Math.floor(roll(seed, `pick:${salt}`) * list.length)
      if (n > 0) swapped.push(`${salt} → ${String(list[n])}`)
      return list[n] as never
    },
    has: (salt, chance = 0.5) => (plain ? chance >= 0.5 : roll(seed, `has:${salt}`) < chance),
  }
}

/** A group's frame in the prefab's: where its origin stands, how it is turned, and its scale. */
interface Frame {
  x: number
  y: number
  z: number
  rot: number
  k: number
}
const ROOT: Frame = { x: 0, y: 0, z: 0, rot: 0, k: 1 }

function within(
  frame: Frame,
  pose: { x?: number; z?: number; y?: number; rot?: number; scale?: number },
): Frame {
  const [sin, cos] = [DMath.sin(frame.rot), DMath.cos(frame.rot)]
  const [lx, lz] = [(pose.x ?? 0) * frame.k, (pose.z ?? 0) * frame.k]
  return {
    x: frame.x + lx * cos + lz * sin,
    y: frame.y + (pose.y ?? 0) * frame.k,
    z: frame.z - lx * sin + lz * cos,
    rot: frame.rot + (pose.rot ?? 0),
    k: frame.k * (pose.scale ?? 1),
  }
}

const spot = (frame: Frame, at: Fixture): Fixture => {
  const f = within(frame, { x: at.x, z: at.z, y: at.y })
  return { x: round(f.x), y: round(f.y), z: round(f.z) }
}

/** Everything a walk of the tree gathers. */
interface Gathered {
  parts: Part[]
  doors: Door[]
  windows: Fixture[]
  chimneys: Fixture[]
  smoke: Fixture[]
  focal?: Fixture
}

interface Walk {
  lookup: Lookup
  seed: number
  kit: KitColour
  out: Gathered
}

/** A child's own seed: none at seed 0 (the plain child), otherwise drawn from this seed and the child's place. */
const childSeed = (seed: number, path: string): number =>
  seed === 0 ? 0 : 1 + Math.floor(roll(seed, `child:${path}`) * 1_000_000)

function addPart(walk: Walk, frame: Frame, part: Part, kit = walk.kit): void {
  const f = within(frame, part)
  walk.out.parts.push({
    piece: pieceOf(part.piece, kit),
    x: round(f.x),
    z: round(f.z),
    ...(f.rot ? { rot: round(f.rot) } : {}),
    ...(f.y ? { y: round(f.y) } : {}),
    ...(f.k !== 1 ? { scale: round(f.k) } : {}),
  })
}

function addDoor(walk: Walk, frame: Frame, door: Door): void {
  const f = within(frame, door)
  walk.out.doors.push({
    x: round(f.x),
    z: round(f.z),
    rot: round(frame.rot + door.rot),
    ...(door.depth ? { depth: round(door.depth * frame.k) } : {}),
    ...(door.y ? { y: round(door.y * frame.k + frame.y) } : {}),
  })
}

function addMarks(walk: Walk, frame: Frame, marks: Group | Prefab | Composed): void {
  const { out } = walk
  for (const door of marks.doors ?? []) addDoor(walk, frame, door)
  for (const w of marks.windows ?? []) out.windows.push(spot(frame, w))
  for (const c of marks.chimneys ?? []) out.chimneys.push(spot(frame, c))
  const smoke = "smoke" in marks ? marks.smoke : undefined
  for (const s of smoke ?? []) out.smoke.push(spot(frame, s))
  const focal = "focal" in marks ? marks.focal : undefined
  if (focal && !out.focal) out.focal = spot(frame, focal)
}

/** A child prefab: its seed's parts, doors and fixtures, mirrored as it was drawn. */
function addPrefab(walk: Walk, frame: Frame, prefab: Prefab, seed: number): void {
  const made = resolve(prefab, seed, walk.kit)
  for (const part of made.parts) addPart(walk, frame, part, made.kit)
  const flip = (list: readonly Fixture[] | undefined): Fixture[] =>
    (list ?? []).map((at) => ({ ...at, x: made.mirrored ? -at.x : at.x }))
  addMarks(walk, frame, {
    name: prefab.id,
    kids: [],
    doors: made.doors,
    windows: flip(prefab.windows),
    chimneys: flip(prefab.chimneys),
  })
}

function walkNode(walk: Walk, frame: Frame, node: Node, path: string): Tree | undefined {
  if (isRef(node)) {
    const child = walk.lookup(node.ref)
    if (!child) throw new Error(`composite: no prefab or composite "${node.ref}"`)
    const at = within(frame, node)
    const seed = childSeed(walk.seed, path)
    if ("build" in child) {
      const made = flatten(child, seed, walk.kit, walk.lookup)
      for (const part of made.parts) addPart(walk, at, part, walk.kit)
      addMarks(walk, at, made)
      return made.tree
    }
    const before = walk.out.parts.length
    addPrefab(walk, at, child, seed)
    return { name: child.label, pieces: walk.out.parts.length - before, kids: [] }
  }
  if (!isGroup(node)) {
    addPart(walk, frame, node)
    return undefined
  }
  const inner = within(frame, node)
  const before = walk.out.parts.length
  addMarks(walk, inner, node)
  const kids: Tree[] = []
  node.kids.forEach((kid, n) => {
    const sub = walkNode(walk, inner, kid, `${path}/${n}`)
    if (sub) kids.push(sub)
  })
  return { name: node.name, pieces: walk.out.parts.length - before, kids }
}

/** The highest piece's top: where the eye lands when no group names a focal point. */
function topOf(parts: readonly Part[]): Fixture {
  let best: Fixture = { x: 0, y: 0, z: 0 }
  for (const part of parts) {
    const box = (PIECES as Record<string, { max: number[] }>)[part.piece]
    const y = (part.y ?? 0) + (box?.max[1] ?? 0) * HEX_SCALE * (part.scale ?? 1)
    if (y > best.y) best = { x: part.x, y: round(y), z: part.z }
  }
  return best
}

/** The composite as `seed` makes it (0 the plain one), `kit` the district's colour. */
export function flatten(composite: Composite, seed: number, kit: KitColour, lookup: Lookup): Composed {
  const v = variantOf(composite, seed, kit)
  const mirrored = composite.variation.mirror === true && seed !== 0 && roll(seed, "mirror") < 0.5
  const out: Gathered = { parts: [], doors: [], windows: [], chimneys: [], smoke: [] }
  const walk: Walk = { lookup, seed, kit: v.kit, out }
  const tree = walkNode(walk, ROOT, composite.build(v), composite.id) as Tree
  const flip = (x: number): number => (mirrored ? -x : x)
  const fixture = (at: Fixture): Fixture => ({ ...at, x: flip(at.x) })
  const focal = out.focal ?? topOf(out.parts)
  return {
    id: composite.id,
    label: composite.label,
    kind: "landmark",
    rings: composite.rings,
    parts: out.parts.map((part) => ({
      ...part,
      x: flip(part.x),
      ...(part.rot ? { rot: flip(part.rot) } : {}),
    })),
    doors: out.doors.map((door) => ({ ...door, x: flip(door.x), rot: flip(door.rot) })),
    windows: out.windows.map(fixture),
    chimneys: out.chimneys.map(fixture),
    composite,
    seed,
    kit: v.kit,
    flag: v.flag,
    mirrored,
    swapped: v.swapped,
    focal: fixture(focal),
    smoke: out.smoke.map(fixture),
    tree,
  }
}
