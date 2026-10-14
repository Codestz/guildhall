# The story's goldens

What V1's own code (branch `main`) said about seven sessions; `test/story-golden.test.ts` checks the port says the same.

| File | What |
| --- | --- |
| `<name>.story.json` | V1's told moments, the party, `legendOf`, `legendMarkdown`, `recapOf` (guild `Codestz/guildhall`, story `A party`), `renownOf` and a Narrator run |
| `<name>.input.json` | a told story's changes, GitHub sea and chapters (main:packages/sim `party`, `sagaTale`, `seas`, `rush`, `solo`) |
| `<name>.departures.json` | where V2 says something else on purpose: each entry's path in the golden, what V1 said there (checked, so a departure never hides a drift) and what V2 says instead |

## Departures (user, 2026-10-13)

- A second guildmaster is numbered by join order (`Guildmaster II`); V1 called every root session `Guildmaster`.
- A shell command is told by its gist (core `commandGist`): `runs git status`, `hunts through the code for requireSession`, never its raw line (`runs git status --short`, `\b(requireSession|…)\b`). A caption's hold follows its length, so those holds move too.
- A command is told by what it does for the work (sim `commandWords`, GUI audit 10-14): `opens a pull request, #418`, `pushes the work upstream`, `looks over the changes`, `checks the types`; one the map does not know `runs a command`, never `runs gh pr create` (decisions.md: captions never raw tool text).

After a deliberate change, `GOLDEN_DEPARTURES=write bun test packages/sim/test/story-golden.test.ts` rewrites the departure files; read their diff before committing.

`v1` and `v2` are core's recorded runs (`packages/core/test/events/fixtures`), so they have no input file here.

## Remaking them

Export main to a scratch folder and install it (`git archive main | tar x -C <dir>/v1full && cd <dir>/v1full && bun install`). Put the driver below beside it as `<dir>/gold/v1gold.ts`, and run `bun v1gold.ts <out> <repo>/packages/core/test/events/fixtures`. The driver has no store: every change goes through V1's `Intake` (live false, start = the first change's `at`), the sea through V1's `seaHappening` with the harbour as actor as run time reaches it, and the party is the guildmaster's tree in join order. The narrator hears each moment live at its run time and is asked every 50 ms, until 30 s after the last.

```ts
import { join } from "node:path"
import {
  type Change, type CiState, createV1Translator, createV2Translator, rootOf, type SeaEvent, type Session,
} from "../v1full/packages/core/src/index.ts"
import { renownOf } from "../v1full/packages/hall/src/guild/events.ts"
import { SCENARIOS } from "../v1full/packages/hall/src/guild/feeds/scenarios.ts"
import { Intake } from "../v1full/packages/hall/src/guild/intake.ts"
import { legendMarkdown, legendOf } from "../v1full/packages/hall/src/guild/legends.ts"
import { HARBOUR, type Moment, MomentStream, seaHappening } from "../v1full/packages/hall/src/guild/moments.ts"
import { byJoin } from "../v1full/packages/hall/src/guild/parties.ts"
import { recapOf } from "../v1full/packages/hall/src/guild/recap.ts"
import { type Caption, Narrator } from "../v1full/packages/hall/src/guild/story.ts"

const [out = ".", fixtures = "."] = process.argv.slice(2)
interface Input { changes: Change[]; sea: SeaEvent[]; chapters: { at: number; numeral: string; title: string; tagline: string; hour: number }[] }

async function recorded(version: 1 | 2): Promise<Input> {
  const lines = (await Bun.file(join(fixtures, `v${version}.jsonl`)).text()).trim().split("\n")
    .map((l) => JSON.parse(l) as { kind: string; at: number; event: unknown })
  const t = version === 1 ? createV1Translator() : createV2Translator()
  return { changes: lines.filter((l) => l.kind === "event").flatMap((l) => t.event(l.event, l.at)), sea: [], chapters: [] }
}

function scenario(id: "party" | "saga" | "seas" | "rush" | "solo"): Input {
  const told = SCENARIOS[id]()
  if (Array.isArray(told)) return { changes: told, sea: [], chapters: [] }
  return { changes: told.changes, sea: [...(told.sea ?? [])], chapters: told.chapters }
}

function tell(input: Input) {
  const stream = new MomentStream()
  const intake = new Intake(stream)
  const start = input.changes[0]?.at ?? 0
  const sea = input.sea.map((event) => ({ event, at: event.at - start })).sort((a, b) => a.at - b.at)
  const finished = new Map<string, CiState>()
  let next = 0
  const root = () => [...intake.model.sessions.values()].find((s) => !s.parentID)?.id ?? ""
  const tellSea = (to: number) => {
    while (next < sea.length && (sea[next]?.at ?? 0) <= to) {
      const { event, at } = sea[next++] as { event: SeaEvent; at: number }
      const happening = seaHappening(event, finished)
      if (happening) stream.add({ ...HARBOUR, master: root(), ...happening, at, live: false })
    }
  }
  for (const change of input.changes) {
    tellSea(change.at - start)
    intake.take(change, false, start)
  }
  tellSea(Number.POSITIVE_INFINITY)
  const model = intake.model
  const master = root()
  const sessions: Session[] = [...model.sessions.values()].filter((s) => rootOf(model, s.id) === master).sort(byJoin)
  const history = stream.history
  const legend = legendOf(history, sessions)
  const lookup = { session: (id: string) => model.sessions.get(id) }
  const recap = legend ? recapOf({ legend, history, sessions, lookup, guild: "Codestz/guildhall", story: "A party" }) : undefined
  const narrator = new Narrator(lookup)
  const captions: { at: number; caption: Caption }[] = []
  const end = (history.at(-1)?.at ?? 0) + 30_000
  let i = 0
  for (let clock = 0; clock <= end; clock += 50) {
    while (i < history.length && (history[i] as Moment).at <= clock) narrator.hear({ ...(history[i++] as Moment), live: true }, clock)
    const caption = narrator.next(clock)
    if (caption) captions.push({ at: clock, caption })
  }
  return { start, told: history, sessions: sessions.map((s) => s.id), legend,
    markdown: legend ? legendMarkdown(legend) : undefined, recap, renown: renownOf(history, sessions), captions }
}

const inputs: Record<string, () => Input | Promise<Input>> = {
  v1: () => recorded(1), v2: () => recorded(2), party: () => scenario("party"), saga: () => scenario("saga"),
  seas: () => scenario("seas"), rush: () => scenario("rush"), solo: () => scenario("solo"),
}
for (const [name, make] of Object.entries(inputs)) {
  const input = await make()
  await Bun.write(join(out, `${name}.story.json`), `${JSON.stringify(tell(input), null, 2)}\n`)
  if (name !== "v1" && name !== "v2") await Bun.write(join(out, `${name}.input.json`), `${JSON.stringify(input)}\n`)
}
```
