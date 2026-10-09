import { useSyncExternalStore } from "react"
import { DataTexture, LinearFilter, type Material, RGBAFormat, type ShaderMaterial } from "three"
import type { GrowthPlan } from "../../world/chronicle/growth.ts"
import { growing, growth } from "../../world/chronicle/growthControl.ts"
import { cellAt, key, neighbours, unkey } from "../../world/gen/hex.ts"
import { SHORE } from "../nature/shore.ts"

/**
 * The growth timelapse's land mask (ADR 0010): one small texture over the shore bake's square
 * (±SHORE.half, laid out like it: row 0 at z = +half), so the water and the grass follow the film
 * without a re-bake. Red: how green each hex is (the grass grows there: Grass.tsx). Green: whether
 * the water there is a shore of land that is up now — a risen hex itself, or sea within two hexes of
 * one (Water.tsx): elsewhere the water reads as open sea, whatever today's shore bake says. While a
 * film is asked but has no plan yet it is all zero: open sea, no grass.
 */

/** 128² over ±120: ~1.9 world units a texel, against 5-unit hexes (linear-filtered). */
const SIZE = 128
let texture: DataTexture | null = null

function riseTexture(): DataTexture {
  if (!texture) {
    texture = new DataTexture(new Uint8Array(SIZE * SIZE * 4), SIZE, SIZE, RGBAFormat)
    texture.magFilter = LinearFilter
    texture.minFilter = LinearFilter
    texture.needsUpdate = true
  }
  return texture
}

/** The mask while a film is asked (none for a far island's patch), else null: the water and grass as always. */
export function useRiseMask(patch = false): DataTexture | null {
  const on = useSyncExternalStore(growth.subscribe, growing)
  return on && !patch ? riseTexture() : null
}

/** Clears the mask to "nothing up yet" (a new film). */
export function clearRiseMask(): void {
  const t = riseTexture()
  ;(t.image.data as Uint8Array).fill(0)
  t.needsUpdate = true
}

/** Water: open sea wherever the mask says no risen land is near (shaders.ts WATER_RISE). */
export function riseWater(material: Material, mask: DataTexture): void {
  const shader = material as ShaderMaterial
  if (!shader.isShaderMaterial) return
  shader.defines.WATER_RISE = ""
  shader.uniforms.uRise = { value: mask }
}

/** Grass: tufts grow with their hex's green (shaders.ts GRASS_RISE). The materials share uniforms. */
export function riseGrass(materials: readonly Material[], mask: DataTexture): void {
  for (const material of materials) {
    const shader = material as ShaderMaterial
    if (!shader.isShaderMaterial) continue
    shader.defines.GRASS_RISE = ""
    shader.uniforms.uRise = { value: mask }
    shader.uniforms.uRiseHalf = { value: SHORE.half }
  }
}

/**
 * Writes a frame's land into the mask. Built once per plan: which cell every texel falls in, and per
 * cell the land hexes within two hexes of it.
 */
export class RiseWriter {
  private texelCell: Int32Array
  private cellLand: Int32Array
  private cellNear: Int32Array[]
  /** Per cell, quantised to a byte: what the texture holds now (only a change uploads it). */
  private gate: Uint8Array
  private green: Uint8Array

  constructor(g: GrowthPlan) {
    const cells = new Map<string, number>()
    const land: number[] = []
    const near: Int32Array[] = []
    this.texelCell = new Int32Array(SIZE * SIZE)
    const cell = (SHORE.half * 2) / SIZE
    for (let row = 0; row < SIZE; row++)
      for (let column = 0; column < SIZE; column++) {
        const id = key(cellAt([-SHORE.half + (column + 0.5) * cell, SHORE.half - (row + 0.5) * cell]))
        let c = cells.get(id)
        if (c === undefined) {
          c = cells.size
          cells.set(id, c)
          land.push(g.index.get(id) ?? -1)
          const ring = new Set([id])
          for (const one of neighbours(unkey(id))) {
            ring.add(key(one))
            for (const two of neighbours(one)) ring.add(key(two))
          }
          near.push(Int32Array.from([...ring].map((k) => g.index.get(k) ?? -1).filter((h) => h >= 0)))
        }
        this.texelCell[row * SIZE + column] = c
      }
    this.cellLand = Int32Array.from(land)
    this.cellNear = near
    this.gate = new Uint8Array(cells.size)
    this.green = new Uint8Array(cells.size)
  }

  /** `up` and `green` per hex (growthFrame / drive.ts). Uploads only when a cell changed. */
  write(up: Float32Array, green: Float32Array): void {
    let changed = false
    for (let c = 0; c < this.cellLand.length; c++) {
      const own = this.cellLand[c] as number
      let gate = 0
      let grown = 0
      if (own >= 0) {
        gate = up[own] as number
        grown = green[own] as number
      } else for (const h of this.cellNear[c] as Int32Array) gate = Math.max(gate, up[h] as number)
      const g = Math.round(gate * 255)
      const r = Math.round(grown * 255)
      if (g === this.gate[c] && r === this.green[c]) continue
      this.gate[c] = g
      this.green[c] = r
      changed = true
    }
    if (!changed) return
    const t = riseTexture()
    const data = t.image.data as Uint8Array
    for (let i = 0; i < this.texelCell.length; i++) {
      const c = this.texelCell[i] as number
      data[i * 4] = this.green[c] as number
      data[i * 4 + 1] = this.gate[c] as number
    }
    t.needsUpdate = true
  }
}
