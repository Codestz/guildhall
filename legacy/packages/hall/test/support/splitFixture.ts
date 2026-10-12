import { patchesOf } from "../../src/scene/archipelago/footprint.ts"
import type { Archipelago } from "../../src/world/archipelagoSource.ts"
import type { Tree } from "../../src/world/gen/load.ts"
import { growSplit } from "../../src/world/splitArchipelago.ts"
import { netFor } from "../../src/world/splitLinks.ts"
import type { World } from "../../src/world/world.ts"
import { FIXTURES } from "./fixtures.ts"

/**
 * React grown as an archipelago of its packages (`?repo=facebook/react&split`), once per test file
 * that asks: the core's world, the archipelago and its links made concrete.
 */
let cached: Promise<{ home: World; archipelago: Archipelago; net: ReturnType<typeof netFor> }> | undefined

export function reactSplit() {
  cached ??= (async () => {
    const fixture = FIXTURES.find((one) => one.repo === "facebook/react") as (typeof FIXTURES)[number]
    const tree = { repo: fixture.repo, source: "fixture", entries: fixture.entries } as unknown as Tree
    const grown = await growSplit(tree, patchesOf)
    if (!grown) throw new Error("React did not split")
    return {
      home: grown.home,
      archipelago: grown.archipelago,
      net: netFor(grown.archipelago, grown.home),
    }
  })()
  return cached
}
