import { islandFromTree } from "../../src/world/gen/islandFromTree.ts"
import type { RepoEntry } from "../../src/world/gen/repo.ts"
import { repoWorld, type World } from "../../src/world/world.ts"
import HINDSIGHT from "../fixtures/repos/codestz__claude-hindsight.json"
import MCPX from "../fixtures/repos/codestz__mcpx.json"
import MINTROOT from "../fixtures/repos/codestz__mintroot.json"
import COCKPIT from "../fixtures/repos/codestz__opencode-cockpit.json"
import REACT from "../fixtures/repos/facebook__react.json"
import SELF from "../fixtures/repos/guildhall.json"
import IS_ODD from "../fixtures/repos/jonschlinkert__is-odd.json"

/** Every bundled repo tree (test/fixtures/repos), from a hamlet to React. */
export const FIXTURES: readonly { repo: string; entries: unknown[] }[] = [
  REACT,
  SELF,
  COCKPIT,
  HINDSIGHT,
  MCPX,
  MINTROOT,
  IS_ODD,
]

/** A fixture grown as the given generator (the default world is gen 2). */
export function grown(fixture: { repo: string; entries: unknown[] }, gen: 1 | 2 = 2): World {
  return repoWorld(islandFromTree(fixture.entries as RepoEntry[], 0, gen), {
    repo: fixture.repo,
    source: "fixture",
    gen,
  })
}

/** All bundled fixtures grown at gen 2, named by repo; built once per test file that asks. */
let cached: [string, World][] | undefined
export function gen2Worlds(): [string, World][] {
  cached ??= FIXTURES.map((fixture) => [fixture.repo, grown(fixture)])
  return cached
}
