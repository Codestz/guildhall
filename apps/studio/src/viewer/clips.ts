/** A character's clips as the inspector lists them: counted, searched and grouped by what they show. */
import type { CatalogEntry, RigEntry } from "@guildhall/assets"

export const CLIP_GROUPS = ["idle", "walk/run", "work", "sit", "social", "combat", "other"] as const
export type ClipGroup = (typeof CLIP_GROUPS)[number]

/**
 * Name patterns, tried in this order (the first match wins), so a compound name lands where it reads:
 * `Fishing_Idle` is work, `Sit_Chair_Idle` sit, `Melee_2H_Idle` combat, `Running_HoldingBow` walk/run.
 * Whatever is left with "idle" in its name is idle.
 */
const PATTERNS: [ClipGroup, RegExp][] = [
  ["sit", /sit|lie_/],
  ["walk/run", /walk|run|sneak|crawl|crouch|strafe|gallop|jump/],
  ["work", /chop|pick|hammer|dig|fish|saw|lockpick|work|interact|use_item|holding|throw/],
  ["social", /wave|waving|cheer|taunt|clap|dance|talk/],
  [
    "combat",
    /attack|melee|ranged|block|hit|dodge|death|spell|magic|shoot|aim|reload|kick|punch|headbutt|summon/,
  ],
  ["idle", /idle/],
]

/** The group a clip's name puts it in. */
export function clipGroup(name: string): ClipGroup {
  const lower = name.toLowerCase()
  return PATTERNS.find(([, pattern]) => pattern.test(lower))?.[0] ?? "other"
}

/** The clips `entry` plays: its own, then its rig's, each name once. */
export function clipNames(entry: CatalogEntry, rig: RigEntry | undefined): string[] {
  return [...new Set([...(entry.character?.clips ?? []), ...(rig?.clips.map((c) => c.name) ?? [])])]
}

/** A piece the inspector animates: a character body, or anything carrying a rig. */
export function isCharacter(entry: CatalogEntry): boolean {
  return entry.kind === "character" || entry.character !== undefined
}

/** The clip a character starts on: `Idle_A`, else the first with "Idle" in its name, else the first. */
export function defaultClip(names: readonly string[]): string | null {
  if (names.includes("Idle_A")) return "Idle_A"
  return names.find((n) => n.toLowerCase().includes("idle")) ?? names[0] ?? null
}

/**
 * The names matching `search` (every word, case-insensitive; `_` reads as a space), grouped in
 * `CLIP_GROUPS` order with empty groups left out. Names keep their order within a group.
 */
export function groupClips(names: readonly string[], search = ""): { group: ClipGroup; names: string[] }[] {
  const words = search
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean)
  const matches = (name: string) => {
    const text = name.toLowerCase().replaceAll("_", " ")
    return words.every((w) => text.includes(w))
  }
  const byGroup = new Map<ClipGroup, string[]>()
  for (const name of names) {
    if (!matches(name)) continue
    const group = clipGroup(name)
    byGroup.set(group, [...(byGroup.get(group) ?? []), name])
  }
  return CLIP_GROUPS.flatMap((group) => {
    const found = byGroup.get(group)
    return found ? [{ group, names: found }] : []
  })
}

/**
 * The deep link with `&clip=` (and `&t=` while paused, so a shared link holds the pose) for what the
 * player shows; both dropped when nothing plays. Every other parameter of `base` is kept.
 */
export function clipSearch(
  base: URLSearchParams,
  shown: { clip: string | null; playing: boolean; t: number } | null,
): string {
  const out = new URLSearchParams(base)
  if (shown?.clip) out.set("clip", shown.clip)
  else out.delete("clip")
  if (shown?.clip && !shown.playing) out.set("t", String(Math.round(shown.t * 1000) / 1000))
  else out.delete("t")
  return `?${out.toString()}`
}

/** The `&clip=` and `&t=` a deep link asks for (`t` only when it is a fraction in [0, 1]). */
export function parseClipLink(query: URLSearchParams): { clip: string | null; t?: number } {
  const raw = query.get("t")
  const t = raw === null || raw.trim() === "" ? Number.NaN : Number(raw)
  return { clip: query.get("clip"), ...(t >= 0 && t <= 1 ? { t } : {}) }
}
