/**
 * The studio's directory: every tool by purpose, with a plain-words line on what it is for. The home
 * page draws its cards from it and the top bar its name and quick switcher. A tool marked `soon` has no
 * screen yet; every other id is a screen in `screens.ts` (home.test.ts holds the two in step). The
 * showcase build leaves out the tools marked `dev`.
 */
import { SHOWCASE } from "../env.ts"
import { href } from "./router.ts"

export interface Tool {
  /** The screen id (`screens.ts`); its path is in `router.ts`. */
  id: string
  /** The name people see: on the card, in the top bar and in the switcher. */
  name: string
  /** One line, plain words: what the tool lets you do. */
  purpose: string
  /** Not built yet: drawn as a dimmed card, with no link. */
  soon?: boolean
  /** Has a committed preview at `/home/<id>.webp`. */
  preview?: boolean
  /** Needs the local checkout (a bench, the raw packs): not in the public showcase. */
  dev?: boolean
}

export interface ToolGroup {
  id: string
  name: string
  /** What the tools in the group have in common. */
  blurb: string
  tools: readonly Tool[]
}

export const HOME_ID = "home"

const ALL_GROUPS: readonly ToolGroup[] = [
  {
    id: "library",
    name: "Library",
    blurb: "Every CC0 piece, sized to one hero and tinted from one palette.",
    tools: [
      {
        id: "pieces",
        name: "Pieces",
        purpose: "Search the whole library and stand any piece beside a 2.2 m hero.",
        preview: true,
      },
      {
        id: "palette",
        name: "Palette",
        purpose: "Tune the one shared palette every piece is re-tinted to.",
        preview: true,
      },
      {
        id: "scale",
        name: "Scale",
        purpose: "Line packs up side by side to check they share one scale.",
        preview: true,
      },
      {
        id: "lineup",
        name: "Lineup",
        purpose: "The untouched vendor packs, before import, for comparison.",
        preview: true,
        // It reads the raw vendor packs (`/raw/`), which only a local checkout has.
        dev: true,
      },
    ],
  },
  {
    id: "build",
    name: "Build",
    blurb: "Turn pieces into buildings a town can use.",
    tools: [
      {
        id: "composer",
        name: "Composer",
        purpose: "Assemble a house from modules: storeys, roof, door, windows, dressing.",
        preview: true,
      },
      {
        id: "npc",
        name: "NPC builder",
        purpose: "Dress and equip the townsfolk from KayKit bodies and props.",
      },
    ],
  },
  {
    id: "characters",
    name: "Characters",
    blurb: "Bodies, animation clips and the props they hold.",
    tools: [
      {
        id: "grip",
        name: "Grip editor",
        purpose: "Fit a prop to a hand, then check the grip through the key clips.",
        preview: true,
      },
      {
        id: "grips",
        name: "Grip matrix",
        purpose: "Every held prop in every key clip, on one sheet.",
        preview: true,
      },
    ],
  },
  {
    id: "world",
    name: "World",
    blurb: "The ground, the light and the town around them.",
    tools: [
      {
        id: "site",
        name: "Site & light",
        purpose: "A town site grown from a seed, lit from dawn to golden hour.",
        preview: true,
      },
      {
        id: "shadows",
        name: "Shadows",
        purpose: "World-fixed sun shadows that hold still as the camera moves.",
        preview: true,
      },
      {
        id: "planner",
        name: "Town planner",
        purpose: "A live fantasy map of a generated town, to judge its layout at a glance.",
      },
      {
        id: "town",
        name: "Town",
        purpose: "A generated town in 3D under the golden-hour sun: streets, walls, harbour, skyline.",
      },
    ],
  },
  {
    id: "lab",
    name: "Lab",
    blurb: "Benches the studio was built on.",
    tools: [
      {
        id: "m0",
        name: "M0 skeleton",
        purpose: "The first render bench: a stage, a camera, a frame budget.",
        dev: true,
      },
      {
        id: "batch",
        name: "Static batch",
        purpose: "Thousands of pieces in one draw: calls stay flat as the count grows.",
        dev: true,
      },
      {
        id: "night",
        name: "Night",
        purpose: "A town from day to night: lamps, lit windows, moonlight, a clock to scrub.",
        dev: true,
      },
      {
        id: "atmosphere",
        name: "Atmosphere",
        purpose: "Clouds, their shadows and the water's reflections over the island town, hour by hour.",
        dev: true,
      },
    ],
  },
]

/** Every group and tool this build offers: the showcase drops the `dev` tools, and a group left empty. */
export const GROUPS: readonly ToolGroup[] = SHOWCASE
  ? ALL_GROUPS.map((g) => ({ ...g, tools: g.tools.filter((t) => !t.dev) })).filter((g) => g.tools.length > 0)
  : ALL_GROUPS

/** The home page itself, for the top bar and the switcher. */
export const HOME_TOOL: Tool = {
  id: HOME_ID,
  name: "Home",
  purpose: "The front door: every tool, live stats.",
}

/** A tool with the group it sits in. */
export interface Placed {
  tool: Tool
  group: ToolGroup | null
}

/** The tool a screen id names, with its group; null for an id the directory does not know. */
export function placeOf(id: string): Placed | null {
  if (id === HOME_ID) return { tool: HOME_TOOL, group: null }
  for (const group of GROUPS) {
    const tool = group.tools.find((t) => t.id === id)
    if (tool) return { tool, group }
  }
  return null
}

/** Every tool that has a screen: home first, then the groups in order. */
export function openable(): Placed[] {
  return [
    { tool: HOME_TOOL, group: null },
    ...GROUPS.flatMap((group) => group.tools.filter((t) => !t.soon).map((tool) => ({ tool, group }))),
  ]
}

/**
 * The switcher's list for what was typed: every word must start a word of the name, group or id, or
 * appear in the purpose. Name matches rank first; order is otherwise the directory's.
 */
export function search(text: string, from: readonly Placed[] = openable()): Placed[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...from]
  const starts = (hay: string, w: string) => hay.split(/[^a-z0-9]+/).some((part) => part.startsWith(w))
  const scored = from.flatMap((p, i) => {
    const name = p.tool.name.toLowerCase()
    const head = `${name} ${p.group?.name.toLowerCase() ?? ""} ${p.tool.id}`
    const purpose = p.tool.purpose.toLowerCase()
    let score = 0
    for (const w of words) {
      if (starts(name, w)) score += 3
      else if (starts(head, w)) score += 2
      else if (purpose.includes(w)) score += 1
      else return []
    }
    return [{ p, score, i }]
  })
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((s) => s.p)
}

/** The deep link to a screen: its path (`/pieces`). */
export const linkTo = (id: string): string => href(id)
