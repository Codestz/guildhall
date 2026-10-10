/**
 * Prints a short hash of what the generators make, per bundled repo fixture and seed: the plan, tiles,
 * decor, roads, venues, homes, relief (massifs, heights, dressing, the whole mesh), rivers, trails,
 * wilds and lights. A world must come out the same on every machine, so run this where CI runs
 * (macOS arm64 and Linux x64) and diff the output:
 *
 *   bun scripts/worldHash.ts [seeds=3] > host.txt
 *   docker run --rm --platform linux/amd64 -v "$PWD":/w -w /w oven/bun:1.4.2 bun scripts/worldHash.ts > linux.txt
 *   diff host.txt linux.txt
 */
import { createHash } from "node:crypto"
import { patchesOf } from "../packages/hall/src/scene/archipelago/footprint.ts"
import { unkey } from "../packages/hall/src/world/gen/hex.ts"
import { islandFromTree } from "../packages/hall/src/world/gen/islandFromTree.ts"
import { reliefMesh } from "../packages/hall/src/world/gen/relief/mesh.ts"
import type { RepoEntry } from "../packages/hall/src/world/gen/repo.ts"
import { splitRepo } from "../packages/hall/src/world/gen/split.ts"
import { lightsOf } from "../packages/hall/src/world/lights.ts"
import { layoutSplit } from "../packages/hall/src/world/repoArchipelago.ts"
import { wildsOf } from "../packages/hall/src/world/wilds.ts"
import { reachOf, repoWorld } from "../packages/hall/src/world/world.ts"
import { FIXTURES } from "../packages/hall/test/support/fixtures.ts"

const hash = (value: unknown): string =>
  createHash("sha1")
    .update(
      String(
        JSON.stringify(value, (_key, v) =>
          v instanceof Map
            ? [...v]
            : v instanceof Set
              ? [...v]
              : ArrayBuffer.isView(v)
                ? Array.from(v as unknown as ArrayLike<number>)
                : v,
        ),
      ),
    )
    .digest("hex")
    .slice(0, 6)

const seeds = Number(process.argv[2] ?? 3)
for (const fixture of FIXTURES)
  for (let seed = 0; seed < seeds; seed++) {
    const made = islandFromTree(fixture.entries as RepoEntry[], seed, 2)
    const world = repoWorld(made, { repo: fixture.repo, source: "fixture", gen: 2 })
    const parts: Record<string, string> = {
      plan: hash(made.plan),
      tiles: hash(world.island.tiles),
      decor: hash(world.island.decor),
      roads: hash(world.roads),
      venues: hash(world.venues),
      homes: hash(world.homes),
      districts: hash(made.districts),
      sites: hash(world.storySites),
      water: hash(world.water),
      trails: hash(world.trails),
      wilds: hash(wildsOf(world)),
      lights: hash(lightsOf(world)),
    }
    const relief = world.relief
    if (relief) {
      parts.massifs = hash(relief.massifs.map((m) => [...m.keys].sort()))
      const heights: number[] = []
      for (let x = -160; x <= 160; x += 5)
        for (let z = -160; z <= 160; z += 5) heights.push(world.ground.heightAt(x, z))
      parts.heights = hash(heights)
      parts.mesh = hash(relief.massifs.map((m) => reliefMesh(relief, [...m.keys].map(unkey), 0)))
    }
    console.log(
      `${fixture.repo}#${seed}`,
      Object.entries(parts)
        .map(([name, value]) => `${name}:${value}`)
        .join(" "),
    )
  }

// A repo as an archipelago (`?repo=…&split`): the split, the coupling, where the islands lie, the
// links and the quays. Island growth is the same generator hashed above, so this covers the layout.
for (const fixture of FIXTURES) {
  const split = splitRepo(fixture.entries as RepoEntry[], fixture.repo)
  if (!split) continue
  const laid = split.slices.map((slice, i) => {
    const world = repoWorld(islandFromTree(slice.entries, 0, 2), {
      repo: fixture.repo,
      source: "fixture",
      gen: 2,
    })
    return {
      id: slice.id,
      world,
      footprint: { reach: reachOf(world), patches: patchesOf(world, i > 0, true) },
    }
  })
  const layout = layoutSplit(laid, split.coupling)
  console.log(
    `${fixture.repo}#split`,
    `slices:${hash(split.slices.map((s) => [s.id, s.kind, s.files]))}`,
    `coupling:${hash([...split.coupling].sort())}`,
    `centers:${hash(layout.centers)}`,
    `links:${hash(layout.links)}`,
    `quays:${hash(layout.quays)}`,
  )
}
