/**
 * The history replay lab (`/lab/replay?repo=react`, spike S4 of plan-hud-events): a repository's island
 * grown from its first commit by scrubbing, without a rebuild. The island is built once at today's size
 * (`files` from the chronicle's last day); every tile's place in the growth order (world
 * `HexIsland.rank`) orders what is drawn, and the scrub sets how many places are revealed:
 * `tiles(t) = landTiles(files(t))`, eased between days. Pieces come in with their tile (render
 * `reveal.ts` and the batch's walk), the ground, roads, stairs and bridges by draw range, townsfolk
 * stay off the tiles not yet there, and a skirt walls the frontier where the ground has no side of
 * its own (two tiles of one height, the later one still out).
 *
 *   `?repo=`   react (default, years of history) or guildhall (three days)
 *   `?look=`   grow (default: tiles rise from the sea, pieces grow from their origin), dither, snap
 *   `?span=`   the frontier's width, tiles on their way in at once (default 12)
 *   `?t=`      where in the history to open, 0..1 (default 1: today)
 * plus every hex island key (`?seed=`, `?life=0`, `?hour=`, …). For shots, `guildhall.ext.replay`.
 */
import { log } from "@guildhall/core"
import {
  createReveal,
  groundMaterial,
  type PlaceAt,
  paletteMaterial,
  placesTexture,
  REVEAL_SPAN,
  type Reveal,
  type RevealLook,
  srgbToLinear,
  surfaceMaterial,
  type VertexMeshData,
} from "@guildhall/render"
import { type Chronicle, filesAt, isoOf, readChronicle } from "@guildhall/sim"
import { HEX_TILE_SIZE, type HexIsland, hexAt, hexIsland, landTiles } from "@guildhall/world"
import { mountHexWorld, ROAD_COLOR, type WorldHooks } from "../hexworld/index.ts"
import { shapeOf } from "../hexworld/job.ts"
import type { Screen } from "../screens.ts"
import { type TilePlaces, tilePlaces } from "./places.ts"

const logger = log("studio:replay")

const REPOS = new Set(["react", "guildhall"])
const lookOf = (v: string | null): RevealLook => (v === "dither" || v === "snap" ? v : "grow")

/** The island's base, where the skirt and a sunk tile end (job.ts' ground base). */
const BASE = -2.5
/** The skirt's colour: the ground's land side (job.ts SIDE_LAND), sRGB. */
const SKIRT_RGB: readonly [number, number, number] = [122, 90, 60]

/**
 * Where everything stands in the reveal order: its tile's place. What stands on the sea (a dock, a
 * beach slope, a bridge's end) takes its coast tile's (the earliest of the tiles round it). A triangle
 * on a wall is pushed a little against its normal first: a wall belongs to the tile it stands on, a
 * beach slope to the tile it runs down from.
 */
function placer(h: HexIsland, { place, ranked }: TilePlaces): PlaceAt {
  const g = h.grid
  const R = HEX_TILE_SIZE
  const tileAt = (x: number, z: number): number => {
    const { q, r } = hexAt(x / R, z / R)
    return g.index(q, r)
  }
  const placeAt = (x: number, z: number): number => {
    const i = tileAt(x, z)
    return i < 0 ? -1 : (place[i] as number)
  }
  const earliestRound = (x: number, z: number): number => {
    const i = tileAt(x, z)
    if (i < 0) return -1
    let best = -1
    for (const j of g.neighbours(i)) {
      if (j < 0) continue
      const p = place[j] as number
      if (p >= 0 && (best < 0 || p < best)) best = p
    }
    return best
  }
  return (x, z, nx, nz) => {
    const len = Math.hypot(nx, nz)
    // a wall or a slope: a little against its outward normal is the tile it belongs to
    if (len > 1e-3) {
      const px = x - (nx / len) * 0.35
      const pz = z - (nz / len) * 0.35
      const p = placeAt(px, pz)
      if (p >= 0) return p
      // a beach slope reaches well out: its tile is further back
      const p2 = placeAt(x - (nx / len) * R * 0.9, z - (nz / len) * R * 0.9)
      if (p2 >= 0) return p2
    }
    const p = placeAt(x, z)
    if (p >= 0) return p
    // on the sea: the earliest coast tile round it, else last of all
    const near = earliestRound(x, z)
    return near >= 0 ? near : ranked
  }
}

/**
 * The frontier's skirt: a wall down to the island's base on every tile edge whose neighbour comes
 * later and whose ground has no wall of its own there (the neighbour's top is level or higher). Each
 * wall carries its tile's place and leaves at the neighbour's (`until`), so a revealed island always
 * ends in a side, never an open cut.
 */
