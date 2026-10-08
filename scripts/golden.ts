/**
 * Golden screenshots: reference shots of the hall's key views, and a check that renders them again
 * through the warm probe server (scripts/probe-server.ts, started if needed) and diffs each.
 *
 *   bun scripts/golden.ts list
 *   bun scripts/golden.ts update [names…]    render and keep as the references
 *   bun scripts/golden.ts check  [names…]    render, diff, report; exit 1 if any is over threshold
 *
 * Names may be prefixes (`site-` checks every site close-up). Each view is a deep link
 * (packages/hall/src/guild/deeplink.ts) with the story paused at a fixed moment, a fixed hour and
 * weather, the quality pinned, the Bard off and the camera framed — plus, for a few, a click, a
 * screen size or a second link applied in place (`after`).
 *
 * Where they live: .probe/golden/<name>.jpg are the references; .probe/golden/current/ the last
 * check's renders; .probe/golden/diff/<name>.jpg reference | current | diff (red: differs in a
 * cluster, orange: lone pixel noise) for every view over its threshold. .probe/ is git-ignored, so
 * the references are local to this machine: they depend on its GPU (Metal), its Chrome and the
 * probe server's DPR (`meta.json` records it; a check at another DPR is refused). Run `update` on
 * a known-good tree before you change something, `check` after.
 *
 * Why a tolerance: two renders of one state are never bit-identical. Metal shimmers along edges
 * (~1–25 px a frame), and animation (water, idle clips, villagers, smoke) keeps running while the
 * story is paused. The diff (probe-server /diff) ignores colour moves under `pixel` and lone
 * pixels; what is left — clusters — must stay under the view's `threshold` (a share of all pixels).
 */
import { mkdir } from "node:fs/promises"
import { call, ensureServer } from "./probe.ts"
import { loadSettle, PROBE_DIR } from "./steps.ts"

export interface View {
  name: string
  /** The deep link, without the shared base (BASE is put in front). */
  link: string
  why: string
  /** Extra wait before the shot, ms (a forced event fading in). */
  settle?: number
  /**
   * A deep link applied in place once the view has settled (a lever moved live, not loaded): the
   * shot is taken after it. Not with `click`.
   */
  after?: string
  /** A CSS selector clicked after the state is set (a panel to open). */
  click?: string
  viewport?: [number, number]
  /** A lab instead of the hall (`?lab=…`, lab/labs.ts); `link` is then unused. */
  lab?: string
  /** Share of pixels allowed to differ in clusters (default THRESHOLD). */
  threshold?: number
}

/**
 * Every view: paused, the quality pinned at High (a `quality=` in the view's link wins: the last
 * one counts), the Bard off, the HUD hidden unless said.
 */
const BASE = "paused=1&quality=2&bard=0&hud=hidden"
/**
 * Calibrated on this Mac (three checks against one update): ordinary views differ by 0–0.7% in
 * clusters (ships sailing, shore foam, sigil spinners), the clear ones mostly under 0.1%. A moved
 * prop, a lamp off or a colour change in a close-up is several percent.
 */
const THRESHOLD = 0.01
const SITE = "story=saga&t=6:00&hour=11&weather=clear&view=explore"

