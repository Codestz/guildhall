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
 * injects them into OpenCode (docs/harness.md); the hall draws each as its archetype (cast.ts).
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

/**
 * The role behind an agent name as OpenCode reports it: the agent id (`guild-implementer`) on both
 * versions — v2's `session.created.agent`, v1's `(@guild-implementer subagent)` title suffix. Any
 * other agent is not the guild's (the hall draws it as a Wanderer: cast.ts).
 */
export function roleOf(agent: string): Role | undefined {
  return ROLES.find((role) => role.id === agent)
}