function skirt(
  h: HexIsland,
  groundAt: (x: number, z: number) => number,
  { place }: TilePlaces,
): { data: VertexMeshData; until: Float32Array } {
  const g = h.grid
  const R = HEX_TILE_SIZE
  const corners: [number, number][] = []
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (60 * k - 30)
    corners.push([Math.cos(a) * R, Math.sin(a) * R])
  }
  const placeOf = (i: number) => place[i] as number
  const pos: number[] = []
  const nor: number[] = []
  const col: number[] = []
  const until: number[] = []
  const rgb = SKIRT_RGB.map((c) => srgbToLinear(c / 255)) as [number, number, number]
  const SEGMENTS = 3
  const put = (x: number, y: number, z: number, nx: number, nz: number, shade: number) => {
    pos.push(x, y, z)
    nor.push(nx, 0, nz)
    col.push(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade)
  }
  for (let i = 0; i < g.size; i++) {
    if (placeOf(i) < 0) continue
    const mine = placeOf(i)
    const [cx, cz] = [g.q[i] as number, g.r[i] as number]
    const x0 = R * Math.sqrt(3) * (cx + cz / 2)
    const z0 = R * 1.5 * cz
    const nb = g.neighbours(i)
    for (let k = 0; k < 6; k++) {
      // edge k (corners k, k+1) faces direction 60°·k, neighbour d = (6 - k) % 6 (world ground.ts)
      const j = nb[(6 - k) % 6] as number
      if (j < 0 || placeOf(j) < 0) continue
      const theirs = placeOf(j)
      if (theirs <= mine) continue
      const ang = (Math.PI / 180) * (60 * k)
      const nx = Math.cos(ang)
      const nz = Math.sin(ang)
      const a = corners[k] as [number, number]
      const b = corners[(k + 1) % 6] as [number, number]
      for (let s = 0; s < SEGMENTS; s++) {
        const f0 = s / SEGMENTS
        const f1 = (s + 1) / SEGMENTS
        const ax = x0 + a[0] + (b[0] - a[0]) * f0
        const az = z0 + a[1] + (b[1] - a[1]) * f0
        const bx = x0 + a[0] + (b[0] - a[0]) * f1
        const bz = z0 + a[1] + (b[1] - a[1]) * f1
        const mx = (ax + bx) / 2
        const mz = (az + bz) / 2
        // the ground just inside and just beyond the edge: a lower neighbour has a wall there already
        const ht = groundAt(mx - nx * 0.2, mz - nz * 0.2)
        const hn = groundAt(mx + nx * 0.2, mz + nz * 0.2)
        if (hn < ht - 0.05) continue
        const top = Math.max(
          ht,
          groundAt(ax - nx * 0.2, az - nz * 0.2),
          groundAt(bx - nx * 0.2, bz - nz * 0.2),
        )
        // facing out (counter-clockwise seen from above with +z down the screen)
        put(ax, top, az, nx, nz, 0.9)
        put(ax, BASE, az, nx, nz, 0.7)
        put(bx, top, bz, nx, nz, 0.9)
        put(bx, top, bz, nx, nz, 0.9)
        put(ax, BASE, az, nx, nz, 0.7)
        put(bx, BASE, bz, nx, nz, 0.7)
        until.push(theirs, theirs)
      }
    }
  }
  return {
    data: { position: new Float32Array(pos), normal: new Float32Array(nor), color: new Float32Array(col) },
    until: new Float32Array(until),
  }
}

/** The tiles the island has at `day` (fractional days ease between two days' counts). */
function tilesAt(c: Chronicle, day: number): number {
  const d0 = Math.floor(day)
  const f = day - d0
  const a = landTiles(filesAt(c, d0))
  if (f <= 0) return a
  const b = landTiles(filesAt(c, d0 + 1))
  return a + (b - a) * f
}

