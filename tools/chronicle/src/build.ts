/**
 * The deep chronicle builder (tools/chronicle/src/cli.ts) as one self-contained file, for the
 * chronicles repo's Action (Codestz/guildhall-chronicles; docs/archive/v1/adr/0019-chronicles-backend.md):
 * it runs `bun builder/chronicle.js deep …` and `… index …` there, with no checkout of this repo and
 * no install.
 *
 *   bun tools/chronicle/src/build.ts [--out ../guildhall-chronicles/builder/chronicle.js]
 *
 * The bundle is readable (not minified), so a change to it reads as a diff in that repo, and starts
 * with the commit it was built from. Rebuild and commit it there whenever tools/chronicle/src or
 * packages/sim/src/repo/{chronicle,catalog}.ts change. The default --out is
 * tools/chronicle/dist/chronicle.js (git-ignored).
 *
 * Until the V1 cutover (2026-10) this was legacy/scripts/chronicle-build.ts, bundling
 * legacy/scripts/chronicle.ts (scripts/ on the v1 tag); a bundle's Source line names the file it
 * was built from.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"

const HERE = join(import.meta.dir, "..")
const ROOT = join(HERE, "../..")
const ENTRY = join(import.meta.dir, "cli.ts")
const args = Bun.argv.slice(2)
const outAt = args.indexOf("--out")
const out = resolve(
  outAt >= 0 && args[outAt + 1] ? (args[outAt + 1] as string) : join(HERE, "dist/chronicle.js"),
)

const sha = (await Bun.$`git -C ${ROOT} rev-parse HEAD`.text()).trim()
const dirty = (
  await Bun.$`git -C ${ROOT} status --porcelain -- tools/chronicle/src packages/sim/src/repo`.text()
).trim()

const built = await Bun.build({ entrypoints: [ENTRY], target: "bun" })
if (!built.success) {
  for (const log of built.logs) console.error(log)
  process.exit(1)
}
const code = await built.outputs[0]?.text()
if (!code) throw new Error("the bundle came out empty")

const banner = [
  "// @bun",
  "// Guildhall's deep chronicle builder, bundled by tools/chronicle/src/build.ts. Do not edit: rebuild it.",
  `// Source: https://github.com/Codestz/guildhall/blob/${sha}/${relative(ROOT, ENTRY)}${dirty ? " (plus uncommitted changes)" : ""}`,
  `// Built: ${new Date().toISOString()}`,
  "",
].join("\n")
await mkdir(dirname(out), { recursive: true })
await writeFile(out, banner + code.replace(/^\/\/ @bun\n/, ""))
console.log(
  `${(code.length / 1024).toFixed(0)} KB  →  ${out}${dirty ? "  (built from uncommitted sources)" : ""}`,
)