export const VIEWS: View[] = [
  {
    name: "diorama-noon",
    link: "story=saga&t=6:00&hour=12&weather=clear&look=island",
    why: "the island at noon",
  },
  {
    name: "diorama-golden",
    link: "story=saga&t=6:00&hour=18.5&weather=clear&look=island",
    why: "golden hour",
  },
  { name: "diorama-night", link: "story=saga&t=6:00&hour=23&weather=clear&look=island", why: "night: lamps" },
  {
    name: "diorama-storm",
    link: "story=saga&t=11:00&hour=14&weather=storm&look=island",
    why: "storm: rain, dark",
    // Rain and snow streaks fall on their own: ~1.2–1.8% of pixels differ between two runs.
    threshold: 0.03,
  },
  {
    name: "diorama-snow",
    link: "story=saga&t=6:00&hour=10&weather=snow&look=island",
    why: "snow",
    threshold: 0.03,
  },
  {
    name: "low-diorama-night",
    link: "story=saga&t=6:00&hour=23&weather=clear&look=island&quality=0",
    why: "the Low tier at night: tone-mapped grade, no post",
    // Without post the moonlit sea's glints are sharper: they and the ships are ~0–1.3%.
    threshold: 0.02,
  },
  {
    name: "low-switch-night",
    link: "story=saga&t=6:00&hour=23&weather=clear&look=island",
    after: "quality=0",
    why: "High dropped to Low in place (the adaptive tier's path, 0ff7db9): Low's grade, not washed out",
    threshold: 0.02,
  },
  {
    name: "low-rush-rain",
    link: "story=rush&t=0:40&hour=21&weather=rain&quality=0",
    why: "the Low tier in night rain: darkened and greyed",
    threshold: 0.03,
  },
  { name: "keep-noon", link: "story=saga&t=6:00&hour=12&weather=clear&look=keep", why: "the keep, closer" },
  { name: "site-quarry", link: `${SITE}&look=quarry`, why: "quarry close-up" },
  { name: "site-forest", link: `${SITE}&look=forest`, why: "forest edge close-up" },
  { name: "site-river", link: `${SITE}&look=river`, why: "river bend close-up" },
  { name: "site-proving", link: `${SITE}&look=proving`, why: "proving grounds close-up" },
  { name: "site-tower", link: `${SITE}&look=tower`, why: "wizard tower close-up" },
  { name: "site-yard", link: `${SITE}&look=yard`, why: "construction yard close-up" },
  {
    name: "quarry-night",
    link: "story=saga&t=11:53&hour=23&weather=clear&view=explore&look=quarry",
    why: "the quarry by night: carried and site lamps",
  },
  {
    name: "graveyard-night",
    link: "story=saga&t=40:00&hour=22&weather=clear&view=explore&look=graveyard",
    why: "the graveyard at night, late in the Saga",
  },
  {
    name: "festival-night",
    link: "story=saga&t=30:00&hour=21&weather=clear&look=square&event=festival",
    why: "the festival: lanterns, fireworks",
    settle: 2500,
    threshold: 0.02,
  },
  {
    name: "lab-lantern",
    link: "",
    lab: "prop&piece=lantern",
    why: "the prop lab: the lantern from four sides",
  },
  {
    name: "lab-mage-walk",
    link: "",
    lab: "character&model=mage&clip=Walking_A&at=0.4",
    why: "the character lab: a frozen walk pose",
  },
  {
    name: "hud-detailed",
    link: "story=saga&t=6:00&hour=12&weather=clear&look=island&hud=detailed",
    why: "the HUD, every panel open",
  },
  {
    name: "dossier",
    link: "story=saga&t=6:00&hour=12&weather=clear&hud=minimal&look=keep&select=Guildmaster",
    why: "an adventurer picked: dossier open, camera following",
  },
  {
    name: "legends",
    link: "story=saga&t=30:00&hour=12&weather=clear&look=island&hud=minimal",
    why: "the Legends book",
    click: "button[aria-label^='Legends']",
  },
  {
    name: "phone",
    link: "story=saga&t=6:00&hour=12&weather=clear&look=keep&hud=minimal",
    why: "a phone held upright (390×844)",
    viewport: [390, 844],
    // At phone size the moving bits (sigil spinners, shore foam, ships) are a bigger share: ~1.2%.
    threshold: 0.02,
  },
]

const GOLDEN = `${PROBE_DIR}/golden`
const ref = (name: string) => `${GOLDEN}/${name}.jpg`

function chosen(names: string[]): View[] {
  if (names.length === 0) return VIEWS
  const views = VIEWS.filter((view) => names.some((name) => view.name === name || view.name.startsWith(name)))
  const unknown = names.filter((name) => !VIEWS.some((view) => view.name.startsWith(name)))
  if (unknown.length) throw new Error(`no view ${unknown.join(", ")}: \`bun scripts/golden.ts list\``)
  return views
}

/** Resolves once no finite CSS animation or transition is running (3 s at most). */
const SETTLED = `new Promise((done) => {
  const until = performance.now() + 3000
  const check = () => {
    const busy = document.getAnimations().some((a) => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity)
    if (!busy || performance.now() > until) done(!busy)
    else setTimeout(check, 50)
  }
  setTimeout(check, 100)
})`

/**
 * Renders one view to .probe/<as>.jpg through the probe server; returns its path. Hall views load
 * the page afresh at their deep link (a probe-server state is a fresh load): an in-place state carries history —
 * adventurers still walking from the last one, clouds drifting on from it — and differed by 10–30%
 * between runs; a fresh load with the seeded random repeats.
 */
