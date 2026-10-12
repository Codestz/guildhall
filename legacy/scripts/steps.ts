/**
 * The steps language shared by scripts/shot.ts (a cold browser per run) and scripts/probe-server.ts
 * (a warm one): a JSON array run in order against a page.
 *
 *   { "wait": ms } | { "shot": "name", "png"?: true } | { "eval": "js" } | { "key": "w", "hold": ms }
 *   | { "drag": [x1, y1, x2, y2], "button": "left" | "right" } | { "wheel": dy, "at": [x, y] }
 *   | { "profile": ms }   (a CPU profile: prints the top functions by self time)
 *   | { "click": "css selector" }   | { "state": "story=saga&hour=23" }   (probe server only: a deep link)
 *
 * Screenshots land in .probe/ (git-ignored): .png from shot.ts, .jpg from the probe server unless
 * the step says `"png": true`.
 */
import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { chromium, type Page } from "playwright-core"

export type Step =
  | { wait: number }
  | { shot: string; png?: boolean }
  | { eval: string }
  | { key: string; hold?: number }
  | { drag: [number, number, number, number]; button?: "left" | "right" }
  | { wheel: number; at?: [number, number] }
  | { profile: number }
  | { click: string }
  | { state: string }

export const ROOT = new URL("..", import.meta.url).pathname
export const PROBE_DIR = `${ROOT}.probe`
/** Where a running probe server says where it listens (scripts/probe-server.ts). */
export const INFO_PATH = `${PROBE_DIR}/probe-server.json`
/**
 * The browser the probe, goldens, bench and recorder drive. Not the user's own Google Chrome: on macOS a
 * headless instance of the installed Chrome blocks opening it (LaunchServices activates the hidden one).
 * Playwright's "Chrome for Testing" is a separate app. Order: $GUILDHALL_CHROME, playwright-core's own
 * build, the newest one installed in ms-playwright, then the system Chrome as a last resort.
 */
export const CHROME = resolveChrome()

function resolveChrome(): string {
  const wanted = process.env.GUILDHALL_CHROME
  if (wanted) return wanted
  const own = chromium.executablePath()
  if (existsSync(own)) return own
  const cache = join(homedir(), "Library/Caches/ms-playwright")
  const app = "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
  const builds = existsSync(cache)
    ? readdirSync(cache)
        .filter((name) => /^chromium-\d+$/.test(name))
        .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
    : []
  for (const build of builds) if (existsSync(join(cache, build, app))) return join(cache, build, app)
  return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
}
/**
 * Uncapped frame rate (no vsync, no 60 Hz limit), so fps/frame-time readings show real headroom
 * against the 120 fps budget instead of the headless 60 cap; Metal through ANGLE, like the Mac.
 * On battery the tools hold to 60 instead (GUILDHALL_UNCAPPED=1 overrides): a capped run still
 * says whether a scene keeps 60 fps, at a fraction of the power.
 */
const UNCAPPED_ARGS = ["--disable-gpu-vsync", "--disable-frame-rate-limit"]
export const CAPPED = process.env.GUILDHALL_UNCAPPED !== "1" && onBattery()
export const CHROME_ARGS = ["--use-angle=metal", "--enable-gpu", ...(CAPPED ? [] : UNCAPPED_ARGS)]

function onBattery(): boolean {
  if (process.platform !== "darwin") return false
  const batt = Bun.spawnSync(["pmset", "-g", "batt"]).stdout.toString()
  return batt.includes("'Battery Power'")
}
export const VIEWPORT = { width: 1440, height: 860 }

/**
 * How long a page freshly loaded at a deep link needs before a shot, ms: shaders compiled, the
 * first frames drawn, the framing cut (1200) — and, with weather other than clear, the clouds,
 * rain or snow eased in from the load's clear sky (scene/weather/shared.ts EASE = 2/s: 2500 ms
 * more leaves e^−6, under 0.3%; the hour snaps).
 */
export function loadSettle(query: string): number {
  const weather = /(?:^|[?&])weather=(\w+)/.exec(query)?.[1] ?? "clear"
  return 1200 + (weather === "clear" ? 0 : 2500)
}

export type Format = "jpeg" | "png"
/**
 * A screenshot of the viewport. JPEG (q90) by default: ~0.35 s at 2880×1720, where PNG's encoder
 * takes ~1.5 s (measured on the M-series Mac this is built on). PNG when every pixel matters.
 */
export async function capture(page: Page, path: string, format: Format = "jpeg"): Promise<void> {
  await page.screenshot(format === "png" ? { path, type: "png" } : { path, type: "jpeg", quality: 90 })
}

/** Where a named shot is written. */
export const shotPath = (name: string, format: Format = "jpeg"): string =>
  `${PROBE_DIR}/${name}.${format === "png" ? "png" : "jpg"}`

export interface StepsOut {
  /** Every `eval` result, in order. */
  evals: unknown[]
  /** Every screenshot written. */
  shots: string[]
  /** Profiles, as printed lines. */
  profiles: string[]
}

/**
 * Runs `steps` on `page`. `state` applies a deep link (needs the hall's PROBE `window.deeplink`).
 * `format`: what a `shot` writes unless it says `"png": true` (shot.ts: png, the probe server: jpeg).
 */
export async function runSteps(
  page: Page,
  steps: Step[],
  { log = () => {}, format = "jpeg" }: { log?: (line: string) => void; format?: Format } = {},
): Promise<StepsOut> {
  const out: StepsOut = { evals: [], shots: [], profiles: [] }
  for (const step of steps) {
    if ("wait" in step) await page.waitForTimeout(step.wait)
    else if ("profile" in step) {
      const lines = await profile(page, step.profile)
      out.profiles.push(...lines)
      for (const line of lines) log(line)
    } else if ("shot" in step) {
      const as = step.png ? "png" : format
      const path = shotPath(step.shot, as)
      await capture(page, path, as)
      out.shots.push(path)
    } else if ("eval" in step) {
      const result = await page.evaluate(step.eval)
      out.evals.push(result)
      log(JSON.stringify(result))
    } else if ("state" in step) {
      const result = await page.evaluate(
        (query) => (window as unknown as { deeplink: { apply(q: string): string[] } }).deeplink.apply(query),
        step.state,
      )
      out.evals.push(result)
      log(JSON.stringify(result))
    } else if ("click" in step) await page.click(step.click)
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
  return out
}

/** Samples the main thread for `ms` and returns where the time went, by function (self time). */
async function profile(page: Page, ms: number): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Profiler.enable")
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 })
  await cdp.send("Profiler.start")
  await page.waitForTimeout(ms)
  const { profile } = await cdp.send("Profiler.stop")
  const self = new Map<string, number>()
  const byId = new Map(profile.nodes.map((node) => [node.id, node]))
  const deltas = profile.timeDeltas ?? []
  ;(profile.samples ?? []).forEach((id, i) => {
    const frame = byId.get(id)?.callFrame
    if (!frame) return
    const file = frame.url.split("/").slice(-2).join("/").replace(/\?.*$/, "")
    const key = `${frame.functionName || "(anon)"}  ${file}:${frame.lineNumber + 1}`
    self.set(key, (self.get(key) ?? 0) + (deltas[i] ?? 0) / 1000)
  })
  const total = [...self.values()].reduce((a, b) => a + b, 0)
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
  await cdp.detach()
  return [
    `profile ${ms} ms (sampled ${total.toFixed(0)} ms):`,
    ...top.map(([key, time]) => `  ${time.toFixed(1).padStart(8)} ms  ${key}`),
  ]
}
