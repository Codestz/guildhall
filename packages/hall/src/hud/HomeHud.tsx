import type { HomePhase } from "../guild/home.ts"
import { HomeFilm } from "./HomeFilm.tsx"
import { HomeInvite } from "./HomeInvite.tsx"

/**
 * The showcase home's own HUD (guild/homeShow.ts): its film's date and way out while the film plays,
 * then its invitation card (not over an open repo door, nor with the HUD hidden).
 */
export function HomeHud({ phase, phone, quiet }: { phase: HomePhase; phone: boolean; quiet: boolean }) {
  if (phase === "film") return <HomeFilm phone={phone} />
  if (phase === "invite" && !quiet) return <HomeInvite phone={phone} />
  return null
}
