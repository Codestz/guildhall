import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { Document } from "@gltf-transform/core"
import type { PackConfig } from "@guildhall/assets"
import { checkLibrary } from "../src/check.ts"
import { loadPacks, paths, selectPacks } from "../src/config.ts"
import { classify, discover, globToRegExp, kebab, slugClashes } from "../src/discover.ts"
import { runImport } from "../src/pipeline.ts"
import { decodePng, encodePng } from "../src/png.ts"
import { fbxConverter, readModel, splitTopNodes } from "../src/read.ts"
import { pickModelFiles, scanPack } from "../src/scan.ts"
import { FIXTURES, fixturePacks, fixturePaths, PACKS, tempDir } from "./fixtures/env.ts"

const SRC = resolve(import.meta.dir, "../src")
const CLI = join(SRC, "cli.ts")

/** A pack config with only what a test cares about. */
const pack = (over: Partial<PackConfig>): PackConfig => ({
  id: "test",
  source: "test",
  vendor: "other",
  license: "CC0",
  include: ["**/*.glb"],
  colour: { mode: "material" },
  scale: { factor: 1 },
  pivot: "keep",
  rules: [],
  ...over,
})

describe("AC1.11: no pack or vendor names in tools/import/src", () => {
  test("src never names a vendor or a configured pack", async () => {
    const configured = (await loadPacks(PACKS)).filter((p) => !p.id.startsWith("fixture-"))
    const names = ["kaykit", "kenney", "quaternius", ...configured.flatMap((p) => [p.id, p.source])]
    const files = readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"))
    const hits = files.flatMap((f) => {
      const text = readFileSync(join(SRC, f), "utf8").toLowerCase()
      return names.filter((n) => text.includes(n.toLowerCase())).map((n) => `${f}: ${n}`)
    })
    expect(files.length).toBeGreaterThan(10)
    expect(hits).toEqual([])
  })
})

describe("config", () => {
  test("environment variables move the raw, library and packs roots", () => {
    const p = paths({ GUILDHALL_ASSETS: "/a", GUILDHALL_LIBRARY: "/l", GUILDHALL_PACKS: "/p" })
    expect(p).toEqual({ raw: "/a", library: "/l", packs: "/p" })
  })

  test("the fixture configs load and select by id; an unknown id is an error", async () => {
    const packs = await fixturePacks()
    expect(packs.map((p) => p.id)).toEqual(["fixture-atlas", "fixture-colormap", "fixture-material"])
    expect(selectPacks(packs, ["all"])).toHaveLength(3)
    expect(selectPacks(packs, ["fixture-atlas"]).map((p) => p.id)).toEqual(["fixture-atlas"])
    expect(() => selectPacks(packs, ["nope"])).toThrow("unknown pack: nope")
  })
})

