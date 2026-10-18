/**
 * The tiles' blockers as their pieces' own shapes (world `hex/blockers.ts`): every disc in data/tiles
 * that sits on a piece becomes `{ of: <piece> }`, so the world works its box or circle out of that
 * piece's outline as placed. A disc on no piece stays as written (a manual circle). Prints what changed
 * and flags a piece whose shape is far bigger or smaller than its old disc; `--dry` writes nothing.
 *
 *   bun tools/import/src/blockers.ts [--dry]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { blockersAsPieces, type TilePrefab } from "@guildhall/world"
import { REPO } from "./config.ts"

/** Data as the Studio writes it (apps/studio json.ts): keys sorted at every depth, 2-space indent. */
function formatData(value: unknown): string {
  const sorted = (_key: string, v: unknown): unknown =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v
  return `${JSON.stringify(value, sorted, 2)}\n`
}

const dry = process.argv.includes("--dry")
const dir = join(REPO, "data/tiles")
let made = 0
let kept = 0
let dropped = 0
for (const f of readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()) {
  const file = join(dir, f)
  const t = JSON.parse(readFileSync(file, "utf8")) as TilePrefab
  if (!t.blockers?.length) continue
  const { blockers, matches } = blockersAsPieces(t)
  for (const m of matches) {
    if (m.of === undefined) {
      kept++
      console.log(`${f} [${m.k}] r ${m.r}: on no piece, kept as a circle`)
      continue
    }
    if (m.dropped) {
      dropped++
      console.log(
        `${f} [${m.k}] r ${m.r}: inside ${t.pieces[m.of]!.piece}, whose own foot is walked round: left out`,
      )
      continue
    }
    made++
    const odd = m.reach > m.r * 1.6 || m.reach < m.r * 0.4
    if (odd || process.env.ALL)
      console.log(
        `${f} [${m.k}] r ${m.r} → of ${m.of} ${t.pieces[m.of]!.piece} (off ${m.off.toFixed(2)}, reach ${m.reach.toFixed(2)})${odd ? "  ← check" : ""}`,
      )
  }
  if (!dry) writeFileSync(file, formatData({ ...t, blockers }))
}
console.log(
  `${made} blockers are their pieces' shapes now, ${dropped} left out (closed buildings), ${kept} kept as written${dry ? " (dry run)" : ""}`,
)
