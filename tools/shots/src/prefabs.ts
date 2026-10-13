/**
 * Prefab review sheets: every tile prefab shot alone (`/lab/hextiles?tile=<id>&sheet=1`: one fixed 3/4
 * camera, its whole footprint, a knight for scale, its name burned in), then composed into contact
 * sheets of about a dozen tiles per group.
 *
 *   bun shots prefabs                         every tile → .probe/prefabs/tiles/<id>.png,
 *                                             .probe/prefabs/sheet-<group>-<n>.png
 *   bun shots prefabs --only archery,dock     just these tiles (no sheets)
 *   bun shots prefabs --port 5351 --out .probe/prefabs-after
 */
import { mkdirSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { openPage, waitReady } from "./app.ts"
import { launchChrome } from "./chrome.ts"
import { serveStudio } from "./server.ts"

export const PREFABS_USAGE =
  "usage: bun shots prefabs [--only id,id] [--out dir] [--port n] [--per n]\n" +
  "  shoots every tile prefab alone and composes contact sheets of --per (12) tiles per group"

const TILES = fileURLToPath(new URL("../../../data/tiles/", import.meta.url))
/** The gallery's groups in sheet order (TILE_GROUPS), then anything without one. */
const GROUPS = ["town", "country", "ground", "landmark", "road", "other"]
/** Placeholders with nothing on them to review. */
const SKIP = new Set(["scene-part"])
/** One tile's shot, CSS pixels; the sheet shows each at half this. */
const SHOT = { width: 900, height: 700 }
const COLUMNS = 4

export interface TileEntry {
  id: string
  group: string
}

export interface Sheet {
  group: string
  /** 1-based, of `of` sheets in this group. */
  n: number
  of: number
  ids: string[]
}

/** Tiles by group (GROUPS order), then id; each group cut into sheets of at most `per`, as even as can be. */
export function sheetPlan(tiles: readonly TileEntry[], per: number): Sheet[] {
  const out: Sheet[] = []
  for (const group of GROUPS) {
    const ids = tiles
      .filter((t) => (GROUPS.includes(t.group) ? t.group : "other") === group)
      .map((t) => t.id)
      .sort()
    if (!ids.length) continue
    const of = Math.ceil(ids.length / per)
    const size = Math.ceil(ids.length / of)
    for (let n = 0; n < of; n++) out.push({ group, n: n + 1, of, ids: ids.slice(n * size, (n + 1) * size) })
  }
  return out
}

export interface PrefabsArgs {
  only: string[] | null
  out: string
  port?: number
  per: number
}

/** argv after `prefabs` → options; throws a message naming what is wrong. */
export function parsePrefabsArgs(argv: readonly string[]): PrefabsArgs {
  const args: PrefabsArgs = { only: null, out: ".probe/prefabs", per: 12 }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[++i]
    if (value === undefined || value === "") throw new Error(`${flag} wants a value`)
    if (flag === "--only") args.only = value.split(",").filter(Boolean)
    else if (flag === "--out") args.out = value
    else if (flag === "--port" || flag === "--per") {
      if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error(`${flag} wants a positive whole number`)
      if (flag === "--port") args.port = Number(value)
      else args.per = Number(value)
    } else throw new Error(`unknown option ${flag}`)
  }
  return args
}

function readTiles(): TileEntry[] {
  return readdirSync(TILES)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(TILES, f), "utf8")) as { id: string; group?: string })
    .filter((t) => !SKIP.has(t.id))
    .map((t) => ({ id: t.id, group: t.group ?? "other" }))
}

const html = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

/** The contact sheet's page: a header, then the shots in a grid (each already carries its name). */
function sheetHtml(sheet: Sheet, images: string[]): string {
  const w = SHOT.width / 2
  const h = SHOT.height / 2
  const cells = images.map((src) => `<img src="${src}" width="${w}" height="${h}" alt="">`).join("")
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#1b1712;color:#f3e9d4;font:15px ui-sans-serif,system-ui,sans-serif}
header{padding:14px 18px 6px;font-weight:600;font-size:20px}
header span{font-weight:400;opacity:.7;font-size:15px;margin-left:10px}
main{display:grid;grid-template-columns:repeat(${COLUMNS},${w}px);gap:8px;padding:8px 18px 18px}
img{display:block;border-radius:4px}
</style></head><body><header>Tile prefabs · ${html(sheet.group)}<span>sheet ${sheet.n} of ${sheet.of} · ${sheet.ids.length} tiles · one camera, a knight for scale</span></header><main>${cells}</main></body></html>`
}

/** `bun shots prefabs …`: the exit code (0 every shot clean, 1 a page error, 2 bad usage). */
export async function runPrefabs(argv: readonly string[]): Promise<number> {
  let args: PrefabsArgs
  try {
    args = parsePrefabsArgs(argv)
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${PREFABS_USAGE}`)
    return 2
  }
  const all = readTiles()
  const known = new Set(all.map((t) => t.id))
  const unknown = (args.only ?? []).filter((id) => !known.has(id))
  if (unknown.length) {
    console.error(`no such tile: ${unknown.join(", ")}\n\n${PREFABS_USAGE}`)
    return 2
  }
  const tiles = args.only ? all.filter((t) => args.only!.includes(t.id)) : all
  const out = resolve(args.out)
  const shots = join(out, "tiles")
  mkdirSync(shots, { recursive: true })
  const server = await serveStudio(args.port)
  const browser = await launchChrome("shots prefabs")
  let failed = 0
  try {
    for (const t of tiles) {
      const page = await openPage(browser, { size: SHOT, dpr: 1 })
      const errors: string[] = []
      try {
        await page.page.goto(new URL(`/lab/hextiles?tile=${t.id}&sheet=1&bar=0`, server.origin).toString())
        await waitReady(page.page)
        await page.page.screenshot({ path: join(shots, `${t.id}.png`), type: "png" })
      } catch (error) {
        errors.push(`shots: ${(error as Error).message.split("\n")[0]}`)
      }
      errors.unshift(...page.errors)
      await page.close()
      if (errors.length) failed++
      console.log(
        `${errors.length ? "error" : "ok   "} ${t.id}${errors.length ? `  ${errors.join("; ")}` : ""}`,
      )
    }
    if (!args.only) {
      const page = await openPage(browser, { size: { width: 1200, height: 800 }, dpr: 1 })
      for (const sheet of sheetPlan(tiles, args.per)) {
        const images = sheet.ids.map(
          (id) => `data:image/png;base64,${readFileSync(join(shots, `${id}.png`)).toString("base64")}`,
        )
        await page.page.setViewportSize({ width: COLUMNS * (SHOT.width / 2 + 8) + 28, height: 600 })
        await page.page.setContent(sheetHtml(sheet, images), { waitUntil: "load" })
        const path = join(out, `sheet-${sheet.group}-${sheet.n}.png`)
        await page.page.screenshot({ path, type: "png", fullPage: true })
        console.log(path)
      }
      await page.close()
    }
  } finally {
    await browser.close()
    await server.stop()
  }
  console.log(`prefabs: ${tiles.length - failed}/${tiles.length} shot · ${out}`)
  return failed > 0 ? 1 : 0
}
