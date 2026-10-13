import { expect, test } from "bun:test"
import { parsePrefabsArgs, sheetPlan } from "../src/prefabs.ts"

const tiles = (group: string, n: number) =>
  Array.from({ length: n }, (_, k) => ({ id: `${group}-${k}`, group }))

test("sheets go by group in gallery order, cut evenly at no more than `per`", () => {
  const plan = sheetPlan([...tiles("road", 5), ...tiles("town", 26), ...tiles("weird", 1)], 12)
  expect(plan.map((s) => [s.group, s.n, s.of, s.ids.length])).toEqual([
    ["town", 1, 3, 9],
    ["town", 2, 3, 9],
    ["town", 3, 3, 8],
    ["road", 1, 1, 5],
    ["other", 1, 1, 1],
  ])
})

test("the command line: defaults, and what it refuses", () => {
  expect(parsePrefabsArgs([])).toEqual({ only: null, out: ".probe/prefabs", per: 12 })
  expect(parsePrefabsArgs(["--only", "dock,archery", "--port", "5351"]).only).toEqual(["dock", "archery"])
  expect(() => parsePrefabsArgs(["--per", "0"])).toThrow("--per")
  expect(() => parsePrefabsArgs(["--nope", "1"])).toThrow("unknown option")
})
