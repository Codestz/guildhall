/**
 * Headless probe of the running hall (`bun run dev` first), with your installed Chrome — cold: it
 * launches Chrome and loads the whole island (~12 s) every run. For repeated checks use the warm
 * probe server instead (scripts/probe-server.ts, `bun scripts/probe.ts shot …`, ~1 s a shot), deep
 * links for state (`?story=saga&t=11:53&hour=23&look=quarry`, guild/deeplink.ts), the labs for one
 * thing alone (`?lab=character|prop|event|grips`), and `bun scripts/golden.ts check` before
 * reporting. The workflow: docs/perf-budget.md "How to verify visual work".
 *
 *   bun scripts/shot.ts [url] [steps.json]
 *
 * Steps (scripts/steps.ts): [{ "wait": ms } | { "shot": "name" } | { "eval": "js" }
 *        | { "key": "w", "hold": ms } | { "drag": [x1, y1, x2, y2], "button": "left" | "right" }
 *        | { "wheel": dy, "at": [x, y] } | { "click": "selector" } | { "state": "deep link query" }
 *        | { "profile": ms }]   (a CPU profile: prints the top functions by self time)
 * Screenshots land in .probe/ (git-ignored). Prints page errors and every `eval` result.
 * Retina-like by default (DPR=2), like the Mac this is built on; `DPR=1 bun scripts/shot.ts …` to compare.
 */
import { chromium } from "playwright-core"
import { CHROME, CHROME_ARGS, runSteps, type Step, VIEWPORT } from "./steps.ts"

const url = process.argv[2] ?? "http://localhost:5199/"
const steps: Step[] = process.argv[3]
  ? await Bun.file(process.argv[3]).json()
  : [{ wait: 6000 }, { shot: "hall" }]

const browser = await chromium.launch({ executablePath: CHROME, args: CHROME_ARGS })
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: Number(process.env.DPR ?? 2) })
const errors: string[] = []
page.on("pageerror", (error) => errors.push(error.message))
// Shader compile failures and WebGL errors arrive as console errors, not page exceptions.
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text().slice(0, 600)}`)
})
await page.goto(url)
await runSteps(page, steps, { log: (line) => console.log(line), format: "png" })
console.log(errors.length ? `errors: ${JSON.stringify(errors)}` : "no page errors")
await browser.close()
