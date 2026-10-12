import { expect, test } from "bun:test"
import { Scene } from "three"
import { createGrid } from "../src/grid.ts"
import { paletteMaterial } from "../src/material.ts"
import type { Stage } from "../src/stage.ts"

test("paletteMaterial is one shared vertex-colour material", () => {
  const material = paletteMaterial()
  expect(material.vertexColors).toBe(true)
  expect(paletteMaterial()).toBe(material)
})

test("createGrid adds a grid to the stage's scene and dispose removes it", () => {
  const scene = new Scene()
  const grid = createGrid({ scene } as Stage, { size: 20, cell: 1 })
  expect(scene.getObjectByName("grid")).toBeDefined()
  grid.dispose()
  expect(scene.getObjectByName("grid")).toBeUndefined()
})
