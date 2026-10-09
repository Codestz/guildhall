import { describe, expect, test } from "bun:test"
import { BODY, blocker, box, islandObstacles } from "../src/world/clearance.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import LANDS from "../src/world/lands.json"
import { prefab } from "../src/world/prefabs/index.ts"
import { repoWorld } from "../src/world/world.ts"
import HINDSIGHT from "./fixtures/repos/codestz__claude-hindsight.json"
import MCPX from "./fixtures/repos/codestz__mcpx.json"
import MINTROOT from "./fixtures/repos/codestz__mintroot.json"
import COCKPIT from "./fixtures/repos/codestz__opencode-cockpit.json"
import REACT from "./fixtures/repos/facebook__react.json"
import SELF from "./fixtures/repos/guildhall.json"

/**
 * A venue's door step (prefabs/venues.ts) is the spot someone stands to go in: just outside the
 * building, not inside its clearance box (clearance.ts: the box of the piece's bounds, porch and stairs
 * included), where a body is a clearance's width from any obstacle.
 */

const VENUES = ["forge", "library", "tavern", "mine-entrance", "watchtower", "market-hall"]
type Bounds = { min: readonly number[]; max: readonly number[] }

describe("a venue prefab's door step", () => {
  for (const id of VENUES) {
    test(`${id}: a body at the step clears every piece of the venue`, () => {
      const venue = prefab(id)
      const step = venue.doors[0]
      expect(step).toBeDefined()
      const crowded = venue.parts.flatMap((part) => {
        const bounds = (LANDS as Record<string, Bounds>)[part.piece.replace("{kit}", "blue")]
        if (!bounds || part.piece.startsWith("hex_")) return []
        const own = box(part.piece, bounds, part.x, part.z, part.rot ?? 0, 5 * (part.scale ?? 1))
        return own.distance(step?.x ?? 0, step?.z ?? 0) < BODY ? [part.piece] : []
      })
      expect(crowded).toEqual([])
    })
  }
})

describe("a gen 2 island's venue steps", () => {
  const worlds = [REACT, SELF, COCKPIT, HINDSIGHT, MCPX, MINTROOT].map((fixture) =>
    repoWorld(islandFromTree(fixture.entries as RepoEntry[], 0, 2), {
      repo: fixture.repo,
      source: "fixture",
      gen: 2,
    }),
  )

  test("no step stands inside a building's own clearance box", () => {
    const inBuilding: string[] = []
    for (const world of worlds) {
      const obstacles = islandObstacles(world).filter((o) => /^building_/.test(o.name))
      for (const venue of world.venues ?? []) {
        const hit = blocker(venue.door.step, obstacles)
        if (hit) inBuilding.push(`${world.repo?.repo} ${venue.kind} in ${hit.name}`)
      }
    }
    expect(inBuilding).toEqual([])
  })
})
