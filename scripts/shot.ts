/**
 * Headless probe of the running hall (`bun run dev` first), with your installed Chrome.
 *
 *   bun scripts/shot.ts [url] [steps.json]
 *
 * Steps: [{ "wait": ms } | { "shot": "name" } | { "eval": "js" } | { "key": "w", "hold": ms }
 *        | { "drag": [x1, y1, x2, y2], "button": "left" | "right" } | { "wheel": dy, "at": [x, y] }]
 * Screenshots land in .probe/ (git-ignored). Prints page errors and every `eval` result.
 */
import { chromium } from "playwright-core"

type Step =
  | { wait: number }
  | { shot: string }
  | { eval: string }
  | { key: string; hold?: number }
  | { drag: [number, number, number, number]; button?: "left" | "right" }
  | { wheel: number; at?: [number, number] }

const url = process.argv[2] ?? "http://localhost:5199/"
const steps: Step[] = process.argv[3] ? await Bun.file(process.argv[3]).json() : [{ wait: 6000 }, { shot: "hall" }]
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=metal", "--enable-gpu"] })
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } })
const errors: string[] = []
page.on("pageerror", (error) => errors.push(error.message))
await page.goto(url)

for (const step of steps) {
  if ("wait" in step) await page.waitForTimeout(step.wait)
  else if ("shot" in step) await page.screenshot({ path: `.probe/${step.shot}.png` })
  else if ("eval" in step) console.log(JSON.stringify(await page.evaluate(step.eval)))
  else if ("key" in step) {
    await page.keyboard.down(step.key)
    await page.waitForTimeout(step.hold ?? 50)
    await page.keyboard.up(step.key)
  } else if ("drag" in step) {
    const [x1, y1, x2, y2] = step.drag
    await page.mouse.move(x1, y1)
    await page.mouse.down({ button: step.button ?? "left" })
    await page.mouse.move(x2, y2, { steps: 12 })
    await page.mouse.up({ button: step.button ?? "left" })
  } else if ("wheel" in step) {
    const [x, y] = step.at ?? [720, 430]
    await page.mouse.move(x, y)
    await page.mouse.wheel(0, step.wheel)
  }
}
console.log(errors.length ? `errors: ${JSON.stringify(errors)}` : "no page errors")
await browser.close()
