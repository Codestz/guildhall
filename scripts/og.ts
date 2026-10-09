/**
 * Rebuilds the social card, packages/hall/public/og.png (1200x630, under 300 KB):
 * a golden-hour frame of the React island, shot cold with scripts/shot.ts, behind the
 * overlay in scripts/og.html (crest, wordmark, tagline), rendered by Chrome for Testing at 2x,
 * then resampled to 1200x630 and palette-quantised with ffmpeg to fit the budget.
 *
 *   bun run dev                              # the hall, in another terminal
 *   bun scripts/og.ts [http://localhost:5199] [--frame]   (--frame: reuse .probe/og-frame.png)
 *
 * Needs ffmpeg (`brew install ffmpeg`). Intermediates stay in .probe/ (git-ignored).
 */
import { chromium } from "playwright-core"
import { acquireGpu } from "./gpulock.ts"
import { CHROME, PROBE_DIR, ROOT } from "./steps.ts"

const base = (process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:5199").replace(
  /\/$/,
  "",
)
const reuse = process.argv.includes("--frame")
const MAX_BYTES = 300 * 1024
const OUT = `${ROOT}packages/hall/public/og.png`

if (!Bun.which("ffmpeg")) {
  console.error("og: ffmpeg not found. Install with: brew install ffmpeg")
  process.exit(1)
}

if (!reuse) {
  // Hide every fixed or absolute HUD piece (the "Show HUD" tab, story captions), keep the canvas.
  const hide =
    "document.querySelectorAll('body *').forEach(e=>{if(e.tagName==='CANVAS'||e.querySelector('canvas')||e.closest('canvas'))return;const p=getComputedStyle(e).position;if(p==='fixed'||p==='absolute')e.style.display='none'})"
  const steps = [{ wait: 7000 }, { eval: hide }, { wait: 400 }, { shot: "og-frame", png: true }]
  await Bun.write(`${PROBE_DIR}/og-steps.json`, JSON.stringify(steps))
  const url = `${base}/?repo=facebook/react&look=island&hour=17.5&hud=off`
  const shot = Bun.spawn(["bun", `${ROOT}scripts/shot.ts`, url, `${PROBE_DIR}/og-steps.json`], {
    stdout: "inherit",
    stderr: "inherit",
  })
  if ((await shot.exited) !== 0) throw new Error("og: shot.ts failed")
}

// The overlay, at 2x, once the web fonts are in.
await acquireGpu("og")
const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 })
await page.goto(`file://${ROOT}scripts/og.html`)
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(500)
await page.screenshot({ path: `${PROBE_DIR}/og-raw.png`, type: "png" })
await browser.close()

const CANDIDATES: [string, number][] = [
  ["sierra2_4a", 256],
  ["bayer:bayer_scale=5", 256],
  ["bayer:bayer_scale=5", 128],
  ["none", 256],
  ["none", 128],
]
// Down to 1200x630 (Lanczos), then 256 colours with dithering; fewer colours until it fits.
let bytes = Number.POSITIVE_INFINITY
for (const [dither, colours] of CANDIDATES) {
  const run = Bun.spawnSync([
    "ffmpeg",
    "-y",
    "-loglevel",
    "error",
    "-i",
    `${PROBE_DIR}/og-raw.png`,
    "-vf",
    `scale=1200:630:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colours}:stats_mode=diff[p];[b][p]paletteuse=dither=${dither}`,
    "-frames:v",
    "1",
    OUT,
  ])
  if (run.exitCode !== 0) throw new Error(`og: ffmpeg failed: ${run.stderr.toString()}`)
  bytes = Bun.file(OUT).size
  console.log(`og: ${dither}, ${colours} colours -> ${(bytes / 1024).toFixed(0)} KB`)
  if (bytes <= MAX_BYTES) break
}
if (bytes > MAX_BYTES) throw new Error("og: could not fit 300 KB")
console.log(`og: wrote ${OUT}`)
