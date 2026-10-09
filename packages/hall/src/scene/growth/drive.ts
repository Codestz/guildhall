import { type BatchedMesh, Color, Matrix4, type Object3D } from "three"
import type { GrowthPlan } from "../../world/chronicle/growth.ts"
import { ageOf, type BuildPlan, type Site, siteKey } from "../../world/chronicle/growthBuild.ts"
import { emptyFrame, type GrowthFrame, growthAt, hexOf } from "../../world/chronicle/growthFrame.ts"
import { DEPTH, pieceAt, saltOf } from "../../world/chronicle/growthPieces.ts"
import { emptyStage, type Stage, stageAt } from "../../world/chronicle/growthStages.ts"
import { cellAt, key } from "../../world/gen/hex.ts"
import { growables, marksOf } from "./registry.ts"

/**
 * Draws a growth frame (world/chronicle/growthFrame.ts) onto the registered batches (registry.ts):
 * each instance's matrix is its built one, raised or sunk with its hex and scaled as its role says
 * (growthPieces.ts); hidden ones are switched off; the land's tiles take a cool tint while only a
 * ghost holds them and a warm one with their district's activity. Only instances whose state moved
 * are written. Allocates nothing per frame.
 */

/** A ghost district's land: a little washed out and cool. Activity: warm, up to +18 %. */
const GHOST = new Color(0.62, 0.7, 0.86)
const WARM = new Color(1.18, 1.08, 0.94)
/** A building plot's, or a wall's rubble, scar: dark earth. */
const SCAR = new Color(0.36, 0.28, 0.22)

interface Batch {
  hex: Int32Array
  salt: Float32Array
  /** Film v2: each instance's build site (growthBuild.ts), if it has one. */
  site: (Site | undefined)[]
  /** Last written per instance: rise, scale, scaleY, visible, colour key. */
  last: Float32Array
}

const NATURE_SALT = 0.5

export class GrowthDriver {
  readonly frame: GrowthFrame
  /** Per hex, how green its land is (the grass mask's red). */
  readonly green: Float32Array
  private batches = new WeakMap<BatchedMesh, Batch>()
  private groupHexes = new WeakMap<Object3D, Int32Array>()
  private state: Stage = emptyStage()
  private matrix = new Matrix4()
  private color = new Color()

  constructor(
    readonly g: GrowthPlan,
    /** Gen 2 films: each building's own birth and stages. Without it, the v1 film. */
    readonly build?: BuildPlan,
  ) {
    this.frame = emptyFrame(g)
    this.green = new Float32Array(g.cells.length)
  }

  /** The hex a spot belongs to. */
  hexAt(x: number, z: number): number {
    return this.g.index.get(key(cellAt([x, z]))) ?? hexOf(this.g, x, z)
  }

  /** Reads film time `t` and draws it. Returns true when anything that casts a shadow moved. */
  apply(t: number): boolean {
    const f = growthAt(this.g, t, this.frame)
    for (let h = 0; h < this.green.length; h++)
      this.green[h] =
        pieceAt(
          "nature",
          f.rise[h] as number,
          f.up[h] as number,
          f.since[h] as number,
          NATURE_SALT,
          this.state,
        ).scale * ((f.up[h] as number) >= 1 ? 1 : 0)
    let moved = false
    for (const mesh of growables.batches) moved = this.drawBatch(mesh) || moved
    for (const [group, spots] of growables.groups) {
      let hexes = this.groupHexes.get(group)
      if (!hexes) {
        hexes = Int32Array.from(spots.map(([x, z]) => this.hexAt(x, z)))
        this.groupHexes.set(group, hexes)
      }
      let shown = true
      for (const h of hexes) if ((this.green[h] as number) < 0.5) shown = false
      group.visible = shown
    }
    return moved
  }

