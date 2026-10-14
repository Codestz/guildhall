/**
 * The walls sweep at runtime (decisions.md 10-14, user: "do agents still walk through walls?"): the
 * Studio's crowd (hexworld space.ts: rounds pushed apart, side-steps round someone standing, queueing)
 * run headless over the townsfolk's day on an island as the Studio plans it (lifePlan.ts), with the
 * notice board's readers (readers.ts) called over by a quest pinned every couple of hours, and every
 * frame's drawn positions looked at against the collision layer's buildings, walls and fences.
 *
 *   crowd push     someone drawn more than a brush (`BRUSH`) inside a wall, deeper than their way there
 *                  (the plan's walls sweep holds the ways themselves at zero): the crowd pushed them in;
 *   reader walk    a reader's straight way to the board or back inside one (what they stood at aside, as
 *                  far as stepping off it takes: world `ownRoom`).
 *
 * A doorway's threshold is no intrusion: by a walk's end, what that end stands in (its house, its bench).
 *
 *   bun apps/studio/test/walls-runtime.ts [seeds=1,3,6] [files=4000]   prints what it found
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  HARD,
  hexCollide,
  hexIsland,
  hexWorld,
  hexZones,
  installTilePrefabs,
  type LifePose,
  lifePose,
  NATURE_CHOSEN,
  ownRoom,
  parseTilePrefabs,
  type Solid,
  solidDistance,
} from "@guildhall/world"
import { planLife, SEC_PER_HOUR, SPEEDUP } from "../src/hexworld/lifePlan.ts"
import { createReaders, type ReaderCandidate } from "../src/hexworld/readers.ts"
import { createSpace } from "../src/hexworld/space.ts"

/** A body's shoulder brushing a wall's foot (the static sweep's), metres. */
export const BRUSH = 0.15
/** By a walk's end, how near it a solid counts as its own and how far from it (space.ts DOOR, DOOR_ROOM). */
const DOOR = 1
const DOOR_ROOM = 1.6

export function installTiles(): void {
  const dir = join(import.meta.dir, "../../../data/tiles")
  installTilePrefabs(
    parseTilePrefabs(
      Object.fromEntries(
        readdirSync(dir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(dir, f), "utf8")) as unknown]),
      ),
    ).prefabs,
  )
}

export interface Intrusion {
  kind: "crowd push" | "reader walk"
  who: string
  x: number
  z: number
  depth: number
  piece?: string
  hour: number
}

export interface RuntimeSweep {
  intrusions: Intrusion[]
  /** Drawn positions looked at (someone out of doors, a frame). */
  looked: number
  /** Frames stepped. */
  frames: number
  /** Readers who came to the board, over every pin. */
  readers: number
  /** Frames someone was pushed off their way (an offset over 2 cm): what the crowd did at all. */
  pushed: number
  ms: number
}

/**
 * One island's townsfolk day through the crowd: `hours` of it (every hour of the day by default), at
 * `fps` frames a screen second, a quest pinned at the board every `pinEvery` day hours from 7.
 */
