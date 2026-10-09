/**
 * The deep chronicle builder (scripts/chronicle.ts) as one self-contained file, for the chronicles
 * repo's Action (docs/adr/0019-chronicles-backend.md): it runs `bun builder/chronicle.js deep …` and
 * `… index …` there, with no checkout of this repo and no install.
 *
 *   bun scripts/chronicle-build.ts [--out ../guildhall-chronicles/builder/chronicle.js]
 *
 * The bundle is readable (not minified), so a change to it reads as a diff in that repo, and starts
 * with the commit it was built from. Rebuild and commit it there whenever world/chronicle/deep.ts,
 * format.ts, catalog.ts or scripts/chronicle.ts change. The default --out is dist/chronicle.js
 * (git-ignored).
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

const ROOT = join(import.meta.dir, "..")
const args = Bun.argv.slice(2)
const outAt = args.indexOf("--out")
const out = resolve(
  outAt >= 0 && args[outAt + 1] ? (args[outAt + 1] as string) : join(ROOT, "dist/chronicle.js"),
)

const sha = (await Bun.$`git -C ${ROOT} rev-parse HEAD`.text()).trim()
const dirty = (
  await Bun.$`git -C ${ROOT} status --porcelain -- scripts/chronicle.ts packages/hall/src/world`.text()
).trim()

const built = await Bun.build({ entrypoints: [join(ROOT, "scripts/chronicle.ts")], target: "bun" })
if (!built.success) {
  for (const log of built.logs) console.error(log)
  process.exit(1)
}
const code = await built.outputs[0]?.text()
if (!code) throw new Error("the bundle came out empty")

const banner = [
  "// @bun",
  "// Guildhall's deep chronicle builder, bundled by scripts/chronicle-build.ts. Do not edit: rebuild it.",
  `// Source: https://github.com/Codestz/guildhall/blob/${sha}/scripts/chronicle.ts${dirty ? " (plus uncommitted changes)" : ""}`,
  `// Built: ${new Date().toISOString()}`,
  "",
].join("\n")
await mkdir(dirname(out), { recursive: true })
await writeFile(out, banner + code.replace(/^\/\/ @bun\n/, ""))
console.log(
  `${(code.length / 1024).toFixed(0)} KB  →  ${out}${dirty ? "  (built from uncommitted sources)" : ""}`,
)
