/**
 * What the hex world builds into its ground besides the cells (decisions.md "Polish round": everything
 * aligned, a real bridge): stone stairs where a road steps down a level, cut straight along the road strip
 * from the shared edge, and plank bridges over the rivers that run bank to bank with posts down to the bed
 * and a rail either side. One vertex-coloured triangle soup, drawn with the ground.
 */
import { hash2 } from "../geom/noise.ts"
import { CHEEK_OUT, CHEEK_W, flightSteps } from "./collide.ts"
import type { HexGroundMesh } from "./ground.ts"
import type { HexBridge, HexWalkway } from "./world.ts"

type RGB = readonly [number, number, number]
type V3 = readonly [number, number, number]

/** Stone and timber (sRGB 0–255). */
const TREAD: RGB = [204, 192, 168]
const TREAD_ALT: RGB = [184, 172, 150]
const CHEEK: RGB = [150, 140, 124]
const PLANK: RGB = [164, 116, 70]
const PLANK_DARK: RGB = [112, 78, 48]
const TIMBER: RGB = [98, 68, 42]

/** Deck thickness, rail height over the deck, and how far apart posts stand at most. */
const THICK = 0.16
const RAIL = 0.72
const POST_GAP = 1.4

/** A triangle soup whose faces always wind toward `out`, so the flat normals light the right side. */
class Soup {
  pos: number[] = []
  col: number[] = []

