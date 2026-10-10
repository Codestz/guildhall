import { describe, expect, test } from "bun:test"
import { patchesOf } from "../src/scene/archipelago/footprint.ts"
import { SEA_CELL, SEA_GAP, waterClear } from "../src/world/archipelago.ts"
import { islandIndexOf, parseSplitLink } from "../src/world/archipelagoLink.ts"
import { onDryLand } from "../src/world/clearance.ts"
import { coastOf, straitBetween } from "../src/world/coast.ts"
import { couplingOf, type Manifests, weightOf } from "../src/world/gen/coupling.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import {
  BIG_REPO_FILES,
  ISLET_FILES,
  MAX_ISLANDS,
  MAX_ISLETS,
  type RepoSplit,
  splitRepo,
} from "../src/world/gen/split.ts"
import type { Spot } from "../src/world/layout.ts"
import { COAST_BAND, QUAY_SPACING, quayProblem, withQuays } from "../src/world/quays.ts"
import {
  BRIDGE_GAP,
  BRIDGE_WEIGHT,
  chooseLinks,
  type Laid,
  layoutSplit,
  linkKind,
  placeCoupled,
  STRAIT_MIN,
} from "../src/world/repoArchipelago.ts"
import { reachOf, repoWorld, type World } from "../src/world/world.ts"
import { FIXTURES } from "./support/fixtures.ts"
import { SLOW } from "./support/slow.ts"

/**
 * A repo as an archipelago (`?repo=…&split`): how its tree is cut into islands, how bound they are,
 * where they lie, which are joined, and the quays where the crossings meet each coast.
 */

const fixture = (repo: string) => FIXTURES.find((one) => one.repo === repo) as (typeof FIXTURES)[number]
const entriesOf = (repo: string): RepoEntry[] => fixture(repo).entries as RepoEntry[]
const blobs = (entries: readonly RepoEntry[]): number => entries.filter((e) => e.type === "blob").length
const file = (path: string): RepoEntry => ({ path, type: "blob", size: 100 })
/** `n` files in `dir`, `dir/f0.ts`…. */
const files = (dir: string, n: number): RepoEntry[] =>
  Array.from({ length: n }, (_, i) => file(`${dir}/f${i}.ts`))

const REACT = splitRepo(entriesOf("facebook/react"), "facebook/react") as RepoSplit

describe("splitting a repo into islands", () => {
  test("React: each package an island, the one named for the repo the core", () => {
    expect(REACT.mode).toBe("workspaces")
    const [core, ...rest] = REACT.slices
    expect(core?.id).toBe("packages/react")
    expect(core?.kind).toBe("island")
    const ids = new Set(rest.map((s) => s.id))
    for (const wanted of ["packages/react-dom", "packages/react-reconciler", "packages/shared"])
      expect(ids.has(wanted)).toBe(true)
    // The root's own share (fixtures, tooling) is an island too.
    expect(ids.has(".")).toBe(true)
  })

  test("every file lands on exactly one island, none lost or doubled", () => {
    const total = REACT.slices.reduce((sum, s) => sum + s.files, 0)
    expect(total).toBe(blobs(entriesOf("facebook/react")))
    // A package is re-rooted at its folder: its src/ is a top-level folder of its own island.
    const dom = REACT.slices.find((s) => s.id === "packages/react-dom")
    expect(dom?.entries.some((e) => e.path.startsWith("src/"))).toBe(true)
    expect(dom?.entries.some((e) => e.path.startsWith("packages/"))).toBe(false)
  })

  test("islands are sized by their files: small packages are islets, and the sea is capped", () => {
    for (const slice of REACT.slices)
      if (!slice.pooled)
        expect(slice.kind).toBe(slice.files < ISLET_FILES && slice !== REACT.slices[0] ? "islet" : "island")
    const islands = REACT.slices.filter((s) => s.kind === "island" && !s.pooled)
    const islets = REACT.slices.filter((s) => s.kind === "islet" && !s.pooled)
    expect(islands.length).toBeLessThanOrEqual(MAX_ISLANDS)
    expect(islets.length).toBeLessThanOrEqual(MAX_ISLETS)
    // The rest are pooled into one "+N more" island, last.
    const pooled = REACT.slices.filter((s) => s.pooled)
    expect(pooled).toHaveLength(1)
    expect(REACT.slices.at(-1)).toBe(pooled[0])
  })

  test("a small monorepo splits too: guildhall's core is its `core` package, the hub the others lean on", () => {
    const split = splitRepo(entriesOf("Codestz/guildhall"), "Codestz/guildhall") as RepoSplit
    expect(split.slices[0]?.id).toBe("packages/core")
    expect(split.slices.find((s) => s.id === "packages/hall")?.kind).toBe("island")
    expect(split.slices.find((s) => s.id === "packages/sim")?.kind).toBe("islet")
  })

  test("a repo without workspaces stays one island: mcpx, Mintroot, is-odd", () => {
    for (const repo of [
      "Codestz/mcpx",
      "Codestz/Mintroot",
      "jonschlinkert/is-odd",
      "Codestz/claude-hindsight",
    ])
      expect(splitRepo(entriesOf(repo), repo)).toBeUndefined()
  })

  test("a lone package in packages/ is no workspace", () => {
    expect(splitRepo([...files("packages/only", 30), file("README.md")], "a/b")).toBeUndefined()
  })

  test("without workspaces, top-level folders are islands only when the repo is big", () => {
    const folders = (n: number): RepoEntry[] => ["api", "web", "docs"].flatMap((dir) => files(dir, n))
    expect(splitRepo(folders(BIG_REPO_FILES / 3 - 1), "a/b")).toBeUndefined()
    const split = splitRepo([...folders(BIG_REPO_FILES / 3), file("README.md")], "a/b") as RepoSplit
    expect(split.mode).toBe("folders")
    expect(split.slices.map((s) => s.id).sort()).toEqual([".", "api", "docs", "web"])
    expect(split.slices.find((s) => s.id === ".")?.kind).toBe("islet")
  })

  test("the same tree splits the same way whatever order its entries come in", () => {
    const shuffled = [...entriesOf("Codestz/guildhall")].reverse()
    const a = splitRepo(shuffled, "Codestz/guildhall") as RepoSplit
    const b = splitRepo(entriesOf("Codestz/guildhall"), "Codestz/guildhall") as RepoSplit
    expect(a.slices.map((s) => [s.id, s.files, s.kind])).toEqual(b.slices.map((s) => [s.id, s.files, s.kind]))
  })
})

