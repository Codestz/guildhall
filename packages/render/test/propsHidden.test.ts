/**
 * Today's props under a hall's history reveal: the harvest's heaps and the work's stocks are taken out
 * where the island is not there yet (land not yet risen is open sea), shadow and all, and come back as
 * they were. Built pieces stand in for the library's (no files read, no GL).
 */
import { describe, expect, test } from "bun:test"
import type { Catalog } from "@guildhall/assets"
import type { HarvestPiece, Stock } from "@guildhall/world"
import { type BatchedMesh, PerspectiveCamera, Scene } from "three"
import { builtPath } from "../src/props/built.ts"
import { contactShadows } from "../src/props/contactShadow.ts"
import { createHarvest } from "../src/props/harvest.ts"
import { createStocks } from "../src/props/stocks.ts"
import type { Stage } from "../src/stage.ts"

function fakeStage(): Stage {
  return {
    scene: new Scene(),
    camera: new PerspectiveCamera(40, 1.5, 0.05, 2000),
    renderer: {},
    onFrame: () => () => {},
  } as unknown as Stage
}

/** Every piece is the built basket. */
const catalog = { get: () => ({ files: { glb: builtPath("basket") } }) } as unknown as Catalog
const url = (p: string) => `/library/${p}`

const heap = (x: number, tile: number, n: number): HarvestPiece[] =>
  Array.from({ length: n }, (_, i) => ({
    piece: "kenney-graveyard/hay-bale",
    x: x + i * 0.4,
    y: 1,
    z: 0,
    rot: 0,
    scale: 1,
    tile,
    heap: 0,
  }))

/** A disc's darkness in the stage's contact shadows (its `aAlpha`), slot by slot. */
const discs = (stage: Stage) => {
  const mesh = stage.scene.getObjectByName("world:contact-shadows") as unknown as {
    geometry: { getAttribute(n: string): { array: Float32Array } }
  }
  return Array.from(mesh.geometry.getAttribute("aAlpha").array)
}

describe("the harvest under the history reveal", () => {
  test("a heap where the island is not there is taken out, shadow and all, and comes back", async () => {
    const stage = fakeStage()
    const harvest = await createHarvest(stage, [...heap(0, 1, 3), ...heap(100, 2, 4)], { catalog, url })
    if (!harvest) throw new Error("no harvest")
    harvest.show(1)
    expect(harvest.stats().shown).toBe(7)
    const mesh = stage.scene.getObjectByName("world:harvest") as BatchedMesh
    // the far heap is on land not yet risen
    harvest.hide((x) => x > 50)
    expect(harvest.stats().shown).toBe(3)
    expect([0, 1, 2].every((i) => mesh.getVisibleAt(i))).toBe(true)
    expect([3, 4, 5, 6].some((i) => mesh.getVisibleAt(i))).toBe(false)
    expect(discs(stage).filter((a) => a > 0)).toHaveLength(1)
    // the weight moving (autumn going) keeps it out
    harvest.show(0.6)
    expect(discs(stage).filter((a) => a > 0)).toHaveLength(1)
    // the land rises: it is back
    harvest.hide(null)
    harvest.show(1)
    expect(harvest.stats().shown).toBe(7)
    expect([3, 4, 5, 6].every((i) => mesh.getVisibleAt(i))).toBe(true)
    expect(discs(stage).filter((a) => a > 0)).toHaveLength(2)
    harvest.dispose()
    expect(contactShadows(stage).stats().slots).toBe(0)
  })
})

describe("the stocks under the history reveal", () => {
  const stock = (x: number): Stock => ({
    folk: 1,
    kind: "log-pile",
    at: [x, 0, 0],
    facing: 0,
    cap: 8,
    piece: "kaykit-forest/log",
    feeds: [],
    since: 0,
  })

  test("a stock off the risen land is not drawn, and is laid out again as it was when it comes back", async () => {
    const stage = fakeStage()
    const stocks = await createStocks(stage, [stock(0), stock(100)], { catalog, url })
    stocks.set(0, { count: 6, fill: 0.75 } as never)
    stocks.set(1, { count: 6, fill: 0.75 } as never)
    const shown = stocks.stats().shown
    expect(shown).toBeGreaterThan(0)
    stocks.hide(1, true)
    expect(stocks.stats().shown).toBe(shown / 2)
    // set while hidden: remembered, not drawn
    stocks.set(1, { count: 8, fill: 1 } as never)
    expect(stocks.stats().shown).toBe(shown / 2)
    const lit = discs(stage).filter((a) => a > 0).length
    stocks.hide(1, false)
    expect(stocks.stats().shown).toBeGreaterThanOrEqual(shown / 2)
    expect(discs(stage).filter((a) => a > 0).length).toBe(lit + 1)
    stocks.dispose()
  })
})
