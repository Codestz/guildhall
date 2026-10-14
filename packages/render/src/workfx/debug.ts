/**
 * The work FX's debug driver (shots, looks): `?workfx=sparks,chips,splash,…` finds each kind's nearest
 * fitting spot to where the camera looks (an anvil, a log, a boat at a pier, …; `siteFor`) and fires it
 * there on a work rhythm (`RHYTHM`), as a routine's beats would. `?workfx=0` turns the FX off.
 */
import type { Stage } from "../stage.ts"
import { WORK_KINDS, type WorkKind } from "./kinds.ts"

export interface WorkFxSpec {
  /** Off altogether (`?workfx=0`). */
  off: boolean
  /** The kinds the driver fires (none: the FX stand ready for life's beats). */
  kinds: WorkKind[]
}

const ALIAS: Record<string, WorkKind> = {
  spark: "sparks",
  anvil: "sparks",
  chip: "chips",
  wood: "chips",
  rock: "stone",
  pick: "stone",
  water: "splash",
  fish: "splash",
  page: "pages",
  book: "pages",
  magic: "motes",
  mote: "motes",
  coin: "glint",
  quench: "steam",
  arrow: "shoot",
  bow: "shoot",
  board: "pin",
  notice: "pin",
  confetti: "cheer",
  hooray: "cheer",
}

/** `?workfx=`: null when absent. */
export function workfxOf(raw: string | null): WorkFxSpec | null {
  if (raw === null) return null
  if (raw === "0" || raw === "off") return { off: true, kinds: [] }
  const kinds: WorkKind[] = []
  for (const word of raw.split(/[,;+ ]/)) {
    const w = word.trim().toLowerCase()
    const kind = (WORK_KINDS as readonly string[]).includes(w) ? (w as WorkKind) : ALIAS[w]
    if (kind && !kinds.includes(kind)) kinds.push(kind)
    if (w === "all") for (const k of WORK_KINDS) if (k !== "ring" && !kinds.includes(k)) kinds.push(k)
  }
  return { off: false, kinds }
}

/** Seconds between beats per kind (a smith's hammer, an axe, a line coming in, …). */
export const RHYTHM: Record<WorkKind, number> = {
  sparks: 0.75,
  chips: 1.1,
  stone: 0.95,
  splash: 2.6,
  ring: 2.2,
  dust: 2.2,
  pages: 2.4,
  motes: 1.4,
  glint: 1.6,
  steam: 3.2,
  shoot: 2.4,
  pin: 2.8,
  cheer: 2.6,
}

/** Where each kind happens (piece ids), and how high over the piece's foot (m). */
const SITES: Record<WorkKind, { re: RegExp; lift: number }> = {
  sparks: { re: /anvil|forge|grindstone/, lift: 0.82 },
  steam: { re: /anvil|forge|tub|bucket|well/, lift: 0.75 },
  chips: { re: /wood-log|tree-log|stump|log-stack|chopping|lumbermill/, lift: 0.35 },
  stone: { re: /rocks?-|rock-\d|ore|mine|pickaxe/, lift: 0.35 },
  splash: { re: /boat-row|dock|pier|jetty|wharf/, lift: 0 },
  ring: { re: /boat-row|dock|pier|jetty|wharf/, lift: 0 },
  dust: { re: /crate|cart|wagon|barrel|hay|sack/, lift: 0.05 },
  pages: { re: /desk|lectern|book|scroll|table/, lift: 0.85 },
  motes: { re: /altar|shrine|statue|crystal|obelisk/, lift: 0.9 },
  glint: { re: /coin|gold|chest|stall|market/, lift: 0.7 },
  shoot: { re: /target|dummy|archery|training|post/, lift: 1.0 },
  pin: { re: /notice|board|sign|post/, lift: 1.3 },
  cheer: { re: /flag|banner|statue|well|fountain|tent|house|building|barracks/, lift: 2.0 },
}

export interface SitePiece {
  piece: string
  x: number
  y: number
  z: number
}

/**
 * Where a kind's burst goes near `near` (xz): the nearest fitting piece within `reach` metres, lifted
 * to its working height; a splash goes on the water (`sea`) a step off its boat or pier, away from the
 * island's middle. Null: none near.
 */
export function siteFor(
  kind: WorkKind,
  pieces: readonly SitePiece[],
  near: readonly [number, number],
  opts: { sea?: number; reach?: number } = {},
): [number, number, number] | null {
  const site = SITES[kind]
  const reach = opts.reach ?? 60
  let best: SitePiece | null = null
  let bestD = reach * reach
  for (const p of pieces) {
    const d = (p.x - near[0]) ** 2 + (p.z - near[1]) ** 2
    if (d < bestD && site.re.test(p.piece)) {
      best = p
      bestD = d
    }
  }
  if (!best) return null
  if (kind === "splash" || kind === "ring") {
    const r = Math.hypot(best.x, best.z) || 1
    return [best.x + (best.x / r) * 1.6, opts.sea ?? 0, best.z + (best.z / r) * 1.6]
  }
  return [best.x, best.y + site.lift, best.z]
}

export interface Driver {
  /** The spot each kind fires at now (null: none found near). */
  sites(): Partial<Record<WorkKind, [number, number, number] | null>>
  dispose(): void
}

/**
 * Fires `spec.kinds` on their rhythm at their sites near where the camera looks (looked up again when
 * the focus moves more than 8 m). `emit` is the FX's (`WorkFx.emit`).
 */
export function driveWorkFx(
  stage: Stage,
  spec: WorkFxSpec,
  emit: (kind: WorkKind, at: readonly [number, number, number], opts: { seed: number }) => unknown,
  pieces: () => readonly SitePiece[],
  opts: { sea?: number } = {},
): Driver {
  const sites: Partial<Record<WorkKind, [number, number, number] | null>> = {}
  let focus: [number, number] | null = null
  let t = 0
  const next = new Map<WorkKind, number>(spec.kinds.map((k, i) => [k, 0.3 + i * 0.17]))
  const off = stage.onFrame((dt) => {
    t += Math.min(dt, 0.1)
    const [x, , z] = stage.getCamera().target
    if (!focus || Math.hypot(x - focus[0], z - focus[1]) > 8) {
      focus = [x, z]
      const list = pieces()
      for (const kind of spec.kinds) sites[kind] = siteFor(kind, list, focus, opts)
    }
    for (const kind of spec.kinds) {
      const due = next.get(kind) ?? 0
      if (t < due) continue
      next.set(kind, due + RHYTHM[kind])
      const at = sites[kind]
      // the beat's own time is its seed: the same rhythm replays the same bursts
      if (at) emit(kind, at, { seed: Math.round(due * 1000) })
    }
  })
  return { sites: () => ({ ...sites }), dispose: off }
}
