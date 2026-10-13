/**
 * The browser shots (and tools/import's thumbnails) drive, and how it is launched.
 *
 * Not the user's own Google Chrome: on macOS a headless instance of the installed Chrome blocks
 * opening it (LaunchServices activates the hidden one). Playwright's "Chrome for Testing" is a separate
 * app. Order: $GUILDHALL_CHROME, playwright-core's own build, the newest one installed in ms-playwright,
 * then the system Chrome as a last resort.
 */
import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { type Browser, chromium } from "playwright-core"
import { acquireGpu } from "./gpulock.ts"

const CACHE = join(homedir(), "Library/Caches/ms-playwright")
const APP = "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
const SYSTEM_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

export function resolveChrome(): string {
  const wanted = process.env.GUILDHALL_CHROME
  if (wanted) return wanted
  const own = chromium.executablePath()
  if (existsSync(own)) return own
  const builds = existsSync(CACHE)
    ? readdirSync(CACHE)
        .filter((name) => /^chromium-\d+$/.test(name))
        .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
    : []
  for (const build of builds) if (existsSync(join(CACHE, build, APP))) return join(CACHE, build, APP)
  return SYSTEM_CHROME
}

/**
 * Uncapped frame rate (no vsync, no 60 Hz limit), so fps readings show real headroom against the
 * 120 fps budget instead of the headless 60 cap; Metal through ANGLE, like the Mac. On battery it holds
 * to 60 instead (GUILDHALL_UNCAPPED=1 overrides): a capped run still says whether a scene keeps 60 fps.
 */
const UNCAPPED_ARGS = ["--disable-gpu-vsync", "--disable-frame-rate-limit"]

export function chromeArgs(): string[] {
  const capped = process.env.GUILDHALL_UNCAPPED !== "1" && onBattery()
  // GUILDHALL_ANGLE=gl tries the OpenGL backend (its GPU timer queries read differently from Metal's)
  const angle = process.env.GUILDHALL_ANGLE || "metal"
  return [`--use-angle=${angle}`, "--enable-gpu", ...(capped ? [] : UNCAPPED_ARGS)]
}

function onBattery(): boolean {
  if (process.platform !== "darwin") return false
  return Bun.spawnSync(["pmset", "-g", "batt"]).stdout.toString().includes("'Battery Power'")
}

/** Takes the GPU lock, then launches headless Chrome; the lock is released when the browser goes. */
export async function launchChrome(label: string): Promise<Browser> {
  const release = await acquireGpu(label)
  try {
    const browser = await chromium.launch({ executablePath: resolveChrome(), args: chromeArgs() })
    browser.on("disconnected", release)
    return browser
  } catch (error) {
    release()
    throw error
  }
}