  tri(a: V3, b: V3, c: V3, out: V3, rgb: RGB, k = 1) {
    const ux = b[0] - a[0]
    const uy = b[1] - a[1]
    const uz = b[2] - a[2]
    const vx = c[0] - a[0]
    const vy = c[1] - a[1]
    const vz = c[2] - a[2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const flip = nx * out[0] + ny * out[1] + nz * out[2] < 0
    for (const p of flip ? [a, c, b] : [a, b, c]) {
      this.pos.push(p[0], p[1], p[2])
      this.col.push((rgb[0] * k) / 255, (rgb[1] * k) / 255, (rgb[2] * k) / 255)
    }
  }

  quad(a: V3, b: V3, c: V3, d: V3, out: V3, rgb: RGB, k = 1) {
    this.tri(a, b, c, out, rgb, k)
    this.tri(a, c, d, out, rgb, k)
  }

  /** An upright box round (cx, cz), `len` along the horizontal axis (ux, uz) and `wid` across, y0 to y1. */
  box(
    cx: number,
    cz: number,
    ux: number,
    uz: number,
    len: number,
    wid: number,
    y0: number,
    y1: number,
    rgb: RGB,
  ) {
    const vx = -uz
    const vz = ux
    const p = (a: number, b: number, y: number): V3 => [
      cx + ux * a * len + vx * b * wid,
      y,
      cz + uz * a * len + vz * b * wid,
    ]
    this.quad(p(-0.5, -0.5, y1), p(0.5, -0.5, y1), p(0.5, 0.5, y1), p(-0.5, 0.5, y1), [0, 1, 0], rgb)
    const sides: [number, number, number, number, number, number][] = [
      [0.5, -0.5, 0.5, 0.5, ux, uz],
      [-0.5, -0.5, -0.5, 0.5, -ux, -uz],
      [-0.5, 0.5, 0.5, 0.5, vx, vz],
      [-0.5, -0.5, 0.5, -0.5, -vx, -vz],
    ]
    for (const [a0, b0, a1, b1, ox, oz] of sides)
      this.quad(p(a0, b0, y0), p(a1, b1, y0), p(a1, b1, y1), p(a0, b0, y1), [ox, 0, oz], rgb, 0.86)
  }

  /** A beam from a to b at any slope, `w` wide and `h` tall, its sides upright. */
  beam(a: V3, b: V3, w: number, h: number, rgb: RGB) {
    const dx = b[0] - a[0]
    const dz = b[2] - a[2]
    const l = Math.hypot(dx, dz) || 1
    const vx = (-dz / l) * (w / 2)
    const vz = (dx / l) * (w / 2)
    const at = (p: V3, s: number, t: number): V3 => [p[0] + vx * s, p[1] + (h / 2) * t, p[2] + vz * s]
    this.quad(at(a, -1, 1), at(b, -1, 1), at(b, 1, 1), at(a, 1, 1), [0, 1, 0], rgb)
    this.quad(at(a, -1, -1), at(b, -1, -1), at(b, 1, -1), at(a, 1, -1), [0, -1, 0], rgb, 0.7)
    this.quad(at(a, 1, -1), at(b, 1, -1), at(b, 1, 1), at(a, 1, 1), [vx, 0, vz], rgb, 0.86)
    this.quad(at(a, -1, -1), at(b, -1, -1), at(b, -1, 1), at(a, -1, 1), [-vx, 0, -vz], rgb, 0.86)
    this.quad(at(a, -1, -1), at(a, 1, -1), at(a, 1, 1), at(a, -1, 1), [-dx, 0, -dz], rgb, 0.86)
    this.quad(at(b, -1, -1), at(b, 1, -1), at(b, 1, 1), at(b, -1, 1), [dx, 0, dz], rgb, 0.86)
  }
}

/**
 * A flight of stone steps down a walkway: each step a block from just under the lower ground up to its
 * tread (the first flush with the upper road), treads alternating a shade so the flight reads from above,
 * and a low stone cheek either side stepping down with it.
 */
function stairsInto(s: Soup, st: HexWalkway) {
  const len = Math.hypot(st.bx - st.ax, st.bz - st.az)
  const ux = (st.bx - st.ax) / len
  const uz = (st.bz - st.az) / len
  // the walker's height (collide.ts `walkwayAt`) reads the same flight: these steps, these treads
  const n = flightSteps(st)
  const rise = (st.ay - st.by) / n
  const tread = len / n
  const foot = st.by - 0.12
  for (let k = 0; k < n; k++) {
    const y = st.ay - k * rise
    const cx = st.ax + ux * tread * (k + 0.5)
    const cz = st.az + uz * tread * (k + 0.5)
    s.box(cx, cz, ux, uz, tread, st.half * 2, foot, y, k % 2 ? TREAD_ALT : TREAD)
    for (const side of [-1, 1]) {
      // (a foot left open where the road it lands on turns off: collide.ts `open`)
      if (k >= n - (st.open?.[side < 0 ? 0 : 1] ?? 0)) continue
      s.box(
        cx - uz * side * (st.half + CHEEK_OUT),
        cz + ux * side * (st.half + CHEEK_OUT),
        ux,
        uz,
        tread,
        CHEEK_W,
        foot,
        y + 0.12,
        CHEEK,
      )
    }
  }
}

/** Offsets either side of a polyline's points: mitred at a bend, capped so a sharp bend never shoots out. */
function sides(line: readonly V3[]): [number, number][] {
  const dir = (a: V3, c: V3) => {
    const l = Math.hypot(c[0] - a[0], c[2] - a[2]) || 1
    return [(c[0] - a[0]) / l, (c[2] - a[2]) / l] as const
  }
  return line.map((p, i) => {
    const d0 = i > 0 ? dir(line[i - 1]!, p) : dir(p, line[i + 1]!)
    const d1 = i + 1 < line.length ? dir(p, line[i + 1]!) : d0
    let nx = -(d0[1] + d1[1])
    let nz = d0[0] + d1[0]
    const nl = Math.hypot(nx, nz) || 1
    nx /= nl
    nz /= nl
    const cos = Math.max(0.6, nx * -d1[1] + nz * d1[0])
    return [nx / cos, nz / cos]
  })
}

/**
 * A plank bridge: one deck along its legs (a two-leg bridge is a single bank → centre → bank line, mitred
 * at the bend, so no rail crosses its road), planks across it each a shade of their own over a dark seam,
 * posts outside the deck from the river bed (on the banks, from the ground) up past the deck, and two rails
 * along each side. A bridge with more legs is a hub: each leg its own deck, its rails clear of the hub.
 */
function bridgeInto(s: Soup, b: HexBridge, seed: number) {
  const legs = b.legs
  const lines: V3[][] =
    legs.length === 2
      ? [
          [
            [legs[0]!.bx, legs[0]!.by, legs[0]!.bz],
            [legs[0]!.ax, legs[0]!.ay, legs[0]!.az],
            [legs[1]!.bx, legs[1]!.by, legs[1]!.bz],
          ],
        ]
      : legs.map((l) => [
          [l.ax, l.ay, l.az],
          [l.bx, l.by, l.bz],
        ])
  const hub = legs.length !== 2
  const half = legs[0]?.half ?? 1
  let plank = 0
  for (const line of lines) {
    const off = sides(line)
    /** The point a fraction f along segment i, k half-widths to one side (+1 left, -1 right). */
    const at = (i: number, f: number, k: number): V3 => {
      const a = line[i]!
      const c = line[i + 1]!
      const oa = off[i]!
      const oc = off[i + 1]!
      return [
        a[0] + (c[0] - a[0]) * f + (oa[0] + (oc[0] - oa[0]) * f) * half * k,
        a[1] + (c[1] - a[1]) * f,
        a[2] + (c[2] - a[2]) * f + (oa[1] + (oc[1] - oa[1]) * f) * half * k,
      ]
    }
    const down = (p: V3, h: number): V3 => [p[0], p[1] - h, p[2]]
    const last = line.length - 2
    for (let i = 0; i <= last; i++) {
      const a = line[i]!
      const c = line[i + 1]!
      const l = Math.hypot(c[0] - a[0], c[2] - a[2])
      const n = Math.max(1, Math.round(l / 0.36))
      const fwd: V3 = [c[0] - a[0], 0, c[2] - a[2]]
      for (let k = 0; k < n; k++) {
        const p0 = at(i, k / n, -1)
        const p1 = at(i, (k + 1) / n, -1)
        const p2 = at(i, (k + 1) / n, 1)
        const p3 = at(i, k / n, 1)
        // a plank, inset a hair at its far edge so the dark deck shows between planks as a seam
        const g0 = at(i, (k + 0.9) / n, -1)
        const g1 = at(i, (k + 0.9) / n, 1)
        s.quad(p0, g0, g1, p3, [0, 1, 0], PLANK, 0.88 + 0.18 * hash2(seed + 97, b.tile, plank++))
        s.quad(g0, p1, p2, g1, [0, 1, 0], PLANK_DARK, 0.9)
        s.quad(
          down(p0, THICK),
          down(p1, THICK),
          down(p2, THICK),
          down(p3, THICK),
          [0, -1, 0],
          PLANK_DARK,
          0.7,
        )
        const sx = p2[0] - p1[0]
        const sz = p2[2] - p1[2]
        s.quad(p0, p1, down(p1, THICK), down(p0, THICK), [-sx, 0, -sz], PLANK_DARK)
        s.quad(p3, p2, down(p2, THICK), down(p3, THICK), [sx, 0, sz], PLANK_DARK)
      }
      // end caps where the deck rests on a bank
      if (i === 0) {
        const e0 = at(0, 0, -1)
        const e1 = at(0, 0, 1)
        s.quad(e0, e1, down(e1, THICK), down(e0, THICK), [-fwd[0], 0, -fwd[2]], PLANK_DARK)
      }
      if (i === last) {
        const e0 = at(i, 1, -1)
        const e1 = at(i, 1, 1)
        s.quad(e0, e1, down(e1, THICK), down(e0, THICK), fwd, PLANK_DARK)
      }
      // a cross beam under the deck mid-span and at the bend
      for (const f of [0.5, 1])
        s.beam(down(at(i, f, -1.05), THICK + 0.07), down(at(i, f, 1.05), THICK + 0.07), 0.14, 0.12, TIMBER)
    }
    // posts just outside the deck: at the bank ends (from the ground), along the span (from the bed); two
    // rails along each side between them
    const out = 1 + 0.12 / half
    for (const k of [-1, 1]) {
      const rail: V3[] = []
      for (let i = 0; i <= last; i++) {
        const a = line[i]!
        const c = line[i + 1]!
        const l = Math.hypot(c[0] - a[0], c[2] - a[2])
        const n = Math.max(1, Math.ceil(l / POST_GAP))
        for (let j = i === 0 ? 0 : 1; j <= n; j++) {
          const f = j / n
          if (hub && f * l < (legs[lines.indexOf(line)]?.rails ?? 1.3)) continue
          const e = at(i, f, k * out)
          rail.push(e)
          const bank = (i === 0 && j === 0 && !hub) || (i === last && j === n)
          s.box(e[0], e[2], 1, 0, 0.13, 0.13, bank ? e[1] - 0.35 : b.bed, e[1] + RAIL + 0.07, TIMBER)
        }
      }
      for (let r = 0; r + 1 < rail.length; r++) {
        const a = rail[r]!
        const c = rail[r + 1]!
        s.beam([a[0], a[1] + RAIL, a[2]], [c[0], c[1] + RAIL, c[2]], 0.1, 0.08, PLANK)
        s.beam([a[0], a[1] + RAIL * 0.5, a[2]], [c[0], c[1] + RAIL * 0.5, c[2]], 0.06, 0.06, TIMBER)
      }
    }
  }
}

/** The world's stairs and bridges as one vertex-coloured mesh (sRGB 0–1 colours, triangles). */
export function hexStructures(
  w: { stairs: readonly HexWalkway[]; bridges: readonly HexBridge[] },
  seed = 1,
): HexGroundMesh {
  const s = new Soup()
  for (const st of w.stairs) stairsInto(s, st)
  for (const b of w.bridges) bridgeInto(s, b, seed)
  return { position: new Float32Array(s.pos), color: new Float32Array(s.col) }
}
