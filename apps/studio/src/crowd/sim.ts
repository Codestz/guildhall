/**
 * The crowd bench's townsfolk (pure): a plaza with work stations round it and people walking loops
 * across and around it, some stopping now and then, the rest working at the stations with a breather
 * between bouts. Everything is a function of the clock (`sampleFolk(folk, look, t)`), so a shot at a
 * given time is the same shot.
 */
import type { NpcLook } from "@guildhall/assets"
import { roll } from "@guildhall/core"

/** Metres a second at walk speed 1, and metres a walk clip cycle covers (feet roughly planted). */
export const WALK_MPS = 1.2
export const STRIDE = 1.3

/** A station's piece per role's work, by work clip; a barrel for the rest. */
const STATION_PIECE: Readonly<Record<string, string>> = {
  Hammering: "kaykit-tools/anvil",
  Chopping: "kenney-nature/stump-old",
  Pickaxing: "kenney-survival/rock-a",
  Interact: "kenney-town/cart",
  Digging: "kenney-nature/log-stack",
}
const DEFAULT_STATION = "kaykit-dungeon/barrel-large"

export const stationPiece = (workClip: string): string => STATION_PIECE[workClip] ?? DEFAULT_STATION

export interface Walker {
  kind: "walk"
  /** Loop centre and radius (m), +1 anticlockwise seen from above, the angle it starts at. */
  centre: [number, number]
  radius: number
  turn: 1 | -1
  start: number
  /** Seconds walking, then seconds idle, repeating; offset into that cycle. */
  walk: number
  rest: number
  offset: number
}

export interface Worker {
  kind: "work"
  /** Where it stands, which way it faces (radians about +y, 0 = +z). */
  at: [number, number]
  heading: number
  work: number
  rest: number
  offset: number
}

export interface Folk {
  id: number
  role: string
  seed: number
  task: Walker | Worker
}

/** The plaza's radius for `n` people: the space grows with the crowd so density stays town-like. */
export const plazaRadius = (n: number): number => 8 + Math.sqrt(n) * 1.6

/**
 * `n` people of `roles` (in turn), seeded from `seed`: about 55% walking loops, the rest working at
 * stations spaced round the plaza edge. Ids are 0..n-1.
 */
export function planFolk(n: number, roles: readonly string[], seed = 1): Folk[] {
  const r = plazaRadius(n)
  const workers = Math.round(n * 0.45)
  const out: Folk[] = []
  for (let i = 0; i < n; i++) {
    const s = seed * 7919 + i
    const role = roles[i % roles.length] as string
    if (i < workers) {
      const angle = (i / Math.max(1, workers)) * Math.PI * 2 + (roll(s, "jitter") - 0.5) * 0.08
      const ring = r * (1.02 + 0.12 * (i % 2))
      const at: [number, number] = [Math.sin(angle) * ring, Math.cos(angle) * ring]
      out.push({
        id: i,
        role,
        seed: s,
        task: {
          kind: "work",
          at,
          // Facing out, at the station beyond it.
          heading: angle,
          work: 8 + roll(s, "work") * 8,
          rest: 2.5 + roll(s, "rest") * 2,
          offset: roll(s, "offset") * 20,
        },
      })
      continue
    }
    const inner = roll(s, "inner") < 0.5
    const radius = inner ? r * (0.3 + 0.55 * roll(s, "radius")) : r * (1.3 + 0.5 * roll(s, "radius"))
    const off = inner ? r * 0.2 : 0
    const a = roll(s, "centre") * Math.PI * 2
    out.push({
      id: i,
      role,
      seed: s,
      task: {
        kind: "walk",
        centre: [Math.sin(a) * off, Math.cos(a) * off],
        radius,
        turn: roll(s, "turn") < 0.5 ? 1 : -1,
        start: roll(s, "start") * Math.PI * 2,
        walk: 14 + roll(s, "walk") * 16,
        rest: roll(s, "stops") < 0.4 ? 2.5 + roll(s, "pause") * 2 : 0,
        offset: roll(s, "offset") * 30,
      },
    })
  }
  return out
}

/** Where a station piece stands for a worker: in front of it. */
export function stationAt(w: Worker): [number, number] {
  return [w.at[0] + Math.sin(w.heading) * 0.95, w.at[1] + Math.cos(w.heading) * 0.95]
}

export interface FolkSample {
  position: [number, number, number]
  heading: number
  clip: string
  phase: number
}

/** Part of `look` sampling needs: its clips, walk speed and phase offset. */
type Look = Pick<NpcLook, "clips" | "speed" | "phase">

/** Seconds into a (busy, rest) cycle → { busy, seconds into it, busy seconds done before this cycle }. */
function cycle(t: number, busy: number, rest: number): { busy: boolean; into: number; done: number } {
  const period = busy + rest
  const k = Math.floor(t / period)
  const into = t - k * period
  return into < busy || rest === 0
    ? { busy: true, into, done: k * busy }
    : { busy: false, into: into - busy, done: (k + 1) * busy }
}

/** A person at time `t` (s): place, heading, clip and phase. `duration(clip)` is the clip's length in seconds. */
export function sampleFolk(
  folk: Folk,
  look: Look,
  t: number,
  duration: (clip: string) => number,
): FolkSample {
  const task = folk.task
  const time = t + task.offset
  const loop = (clip: string, seconds: number, rate = 1) =>
    look.phase + (seconds * rate) / Math.max(duration(clip), 1e-3)
  if (task.kind === "work") {
    const c = cycle(time, task.work, task.rest)
    const clip = c.busy ? look.clips.work : look.clips.idle
    return {
      position: [task.at[0], 0, task.at[1]],
      heading: task.heading,
      clip,
      phase: frac(loop(clip, c.into)),
    }
  }
  const c = cycle(time, task.walk, task.rest)
  const speed = WALK_MPS * look.speed
  const walked = (c.busy ? c.done + c.into : c.done) * speed
  const angle = task.start + (task.turn * walked) / task.radius
  const position: [number, number, number] = [
    task.centre[0] + Math.sin(angle) * task.radius,
    0,
    task.centre[1] + Math.cos(angle) * task.radius,
  ]
  // The tangent: d/dθ (sin θ, cos θ) = (cos θ, −sin θ), turned by the direction of travel.
  const heading = Math.atan2(Math.cos(angle) * task.turn, -Math.sin(angle) * task.turn)
  if (!c.busy) return { position, heading, clip: look.clips.idle, phase: frac(loop(look.clips.idle, c.into)) }
  return { position, heading, clip: look.clips.walk, phase: frac(look.phase + walked / STRIDE) }
}

const frac = (x: number): number => x - Math.floor(x)
