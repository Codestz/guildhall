import { useSyncExternalStore } from "react"
import { DataTexture, LinearFilter, type Material, RGBAFormat, type ShaderMaterial } from "three"
import type { GrowthPlan } from "../../world/chronicle/growth.ts"
import { growing, growth } from "../../world/chronicle/growthControl.ts"
import { cellAt, key, neighbours, unkey } from "../../world/gen/hex.ts"
import { useWorld } from "../../world/source.ts"
import type { World } from "../../world/world.ts"
import { SHORE } from "../nature/shore.ts"
import { outreachOf } from "../nature/shoreTiles.ts"

/**
 * The growth timelapse's land mask (ADR 0010): one small texture over the shore bake's square
 * (±SHORE.half, laid out like it: row 0 at z = +half), so the water and the grass follow the film
 * without a re-bake. An island that reaches past it (nature/shoreTiles.ts) gets a mask as many of
 * those squares across, at the same density. Red: how green each hex is (the grass grows there:
 * Grass.tsx). Green: whether the water there is a shore of land that is up now — a risen hex
 * itself, or sea within two hexes of one (Water.tsx): elsewhere the water reads as open sea,
 * whatever today's shore bake says. While a film is asked but has no plan yet it is all zero: open
 * sea, no grass.
 */

/** 128² over ±120: ~1.9 world units a texel, against 5-unit hexes (linear-filtered). */
const SIZE = 128

/** A mask and the half-width of the square it covers, round the origin. */
export interface Rise {
  mask: DataTexture
  half: number
}

/** One mask per size asked for (the home bake's square, or k of them across). */
const rises = new Map<number, Rise>()

/** The mask that covers `world`'s land. */
export function riseMaskOf(world: World): Rise {
  const k = Math.ceil(outreachOf(world))
  let rise = rises.get(k)
  if (!rise) {
    const size = SIZE * k
    const mask = new DataTexture(new Uint8Array(size * size * 4), size, size, RGBAFormat)
    mask.magFilter = LinearFilter
    mask.minFilter = LinearFilter
    mask.needsUpdate = true
    rise = { mask, half: SHORE.half * k }
    rises.set(k, rise)
  }
  return rise
}

/** The mask while a film is asked (none for a far island's patch), else null: the water and grass as always. */
export function useRiseMask(patch = false): Rise | null {
  const on = useSyncExternalStore(growth.subscribe, growing)
  const world = useWorld()
  return on && !patch ? riseMaskOf(world) : null
}

/** Clears the masks to "nothing up yet" (a new film). */
export function clearRiseMask(): void {
  for (const { mask } of rises.values()) {
    const data = mask.image.data as Uint8Array
    data.fill(0)
    mask.needsUpdate = true
  }
}

/** Water: open sea wherever the mask says no risen land is near (shaders.ts WATER_RISE). */
export function riseWater(material: Material, rise: Rise): void {
  const shader = material as ShaderMaterial
  if (!shader.isShaderMaterial) return
  shader.defines.WATER_RISE = ""
  shader.uniforms.uRise = { value: rise.mask }
  shader.uniforms.uRiseHalf = { value: rise.half }
}

/** Grass: tufts grow with their hex's green (shaders.ts GRASS_RISE). The materials share uniforms. */
export function riseGrass(materials: readonly Material[], rise: Rise): void {
  for (const material of materials) {
    const shader = material as ShaderMaterial
    if (!shader.isShaderMaterial) continue
    shader.defines.GRASS_RISE = ""
    shader.uniforms.uRise = { value: rise.mask }
    shader.uniforms.uRiseHalf = { value: rise.half }
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

  constructor(
    g: GrowthPlan,
    private readonly rise: Rise,
  ) {
    const cells = new Map<string, number>()
    const land: number[] = []
    const near: Int32Array[] = []
    const { half } = rise
    const size = rise.mask.image.width
    this.texelCell = new Int32Array(size * size)
    const cell = (half * 2) / size
    for (let row = 0; row < size; row++)
      for (let column = 0; column < size; column++) {
        const id = key(cellAt([-half + (column + 0.5) * cell, half - (row + 0.5) * cell]))
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
        this.texelCell[row * size + column] = c
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
    const t = this.rise.mask
    const data = t.image.data as Uint8Array
    for (let i = 0; i < this.texelCell.length; i++) {
      const c = this.texelCell[i] as number
      data[i * 4] = this.green[c] as number
      data[i * 4 + 1] = this.gate[c] as number
    }
    t.needsUpdate = true
  }
}
