import { expect, test } from "bun:test"
import { paletteMaterial } from "../src/material.ts"

test("paletteMaterial is one shared vertex-colour material", () => {
  const material = paletteMaterial()
  expect(material.vertexColors).toBe(true)
  expect(paletteMaterial()).toBe(material)
})