describe("coupling between packages", () => {
  const pkgs = ["react-dom", "react-dom-bindings", "scheduler", "shared", "react-art"].map((label) => ({
    id: `packages/${label}`,
    label,
    group: "packages",
  }))
  const at = (a: string, b: string) => weightOf(couplingOf(pkgs), `packages/${a}`, `packages/${b}`)

  test("a family is bound, strangers are not, a hub is leaned on by its siblings", () => {
    expect(at("react-dom", "react-dom-bindings")).toBeGreaterThanOrEqual(BRIDGE_WEIGHT)
    expect(at("react-dom", "scheduler")).toBe(0)
    expect(at("shared", "scheduler")).toBeGreaterThan(0)
    expect(at("react-dom", "react-dom-bindings")).toBe(at("react-dom-bindings", "react-dom"))
  })

  test("manifests win: a real dependency binds packages whose names say nothing", () => {
    const manifests: Manifests = {
      "packages/scheduler": { name: "scheduler", deps: [] },
      "packages/react-art": { name: "react-art", deps: ["scheduler", "left-pad"] },
    }
    const coupling = couplingOf(pkgs, manifests)
    expect(weightOf(coupling, "packages/react-art", "packages/scheduler")).toBeGreaterThan(0.8)
    // Both ways, a full bond.
    const both = couplingOf(pkgs, {
      ...manifests,
      "packages/scheduler": { name: "scheduler", deps: ["react-art"] },
    })
    expect(weightOf(both, "packages/react-art", "packages/scheduler")).toBe(1)
  })

  test("the same names give the same weights", () => {
    expect([...couplingOf(pkgs)]).toEqual([...couplingOf(pkgs)])
  })
})