describe("discover", () => {
  test("globs: * stays in a segment, ** crosses, {a,b} alternates, case is ignored", () => {
    expect(globToRegExp("Models/*.glb").test("models/wall.GLB")).toBe(true)
    expect(globToRegExp("Models/*.glb").test("Models/sub/wall.glb")).toBe(false)
    expect(globToRegExp("**/*.glb").test("a/b/c.glb")).toBe(true)
    expect(globToRegExp("**/*.glb").test("c.glb")).toBe(true)
    expect(globToRegExp("wall-{door,window}*").test("wall-window-round")).toBe(true)
    expect(globToRegExp("a,b").test("a,b")).toBe(true)
  })

  test("kebab turns source names into slugs", () => {
    expect(kebab("BirchTree_Dead_Snow_4")).toBe("birch-tree-dead-snow-4")
    expect(kebab("building_home_A_blue")).toBe("building-home-a-blue")
    expect(kebab("RPGCharacter")).toBe("rpg-character")
    expect(kebab("wall-door")).toBe("wall-door")
  })

  test("the first matching rule wins, overrides replace category and add tags", () => {
    const p = pack({
      rules: [
        { match: "wall-door*", category: "door", tags: ["entry"] },
        { match: "wall*", category: "wall" },
        { match: "Props/*", category: "prop" },
      ],
      overrides: { "wall-corner": { category: "tower", tags: ["corner"] } },
      characters: [{ match: "hero*", rig: "rig-a" }],
    })
    expect(classify(p, "/x", "wall-door-round.glb", "wall-door-round").category).toBe("door")
    expect(classify(p, "/x", "wall-flat.glb", "wall-flat").category).toBe("wall")
    expect(classify(p, "/x", "Props/barrel.glb", "barrel").category).toBe("prop")
    expect(classify(p, "/x", "rock.glb", "rock").category).toBe("other")
    const corner = classify(p, "/x", "wall-corner.glb", "wall-corner")
    expect([corner.category, corner.tags]).toEqual(["tower", ["corner"]])
    expect(classify(p, "/x", "hero_knight.glb", "hero_knight").rig).toBe("rig-a")
  })

  test("discover applies include, exclude and excluded overrides, sorted by slug", () => {
    const all = discover(pack({ id: "m", source: "fixture-material" }), FIXTURES)
    expect(all.map((p) => [p.slug, p.source])).toEqual([
      ["bush", "bush.glb"],
      ["villager", "villager.glb"],
    ])
    expect(
      discover(pack({ source: "fixture-material", exclude: ["vill*"] }), FIXTURES).map((p) => p.slug),
    ).toEqual(["bush"])
    expect(
      discover(pack({ source: "fixture-material", overrides: { bush: { exclude: true } } }), FIXTURES).map(
        (p) => p.slug,
      ),
    ).toEqual(["villager"])
    expect(discover(pack({ source: "missing-folder" }), FIXTURES)).toEqual([])
  })

  test("two files that kebab to one slug are reported", () => {
    const p = pack({})
    const clashes = slugClashes([
      classify(p, "/a", "a/Wall_Door.glb", "Wall_Door"),
      classify(p, "/b", "b/wall-door.glb", "wall-door"),
    ])
    expect(clashes).toEqual(["test/wall-door: a/Wall_Door.glb and b/wall-door.glb"])
  })
})

describe("read", () => {
  test("splitTopNodes cuts one document per top-level node and prunes the rest", async () => {
    const doc = new Document()
    const scene = doc.createScene()
    for (const name of ["Tree", "Rock"]) {
      const pos = doc.createAccessor().setType("VEC3").setArray(new Float32Array(9))
      scene.addChild(
        doc
          .createNode(name)
          .setMesh(doc.createMesh(name).addPrimitive(doc.createPrimitive().setAttribute("POSITION", pos))),
      )
    }
    const parts = await splitTopNodes(doc)
    expect(parts.map((p) => p.node)).toEqual(["Tree", "Rock"])
    expect(
      parts.map((p) =>
        p.doc
          .getRoot()
          .listMeshes()
          .map((m) => m.getName()),
      ),
    ).toEqual([["Tree"], ["Rock"]])
  })

  test("FBX2GLTF overrides where the converter is found", () => {
    expect(fbxConverter({ FBX2GLTF: "/opt/FBX2glTF" })).toBe("/opt/FBX2glTF")
  })

  test("an unknown format is rejected by name", async () => {
    await expect(readModel(join(FIXTURES, "make.ts"), tempDir())).rejects.toThrow("unsupported format .ts")
  })
})

describe("png", () => {
  test("encode then decode round-trips RGBA pixels", () => {
    const data = Uint8Array.from({ length: 3 * 2 * 4 }, (_, i) => (i * 37) % 256)
    expect(decodePng(encodePng({ width: 3, height: 2, data }))).toEqual({ width: 3, height: 2, data })
  })

  test("a non-PNG is rejected", () => {
    expect(() => decodePng(new Uint8Array(16))).toThrow("not a PNG")
  })
})

describe("scan", () => {
  test("reports colour source, bounds, pivot, skin and clips per piece", async () => {
    const rows = new Map<string, Awaited<ReturnType<typeof scanPack>>["rows"][number]>()
    for (const folder of ["fixture-atlas", "fixture-colormap", "fixture-material"])
      for (const r of (await scanPack(FIXTURES, folder, tempDir())).rows) rows.set(r.name, r)
    expect(rows.get("crate")?.colour).toBe("atlas")
    expect(rows.get("wall-door")?.colour).toBe("colormap")
    expect(rows.get("bush")).toMatchObject({
      colour: "material",
      textures: 0,
      minY: -0.05,
      pivot: [0, 0],
      tris: 24,
    })
    expect(rows.get("crate")).toMatchObject({ textures: 1, size: [1, 1, 1], minY: 0, skinned: false })
    expect(rows.get("villager")).toMatchObject({
      skinned: true,
      joints: 2,
      animations: [{ name: "Wave", seconds: 1 }],
    })
  })

  test("a folder with glTF skips its FBX copies", () => {
    expect(pickModelFiles(join(FIXTURES, "fixture-material"))).toEqual({
      files: ["bush.glb", "villager.glb"],
      skipped: 0,
    })
  })
})