export function runtimeSweep(
  { seed, files }: { seed: number; files: number },
  opts: { fps?: number; from?: number; hours?: number; pinEvery?: number } = {},
): RuntimeSweep {
  const t0 = performance.now()
  const fps = opts.fps ?? 15
  const h = hexIsland({ seed, files })
  const z = hexZones(h, { wild: NATURE_CHOSEN.wild })
  const w = hexWorld(h, z, { nature: NATURE_CHOSEN })
  const plan = planLife(h, z, w, seed, undefined, { agents: null })
  const collide = hexCollide({ solids: plan.solids, walkways: plan.walkways, ground: w.heightAt })
  const folk = plan.folk
  const n = folk.length
  const radii = new Float32Array(n)
  // (as wide as the bodies are drawn: 0.26 to 0.5 m, a knight's shoulders and the mage's brim widest)
  for (let i = 0; i < n; i++) radii[i] = 0.26 + ((i * 7919) % 13) * 0.018
  const space = createSpace(radii, {
    heightAt: collide.heightAt,
    solidsNear: collide.solidsNear,
    solidDistance,
  })
  const readers = createReaders(plan.readers, { solidsNear: collide.solidsNear, solidDistance }, seed)
  const poses: LifePose[] = new Array(n)
  const out: RuntimeSweep = { intrusions: [], looked: 0, frames: 0, readers: 0, pushed: 0, ms: 0 }
  const from = opts.from ?? 0
  const hours = opts.hours ?? 24
  const pinEvery = opts.pinEvery ?? 2
  const dt = 1 / fps
  let secs = from * SEC_PER_HOUR
  const end = (from + hours) * SEC_PER_HOUR
  let nextPin = Math.max(from, 7)
  const hard = (x: number, zz: number) => collide.solidsNear(x, zz, 0.05).filter((o) => HARD(o.kind))
  /** Whether solid `o` is what a walk's end stands in, by that end (a doorway's threshold, a bench). */
  const byEnd = (o: Solid, p: LifePose, x: number, zz: number, room: (d: number) => number) => {
    for (const e of [p.from, p.to]) {
      if (!e) continue
      const d = solidDistance(o, e[0], e[2])
      if (d < DOOR && Math.hypot(x - e[0], zz - e[2]) < room(d)) return true
    }
    return false
  }
  // the first frame sets everyone where their day has them (no push yet)
  let day = (secs / SEC_PER_HOUR) % 24
  for (; secs < end; secs += dt) {
    day = (secs / SEC_PER_HOUR) % 24
    for (let id = 0; id < n; id++) {
      const late = space.delay[id]!
      poses[id] =
        (readers.size ? readers.pose(id, secs, day, SEC_PER_HOUR) : null) ??
        lifePose(folk[id]!.day, day - (late * SPEEDUP) / 3600, 24)
    }
    space.step(poses, dt)
    out.frames++
    // a quest pinned: who stands about near the board comes to read it
    if (day >= nextPin && day < 22 && plan.readers.length) {
      nextPin += pinEvery
      const crowd: ReaderCandidate[] = []
      for (let id = 0; id < n; id++) {
        const p = poses[id]!
        if (p.indoors || p.act === "walk" || p.drill || p.routine?.day !== undefined) continue
        crowd.push({
          id,
          x: space.x[id]!,
          z: space.z[id]!,
          y: p.at[1],
          steps: folk[id]!.day,
          ...(p.since !== undefined ? { since: p.since } : {}),
        })
      }
      readers.reset()
      readers.gather(secs, day, crowd, SPEEDUP)
      out.readers += readers.size
    }
    const reading = new Set(readers.ids)
    for (let id = 0; id < n; id++) {
      const p = poses[id]!
      if (p.indoors) continue
      out.looked++
      const x = space.x[id]!
      const zz = space.z[id]!
      const bx = p.at[0]
      const bz = p.at[2]
      if (Math.hypot(x - bx, zz - bz) > 0.02) out.pushed++
      // a reader's own way, on the straight line to the board and back
      if (reading.has(id) && p.act === "walk")
        for (const o of hard(bx, bz)) {
          const d = -solidDistance(o, bx, bz)
          if (d <= BRUSH || byEnd(o, p, bx, bz, ownRoom)) continue
          out.intrusions.push({
            kind: "reader walk",
            who: `s${seed}/${files}:folk ${id} ${folk[id]!.role}`,
            x: bx,
            z: bz,
            depth: d,
            ...(o.piece ? { piece: o.piece } : {}),
            hour: day,
          })
        }
      // what the crowd did: drawn deeper in a wall than the way there is
      for (const o of hard(x, zz)) {
        const d = -solidDistance(o, x, zz)
        if (d <= BRUSH) continue
        if (d <= -solidDistance(o, bx, bz) + 0.02) continue
        if (p.act === "walk" && byEnd(o, p, x, zz, () => DOOR_ROOM)) continue
        out.intrusions.push({
          kind: "crowd push",
          who: `s${seed}/${files}:folk ${id} ${folk[id]!.role}`,
          x,
          z: zz,
          depth: d,
          ...(o.piece ? { piece: o.piece } : {}),
          hour: day,
        })
      }
    }
  }
  out.ms = performance.now() - t0
  return out
}

if (import.meta.main) {
  installTiles()
  const [seedArg = "1,3,6", filesArg = "4000"] = process.argv.slice(2)
  const fps = Number(process.env.FPS ?? 15)
  for (const seed of seedArg.split(",").map(Number))
    for (const files of filesArg.split(",").map(Number)) {
      const r = runtimeSweep({ seed, files }, { fps })
      const by = new Map<string, number>()
      for (const i of r.intrusions) by.set(i.kind, (by.get(i.kind) ?? 0) + 1)
      console.log(
        `seed ${seed} files ${files}: ${r.frames} frames, ${r.looked} looked, ${r.pushed} pushed, ${r.readers} readers; ` +
          `crowd push ${by.get("crowd push") ?? 0}, reader walk ${by.get("reader walk") ?? 0} (${Math.round(r.ms)} ms)`,
      )
      const seen = new Set<string>()
      for (const i of r.intrusions.sort((a, b) => b.depth - a.depth)) {
        const k = `${i.kind} ${i.who} ${i.piece}`
        if (seen.has(k)) continue
        seen.add(k)
        if (seen.size > Number(process.env.SHOW ?? 12)) break
        console.log(
          `  ${i.kind} ${i.who} ${i.depth.toFixed(2)} m ${i.piece ?? ""} at ${i.x.toFixed(1)},${i.z.toFixed(1)} h${i.hour.toFixed(2)}`,
        )
      }
    }
}