describe("the archipelago's layout", () => {
  // Grown once for the file: React's islands at the generator the link asks (2).
  const laid: Laid[] = REACT.slices.map((slice, i) => {
    const world = repoWorld(islandFromTree(slice.entries, 0, 2), {
      repo: "facebook/react",
      source: "fixture",
      gen: 2,
    })
    return {
      id: slice.id,
      world,
      footprint: { reach: reachOf(world), patches: patchesOf(world, i > 0, true) },
    }
  })
  const layout = layoutSplit(laid, REACT.coupling)
  const ids = laid.map((one) => one.id)
  const index = (id: string): number => ids.indexOf(id)
  const dist = (a: string, b: string): number =>
    Math.hypot(
      ...(([0, 1] as const).map(
        (k) => (layout.centers[index(a)] as Spot)[k] - (layout.centers[index(b)] as Spot)[k],
      ) as [number, number]),
    )

  test("the core sits at the origin, every island on the sea grid", () => {
    expect(layout.centers[0]).toEqual([0, 0])
    expect(layout.centers).toHaveLength(laid.length)
    for (const at of layout.centers) {
      expect(Math.abs(at[0] % SEA_CELL)).toBe(0)
      expect(Math.abs(at[1] % SEA_CELL)).toBe(0)
    }
  })

  const strait = (a: string, b: string): number =>
    straitBetween(
      coastOf((laid[index(a)] as Laid).world),
      layout.centers[index(a)] as Spot,
      coastOf((laid[index(b)] as Laid).world),
      layout.centers[index(b)] as Spot,
    )?.gap as number

  test("no two islands share water, or come closer than their strait: narrow for the bound, the sea gap for the rest", () => {
    for (const [i, a] of laid.entries())
      for (const [j, b] of laid.entries())
        if (j > i) {
          const [from, to] = [layout.centers[i] as Spot, layout.centers[j] as Spot]
          expect(waterClear(a.footprint, from, b.footprint, to)).toBe(true)
          const bound = weightOf(REACT.coupling, a.id, b.id) >= BRIDGE_WEIGHT
          expect(strait(a.id, b.id)).toBeGreaterThanOrEqual(bound ? STRAIT_MIN : SEA_GAP)
        }
  })

  test("bound packages sit in narrow straits: bridges, with the weaker links ferries", () => {
    const bridges = layout.links.filter((link) => link.kind === "bridge")
    expect(bridges.length).toBeGreaterThanOrEqual(3)
    for (const link of layout.links) {
      expect(link.gap).toBeCloseTo(strait(link.a, link.b), 0)
      if (link.kind === "bridge") {
        expect(link.weight).toBeGreaterThanOrEqual(BRIDGE_WEIGHT)
        expect(link.gap).toBeLessThanOrEqual(BRIDGE_GAP)
      }
    }
    const mean = (xs: number[]): number => xs.reduce((sum, x) => sum + x, 0) / xs.length
    const weak = layout.links.filter((link) => link.weight < BRIDGE_WEIGHT)
    expect(mean(bridges.map((link) => link.gap))).toBeLessThan(mean(weak.map((link) => link.gap)))
  })

  test("bound packages lie nearer each other than packages in general", () => {
    const pairs = ids.flatMap((a, i) => ids.slice(i + 1).map((b) => [a, b] as const))
    const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length
    const bound = pairs.filter(([a, b]) => weightOf(REACT.coupling, a, b) >= BRIDGE_WEIGHT)
    expect(bound.length).toBeGreaterThan(2)
    expect(mean(bound.map(([a, b]) => dist(a, b)))).toBeLessThan(mean(pairs.map(([a, b]) => dist(a, b))))
  })

  test("the same repo lays out the same sea, whatever the order islands are asked in", () => {
    expect(layoutSplit(laid, REACT.coupling)).toEqual(layout)
    const [, ...rest] = laid
    const body = (one: Laid) => ({ repo: one.id, ...one.footprint, coast: coastOf(one.world) })
    const seeds = rest.map(body)
    const core = body(laid[0] as Laid)
    expect(placeCoupled(seeds, core, REACT.coupling)).toEqual(layout.centers.slice(1))
  })

  test("links join every island, each pair once, no island over its quays", () => {
    const seen = new Set<string>()
    const reached = new Set<string>([ids[0] as string])
    for (const link of layout.links) {
      expect(link.a).not.toBe(link.b)
      expect(ids).toContain(link.a)
      expect(ids).toContain(link.b)
      expect(link.weight).toBeGreaterThan(0)
      expect(link.weight).toBeLessThanOrEqual(1)
      expect(["bridge", "ferry"]).toContain(link.kind)
      expect(seen.has([link.a, link.b].sort().join("|"))).toBe(false)
      seen.add([link.a, link.b].sort().join("|"))
    }
    for (let grew = true; grew; ) {
      grew = false
      for (const { a, b } of layout.links)
        if (reached.has(a) !== reached.has(b)) {
          reached.add(a)
          reached.add(b)
          grew = true
        }
    }
    // An island whose coast had no valid quay may be left out; nearly all must be in.
    expect(reached.size).toBeGreaterThanOrEqual(ids.length - 2)
  })

  test("a bridge needs a tight bond and a narrow sea; anything else is a ferry", () => {
    expect(linkKind(BRIDGE_WEIGHT, BRIDGE_GAP)).toBe("bridge")
    expect(linkKind(BRIDGE_WEIGHT - 0.01, 10)).toBe("ferry")
    expect(linkKind(1, BRIDGE_GAP + 1)).toBe("ferry")
  })

  test("links prefer the strongest bonds, and unbound packages join their nearest neighbour", () => {
    const centers: Spot[] = [
      [0, 0],
      [100, 0],
      [200, 0],
      [0, 400],
    ]
    const chosen = chooseLinks(["c", "a", "b", "z"], new Map([[`a\u0000b`, 0.9]]), centers)
    const pairs = chosen.map((l) => [l.a, l.b].sort().join("")).sort()
    // a–b (bound), then the unbound by distance: c–a, then z joins its nearest (c).
    expect(pairs).toEqual(["ab", "ac", "cz"])
  })

  describe("quays", () => {
    const worlds = laid.map((one, i) => withQuays(one.world as World, layout.quays[i] ?? []))

    test("every link has a quay at each end, on its own island's side", () => {
      for (const [k, link] of layout.links.entries())
        for (const [id, partner] of [
          [link.a, link.b],
          [link.b, link.a],
        ] as const) {
          const quay = layout.quays[index(id)]?.find((q) => q.link === k)
          expect(quay?.partner).toBe(partner)
          const center = layout.centers[index(id)] as Spot
          expect(quay?.at).toEqual([center[0] + (quay?.local[0] ?? 0), center[1] + (quay?.local[1] ?? 0)])
          expect(Math.hypot(quay?.facing[0] ?? 0, quay?.facing[1] ?? 0)).toBeCloseTo(1, 5)
        }
    })

    test(
      "each is on dry land at the coast, clear of buildings and trees",
      () => {
        let n = 0
        for (const [i, quays] of layout.quays.entries())
          for (const quay of quays) {
            n++
            const world = worlds[i] as World
            expect(onDryLand(quay.local, world)).toBe(true)
            expect(quayProblem(world, quay.local)).toBeUndefined()
          }
        expect(n).toBe(layout.links.length * 2)
      },
      30_000 * SLOW,
    )

    test(
      "each is a walk from the keep: joined to the road network the keep is on",
      () => {
        for (const [i, quays] of layout.quays.entries()) {
          const { nodes, edges } = (worlds[i] as World).roads
          const near = Object.keys(nodes).sort(
            (a, b) => Math.hypot(...(nodes[a] as Spot)) - Math.hypot(...(nodes[b] as Spot)),
          )[0] as string
          const reach = new Set([near])
          for (let grew = true; grew; ) {
            grew = false
            for (const [a, b] of edges)
              if (reach.has(a) !== reach.has(b)) {
                reach.add(a)
                reach.add(b)
                grew = true
              }
          }
          for (const quay of quays) {
            const node = Object.entries(nodes).find(([, at]) => at === quay.local)?.[0]
            expect(node).toBeDefined()
            expect(reach.has(node as string)).toBe(true)
          }
        }
      },
      30_000 * SLOW,
    )

    test("quays on one island keep their distance, and sit within a step of the sea", () => {
      for (const quays of layout.quays)
        for (const [i, a] of quays.entries()) {
          for (const b of quays.slice(i + 1))
            expect(Math.hypot(a.local[0] - b.local[0], a.local[1] - b.local[1])).toBeGreaterThanOrEqual(
              QUAY_SPACING,
            )
        }
      expect(COAST_BAND).toBeGreaterThan(0)
    })
  })
})

describe("the link", () => {
  test("`?repo=…&split` names the repo; without `split` or a repo it is no split", () => {
    expect(parseSplitLink("?repo=facebook/react&split")).toEqual({ repo: "facebook/react" })
    expect(parseSplitLink("?repo=facebook/react&split&island=map")).toEqual({
      repo: "facebook/react",
      island: "map",
    })
    expect(parseSplitLink("?repo=facebook/react")).toBeNull()
    expect(parseSplitLink("?split")).toBeNull()
    expect(parseSplitLink("?repo=facebook/react&split=0")).toBeNull()
    expect(parseSplitLink("?repo=home&split")).toBeNull()
  })

  test("`island=` finds a split repo's package by its name or its id", () => {
    const islands = [
      "facebook/react#packages/react-dom",
      "facebook/react#.",
      "facebook/react#compiler/packages/x",
    ]
    expect(islandIndexOf("react-dom", islands)).toBe(0)
    expect(islandIndexOf("facebook/react#packages/react-dom", islands)).toBe(0)
    expect(islandIndexOf("x", islands)).toBe(2)
    expect(islandIndexOf("map", islands)).toBe("map")
  })
})