  private batchOf(mesh: BatchedMesh): Batch | undefined {
    let known = this.batches.get(mesh)
    if (known) return known
    const marks = marksOf(mesh)
    if (!marks?.base) return undefined
    const n = marks.ids.length
    known = {
      hex: new Int32Array(n),
      salt: new Float32Array(n),
      site: new Array(n),
      last: new Float32Array(n * 5).fill(Number.NaN),
    }
    for (let i = 0; i < n; i++) {
      const x = marks.spots[i * 2] as number
      const z = marks.spots[i * 2 + 1] as number
      known.hex[i] = this.hexAt(x, z)
      known.salt[i] = saltOf(x, z)
      known.site[i] = this.build?.sites.get(siteKey(marks.pieces[i] ?? "", x, z))
    }
    this.batches.set(mesh, known)
    return known
  }

  /** Film v2: the build site's own stage (growthStages.ts) in place of the role's v1 arc, written over `state`. */
  private stage(role: string, batch: Batch, i: number, h: number): void {
    const s = this.state
    const f = this.frame
    const site = batch.site[i]
    const rise = s.rise
    if (site) stageAt(site.kind, ageOf(site, f.t, f.built[h] as number), s)
    else if (role === "nature")
      stageAt(
        "tree",
        (f.since[h] as number) - (this.build?.lag[h] as number) - (batch.salt[i] as number) * 0.6,
        s,
      )
    else return
    s.rise = rise
    if ((f.up[h] as number) <= 0) s.visible = false
  }

  private drawBatch(mesh: BatchedMesh): boolean {
    const marks = marksOf(mesh)
    const batch = this.batchOf(mesh)
    if (!marks?.base || !batch) return false
    const f = this.frame
    const s = this.state
    const e = this.matrix.elements
    let moved = false
    for (let i = 0; i < marks.ids.length; i++) {
      const role = marks.roles[i] ?? "land"
      if (role === "sea") continue
      const h = batch.hex[i] as number
      // What is built goes up on its own district's land, never on a ghost's borrowed hex.
      const since = role === "build" || role === "prop" ? f.built[h] : f.since[h]
      pieceAt(role, f.rise[h] as number, f.up[h] as number, since as number, batch.salt[i] as number, s)
      s.scar = 0
      if (this.build) this.stage(role, batch, i, h)
      const id = marks.ids[i] as number
      const o = i * 5
      const tint =
        role === "land"
          ? colourKey(f.ghost[h] as number, f.heat[this.g.district[h] as number] as number)
          : s.scar > 0.02
            ? 2 + Math.round(s.scar * 16) / 16
            : 0
      const last = batch.last
      if (
        last[o] === s.rise &&
        last[o + 1] === s.scale &&
        last[o + 2] === s.scaleY &&
        last[o + 3] === (s.visible ? 1 : 0) &&
        last[o + 4] === tint
      )
        continue
      if (last[o + 4] !== tint) {
        if (tint < 0) this.color.copy(GHOST)
        else if (tint >= 2) this.color.setRGB(1, 1, 1).lerp(SCAR, tint - 2)
        else this.color.setRGB(1, 1, 1).lerp(WARM, tint)
        mesh.setColorAt(id, this.color)
      }
      last[o] = s.rise
      last[o + 1] = s.scale
      last[o + 2] = s.scaleY
      last[o + 3] = s.visible ? 1 : 0
      last[o + 4] = tint
      mesh.setVisibleAt(id, s.visible)
      if (!s.visible) continue
      const base = marks.base
      for (let k = 0; k < 16; k++) e[k] = base[i * 16 + k] as number
      const sxz = s.scale
      const sy = s.scale * s.scaleY
      for (let k = 0; k < 3; k++) {
        e[k] = (e[k] as number) * sxz
        e[4 + k] = (e[4 + k] as number) * sy
        e[8 + k] = (e[8 + k] as number) * sxz
      }
      e[13] = (e[13] as number) + s.rise * (DEPTH + Math.max(0, base[i * 16 + 13] as number))
      mesh.setMatrixAt(id, this.matrix)
      if (role !== "nature" || s.scale > 0.3) moved = true
    }
    return moved
  }
}

/** A tile's tint, quantised so it is only rewritten when it visibly changes: −1 ghost, else heat 0–1. */
function colourKey(ghost: number, heat: number): number {
  if (ghost) return -1
  return Math.round(heat * 16) / 16
}
