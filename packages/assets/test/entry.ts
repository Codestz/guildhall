import type { CatalogEntry } from "../src/catalog.ts"

/** A valid static catalog entry; tests override the fields they care about. */
export function entry(over: Partial<CatalogEntry> & { id: string }): CatalogEntry {
  const pack = over.pack ?? over.id.split("/")[0]!
  const slug = over.id.split("/")[1]!
  return {
    pack,
    source: `${slug}.glb`,
    name: slug,
    kind: "static",
    category: "prop",
    tags: [],
    size: [1, 1, 1],
    footprint: { w: 1, d: 1 },
    tris: 120,
    verts: 80,
    bytes: 2048,
    swatches: [1, 22],
    scale: { factor: 1, rule: "factor", confidence: "pack", flags: [] },
    flags: [],
    compose: { front: null, streetEdge: null, attach: "free", anchors: [], source: "placeholder" },
    files: { glb: `pieces/${pack}/${slug}.glb`, thumb: `thumbs/${pack}/${slug}.webp` },
    hash: "0badc0de",
    ...over,
  }
}
