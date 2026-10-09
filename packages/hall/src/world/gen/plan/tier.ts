/**
 * An island's tier by its files (world-gen v2 §1.2), and what mountains it gets: how many ranges,
 * what share of its land they hold, and the tallest main peak. Shared by the plan, which reserves
 * the ranges' ground (plan/zones.ts), and the relief, which raises them (relief/massifs.ts).
 */

export type Tier = "hamlet" | "village" | "town" | "city"

/** The tallest a tier's main peak gets, world units (decided: 60 / 40 / 22; a hamlet has hills only). */
export const CAP: Readonly<Record<Tier, number>> = { hamlet: 0, village: 22, town: 40, city: 60 }
/** The share of an island's land its ranges hold (terrain v2 §2.1: village 10–15%, town 15–22%, city 22–30%). */
export const SHARE: Readonly<Record<Tier, number>> = { hamlet: 0, village: 0.13, town: 0.19, city: 0.27 }
/** How many ranges a tier has at most. */
export const COUNT: Readonly<Record<Tier, number>> = { hamlet: 0, village: 1, town: 2, city: 3 }

/** The tier of a repo by its files. */
export function tierOf(files: number): Tier {
  if (files < 50) return "hamlet"
  if (files < 500) return "village"
  return files < 3000 ? "town" : "city"
}
