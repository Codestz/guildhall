#!/usr/bin/env bun
/**
 * The palette's evidence: what colours the kept packs really use, and how well a palette covers them.
 *   bun tools/palette/src/cli.ts extract                      sample every kept pack → colours.json
 *   bun tools/palette/src/cli.ts clusters [--k n] [--seed n]  area-weighted OKLab clusters as ramps
 *   bun tools/palette/src/cli.ts report [--before palette.json] [--after palette.json]
 *                                                            area-weighted miss rate and mean ΔE per pack
 *                                                            (--after defaults to packages/assets' palette)
 * colours.json lives in --out (default .probe/palette). Raw packs come from $GUILDHALL_ASSETS
 * (default <repo>/assets/src), as for the importer.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { hexToSrgb, loadPalette, PALETTE, type Palette, srgbToOklab } from "@guildhall/assets"
import { loadPacks, paths, REPO } from "@guildhall/import/src/config.ts"
import { kmeans, labHex, type Point, RAMP_WEIGHTS, rampTones } from "./cluster.ts"
import { type Colours, packColours } from "./extract.ts"
import { missReport } from "./miss.ts"

/** Test packs live beside the real ones; they are not part of the library. */
const isKept = (id: string): boolean => !id.startsWith("fixture-")

type Stored = Record<string, Record<string, number>>

function flag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name)
  return at >= 0 ? argv[at + 1] : undefined
}

async function readColours(out: string): Promise<Map<string, Colours>> {
  const file = Bun.file(join(out, "colours.json"))
  if (!(await file.exists())) throw new Error(`${file.name} is missing: run "extract" first`)
  const stored = (await file.json()) as Stored
  return new Map(Object.entries(stored).map(([pack, hexes]) => [pack, new Map(Object.entries(hexes))]))
}

async function extract(out: string): Promise<void> {
  const p = paths()
  const stored: Stored = {}
  for (const pack of (await loadPacks(p.packs)).filter((x) => isKept(x.id))) {
    const colours = await packColours(pack, p.raw)
    const sorted = [...colours].sort((a, b) => b[1] - a[1])
    stored[pack.id] = Object.fromEntries(sorted.map(([hex, area]) => [hex, Number(area.toPrecision(6))]))
    console.log(`${pack.id}: ${colours.size} colours`)
  }
  mkdirSync(out, { recursive: true })
  await Bun.write(join(out, "colours.json"), `${JSON.stringify(stored, null, 1)}\n`)
  console.log(`wrote ${join(out, "colours.json")}`)
}

const pct = (x: number): string => `${(x * 100).toFixed(2)}%`

async function report(out: string, after: Palette, before: Palette | undefined): Promise<void> {
  const packs = await readColours(out)
  const all: Colours = new Map()
  const row = (colours: Colours, label: string, worst: boolean): string => {
    const now = missReport(colours, after)
    const was = before ? missReport(colours, before) : undefined
    const cells = [
      label,
      ...(was ? [pct(was.rate)] : []),
      pct(now.rate),
      ...(was ? [was.drift.toFixed(3)] : []),
      now.drift.toFixed(3),
      worst
        ? now.hexes
            .slice(0, 3)
            .map((h) => `${h.hex} ${pct(h.area / now.area)}`)
            .join(", ")
        : "",
    ]
    return `| ${cells.join(" | ")} |`
  }
  const head = before
    ? ["pack", "miss before", "miss after", "ΔE before", "ΔE after", "worst misses after"]
    : ["pack", "miss", "ΔE", "worst misses"]
  console.log(`| ${head.join(" | ")} |\n|${head.map(() => "---|").join("")}`)
  for (const [pack, colours] of packs) {
    // The total weighs every pack equally, so a pack in big units does not drown the others.
    const total = [...colours.values()].reduce((s, a) => s + a, 0)
    for (const [hex, a] of colours) all.set(hex, (all.get(hex) ?? 0) + a / total)
    console.log(row(colours, pack, true))
  }
  console.log(row(all, "all (packs weighted equally)", false))
}

async function clusters(out: string, k: number, seed: number): Promise<void> {
  const packs = await readColours(out)
  const shares = new Map<string, Map<string, number>>()
  for (const [pack, colours] of packs) {
    const total = [...colours.values()].reduce((s, a) => s + a, 0)
    for (const [hex, a] of colours) {
      const by = shares.get(hex) ?? new Map<string, number>()
      by.set(pack, a / total)
      shares.set(hex, by)
    }
  }
  const hexes = [...shares.keys()]
  const points: Point[] = hexes.map((hex) => ({
    lab: srgbToOklab(hexToSrgb(hex)),
    weight: [...(shares.get(hex)?.values() ?? [])].reduce((s, w) => s + w, 0),
  }))
  const total = points.reduce((s, p) => s + p.weight, 0)
  for (const cluster of kmeans(points, k, { seed, weights: RAMP_WEIGHTS })) {
    const tones = rampTones(points, cluster)
    const by = new Map<string, number>()
    for (const i of cluster.members)
      for (const [pack, w] of shares.get(hexes[i] as string) ?? []) by.set(pack, (by.get(pack) ?? 0) + w)
    const top = [...by].sort((a, b) => b[1] - a[1]).slice(0, 3)
    const [L, a, b] = cluster.centre
    const chroma = Math.hypot(a, b)
    const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
    console.log(
      `${pct(cluster.weight / total).padStart(6)}  ${labHex(tones.dark)} ${labHex(tones.base)} ${labHex(tones.light)}` +
        `  L${L.toFixed(2)} C${chroma.toFixed(3)} h${hue.toFixed(0).padStart(3)}  ` +
        top.map(([pack, w]) => `${pack} ${pct(w / packs.size)}`).join(", "),
    )
  }
}

async function main(argv: string[]): Promise<number> {
  const out = flag(argv, "--out") ?? join(REPO, ".probe/palette")
  const command = argv[0]
  if (command === "extract") await extract(out)
  else if (command === "report") {
    const read = async (path: string | undefined) =>
      path ? loadPalette(await Bun.file(path).json()) : undefined
    await report(out, (await read(flag(argv, "--after"))) ?? PALETTE, await read(flag(argv, "--before")))
  } else if (command === "clusters")
    await clusters(out, Number(flag(argv, "--k") ?? 24), Number(flag(argv, "--seed") ?? 1))
  else {
    console.log(
      "usage: bun tools/palette/src/cli.ts extract | clusters [--k n] [--seed n] | report [--before path] [--after path]",
    )
    return command === undefined ? 0 : 2
  }
  return 0
}

if (import.meta.main)
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(2)
    },
  )