async function render(port: number, view: View, as: string): Promise<string> {
  if (view.lab !== undefined) {
    const out = await call(port, "/shot", { name: as, lab: view.lab, settle: 300 + (view.settle ?? 0) })
    return String(out.path)
  }
  const state = `${BASE}&${view.link}`
  const settle = loadSettle(state) + (view.settle ?? 0)
  if (view.click) {
    // Load, click, wait for the panel to settle and shoot in ONE request: as separate calls, another
    // probe client's shot could land in between and this view would capture that client's state.
    const click = `document.querySelector(${JSON.stringify(view.click)})?.click()`
    const out = await call(port, "/shot", {
      name: as,
      state,
      settle,
      js: `(async () => { ${click}; await (${SETTLED}); await new Promise((done) => setTimeout(done, 300)) })()`,
    })
    return String(out.path)
  }
  // One request (load, `after`, shot): the probe server runs it whole, so another client's state
  // can't land in between.
  const out = await call(port, "/shot", {
    name: as,
    state,
    viewport: view.viewport,
    settle,
    ...(view.after !== undefined ? { after: view.after } : {}),
  })
  return String(out.path)
}

async function main(argv: string[]): Promise<number> {
  const [command, ...names] = argv
  if (command === "list") {
    for (const view of VIEWS)
      console.log(
        `${view.name.padEnd(16)} ${view.why}\n${"".padEnd(16)} ?${view.lab !== undefined ? `lab=${view.lab}` : `${BASE}&${view.link}`}${view.after ? `  after, in place: ?${view.after}` : ""}`,
      )
    return 0
  }
  if (command !== "update" && command !== "check") {
    console.log("bun scripts/golden.ts list | update [names…] | check [names…]   (see the header)")
    return 2
  }
  const views = chosen(names)
  const port = await ensureServer()
  const health = await call(port, "/health")
  const meta = Bun.file(`${GOLDEN}/meta.json`)
  await mkdir(`${GOLDEN}/current`, { recursive: true })
  const t0 = performance.now()

  if (command === "update") {
    for (const view of views) {
      const path = await render(port, view, `golden/current/${view.name}`)
      await Bun.write(ref(view.name), Bun.file(path))
      console.log(`  kept ${view.name}`)
    }
    await Bun.write(meta, JSON.stringify({ dpr: health.dpr, updated: new Date().toISOString() }, null, 2))
    console.log(
      `${views.length} references in .probe/golden/ (${((performance.now() - t0) / 1000).toFixed(1)} s)`,
    )
    return 0
  }

  if (!(await meta.exists())) throw new Error("no references yet: `bun scripts/golden.ts update` first")
  const kept = (await meta.json()) as { dpr: number }
  if (kept.dpr !== health.dpr)
    throw new Error(
      `references are DPR ${kept.dpr}, the probe server runs DPR ${health.dpr}: restart it or update`,
    )
  const failed: string[] = []
  const rows: string[] = []
  for (const view of views) {
    if (!(await Bun.file(ref(view.name)).exists())) {
      rows.push(`  ?    ${view.name.padEnd(16)} no reference (update it)`)
      failed.push(view.name)
      continue
    }
    const path = await render(port, view, `golden/current/${view.name}`)
    const threshold = view.threshold ?? THRESHOLD
    const out = await call(port, "/diff", {
      reference: ref(view.name),
      current: path,
      out: `${GOLDEN}/diff/${view.name}.jpg`,
      threshold,
    })
    if (typeof out.error === "string") {
      rows.push(`  FAIL ${view.name.padEnd(16)} ${out.error}`)
      failed.push(view.name)
      continue
    }
    const ratio = Number(out.ratio)
    const over = ratio > threshold
    if (over) failed.push(view.name)
    rows.push(
      `  ${over ? "FAIL" : "ok  "} ${view.name.padEnd(16)} ${(ratio * 100).toFixed(3).padStart(7)}% differ (limit ${(threshold * 100).toFixed(1)}%)${over ? `  → .probe/golden/diff/${view.name}.jpg` : ""}`,
    )
  }
  console.log(rows.join("\n"))
  console.log(
    `${views.length - failed.length}/${views.length} match (${((performance.now() - t0) / 1000).toFixed(1)} s)${failed.length ? `; over: ${failed.join(", ")}` : ""}`,
  )
  return failed.length ? 1 : 0
}

if (import.meta.main) {
  const code = await main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    return 2
  })
  process.exit(code)
}
