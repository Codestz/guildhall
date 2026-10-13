/**
 * The Studio's committed pictures, captured from the real pages at hi-DPI and written as WebP:
 *
 *   bun shots thumbs                   every home-directory card → apps/studio/public/home/<id>.webp
 *   bun shots thumbs hudlab sitelab    just these cards
 *   bun shots stills                   the lab backdrops (site, HUD) → apps/studio/public/lab/
 *   bun shots thumbs --out .probe/x --port 5341 --dpr 2
 *
 * Each card is the page at 1280×800 CSS px with no top bar, shot at device pixel ratio 2 and scaled
 * down to 800×500 (2.5× the card's widest display, ~320 px) so it stays sharp on a phone at 3×.
 * Backdrops are shot at the size the lab shows them and kept at 2× up to 2560 px wide. The scaling and the
 * WebP encoding run in the browser (no image tool needed). Poses live in CARDS and STILLS below.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Page } from "playwright-core"
import { openPage, waitReady } from "./app.ts"
import { parseCamera } from "./args.ts"
import { launchChrome } from "./chrome.ts"
import { serveStudio } from "./server.ts"

export const THUMBS_USAGE =
  "usage: bun shots thumbs [id …] [--out dir] [--port n] [--dpr n]\n       bun shots stills [name …] [--out dir] [--port n]"

const STUDIO_PUBLIC = fileURLToPath(new URL("../../../apps/studio/public/", import.meta.url))

export interface Pose {
  /** Output file stem. */
  id: string
  /** Path and query on the studio. */
  url: string
  /** Viewport in CSS pixels. */
  size: [number, number]
  /** Output pixel width (height keeps the aspect). */
  width: number
  /** WebP quality, 0..100. */
  quality: number
  /** `az,el,dist,tx,ty,tz` for a world screen. */
  camera?: string
  /** Page script run before the shot (clicks, scrolls). */
  run?: string
  /** Settle time after the page is ready, ms. */
  settle?: number
}

const CARD = { size: [1280, 800] as [number, number], width: 800, quality: 80 }
const BARE = "bar=0&ui=0"

/** The home directory's cards, one per tool (apps/studio/src/shell/directory.ts). */
export const CARDS: readonly Pose[] = [
  { id: "town", url: `/town/1?${BARE}`, ...CARD, settle: 3000 },
  { id: "hexmap", url: `/lab/hexmap?${BARE}`, ...CARD },
  {
    id: "hexscale",
    url: `/lab/hexscale?board=scale&${BARE}`,
    ...CARD,
    camera: "0,32,112,52,1,2",
    settle: 1500,
  },
  { id: "hudlab", url: `/lab/hud?still=1&${BARE}`, ...CARD, settle: 1500 },
  { id: "sitelab", url: `/lab/site?${BARE}`, ...CARD, settle: 1500 },
  { id: "pieces", url: `/pieces?${BARE}`, ...CARD },
  { id: "palette", url: `/palette?${BARE}`, ...CARD },
  { id: "composer", url: `/composer?tile=tavern-garden&${BARE}`, ...CARD },
  { id: "hextiles", url: `/lab/hextiles?${BARE}`, ...CARD },
  { id: "npc", url: `/npcs?${BARE}`, ...CARD },
  { id: "grip", url: `/grips/editor?${BARE}`, ...CARD },
  { id: "grips", url: `/grips?${BARE}`, ...CARD },
]

/** Backdrops the labs draw behind their panels (shown `cover` over the whole window). */
export const STILLS: readonly Pose[] = [
  // the site lab's island: the town's opening view
  {
    id: "island-hero",
    url: `/town/1?${BARE}`,
    size: [1440, 860],
    width: 2560,
    quality: 72,
    settle: 3000,
  },
  // the HUD lab's backdrop: a close street of the same town
  {
    id: "hud-bg",
    url: `/town/1?${BARE}`,
    size: [1440, 860],
    width: 2560,
    quality: 70,
    camera: "295,38,36,-8,1.95,12",
    settle: 3000,
  },
]
const STILL_DIRS: Record<string, string> = { "island-hero": "lab/site", "hud-bg": "lab/hud" }

