/**
 * The Studio's committed pictures, captured from the real pages at hi-DPI and written as WebP:
 *
 *   bun shots thumbs                   every home-directory card → apps/studio/public/home/<id>.webp
 *   bun shots thumbs hudlab sitelab    just these cards
 *   bun shots stills                   the backdrops: the island hero → public/site/, the HUD lab's → public/lab/hud/
 *   bun shots repos [owner__repo …]    the demo picker's live-chronicle cards → apps/studio/public/site/repos/
 *   bun shots demos [id …]             the demo picker's story cards, captured on V2 → apps/studio/public/site/demos/
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
  "usage: bun shots thumbs [id …] [--out dir] [--port n] [--dpr n]\n       bun shots stills [name …] [--out dir] [--port n]\n       bun shots repos [owner__repo …] [--out dir] [--port n]\n       bun shots demos [id …] [--out dir] [--port n]"

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
/**
 * The demo picker's live chronicle cards: each repo's hall island at the hall's own opening camera, no
 * plates and none of the site's pieces, 640×400 (shown ≤ 320 px wide: 2×). The id is the catalog stem
 * (`owner__repo`, lower-cased), what `liveStories` looks the picture up by. Needs the chronicles reachable.
 */
export const REPO_SLUGS = [
  "react/react",
  "anomalyco/opencode",
  "microsoft/vscode",
  "Codestz/claude-hindsight",
  "Codestz/mcpx",
  "Codestz/opencode-cockpit",
  "Codestz/guildhall",
  "Codestz/Mintroot",
] as const
export const repoStem = (slug: string): string => slug.replace("/", "__").toLowerCase()
const HIDE_SITE = `document.querySelector(".site-pieces")?.style.setProperty("display", "none")`
const INDEX_URL = "https://cdn.jsdelivr.net/gh/Codestz/guildhall-chronicles@main/index.json"

/**
 * The camera pulled back until the whole island is in: the hall's opening distance times 2 (a small repo)
 * to 5 (20k files), by the square root of the files (the island's width), at a 50° pitch.
 */
export const pullBack = (files: number): number => 2 + 3 * Math.min(1, Math.sqrt(files / 20_000))
const pose = (slug: string, files: number): Pose => ({
  id: repoStem(slug),
  url: `/hall/${slug}?labels=0&${BARE}`,
  size: [1280, 800],
  width: 640,
  quality: 72,
  run: `${HIDE_SITE};(async () => { const c = guildhall.camera.get(); await guildhall.camera.set({ ...c, elevation: 50, distance: c.distance * ${pullBack(files).toFixed(2)} }) })()`,
  settle: 6000,
})
/** The site's pieces and the island's HUD out of a card's picture (the heroes' chips stay: they are the world's). */
const HIDE_HUD = `${HIDE_SITE};document.querySelector(".ui-viewer-hud")?.style.setProperty("display", "none")`
/** A hall's camera pulled back `k` times its opening distance, at `el`° and turned `turn`°. */
const pulled = (k: number, el = 50, turn = 0) =>
  `${HIDE_HUD};(async () => { const c = guildhall.camera.get(); await guildhall.camera.set({ ...c, azimuth: c.azimuth + ${turn}, elevation: ${el}, distance: c.distance * ${k} }) })()`
const DEMO = { size: [1280, 800] as [number, number], width: 640, quality: 74 }

/**
 * The demo picker's story cards (apps/studio/src/site/stories.ts `STORIES`), each its own link as V2 opens
 * it: a told story mid-way on the home island with the director filming, a repo's hall pulled back, the
 * night storm; the site's pieces and the HUD left out. 640×400 (the Saga's feature card 1024×640).
 */
export const DEMOS: readonly Pose[] = [
  { id: "saga", url: `/?story=saga&act=2&${BARE}`, ...DEMO, width: 1024, run: HIDE_HUD, settle: 12_000 },
  { id: "party", url: `/?story=party&st=45&${BARE}`, ...DEMO, run: HIDE_HUD, settle: 10_000 },
  { id: "solo", url: `/?story=solo&st=70&${BARE}`, ...DEMO, run: HIDE_HUD, settle: 10_000 },
  { id: "factions", url: `/?story=factions&st=60&${BARE}`, ...DEMO, run: HIDE_HUD, settle: 10_000 },
  { id: "seas", url: `/?story=seas&st=80&${BARE}`, ...DEMO, run: HIDE_HUD, settle: 10_000 },
  { id: "crowd", url: `/?story=rush&st=30&${BARE}`, ...DEMO, run: HIDE_HUD, settle: 10_000 },
  { id: "react", url: `/hall/facebook/react?labels=0&${BARE}`, ...DEMO, run: pulled(1.6, 44), settle: 7000 },
  {
    id: "world",
    url: `/hall/facebook/react?labels=0&${BARE}`,
    ...DEMO,
    run: pulled(4.2, 52, 120),
    settle: 8000,
  },
  { id: "island", url: `/hall/Codestz/mcpx?labels=0&${BARE}`, ...DEMO, run: pulled(2.4, 50), settle: 7000 },
  { id: "night", url: `/?hour=21&weather=storm&${BARE}`, ...DEMO, run: HIDE_HUD, settle: 10_000 },
]

/** The poses, sized by the catalog's file counts (read live; a repo it does not list gets the middle). */
export async function repoPoses(): Promise<Pose[]> {
  const files = new Map<string, number>()
  try {
    const index = (await (await fetch(INDEX_URL, { signal: AbortSignal.timeout(10_000) })).json()) as {
      repos: { repo: string; files: number }[]
    }
    for (const r of index.repos) files.set(r.repo, r.files)
  } catch {}
  return REPO_SLUGS.map((slug) => pose(slug, files.get(slug) ?? 5000))
}

const STILL_DIRS: Record<string, string> = { "island-hero": "site", "hud-bg": "lab/hud" }

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
export const runRepos = async (argv: readonly string[]) =>
  capture(await repoPoses(), argv, () => "site/repos")
export const runDemos = (argv: readonly string[]) => capture(DEMOS, argv, () => "site/demos")
export const runStills = (argv: readonly string[]) => capture(STILLS, argv, (p) => STILL_DIRS[p.id] ?? "lab")
