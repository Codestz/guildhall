import { hash } from "../hex.ts"
import type { Folder } from "../repo.ts"
import type { IslandHint, Role } from "./types.ts"

/**
 * What an island is for, from its name and then from what is in it, and the landmark that says so:
 * a forge works for the compilers and build tools, an academy or an observatory for the docs and the
 * devtools, a keep for the tests, a harbour fortress for what talks across the water, a castle for
 * the shared core. A name that says nothing makes a civic island, its heart chosen by size.
 */

/** Words that name a role, in the order they win: `devtools-docs` is a library, `server-dom-webpack` a harbour. */
const WORDS: readonly (readonly [Role, readonly string[]])[] = [
  [
    "library",
    "docs doc documentation website www site blog guides guide book wiki examples example".split(" "),
  ],
  [
    "watch",
    "test tests testing fixtures fixture e2e bench benchmark benchmarks jest mocks spec specs".split(" "),
  ],
  [
    "harbour",
    "server servers network net http https api ssr gateway proxy socket sockets transport relay".split(" "),
  ],
  [
    "forge",
    "compiler babel build builder bundler transform transpiler plugin plugins codegen parser lexer swc webpack rollup vite esbuild eslint lint".split(
      " ",
    ),
  ],
  [
    "observatory",
    "devtools devtool inspector debug debugger profiler monitor telemetry analytics tracing trace metrics dashboard".split(
      " ",
    ),
  ],
  ["castle", "shared core common kernel runtime base engine main lib utils util types".split(" ")],
]

const tokensOf = (name: string): string[] =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/** The role a name says, or none. */
function named(name: string): Role | undefined {
  const tokens = new Set(tokensOf(name))
  return WORDS.find(([, words]) => words.some((word) => tokens.has(word)))?.[0]
}

/** An island's role: the core's own, else its name's, else the one most of its files are in, else civic. */
export function roleOf(hint: IslandHint | undefined, folders: readonly Folder[]): Role {
  if (!hint || hint.core) return "core"
  const byName = named(hint.name)
  if (byName) return byName
  const byFolder = new Map<Role, number>()
  let files = 0
  for (const folder of folders) {
    files += folder.files
    const role = named(folder.name)
    if (role) byFolder.set(role, (byFolder.get(role) ?? 0) + folder.files)
  }
  const [best] = [...byFolder].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  return best && best[1] * 2 >= files ? best[0] : "civic"
}

/** Land below which an island is an islet: only the small landmarks (rings 0) are for it. */
export const ISLET_LAND = 110
/** Land a civic island needs to be a big package: a cathedral or a keep, not a guildhouse. */
const BIG = 330

/**
 * The composites an island may have as its heart, the best first (plan/heart.ts builds the first
 * that fits the land): by its role, and by its size. An islet has an islet's landmark, a lighthouse
 * where the work is the sea's.
 */
export function wishOf(role: Role, land: number, name: string, seed: number): readonly string[] {
  if (land < ISLET_LAND) {
    if (role === "harbour") return ["islet-lighthouse"]
    if (role === "library" || role === "observatory" || role === "civic") return ["islet-shrine"]
    return ["islet-fort"]
  }
  const turn = hash(`${name}:${seed}`)
  const small = land < BIG ? "guildhouse-plaza academy observatory" : "cathedral castle-keep guildhouse-plaza"
  const civic = small.split(" ")
  switch (role) {
    case "core":
      return ["castle-grand", "castle-keep", "islet-fort"]
    case "castle":
      return ["castle-keep", "islet-fort"]
    case "forge":
      return ["forge-works", "castle-keep", "islet-fort"]
    case "library":
      return ["academy", "cathedral", "islet-shrine"]
    case "observatory": {
      // Most of the devtools look at the sky; one in four is a workshop, one in four a school.
      const first = ["forge-works", "academy", "observatory", "observatory"][turn % 4] as string
      return [first, "observatory", "academy", "islet-shrine"]
    }
    case "watch":
      return ["castle-keep", "islet-fort"]
    case "harbour":
      return ["harbour-fortress", "castle-keep", "islet-lighthouse"]
    case "civic": {
      const first = civic[turn % civic.length] as string
      return [first, ...civic.filter((id) => id !== first), "islet-shrine"]
    }
  }
}
