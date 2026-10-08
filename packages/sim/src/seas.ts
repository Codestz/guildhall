import type { Change, CiState, SeaEvent } from "@guildhall/core"
import { type Adventurer, Script } from "./script.ts"

/**
 * A party's run with its sea beside it (PROTOCOL.md §7): what GitHub would say while the guild works,
 * so the website can show the sea without a hub or a token. The story: a dark-mode change is built
 * and pushed once its tests pass, a pull request opens, CI goes red on Linux, the fix is pushed and
 * CI goes green, the PR is merged, main's CI passes, and a release is cut at the end.
 *
 * Sea events are timed like the changes (ms from the start) and fall at the moments in the run that
 * cause them: a push right after the `git push` deed, CI a little after each push.
 */

export interface SeaTale {
  changes: Change[]
  sea: SeaEvent[]
}

const REPO = "acme/shop"
const BRANCH = "dark-mode"
const AUTHOR = "mira"
const PR = 128

export function seas(seed = 1): SeaTale {
  const script = new Script(seed)
  const sea: SeaEvent[] = []
  let shas = 0
  /** A sha for the story, the same for the same seed. */
  const sha = () => (++shas).toString(16).padStart(8, "0").repeat(5)

  const push = (at: number, commits: number, branch = BRANCH): string => {
    const head = sha()
    sea.push({
      kind: "push",
      id: `push:${REPO}:${branch}:${head}`,
      at,
      repo: REPO,
      branch,
      commits,
      author: AUTHOR,
      sha: head,
    })
    return head
  }
  /** One workflow run on `head`: queued at `at`, running, then `end` after about `ms`. */
  const ci = (at: number, head: string, end: CiState, ms: number, branch = BRANCH, name = "CI"): number => {
    const run = sea.length + 1000
    const states: [CiState, number][] = [
      ["queued", at + script.jitter(1500)],
      ["running", at + script.jitter(4000)],
      [end, at + script.jitter(4000) + script.jitter(ms)],
    ]
    for (const [state, when] of states)
      sea.push({
        kind: "ci",
        id: `ci:${REPO}:${run}:${state}`,
        at: when,
        repo: REPO,
        state,
        name,
        branch,
        sha: head,
      })
    return states[2]?.[1] ?? at
  }
  const pr = (kind: "pr_opened" | "pr_merged", at: number) =>
    sea.push({
      kind,
      id: `${kind}:${REPO}#${PR}`,
      at,
      repo: REPO,
      number: PR,
      title: "Dark mode for the settings page",
      author: AUTHOR,
      branch: BRANCH,
    })

  const master = script.guildmaster("Ship dark mode for the settings page, behind a PR")
  master.think("Theme tokens first, then the page. Push when the tests pass, open a PR, watch CI.", 2600)
  const smith = master.quest("guild-implementer", "Add dark theme tokens and wire the settings page", (s) => {
    s.deed("read", { filePath: "src/theme/tokens.ts" }, 1100)
    s.deed("edit", { filePath: "src/theme/tokens.ts" }, 3200)
    s.deed("edit", { filePath: "src/settings/SettingsPage.tsx" }, 3600)
    s.deed("bash", { command: "bun test settings" }, 3400, { summary: "14 pass" })
    s.finish("Dark tokens added; the settings page follows prefers-color-scheme.")
  })
  gitPush(master)
  const pushed = master.clock
  const first = push(pushed, 3)
  master.deed("bash", { command: "gh pr create --fill" }, 1800, { summary: "#128" })
  pr("pr_opened", master.clock)
  const red = ci(pushed, first, "failed", 18_000)
  master.think("Waiting on CI before calling it done.", 2400)
  master.clock = Math.max(master.clock, red + 800)
  master.deed("bash", { command: "gh run view --log-failed" }, 1400, {
    summary: "exit 0",
    output: "settings.snap: contrast 3.9 < 4.5 on Linux fonts",
  })
  master.think("Contrast fails on Linux font rendering. Send the smith back with the log.", 1800)
  master.resume(smith, "Fix: raise muted-text contrast to 4.5 in dark mode", (s) => {
    s.deed("edit", { filePath: "src/theme/tokens.ts" }, 2200)
    s.deed("bash", { command: "bun test settings" }, 3200, { summary: "15 pass" })
    s.finish("Muted text lifted to #a3a3a3: 4.6 contrast; snapshot updated.")
  })
  gitPush(master)
  const fix = push(master.clock, 1)
  const green = ci(master.clock, fix, "passed", 16_000)
  master.think("Green. Merge it.", 1200)
  master.clock = Math.max(master.clock, green + 600)
  master.deed("bash", { command: "gh pr merge 128 --squash" }, 1600, { summary: "merged" })
  pr("pr_merged", master.clock)
  const merged = push(master.clock + 300, 1, "main")
  const mainGreen = ci(master.clock + 300, merged, "passed", 14_000, "main")
  master.clock = Math.max(master.clock, mainGreen + 600)
  master.deed("bash", { command: "gh release create v1.4.0 --generate-notes" }, 1800, { summary: "v1.4.0" })
  sea.push({
    kind: "release",
    id: `release:${REPO}:v1.4.0`,
    at: master.clock,
    repo: REPO,
    tag: "v1.4.0",
    name: "Dark mode",
  })
  master.finish("Dark mode shipped: PR #128 merged after a contrast fix, CI green, v1.4.0 released.")
  return { changes: script.done(), sea: sea.sort((a, b) => a.at - b.at) }
}

function gitPush(master: Adventurer): void {
  master.deed("bash", { command: `git push -u origin ${BRANCH}` }, 1400, { summary: "pushed" })
}
