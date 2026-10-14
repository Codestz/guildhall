import { expect, test } from "bun:test"
import { isPaletteMaterial, paletteMaterial } from "../src/material.ts"

test("paletteMaterial is one shared vertex-colour material", () => {
  const material = paletteMaterial()
  expect(material.vertexColors).toBe(true)
  expect(paletteMaterial()).toBe(material)
  expect(paletteMaterial("mesh")).toBe(material)
})

test("one shared palette material per object kind, the same look, so no program swaps between kinds", () => {
  const mesh = paletteMaterial("mesh")
  const instanced = paletteMaterial("instanced")
  const batched = paletteMaterial("batched")
  expect(new Set([mesh, instanced, batched]).size).toBe(3)
  expect(paletteMaterial("batched")).toBe(batched)
  for (const m of [instanced, batched]) {
    expect(m.vertexColors).toBe(true)
    expect(m.roughness).toBe(mesh.roughness)
    expect(m.metalness).toBe(mesh.metalness)
    expect(m.onBeforeCompile).toBeDefined()
    expect(isPaletteMaterial(m)).toBe(true)
  }
  expect(isPaletteMaterial(mesh.clone())).toBe(false)
})
