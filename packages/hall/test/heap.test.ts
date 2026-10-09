import { describe, expect, test } from "bun:test"
import { Heap } from "../src/world/gen/heap.ts"
import { rng } from "../src/world/gen/hex.ts"

describe("Heap", () => {
  test("pops in order, whatever order it was filled in", () => {
    const random = rng(7)
    const values = Array.from({ length: 500 }, () => Math.floor(random() * 100))
    const heap = new Heap<number>((a, b) => a < b)
    for (const value of values) heap.push(value)
    const out: number[] = []
    for (let value = heap.pop(); value !== undefined; value = heap.pop()) out.push(value)
    expect(out).toEqual([...values].sort((a, b) => a - b))
  })

  test("pushes between pops still come out in order", () => {
    const heap = new Heap<number>((a, b) => a < b)
    for (const value of [5, 1, 9]) heap.push(value)
    expect(heap.pop()).toBe(1)
    heap.push(0)
    heap.push(7)
    expect([heap.pop(), heap.pop(), heap.pop(), heap.pop()]).toEqual([0, 5, 7, 9])
    expect(heap.size).toBe(0)
  })

  test("is empty when drained", () => {
    const heap = new Heap<number>((a, b) => a < b)
    expect(heap.pop()).toBeUndefined()
    heap.push(3)
    expect(heap.pop()).toBe(3)
    expect(heap.pop()).toBeUndefined()
  })

  test("orders equals by the comparator's own tie-break", () => {
    const heap = new Heap<[number, string]>((a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]))
    for (const item of [
      [1, "c"],
      [1, "a"],
      [0, "z"],
      [1, "b"],
    ] as [number, string][])
      heap.push(item)
    expect([heap.pop(), heap.pop(), heap.pop(), heap.pop()].map((item) => item?.[1])).toEqual([
      "z",
      "a",
      "b",
      "c",
    ])
  })
})
