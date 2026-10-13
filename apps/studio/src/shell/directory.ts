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
    id: "world",
    name: "World",
    blurb: "The hex island: its map, its scale and the town on it.",
    tools: [
      {
        id: "town",
        name: "Town",
        purpose: "The hex island in 3D, built tile by tile, its folk living their day and agents on errands.",
        preview: true,
      },
      {
        id: "hexmap",
        name: "Hex map",
        purpose: "The hex world from above: island, heights in steps, sand, cliffs, rivers, lakes, forest.",
        preview: true,
        dev: true,
      },
      {
        id: "hexscale",
        name: "Scale board",
        purpose:
          "The hex world's proportions side by side: tile, buildings, trees and characters at three scales.",
        dev: true,
      },
    ],
  },
  {
    id: "library",
    name: "Library",
    blurb: "Every CC0 piece the island is built from, tinted from one palette.",
    tools: [
      {
        id: "pieces",
        name: "Pieces",
        purpose: "Search the whole library and stand any piece beside a townsperson at the world's scale.",
        preview: true,
      },
      {
        id: "palette",
        name: "Palette",
        purpose: "Tune the one shared palette every piece is re-tinted to.",
        preview: true,
      },
    ],
  },
  {
    id: "build",
    name: "Build",
    blurb: "Turn pieces into the tiles and people the hex world is made of.",
    tools: [
      {
        id: "composer",
        name: "Tile composer",
        purpose:
          "Compose a hex tile's scene: its pieces, where people sit, work and talk, and what they walk round.",
        preview: true,
      },
      {
        id: "hextiles",
        name: "Tile prefabs",
        purpose:
          "Every hex tile prefab (house, farmstead, woods, field, road…) at the chosen scale, with a character.",
        preview: true,
        dev: true,
      },
      {
        id: "npc",
        name: "NPC builder",
        purpose: "Dress and equip the townsfolk from KayKit bodies and props.",
        preview: true,
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
