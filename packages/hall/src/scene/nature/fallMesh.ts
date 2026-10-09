import { type BufferGeometry, Vector3 } from "three"
import type { Spot } from "../../world/layout.ts"
import type { Fall, Waterways } from "../../world/waterways.ts"
import { surfaceY } from "../../world/waterways.ts"
import { Builder, mid, THROW, THROW_AT_LIP, W } from "./riverMesh.ts"

/**
 * The waterfalls' one mesh (Rivers.tsx draws it; world-gen v2 §2.3): per fall, a sheet that
 * leaves the upper water, curls over the lip and drops (a thrown jet's curve) to below the lower
 * water, and a crown of spray where it lands. `uv` runs across the sheet (0–1) and down it (world
 * units), `aSheet` holds its length and width, `aPart` is 0 on the sheet and 1 on the spray.
 */

/** How wide a fall pours (a river's channel; a lake's whole edge) and how far back on the water it starts. */
export const FALL_WIDTH = 5.2
const LAKE_FALL_WIDTH = 5.7
const SHEET_BACK = 1.1
/** How far below the lower water the sheet reaches, so it always pierces it. */
const SINK = 0.3
const SHEET_ROWS = 10
const SHEET_COLUMNS = 6
const SPRAY_SEGMENTS = 12

/** Every waterfall's sheet and spray as one geometry (empty when there are none). */
export function fallsGeometry(waters: Waterways): BufferGeometry {
  const out = new Builder({ uv: 2, aSheet: 2, aPart: 1 })
  for (const fall of waters.falls) {
    sheet(out, fall)
    spray(out, fall)
  }
  return out.geometry()
}

const widthOf = (fall: Fall): number => (fall.source === "lake" ? LAKE_FALL_WIDTH : FALL_WIDTH)

/** The upper and lower water's heights at a fall. */
function heightsOf(fall: Fall): { top: number; bottom: number } {
  return {
    top: surfaceY(fall.source, fall.top),
    bottom: surfaceY(fall.into === "river" ? "river" : "lake", fall.bottom),
  }
}

/** The fall's frame: the lip's midpoint, outward (down the fall) and across it, in xz. */
function frameOf(fall: Fall): { lip: Spot; out: Spot; across: Spot } {
  const from = W(fall.from)
  const to = W(fall.to)
  const length = Math.hypot(to[0] - from[0], to[1] - from[1])
  const out: Spot = [(to[0] - from[0]) / length, (to[1] - from[1]) / length]
  return { lip: mid(from, to), out, across: [-out[1], out[0]] }
}

/**
 * The sheet: two rows lying back on the upper water, then a jet's curve — thrown out by
 * THROW·√p as it drops by p of the height, so it leaves the lip level and falls ever steeper.
 */
function sheet(out: Builder, fall: Fall): void {
  const { top, bottom } = heightsOf(fall)
  const { lip, out: o, across } = frameOf(fall)
  const drop = top - bottom + SINK
  const width = widthOf(fall)
  const profile: { s: number; y: number }[] = [
    { s: -SHEET_BACK, y: top + 0.02 },
    { s: -SHEET_BACK / 2, y: top + 0.02 },
  ]
  for (let i = 0; i <= SHEET_ROWS; i++) {
    const p = (i / SHEET_ROWS) ** 2
    profile.push({ s: THROW_AT_LIP + THROW * Math.sqrt(p), y: top + 0.02 - p * drop })
  }
  let length = 0
  const v = profile.map((point, i) => {
    const before = profile[i - 1]
    if (before) length += Math.hypot(point.s - before.s, point.y - before.y)
    return length
  })
  const rows = profile.map((point, i) => {
    const before = profile[Math.max(0, i - 1)] as { s: number; y: number }
    const after = profile[Math.min(profile.length - 1, i + 1)] as { s: number; y: number }
    const ds = after.s - before.s
    const dy = after.y - before.y
    // The curve's normal in the plane of the fall: up on the water, outward on the drop.
    const normal = new Vector3(o[0] * -dy, ds, o[1] * -dy).normalize()
    const row: number[] = []
    for (let j = 0; j <= SHEET_COLUMNS; j++) {
      const u = j / SHEET_COLUMNS
      const w = (u - 0.5) * width
      const at = new Vector3(
        lip[0] + o[0] * point.s + across[0] * w,
        point.y,
        lip[1] + o[1] * point.s + across[1] * w,
      )
      row.push(out.vertex(at, normal, { uv: [u, v[i] as number], aSheet: [length, width], aPart: [0] }))
    }
    return { row, normal }
  })
  for (let i = 1; i < rows.length; i++) {
    const { row: a } = rows[i - 1] as { row: number[] }
    const { row: b, normal } = rows[i] as { row: number[]; normal: Vector3 }
    for (let j = 0; j < SHEET_COLUMNS; j++) {
      out.triangle(a[j] as number, a[j + 1] as number, b[j] as number, normal)
      out.triangle(a[j + 1] as number, b[j + 1] as number, b[j] as number, normal)
    }
  }
}

/** The spray: a half crown round where the sheet lands, flaring up and out from under the water. */
function spray(out: Builder, fall: Fall): void {
  const { bottom } = heightsOf(fall)
  const { lip, out: o, across } = frameOf(fall)
  const reach = THROW_AT_LIP + THROW
  const centre: Spot = [lip[0] + o[0] * reach, lip[1] + o[1] * reach]
  const rings = [
    { scale: 0.72, y: bottom - 0.15, v: 0 },
    { scale: 1.1, y: bottom + 1.3, v: 1 },
  ]
  const ids = rings.map(({ scale, y, v }) => {
    const ring: { id: number; normal: Vector3 }[] = []
    for (let k = 0; k <= SPRAY_SEGMENTS; k++) {
      const angle = ((k / SPRAY_SEGMENTS) * 2 - 1) * (Math.PI * 0.56)
      const side = Math.sin(angle) * (widthOf(fall) / 2 + 0.5)
      const ahead = Math.cos(angle) * 1.4
      const x = centre[0] + (across[0] * side + o[0] * ahead) * scale
      const z = centre[1] + (across[1] * side + o[1] * ahead) * scale
      const normal = new Vector3(
        across[0] * side + o[0] * ahead,
        0.6,
        across[1] * side + o[1] * ahead,
      ).normalize()
      ring.push({
        id: out.vertex(new Vector3(x, y, z), normal, {
          uv: [k / SPRAY_SEGMENTS, v],
          aSheet: [0, 0],
          aPart: [1],
        }),
        normal,
      })
    }
    return ring
  })
  const [low, high] = ids as [{ id: number; normal: Vector3 }[], { id: number; normal: Vector3 }[]]
  for (let k = 0; k < SPRAY_SEGMENTS; k++) {
    const facing = (low[k] as { normal: Vector3 }).normal
    const a = (low[k] as { id: number }).id
    const b = (low[k + 1] as { id: number }).id
    const c = (high[k] as { id: number }).id
    const d = (high[k + 1] as { id: number }).id
    out.triangle(a, b, c, facing)
    out.triangle(b, d, c, facing)
  }
}
