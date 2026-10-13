/**
 * The avatars' pure parts: a hero's face (its expression from the phase, its features from a seed) and a
 * party's shield (a division from the session id, a charge from the family). Same input, same picture,
 * so a hero keeps its face across reloads and a session keeps its arms.
 */
import { phaseOf } from "../format.ts"
import type { Family, Phase } from "../types.ts"

/** FNV-1a, 32 bit: a stable small hash for seeding. */
export function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// ── the face (variant C) ─────────────────────────────────────────

/** What the face says, from what the hero is doing. */
export type Expression = "thinking" | "plea" | "failed" | "loot" | "idle" | "calm"

const EXPRESSION: Record<Phase, Expression> = {
  working: "thinking",
  waiting: "plea",
  failed: "failed",
  loot: "loot",
  resting: "idle",
  idle: "idle",
  leaving: "calm",
}

/** Thinking eyes up while at work, a sweat drop on a plea, X eyes when fallen, a grin with loot, zzz idle. */
export function expressionOf(phase: Phase | string): Expression {
  return EXPRESSION[phase as Phase] ?? "calm"
}

export type Beard = "none" | "full" | "moustache" | "stubble"
export type Brows = "none" | "arched" | "stern"

export interface FaceFeatures {
  beard: Beard
  brows: Brows
  /** Rosy cheeks. */
  cheeks: boolean
  /** Skin tone (CSS). */
  skin: string
  /** Beard and brow colour (CSS). */
  hair: string
  /** Eyes a touch wider apart (px in the 60-unit box). */
  spread: number
}

const SKINS = ["#f0c9a0", "#e6b98f", "#d9a77c", "#c48b62", "#f3d2b3", "#a8714d"] as const
const HAIRS = ["#5a3a20", "#2e2118", "#e9e3d6", "#9a4f2a", "#c9a36a"] as const
const BEARDS: readonly Beard[] = ["none", "none", "full", "moustache", "stubble"]
const BROWS: readonly Brows[] = ["none", "arched", "stern"]

/** A hero's features, seeded by its id: the same hero always wears the same face. */
export function faceFeatures(seed: string, family?: Family): FaceFeatures {
  const h = hash32(`face:${seed}`)
  // a rogue's mask hides the mouth: no beard to draw under it
  const beard = family === "rogue" ? "none" : (BEARDS[h % BEARDS.length] as Beard)
  return {
    beard,
    brows: BROWS[(h >>> 4) % BROWS.length] as Brows,
    cheeks: ((h >>> 8) & 3) !== 0,
    skin: SKINS[(h >>> 11) % SKINS.length] as string,
    hair: HAIRS[(h >>> 18) % HAIRS.length] as string,
    spread: (h >>> 15) % 3,
  }
}

// ── the shield (variant B) ───────────────────────────────────────

/** How the field is parted (heraldry's divisions). */
export type Division = "pale" | "fess" | "bend" | "chevron" | "quarterly" | "saltire"
export const DIVISIONS: readonly Division[] = ["pale", "fess", "bend", "chevron", "quarterly", "saltire"]

/** The emblem on the field, one per body family. */
export type Charge = "star" | "cross" | "bow" | "axe" | "key"
export const CHARGE: Readonly<Record<Family, Charge>> = {
  mage: "star",
  knight: "cross",
  ranger: "bow",
  barbarian: "axe",
  rogue: "key",
}

export interface ShieldArms {
  division: Division
  charge: Charge
  /** Mirror the division (bend sinister, a chevron reversed…). */
  flip: boolean
}

/** A session's arms for a hero of `family`: the division from the session id, the charge from the family. */
export function shieldOf(sessionId: string, family: Family): ShieldArms {
  const h = hash32(`arms:${sessionId}`)
  return {
    division: DIVISIONS[h % DIVISIONS.length] as Division,
    charge: CHARGE[family],
    flip: ((h >>> 8) & 1) === 1,
  }
}

// ── colour and state ─────────────────────────────────────────────

/** `#rrggbb` (or `#rgb`) scaled by `k` (below 1 darker, above lighter); other CSS colours come back as they are. */
export function shade(colour: string, k: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim())
  if (!m) return colour
  let hex = m[1] as string
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("")
  const n = Number.parseInt(hex, 16)
  const ch = (v: number) => {
    const out = k <= 1 ? v * k : v + (255 - v) * (k - 1)
    return Math.max(0, Math.min(255, Math.round(out)))
      .toString(16)
      .padStart(2, "0")
  }
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`
}

/** The tone a badge's rim and mark wear: plea, fail and loot speak; the rest is the banner's. */
export function rimTone(phase: Phase | string): "plea" | "fail" | "loot" | null {
  const tone = phaseOf(phase).tone
  return tone === "plea" || tone === "fail" || tone === "loot" ? tone : null
}