/** The screenshot as a WebP of `width` px: halved stepwise (smooth, never aliased), then encoded. */
async function encode(page: Page, png: Buffer, width: number, quality: number): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ({ data, width, quality }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${data}`
      await img.decode()
      let src: CanvasImageSource = img
      let w = img.naturalWidth
      let h = img.naturalHeight
      const outH = Math.round((h * width) / w)
      while (w > width * 2) {
        const c = document.createElement("canvas")
        c.width = Math.round(w / 2)
        c.height = Math.round(h / 2)
        const g = c.getContext("2d") as CanvasRenderingContext2D
        g.imageSmoothingQuality = "high"
        g.drawImage(src, 0, 0, c.width, c.height)
        src = c
        w = c.width
        h = c.height
      }
      const out = document.createElement("canvas")
      out.width = Math.min(width, w)
      out.height = out.width === width ? outH : h
      const g = out.getContext("2d") as CanvasRenderingContext2D
      g.imageSmoothingQuality = "high"
      g.drawImage(src, 0, 0, out.width, out.height)
      const blob: Blob = await new Promise((done, fail) =>
        out.toBlob((b) => (b ? done(b) : fail(new Error("no webp"))), "image/webp", quality / 100),
      )
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let bin = ""
      for (let i = 0; i < bytes.length; i += 0x8000)
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return btoa(bin)
    },
    { data: png.toString("base64"), width, quality },
  )
  return Buffer.from(b64, "base64")
}

interface Args {
  ids: string[]
  out: string | null
  port?: number
  dpr: number
}

export function parseThumbsArgs(argv: readonly string[]): Args {
  const args: Args = { ids: [], out: null, dpr: 2 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (!a.startsWith("--")) {
      args.ids.push(a)
      continue
    }
    const value = argv[++i]
    if (value === undefined || value === "") throw new Error(`${a} wants a value`)
    if (a === "--out") args.out = value
    else if (a === "--port") args.port = Number(value)
    else if (a === "--dpr") args.dpr = Number(value)
    else throw new Error(`unknown option ${a}`)
  }
  return args
}

async function capture(
  poses: readonly Pose[],
  argv: readonly string[],
  dir: (p: Pose) => string,
): Promise<number> {
  let args: Args
  try {
    args = parseThumbsArgs(argv)
  } catch (error) {
    console.error(`${(error as Error).message}\n${THUMBS_USAGE}`)
    return 2
  }
  const unknown = args.ids.filter((id) => !poses.some((p) => p.id === id))
  if (unknown.length) {
    console.error(`unknown: ${unknown.join(", ")} (have ${poses.map((p) => p.id).join(", ")})`)
    return 2
  }
  const chosen = poses.filter((p) => args.ids.length === 0 || args.ids.includes(p.id))
  const server = await serveStudio(args.port)
  const browser = await launchChrome("thumbs")
  let failed = 0
  try {
    for (const pose of chosen) {
      const [w, h] = pose.size
      const opened = await openPage(browser, { size: { width: w, height: h }, dpr: args.dpr })
      const { page } = opened
      try {
        await page.goto(new URL(pose.url, server.origin).toString())
        await waitReady(page)
        if (pose.camera) await page.evaluate((c) => window.guildhall?.camera.set(c), parseCamera(pose.camera))
        if (pose.run) await page.evaluate(pose.run)
        await page.waitForTimeout(pose.settle ?? 800)
        const png = await page.screenshot({ type: "png" })
        const webp = await encode(page, png, pose.width, pose.quality)
        const folder = args.out ? resolve(args.out) : join(STUDIO_PUBLIC, dir(pose))
        mkdirSync(folder, { recursive: true })
        const file = join(folder, `${pose.id}.webp`)
        writeFileSync(file, webp)
        const errs = opened.errors.filter((e) => !/404/.test(e))
        console.log(
          `${pose.id}: ${file} ${(webp.length / 1024).toFixed(0)} KB${errs.length ? ` (${errs[0]})` : ""}`,
        )
      } catch (error) {
        failed++
        console.error(`${pose.id}: ${(error as Error).message.split("\n")[0]}`)
      } finally {
        await opened.close()
      }
    }
  } finally {
    await browser.close()
    await server.stop()
  }
  return failed ? 1 : 0
}

export const runThumbs = (argv: readonly string[]) => capture(CARDS, argv, () => "home")
export const runStills = (argv: readonly string[]) => capture(STILLS, argv, (p) => STILL_DIRS[p.id] ?? "lab")
