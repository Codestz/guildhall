# The told stories' goldens

What V1's own sim (`main:packages/sim`, the same files as `legacy/packages/sim` on `v2`) told; `test/stories-golden.test.ts` checks the port (`src/stories/`) tells the same, change for change.

| File | What |
| --- | --- |
| `dsl.json` | one script using every verb of the DSL (seed 5, a model turn of 3 s, an economy of its own), its chapters, a pick and a jitter: the test's `dsl()` |
| `solo-1`, `solo-7`, `party-1`, `party-3`, `parties-1`, `factions-1` | those stories at those seeds, as their changes |
| `rush-12-1`, `rush-5-2` | `rush(12, 1)` and `rush(5, 2, [1])` |
| `seas-1`, `seas-3` | `seas(seed)`: its changes and GitHub sea |
| `rush-300-1.sha256` | the sha-256 of `JSON.stringify(rush(300, 1))` |

The V2 saga is new (re-authored for the hex island), so it has no V1 golden: `test/stories-saga.test.ts` walks its beats instead.

## Remaking them

Save the driver below as `v1gold.ts` outside the repo, with `<repo>` replaced by the checkout's absolute path, and run `bun v1gold.ts <repo>/packages/sim/test/fixtures/stories`. It imports V1's files by path; their imports of `@guildhall/core` are types only, so nothing else is needed.

```ts
import { factions } from "<repo>/legacy/packages/sim/src/factions.ts"
import { parties, party, rush, solo } from "<repo>/legacy/packages/sim/src/scenarios.ts"
import { seas } from "<repo>/legacy/packages/sim/src/seas.ts"
import { Script } from "<repo>/legacy/packages/sim/src/script.ts"

const out = process.argv[2] ?? "."

function dsl() {
  const s = new Script(5, { turnMs: 3000, economy: (step, ms) => ({ tokens: 1000 + step * 10, cost: ms / 1e6 }) })
  const m = s.guildmaster("t", 100)
  m.wait(500).think("x", 900)
  m.deed("read", { filePath: "a.ts" }, 400, { batch: true })
  m.deed("read", { filePath: "b.ts" }, 400, { batch: true })
  m.deed("bash", { command: "bun test" }, 1200, { fail: "1 failed", summary: "exit 1", output: "✗ a" })
  const c = m.quest("guild-explorer", "map", (k) => {
    k.deed("grep", { pattern: "p" }, 300).plea(2000).finish("ok", 400)
  })
  const bg = m.quest("guild-implementer", "bg", (k) => k.deed("edit", { filePath: "c.ts" }, 900).fail("nope"), { wait: false })
  m.waitFor(bg)
  m.resume(c, "again", (k) => k.deed("read", { filePath: "d.ts" }).finish("ok2"))
  m.prompt("more").plea().finish("done")
  s.chapter(0, { numeral: "I", title: "A", tagline: "b", hour: 6 })
  return { changes: s.done(), chapters: s.chapters, picks: [s.pick([1, 2, 3]), s.jitter(1000)] }
}

const sets: Record<string, unknown> = {
  dsl: dsl(),
  "solo-1": solo(1), "solo-7": solo(7), "party-1": party(1), "party-3": party(3), "parties-1": parties(1),
  "rush-12-1": rush(12, 1), "rush-5-2": rush(5, 2, [1]), "seas-1": seas(1), "seas-3": seas(3), "factions-1": factions(1),
}
for (const [name, value] of Object.entries(sets)) await Bun.write(`${out}/${name}.json`, `${JSON.stringify(value)}\n`)
const hasher = new Bun.CryptoHasher("sha256")
hasher.update(JSON.stringify(rush(300, 1)))
await Bun.write(`${out}/rush-300-1.sha256`, `${hasher.digest("hex")}\n`)
```
