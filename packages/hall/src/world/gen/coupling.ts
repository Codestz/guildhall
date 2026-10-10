/**
 * How tightly two packages are bound, 0..1, which is how near their islands sit and whether a
 * bridge or a ferry joins them (world/repoArchipelago.ts). Pure.
 *
 * A tree has no file contents, so the default is a heuristic from the names: packages of one family
 * (`react-dom`, `react-dom-bindings`) are bound, and a hub (`shared`, `core`…) is depended on by its
 * siblings. When a source did read the manifests (`Manifests`: a package.json's name and
 * dependencies, a Cargo.toml's), their real edges win.
 */

/** A package's manifest, by the folder it lives in. */
export interface Manifest {
  name: string
  /** Names of the packages it depends on (any, not only the repo's own). */
  deps: readonly string[]
}
export type Manifests = Readonly<Record<string, Manifest>>

/** What coupling needs to know of a package. */
export interface Coupled {
  id: string
  label: string
  /** The workspace container it sits in ("packages"). */
  group?: string
}

/** Weights by pair; see `pairKey`. A pair that isn't there is unbound (0). */
export type Coupling = ReadonlyMap<string, number>

export const pairKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)
export const weightOf = (coupling: Coupling, a: string, b: string): number => coupling.get(pairKey(a, b)) ?? 0

/** Packages siblings lean on: a package called one of these is bound to the rest of its container. */
const HUBS = new Set(["core", "shared", "common", "utils", "util", "types", "internal", "base", "lib"])
/** A real dependency edge, and the share of an edge a family resemblance is worth at most. */
const DEPENDS = 0.9
const FAMILY = 0.8
const HUB = 0.3

const tokensOf = (label: string): string[] =>
  (label.split("/").pop() ?? label)
    .toLowerCase()
    .split(/[-_.]+/)
    .filter(Boolean)

/** The weight each pair of `packages` is bound by (only pairs above 0). Deterministic. */
export function couplingOf(packages: readonly Coupled[], manifests: Manifests = {}): Coupling {
  const out = new Map<string, number>()
  const set = (a: string, b: string, weight: number): void => {
    if (weight > (out.get(pairKey(a, b)) ?? 0)) out.set(pairKey(a, b), Math.min(1, weight))
  }
  // Tokens most packages share say nothing (every `react-*` is a react package): left out of the family test.
  const count = new Map<string, number>()
  for (const one of packages)
    for (const token of new Set(tokensOf(one.label))) count.set(token, (count.get(token) ?? 0) + 1)
  const rare = (one: Coupled): string[] =>
    tokensOf(one.label).filter((token) => (count.get(token) ?? 0) * 2 <= packages.length)

  for (const [i, a] of packages.entries())
    for (const b of packages.slice(i + 1)) {
      const ta = tokensOf(a.label)
      const tb = tokensOf(b.label)
      const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
      // One name leading the other's (react-dom, react-dom-bindings) is a family.
      const prefix = short.every((token, k) => token === long[k])
      const ra = new Set(rare(a))
      const rb = new Set(rare(b))
      const shared = [...ra].filter((token) => rb.has(token)).length
      const union = new Set([...ra, ...rb]).size
      const jaccard = union === 0 ? 0 : shared / union
      if (shared > 0 || (prefix && short.length > 1))
        set(a.id, b.id, Math.min(FAMILY, jaccard * 0.7 + (prefix ? 0.3 : 0)))
      else if (prefix) set(a.id, b.id, 0.2)
      if (a.group === b.group) {
        if (HUBS.has(ta.join("-")) || HUBS.has(tb.join("-"))) set(a.id, b.id, HUB)
      }
    }

  // A package's id is its folder: the key of its manifest. A real edge outweighs a guess; both ways, a full bond.
  const byName = new Map(
    packages.flatMap((one) => {
      const named = manifests[one.id]
      return named ? [[named.name, one.id] as const] : []
    }),
  )
  const edges = new Set<string>()
  for (const one of packages)
    for (const dep of manifests[one.id]?.deps ?? []) {
      const to = byName.get(dep)
      if (!to || to === one.id) continue
      set(one.id, to, edges.has(`${to}>${one.id}`) ? 1 : DEPENDS)
      edges.add(`${one.id}>${to}`)
    }
  return out
}
