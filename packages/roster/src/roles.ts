import type { Role } from "./role.ts"
import { architect } from "./roles/architect.ts"
import { designer } from "./roles/designer.ts"
import { explorer } from "./roles/explorer.ts"
import { implementer } from "./roles/implementer.ts"
import { librarian } from "./roles/librarian.ts"
import { master } from "./roles/master.ts"
import { productOwner } from "./roles/product-owner.ts"
import { researcher } from "./roles/researcher.ts"
import { verifier } from "./roles/verifier.ts"

export type { Role } from "./role.ts"

/**
 * Every adventurer the guild ships (CONTEXT.md: Role), one module each under `roles/`. The herald
 * injects them into OpenCode (docs/harness.md); the hall reads their colour, station and site.
 */
export const ROLES: readonly Role[] = [
  master,
  architect,
  implementer,
  verifier,
  librarian,
  explorer,
  researcher,
  designer,
  productOwner,
]

/** What the hall needs of a role to draw it. */
export type Look = Pick<Role, "title" | "color" | "station" | "character" | "site">

/**
 * Any agent the roster does not know (OpenCode's own `general`, a user's agent): grey, overflow
 * bench, and out at the quarry when it works on the island.
 */
export const STRANGER: Look & { id: string; description: string; mode: Role["mode"] } = {
  id: "stranger",
  title: "Wanderer",
  description: "An agent from outside the guild.",
  mode: "subagent",
  color: "#9a8f80",
  station: "overflow",
  character: "rogue-hooded",
  site: "quarry",
}

/**
 * The role behind an agent name as OpenCode reports it: the agent id (`guild-implementer`) on both
 * versions — v2's `session.created.agent`, v1's `(@guild-implementer subagent)` title suffix.
 */
export function roleOf(agent: string): Look {
  return ROLES.find((role) => role.id === agent) ?? STRANGER
}