export const replayLab: Screen = {
  id: "replay",
  title: "History replay",
  mount(host, ctx) {
    const repo = REPOS.has(ctx.query.get("repo") ?? "") ? (ctx.query.get("repo") as string) : "react"
    const look = lookOf(ctx.query.get("look"))
    const span = Math.max(0, Number(ctx.query.get("span") ?? REVEAL_SPAN)) || 0
    const t0 = Math.min(1, Math.max(0, Number(ctx.query.get("t") ?? 1)))
    let disposed = false
    let unmount = () => {}
    const reveal: Reveal = createReveal(look)
    let placeAt: PlaceAt | null = null
    let places: TilePlaces | null = null

    const run = async () => {
      const bytes = new Uint8Array(await (await fetch(`/lab/repo/${repo}.json.gz`)).arrayBuffer())
      const c = await readChronicle(bytes)
      if (disposed) return
      const files = filesAt(c, c.end)
      const query = new URLSearchParams(ctx.query)
      query.set("files", String(files))
      for (const k of ["repo", "look", "span", "t"]) query.delete(k)
      const days = Math.max(1, c.end - c.start)
      let day = c.start + t0 * days
      let shown = Number.NaN
      const show = (d: number) => {
        day = d
        const n = tilesAt(c, d)
        if (n === shown) return
        shown = n
        // the count is the frontier's far edge: n tiles whole, the next `span` on their way in
        reveal.set(n + span, span)
        moved?.(n)
      }
      /** Once built: what else moves with the count (the shadows, the gates, the title card). */
      let moved: ((n: number) => void) | null = null
      const hooks: WorldHooks = {
        transport: true,
        mesh(stage, data, kind) {
          if (!placeAt) throw new Error("replay: the island's order is not built yet")
          const material =
            kind === "ground"
              ? groundMaterial()
              : kind === "roads"
                ? surfaceMaterial(ROAD_COLOR)
                : paletteMaterial()
          const mesh = reveal.mesh(stage, data, placeAt, { material, castShadow: kind !== "roads" })
          logger.info("reveal mesh", { kind, triangles: mesh.triangles })
          return mesh
        },
        built(parts) {
          if (disposed) return
          const place = placeAt as PlaceAt
          const tiles = places as TilePlaces
          const land = tiles.ranked
          reveal.batch(parts.batch.mesh, place)
          // the frontier's skirt, like the ground: the palette material, its tile's place, gone at the neighbour's
          const wall = skirt(parts.island, parts.groundAt, tiles)
          const placed = reveal.mesh(parts.stage, wall.data, (x, z, nx, nz) => place(x, z, nx, nz), {
            material: paletteMaterial(),
            until: wall.until,
            castShadow: false,
          })
          logger.info("skirt", { triangles: placed.triangles })
          // townsfolk stay off the tiles not yet there
          parts.life?.hide((x, z) => place(x, z, 0, 0) >= reveal.count)
          // the water: hidden land is open sea, pools come in with their tiles
          parts.water?.setReveal({
            places: placesTexture(parts.island.grid, (i) => tiles.place[i] as number),
            radius: parts.island.grid.radius,
            tile: HEX_TILE_SIZE,
            count: reveal.uniforms.count,
            span: reveal.uniforms.span,
          })
          const gates = parts.doors.gates
          moved = (n) => {
            parts.sun.markDirty()
            gates?.hide((x, z) => place(x, z, 0, 0) >= n)
            parts.viewer.setInfo({
              figures: [
                { label: "Day", value: isoOf(Math.floor(day)) },
                { label: "Files", value: filesAt(c, Math.floor(day)) },
                { label: "Tiles", value: `${Math.round(n)} / ${land}` },
              ],
            })
          }
          const transport = parts.viewer.transport({
            label: "History",
            value: day,
            min: c.start,
            max: c.end,
            step: days / 2000,
            rate: days / 20,
            wrap: false,
            format: (d) => isoOf(Math.floor(d)),
            onChange: show,
          })
          const ext = window.guildhall?.ext
          if (ext)
            ext.replay = {
              repo,
              look,
              span,
              start: c.start,
              end: c.end,
              land,
              get: () => day,
              set: (d: number) => {
                transport.set(d)
                show(d)
              },
              /** 0..1 along the history. */
              t: () => (day - c.start) / days,
              setT: (t: number) => {
                const d = c.start + Math.min(1, Math.max(0, t)) * days
                transport.set(d)
                show(d)
              },
              tiles: () => shown,
              files: () => filesAt(c, Math.floor(day)),
              /** The centre of a tile on the frontier now (mid-way in), for a shot's camera; null at the end. */
              frontier: () => {
                const want = shown + span / 2
                let best = -1
                for (let i = 0; i < tiles.place.length; i++) {
                  const p = tiles.place[i] as number
                  if (p < 0) continue
                  if (best < 0 || Math.abs(p - want) < Math.abs((tiles.place[best] as number) - want))
                    best = i
                }
                if (best < 0) return null
                const g = parts.island.grid
                const q = g.q[best] as number
                const r = g.r[best] as number
                return {
                  x: HEX_TILE_SIZE * Math.sqrt(3) * (q + r / 2),
                  z: HEX_TILE_SIZE * 1.5 * r,
                  place: tiles.place[best],
                }
              },
            }
          shown = Number.NaN
          show(day)
        },
      }
      // the island's order first: the same pure island the world builds, so the ranks are the ranks
      const seed = Number(query.get("seed") ?? query.get("town")) || 1
      const island = hexIsland({ ...shapeOf(query), seed, files })
      places = tilePlaces(island)
      placeAt = placer(island, places)
      reveal.set(tilesAt(c, day) + span, span)
      let filled = 0
      for (let i = 0; i < places.place.length; i++)
        if ((places.place[i] as number) >= 0 && places.place[i] !== island.rank[i]) filled++
      logger.info("history", {
        repo,
        start: isoOf(c.start),
        end: isoOf(c.end),
        files,
        land: island.stats.land,
        ranked: places.ranked,
        holesFilled: filled,
        tiles0: Math.round(tilesAt(c, c.start)),
        look,
        span,
      })
      if (disposed) return
      unmount = mountHexWorld(host, { ...ctx, query }, hooks)
    }
    ctx.load(run()).catch((error: unknown) => {
      logger.error("replay failed", { error: String(error) })
      host.textContent = `The replay did not start: ${String(error)}`
    })
    return () => {
      disposed = true
      unmount()
      reveal.dispose()
      const ext = window.guildhall?.ext
      if (ext) delete ext.replay
    }
  },
}
