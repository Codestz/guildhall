/** Test helpers: small catalog entries and a catalog over them. */
import type { CatalogEntry, CatalogIndex } from "@guildhall/assets"
import { createCatalog } from "@guildhall/assets"

export function entry(id: string, patch: Partial<CatalogEntry> = {}): CatalogEntry {
  const [pack = "pack", slug = id] = id.split("/")
  return {
    id,
    pack,
    source: `${slug}.glb`,
    name: slug,
    kind: "static",
    category: "prop",
    tags: [],
    size: [1, 1, 1],
    footprint: { w: 1, d: 1 },
    tris: 12,
    verts: 8,
    bytes: 2048,
    swatches: [0],
    scale: { factor: 1, rule: "factor", confidence: "pack", flags: [] },
    flags: [],
    compose: { front: null, streetEdge: null, attach: "free", anchors: [], source: "placeholder" },
    files: { glb: `pieces/${pack}/${slug}.glb`, thumb: null },
    hash: "0",
    ...patch,
  }
}

export function index(packs: { id: string; vendor: string }[]): CatalogIndex {
  return {
    version: 1,
    palette: "p",
    importer: "test",
    packs: packs.map((p) => ({ ...p, count: 0, hash: "0" })),
    rigs: [],
  }
}

/** A catalog whose packs (and vendors) are read off the entries' ids. */
export function catalogOf(entries: CatalogEntry[], vendors: Record<string, string> = {}) {
  const packs = [...new Set(entries.map((e) => e.pack))].map((id) => ({ id, vendor: vendors[id] ?? "other" }))
  return createCatalog(index(packs), [entries])
}
