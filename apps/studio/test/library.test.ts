import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ROUTES } from "../src/shell/router.ts"
import {
  HOST_CONFIG,
  hostRules,
  libraryMode,
  planLibrary,
  robots,
  sitemap,
  styleSubset,
} from "../vite.config.ts"

describe("the showcase's library mode", () => {
  test("style by default, full on request, a CDN by https URL", () => {
    expect(libraryMode(undefined)).toEqual({ kind: "style" })
    expect(libraryMode("")).toEqual({ kind: "style" })
    expect(libraryMode("style")).toEqual({ kind: "style" })
    expect(libraryMode("full")).toEqual({ kind: "full" })
    expect(libraryMode("https://cdn.example.org/lib/")).toEqual({
      kind: "remote",
      url: "https://cdn.example.org/lib",
    })
  })

  test("anything else is refused at build time", () => {
    expect(() => libraryMode("http://insecure.example.org")).toThrow()
    expect(() => libraryMode("pieces")).toThrow()
  })
})

describe("styleSubset", () => {
  test("keeps the house style's packs, the files their entries name and the rigs their characters use", async () => {
    const root = await mkdtemp(join(tmpdir(), "gh-library-"))
    await mkdir(join(root, "catalog"), { recursive: true })
    const pack = (id: string) => ({ id, vendor: "x", count: 1, hash: "h" })
    const rig = (id: string) => ({ id, file: `rigs/${id}.glb`, clips: [], bones: 1 })
    await writeFile(
      join(root, "catalog", "index.json"),
      JSON.stringify({
        version: 1,
        palette: "p",
        importer: "i",
        packs: [pack("kaykit-adventurers"), pack("quaternius-animals")],
        rigs: [rig("rig-medium"), rig("quaternius-animal-cow")],
      }),
    )
    const entry = (pack: string, slug: string, rigId?: string) => ({
      id: `${pack}/${slug}`,
      pack,
      files: { glb: `pieces/${pack}/${slug}.glb`, thumb: `thumbs/${pack}/${slug}.webp` },
      ...(rigId ? { character: { rig: rigId, clips: [], bones: 1 } } : {}),
    })
    await writeFile(
      join(root, "catalog", "kaykit-adventurers.json"),
      JSON.stringify([
        entry("kaykit-adventurers", "knight", "rig-medium"),
        entry("kaykit-adventurers", "sword"),
      ]),
    )
    await writeFile(
      join(root, "catalog", "quaternius-animals.json"),
      JSON.stringify([entry("quaternius-animals", "cow", "quaternius-animal-cow")]),
    )
    const subset = await styleSubset(root)
    expect(subset.index.packs.map((p) => p.id)).toEqual(["kaykit-adventurers"])
    expect(subset.index.rigs.map((r) => r.id)).toEqual(["rig-medium"])
    expect(subset.files).toEqual([
      "catalog/index.json",
      "catalog/kaykit-adventurers.json",
      "pieces/kaykit-adventurers/knight.glb",
      "pieces/kaykit-adventurers/sword.glb",
      "rigs/rig-medium.glb",
      "thumbs/kaykit-adventurers/knight.webp",
      "thumbs/kaykit-adventurers/sword.webp",
    ])
    // a shipped file that is missing fails the build
    await expect(planLibrary(root, "style")).rejects.toThrow()
    for (const rel of subset.files.filter((f) => !f.startsWith("catalog/"))) {
      await mkdir(join(root, rel, ".."), { recursive: true })
      await writeFile(join(root, rel), rel)
    }
    const before = await planLibrary(root, "style")
    expect(before.files).toEqual(subset.files)
    expect(before.version).toMatch(/^[0-9a-f]{12}$/)
    // out-of-style bytes do not move the version; a shipped byte does
    await mkdir(join(root, "pieces", "quaternius-animals"), { recursive: true })
    await writeFile(join(root, "pieces", "quaternius-animals", "cow.glb"), "moo")
    expect((await planLibrary(root, "style")).version).toBe(before.version)
    await writeFile(join(root, "pieces", "kaykit-adventurers", "knight.glb"), "v2")
    expect((await planLibrary(root, "style")).version).not.toBe(before.version)
    await rm(root, { recursive: true })
  })
})

describe("the host config (deploy/vercel.v2.json)", () => {
  const rules = hostRules(JSON.parse(readFileSync(HOST_CONFIG, "utf8")))

  test("every route deep-links to the app, with and without its id", () => {
    for (const route of ROUTES) {
      if (route.path === "") continue
      const base = `/${route.path}`
      expect([base, rules.rewrite(base)]).toEqual([base, "/index.html"])
      if (route.param) {
        const id = Array.from({ length: route.param.parts }, (_, i) => `part${i}.x`).join("/")
        expect([base, rules.rewrite(`${base}/${id}`)]).toEqual([base, "/index.html"])
      }
    }
    expect(rules.rewrite("/lab/hexworld")).toBe("/index.html")
    expect(rules.rewrite("/hall/vercel/next.js")).toBe("/index.html")
    expect(rules.rewrite("/harbour")).toBe("/index.html")
  })

  test("V1's old pages go to their V2 homes: /harbour.html is the harbour, /how is How it's built", () => {
    const { redirects } = JSON.parse(readFileSync(HOST_CONFIG, "utf8")) as {
      redirects: { source: string; destination: string }[]
    }
    const go = (path: string) => redirects.find((r) => new RegExp(`^${r.source}$`).test(path))?.destination
    expect(go("/harbour.html")).toBe("/harbour")
    expect(go("/harbour")).toBeUndefined()
    expect(go("/how")).toBe("/built")
    expect(go("/how.html")).toBe("/built")
    expect(go("/demos.html")).toBe("/demos")
  })

  test("files and unknown paths are not the app (the host answers 404 for a missing one)", () => {
    const paths = [
      "/library/abc/pieces/x.glb",
      "/data/x.json",
      "/assets/x.js",
      "/lab/repo/x.json.gz",
      "/nope",
    ]
    for (const path of paths) expect([path, rules.rewrite(path)]).toEqual([path, null])
  })

  test("hashed bundles and the versioned library are immutable; data revalidates", () => {
    const piece = "/library/b98371338cf8/pieces/a/b.glb"
    expect(rules.headers("/assets/main-abc.js")["Cache-Control"]).toContain("immutable")
    expect(rules.headers(piece)["Cache-Control"]).toContain("immutable")
    expect(rules.headers(piece)["Content-Type"]).toBe("model/gltf-binary")
    expect(rules.headers("/data/index.json")["Cache-Control"]).toContain("must-revalidate")
    expect(rules.headers("/")["Cache-Control"]).toBeUndefined()
    expect(rules.headers("/hall/a/b")["Content-Security-Policy"]).toContain("default-src 'self'")
  })

  test("robots points at the sitemap, which lists the public pages", () => {
    expect(robots("https://x.dev")).toContain("Sitemap: https://x.dev/sitemap.xml")
    const xml = sitemap("https://x.dev")
    for (const p of ["/", "/demos", "/harbour", "/built", "/studio"])
      expect(xml).toContain(`<loc>https://x.dev${p}</loc>`)
  })
})
