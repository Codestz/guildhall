/** The tile composer's document edits (composer/model.ts): pure functions over one tile prefab. */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { blockerShapes, HEX_TILE_SIZE, sideDir, type TilePrefab } from "@guildhall/world"
import {
  addBlocker,
  addPiece,
  addSpot,
  back,
  blockerFor,
  copyAs,
  duplicate,
  forward,
  history,
  KIND_CLIP,
  lint,
  moveTo,
  onTile,
  parseTileId,
  patchPiece,
  push,
  remove,
  snapToEdge,
  tidy,
  writeOut,
} from "../src/composer/model.ts"

const tile = (): TilePrefab => ({
  id: "demo",
  name: "Demo",
  ground: "grass",
  pieces: [{ piece: "kenney-nature/fence-simple-low", x: 0.3, z: 2.2, rot: 0, scale: 1 }],
})
const APOTHEM = (HEX_TILE_SIZE * Math.sqrt(3)) / 2

describe("tile composer document", () => {
  test("a deep link names a kebab tile id, or nothing", () => {
    expect(parseTileId("tavern-yard")).toBe("tavern-yard")
    for (const bad of [null, "", "Tavern", "a/b", "../x"]) expect(parseTileId(bad)).toBeNull()
  })

  test("adding returns the new item's index; spots take their kind's clip", () => {
    const [t1, i] = addPiece(tile(), "kenney-pirate/barrel", 1, 1)
    expect(i).toBe(1)
    const [t2, s] = addSpot(t1, "sit")
    expect(t2.spots?.[s]).toMatchObject({ kind: "sit", clip: KIND_CLIP.sit, facing: 0 })
    const [t3, b] = addBlocker(t2, 1, 1, 0.4)
    expect(t3.blockers?.[b]).toEqual({ x: 1, z: 1, r: 0.4 })
  })

  test("moving takes a piece's turn and a spot's facing; a blocker only moves", () => {
    const [t, s] = addSpot(tile(), "work")
    const moved = moveTo(
      moveTo(t, { layer: "pieces", i: 0 }, 1.23456, -0.5, 1),
      { layer: "spots", i: s },
      0.5,
      0.5,
      2,
    )
    expect(moved.pieces[0]).toMatchObject({ x: 1.235, z: -0.5, rot: 1 })
    expect(moved.spots?.[s]).toMatchObject({ x: 0.5, z: 0.5, facing: 2 })
  })

  test("removing the last spot drops the list; a piece list stays", () => {
    const [t] = addSpot(tile(), "talk")
    expect(remove(t, { layer: "spots", i: 0 }).spots).toBeUndefined()
    expect(remove(t, { layer: "pieces", i: 0 }).pieces).toEqual([])
  })

  test("duplicate copies beside the original; a blocker for a piece is that piece's own shape", () => {
    const [t, i] = duplicate(tile(), { layer: "pieces", i: 0 })
    expect(t.pieces[i]).toMatchObject({ x: 0.8, z: 2.2 })
    const [b, j] = blockerFor(patchPiece(t, 0, { scale: 0.5 }), 0)
    expect(b.blockers?.[j]).toEqual({ of: 0 })
    // (asked again: the one it has)
    expect(blockerFor(b, 0)).toEqual([b, j])
    // its shape follows the piece: a box along the fence, where the fence now stands
    const [sh] = blockerShapes(b.blockers![j]!, moveTo(b, { layer: "pieces", i: 0 }, 1, 1).pieces)
    expect(sh).toMatchObject({ kind: "box" })
    expect(sh!.x).toBeCloseTo(1, 1)
    expect(sh!.z).toBeCloseTo(1, 1)
    // … and is not moved on its own, nor copied apart from it
    expect(moveTo(b, { layer: "blockers", i: j }, 2, 2)).toBe(b)
    expect(duplicate(b, { layer: "blockers", i: j })[1]).toBe(-1)
  })

  test("a piece taken away takes its own blocker; the later pieces' blockers follow them down", () => {
    let t: TilePrefab = { ...tile(), pieces: [...tile().pieces, ...tile().pieces, ...tile().pieces] }
    t = blockerFor(blockerFor(blockerFor(t, 0)[0], 1)[0], 2)[0]
    t = addBlocker(t, 1, 1, 0.3)[0]
    expect(remove(t, { layer: "pieces", i: 1 }).blockers).toEqual([
      { of: 0 },
      { of: 1 },
      { x: 1, z: 1, r: 0.3 },
    ])
  })

  test("a piece's blocker written out is its boxes and circles, sized and turned by hand from there", () => {
    const t = blockerFor({ ...tile(), pieces: [{ ...tile().pieces[0]!, rot: 0.5 }] }, 0)[0]
    const [w, k] = writeOut(t, 0)
    const b = w.blockers![k]!
    expect(b).toMatchObject({ rot: 0.5 })
    expect("w" in b && b.w > 0 && b.d > 0).toBe(true)
    // a box turns with the gizmo; a circle only moves
    expect(moveTo(w, { layer: "blockers", i: k }, 0, 0, 1).blockers![k]).toMatchObject({ x: 0, z: 0, rot: 1 })
    const [c, ci] = addBlocker(w, 1, 1, 0.4)
    expect(moveTo(c, { layer: "blockers", i: ci }, 0, 0, 1).blockers![ci]).toEqual({ x: 0, z: 0, r: 0.4 })
  })

  test("to edge: on the nearest tile side, along it, spanning it", () => {
    const t = snapToEdge(tile(), 0, 0.96, 4.16)
    const q = t.pieces[0]!
    const [dx, dz] = sideDir(4)
    expect(q.x).toBeCloseTo(dx * APOTHEM * 0.96, 2)
    expect(q.z).toBeCloseTo(dz * APOTHEM * 0.96, 2)
    // the front side runs along x: no turn
    expect(Math.abs(Math.sin(q.rot))).toBeCloseTo(0, 2)
    expect(q.scale * 4.16).toBeCloseTo(HEX_TILE_SIZE * 0.96, 2)
  })

  test("the tile's outline: corners on ±x, a side across ±z", () => {
    expect(onTile(3.0, 0)).toBe(true)
    expect(onTile(0, 2.6)).toBe(true)
    expect(onTile(0, 2.8)).toBe(false)
    expect(onTile(2.5, 1.5)).toBe(false)
  })

  test("undo and redo step through the edits; a new edit drops the redo", () => {
    let h = history(tile())
    const a = addPiece(h.now, "a/b")[0]
    h = push(h, a)
    h = back(h)
    expect(h.now.pieces.length).toBe(1)
    h = forward(h)
    expect(h.now).toBe(a)
    h = push(back(h), copyAs(tile(), "other"))
    expect(h.future).toEqual([])
    expect(h.now.id).toBe("other")
  })

  test("tidy rounds to the millimetre and drops undefined fields", () => {
    const t = tidy({
      ...tile(),
      pieces: [{ piece: "a/b", x: 1.23456, z: 0, rot: 0, scale: 1, odds: undefined }],
    })
    expect(t.pieces[0]).toEqual({ piece: "a/b", x: 1.235, z: 0, rot: 0, scale: 1 })
  })

  test("lint names unknown pieces, clips and props, and things off the tile", () => {
    const [t] = addSpot({ ...tile(), pieces: [{ piece: "x/y", x: 5, z: 0, rot: 0, scale: 1 }] }, "sit")
    const t2 = { ...t, spots: [{ ...t.spots![0]!, prop: "a/b", clip: "Nope" }] }
    const out = lint(t2, { piece: () => false, clip: () => false, prop: () => false }).join("\n")
    expect(out).toContain("x/y is not in the library")
    expect(out).toContain("off the tile")
    expect(out).toContain('no clip "Nope"')
    expect(out).toContain("has no grip")
  })

  test("lint names a spot inside a blocker (a seat's sitter and a bed's sleeper aside)", () => {
    const t: TilePrefab = {
      ...tile(),
      spots: [
        { kind: "talk", x: 0.9, z: 1.75, facing: 0 },
        { kind: "sit", x: 0, z: 0, facing: 0 },
        { kind: "sleep", x: 0, z: 0, facing: 0 },
      ],
      blockers: [
        { x: 1.15, z: 1.95, r: 0.482 },
        { x: 0, z: 0, r: 0.6 },
      ],
    }
    expect(lint(t, { piece: () => true, clip: () => true, prop: () => true })).toEqual([
      "spot 1 stands inside blocker 1",
    ])
    // a box: inside it along its length, past it across (it is turned a quarter: its w runs along z)
    const box: TilePrefab = {
      ...tile(),
      spots: [
        { kind: "work", x: 0, z: 0.9, facing: 0 },
        { kind: "work", x: 0.5, z: 0, facing: 0 },
      ],
      blockers: [{ x: 0, z: 0, w: 2, d: 0.6, rot: Math.PI / 2 }],
    }
    expect(lint(box, { piece: () => true, clip: () => true, prop: () => true })).toEqual([
      "spot 1 stands inside blocker 1",
    ])
  })

  test("no tile in data/tiles has a spot standing inside one of its blockers", () => {
    const dir = join(import.meta.dir, "../../../data/tiles")
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"))
    expect(files.length).toBeGreaterThan(50)
    const known = { piece: () => true, clip: () => true, prop: () => true }
    const inside = files.flatMap((f) => {
      const t = JSON.parse(readFileSync(join(dir, f), "utf8")) as TilePrefab
      return lint(t, known)
        .filter((w) => w.includes("inside blocker"))
        .map((w) => `${f}: ${w}`)
    })
    expect(inside).toEqual([])
  })
})