describe("import", () => {
  test("--dry lists every piece per pack and writes nothing", async () => {
    const p = fixturePaths()
    const summaries = await runImport({ paths: p, packs: await fixturePacks(), dry: true })
    expect(summaries.map((s) => [s.id, s.pieces.map((x) => `${x.slug}:${x.category}`)])).toEqual([
      ["fixture-atlas", ["crate:prop"]],
      ["fixture-colormap", ["wall-door:wall"]],
      ["fixture-material", ["bush:bush", "villager:character"]],
    ])
    expect(existsSync(join(p.library, "catalog"))).toBe(false)
  })

  test("a run writes one GLB per piece, the shards and the index; skinned + rig is a character", async () => {
    const p = fixturePaths()
    const summaries = await runImport({ paths: p, packs: await fixturePacks(), jobs: 1 })
    expect(summaries.map((s) => [s.id, s.imported, s.failed])).toEqual([
      ["fixture-atlas", 1, []],
      ["fixture-colormap", 1, []],
      ["fixture-material", 2, []],
    ])
    for (const f of ["fixture-atlas/crate", "fixture-colormap/wall-door", "fixture-material/bush"])
      expect(existsSync(join(p.library, `pieces/${f}.glb`))).toBe(true)
    const shard = JSON.parse(readFileSync(join(p.library, "catalog/fixture-material.json"), "utf8"))
    expect(shard[1]).toMatchObject({
      id: "fixture-material/villager",
      kind: "character",
      character: { rig: "fixture-rig", clips: ["Wave"], bones: 2 },
    })
    const index = JSON.parse(readFileSync(join(p.library, "catalog/index.json"), "utf8"))
    expect(index.packs.map((x: { id: string; count: number }) => [x.id, x.count])).toEqual([
      ["fixture-atlas", 1],
      ["fixture-colormap", 1],
      ["fixture-material", 2],
    ])
  })

  test("check flags what the identity stages leave: textures and missing palette attributes", async () => {
    const p = fixturePaths()
    await runImport({ paths: p, packs: await fixturePacks(), jobs: 1 })
    const { problems, entries } = await checkLibrary(p.library, (await import("@guildhall/assets")).PALETTE)
    expect(entries).toBe(4)
    expect(problems).toContain("fixture-atlas/crate: 1 texture(s); the palette bake removes them")
    expect(problems).toContain('fixture-material/bush: mesh "bush" primitive 0: no COLOR_0, _SWATCH, _SHADE')
  })

  test("workers produce the same shards as a single thread", async () => {
    const packs = await fixturePacks()
    const one = fixturePaths()
    const two = fixturePaths()
    await runImport({ paths: one, packs, jobs: 1 })
    await runImport({ paths: two, packs, jobs: 2 })
    for (const id of packs.map((x) => x.id))
      expect(readFileSync(join(two.library, `catalog/${id}.json`), "utf8")).toBe(
        readFileSync(join(one.library, `catalog/${id}.json`), "utf8"),
      )
  })
})

describe("cli", () => {
  const run = (args: string[], env: Record<string, string>) => {
    const proc = Bun.spawnSync(["bun", CLI, ...args], {
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
    })
    return { code: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() }
  }

  test("check on an empty library succeeds and says so", () => {
    const res = run(["check"], { GUILDHALL_LIBRARY: tempDir() })
    expect(res.code).toBe(0)
    expect(res.out).toContain("no catalog yet")
  })

  test("--dry all lists the fixture pieces", () => {
    const res = run(["--dry", "all"], { GUILDHALL_ASSETS: FIXTURES, GUILDHALL_LIBRARY: tempDir() })
    expect(res.code).toBe(0)
    expect(res.out).toContain("fixture-material: 2 pieces")
    expect(res.out).toContain("villager")
  })

  test("no arguments prints usage; an unknown option fails", () => {
    expect(run([], {}).out).toContain("usage:")
    expect(run(["all", "--nope"], {}).code).toBe(2)
  })
})
