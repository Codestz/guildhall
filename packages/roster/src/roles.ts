/**
 * Every adventurer the guild ships (CONTEXT.md: Role). One record drives both sides:
 * the herald injects it as an OpenCode agent, the hall uses it to pick a character and a station.
 * Prompts live next to this file as `prompts/<id>.md` (to be ported from Agentry's plugin/agents).
 */
export interface Role {
  /** OpenCode agent id. Prefixed so it never collides with a user's agents (docs/opencode/shipping-agents.md). */
  id: `guild-${string}`
  title: string
  description: string
  mode: "primary" | "subagent"
  /** Hex color, shared by the OpenCode TUI and the hall. */
  color: string
  station:
    | "quest-board"
    | "drafting-table"
    | "forge"
    | "inspection-bench"
    | "library"
    | "map-table"
    | "easel"
    | "scroll-desk"
    | "overflow"
  /** Character model key in the hall's asset manifest. */
  character: string
}

export const ROLES: readonly Role[] = [
  {
    id: "guild-master",
    title: "Guildmaster",
    description: "Routes work to the right adventurers and gates the results.",
    mode: "primary",
    color: "#d4ad3a",
    station: "quest-board",
    character: "mage",
  },
  {
    id: "guild-architect",
    title: "Architect",
    description: "Designs structure and boundaries before code is written.",
    mode: "subagent",
    color: "#4f8fd6",
    station: "drafting-table",
    character: "knight",
  },
  {
    id: "guild-implementer",
    title: "Implementer",
    description: "Builds a bounded task: code and tests inside its contract.",
    mode: "subagent",
    color: "#e0702f",
    station: "forge",
    character: "barbarian",
  },
  {
    id: "guild-verifier",
    title: "Verifier",
    description: "Tries to prove finished work wrong; never the author.",
    mode: "subagent",
    color: "#3fae6b",
    station: "inspection-bench",
    character: "rogue",
  },
  {
    id: "guild-librarian",
    title: "Librarian",
    description: "Looks up docs and keeps what the guild learns.",
    mode: "subagent",
    color: "#8b6cd9",
    station: "library",
    character: "mage",
  },
  {
    id: "guild-explorer",
    title: "Explorer",
    description: "Maps unfamiliar code, read-only.",
    mode: "subagent",
    color: "#2fa7a0",
    station: "map-table",
    character: "ranger",
  },
  {
    id: "guild-researcher",
    title: "Researcher",
    description: "Answers unknowns from the web with cited findings.",
    mode: "subagent",
    color: "#6fb3e0",
    station: "map-table",
    character: "rogue-hooded",
  },
  {
    id: "guild-designer",
    title: "Designer",
    description: "Shapes UI and checks the rendered result.",
    mode: "subagent",
    color: "#e070a8",
    station: "easel",
    character: "rogue",
  },
  {
    id: "guild-product-owner",
    title: "Product owner",
    description: "Turns a vague goal into a spec with checkable criteria.",
    mode: "subagent",
    color: "#b8864a",
    station: "scroll-desk",
    character: "knight",
  },
]

/** Any agent the roster does not know (OpenCode's own `general`, a user's agent): grey, overflow bench. */
export const STRANGER: Omit<Role, "id"> & { id: string } = {
  id: "stranger",
  title: "Wanderer",
  description: "An agent from outside the guild.",
  mode: "subagent",
  color: "#9a8f80",
  station: "overflow",
  character: "rogue-hooded",
}

export function roleOf(agent: string): Pick<Role, "title" | "color" | "station" | "character"> {
  return ROLES.find((role) => role.id === agent) ?? STRANGER
}
