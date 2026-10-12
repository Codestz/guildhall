/**
 * Screenshot regression sets: a manifest of shots (`tools/shots/sets/<name>.json`), each diffed against
 * its approved baseline in `.probe/baselines/<name>/`.
 *
 *   bun shots set grips                       shoot, diff, exit 1 on a regression (and write <shot>.diff.png)
 *   bun shots set grips --approve             shoot and promote the shots to the baseline
 *   bun shots set grips --out .probe/x --port 5341
 *
 * A pixel differs when any channel moves by more than `threshold`; a shot regresses when more than
 * `maxDiffPct` percent of its pixels differ, when its size changed, or when it has no baseline yet.
 * PNGs are read and written here (zlib only), so the diff needs no image library.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { deflateSync, inflateSync } from "node:zlib"
import { openPage, waitReady } from "./app.ts"
import { parseCamera, parseSize, type Size } from "./args.ts"
import { launchChrome } from "./chrome.ts"
import { serveStudio } from "./server.ts"

export const SET_USAGE = "usage: bun shots set <name> [--approve] [--out dir] [--port n]"

const SETS = fileURLToPath(new URL("../sets/", import.meta.url))

export interface SetShot {
  /** File-safe: the PNG is `<out>/<name>.png`. */
  name: string
  /** Path and query on the studio: `/?screen=grips&t=0.3`. */
  url: string
  /** `az,el,dist,tx,ty,tz`, as `bun shots --camera`; the page's own camera when absent. */
  camera?: string
  /** `WxH` CSS pixels (default 1440x860). */
  size?: string
  /** Device pixel ratio (default 1). */
  dpr?: number
}

export interface ShotSet {
  shots: SetShot[]
  /** Per-channel difference (0..255) above which a pixel differs. */
  threshold: number
  /** Percent of differing pixels above which a shot regresses. */
  maxDiffPct: number
}

export const SET_DEFAULTS = { threshold: 16, maxDiffPct: 0.1, size: "1440x860", dpr: 1 } as const

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** A parsed manifest → a checked set; throws naming every problem. */
export function parseSet(json: unknown): ShotSet {
  const problems: string[] = []
  const value = (json ?? {}) as Partial<ShotSet>
  const shots = Array.isArray(value.shots) ? value.shots : []
  if (shots.length === 0) problems.push("shots: expected a non-empty array")
  const seen = new Set<string>()
  for (const [i, shot] of shots.entries()) {
    const at = `shots[${i}]`
    if (typeof shot?.name !== "string" || !NAME.test(shot.name))
      problems.push(`${at}.name: expected kebab-case`)
    else if (seen.has(shot.name)) problems.push(`${at}.name: duplicate "${shot.name}"`)
    else seen.add(shot.name)
    if (typeof shot?.url !== "string" || !shot.url.startsWith("/"))
      problems.push(`${at}.url: expected a path`)
    for (const [key, check] of [
      ["camera", parseCamera],
      ["size", parseSize],
    ] as const) {
      const text = shot?.[key]
      if (text === undefined) continue
      try {
        check(String(text))
      } catch (error) {
        problems.push(`${at}.${key}: ${(error as Error).message}`)
      }
    }
    if (shot?.dpr !== undefined && !(typeof shot.dpr === "number" && shot.dpr > 0))
      problems.push(`${at}.dpr: expected a positive number`)
  }
  const threshold = value.threshold ?? SET_DEFAULTS.threshold
  const maxDiffPct = value.maxDiffPct ?? SET_DEFAULTS.maxDiffPct
  if (!(threshold >= 0 && threshold <= 255)) problems.push("threshold: expected 0..255")
  if (!(maxDiffPct >= 0 && maxDiffPct <= 100)) problems.push("maxDiffPct: expected 0..100")
  if (problems.length > 0) throw new Error(problems.join("\n"))
  return { shots, threshold, maxDiffPct }
}

export interface SetArgs {
  name: string
  approve: boolean
  out: string
  port?: number
}

/** argv after `set` → options; throws a message naming what is wrong. */
export function parseSetArgs(argv: readonly string[]): SetArgs {
  let name: string | undefined
  let approve = false
  let out: string | undefined
  let port: number | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string
    if (arg === "--approve") approve = true
    else if (arg === "--out" || arg === "--port") {
      const value = argv[++i]
      if (value === undefined || value === "") throw new Error(`${arg} wants a value`)
      if (arg === "--out") out = value
      else if (!/^\d+$/.test(value)) throw new Error(`--port wants a port number, got "${value}"`)
      else port = Number(value)
    } else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`)
    else if (name !== undefined) throw new Error(`one set only, got "${name}" and "${arg}"`)
    else name = arg
  }
  if (name === undefined || !NAME.test(name)) throw new Error("a set name (kebab-case) is required")
  return { name, approve, out: out ?? join(".probe/sets", name), port }
}

/** 8-bit RGBA pixels, row-major. */
export interface Image {
  width: number
  height: number
  data: Uint8Array
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)]
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** An 8-bit, non-interlaced RGB or RGBA PNG (what Chrome screenshots are) → RGBA. Throws on anything else. */
export function decodePng(bytes: Uint8Array): Image {
  if (!SIGNATURE.every((b, i) => bytes[i] === b)) throw new Error("not a PNG")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0
  let height = 0
  let channels = 0
  const idat: Uint8Array[] = []
  for (let at = 8; at < bytes.length; ) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (type === "IHDR") {
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      const [depth, colour, , , interlace] = body.subarray(8, 13)
      channels = colour === 6 ? 4 : colour === 2 ? 3 : 0
      if (depth !== 8 || channels === 0 || interlace !== 0)
        throw new Error(`unsupported PNG (depth ${depth}, colour ${colour}, interlace ${interlace})`)
    } else if (type === "IDAT") idat.push(body)
    else if (type === "IEND") break
    at += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const rows = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (rows[out + x - channels] as number) : 0
      const b = y > 0 ? (rows[out - stride + x] as number) : 0
      const c = x >= channels && y > 0 ? (rows[out - stride + x - channels] as number) : 0
      const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter as number]
      if (predictor === undefined) throw new Error(`bad PNG filter ${filter}`)
      rows[out + x] = ((line[x] as number) + predictor) & 0xff
    }
  }
  if (channels === 4) return { width, height, data: rows }
  const data = new Uint8Array(width * height * 4)
  for (let i = 0, j = 0; i < rows.length; i += 3, j += 4) {
    data.set(rows.subarray(i, i + 3), j)
    data[j + 3] = 255
  }
  return { width, height, data }
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(body, 8)
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))
  return out
}

/** RGBA → an 8-bit RGBA PNG (no filtering). */
export function encodePng({ width, height, data }: Image): Uint8Array {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 6, 0, 0, 0], 8)
  const raw = new Uint8Array((width * 4 + 1) * height)
  for (let y = 0; y < height; y++)
    raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
  return Buffer.concat([
    Uint8Array.from(SIGNATURE),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ])
}

export interface Diff {
  /** Percent of pixels that differ; 100 when the sizes differ. */
  pct: number
  differing: number
  /** The current image faded, with every differing pixel in red; null when the sizes differ. */
  image: Image | null
}

/** Compares two images pixel by pixel: a pixel differs when any channel moves by more than `threshold`. */
export function diffImages(base: Image, current: Image, threshold: number): Diff {
  if (base.width !== current.width || base.height !== current.height)
    return { pct: 100, differing: current.width * current.height, image: null }
  const out = new Uint8Array(current.data.length)
  let differing = 0
  for (let i = 0; i < out.length; i += 4) {
    let moved = false
    for (let k = 0; k < 4; k++)
      if (Math.abs((base.data[i + k] as number) - (current.data[i + k] as number)) > threshold) moved = true
    if (moved) {
      differing++
      out.set([255, 0, 0, 255], i)
    } else {
      for (let k = 0; k < 3; k++) out[i + k] = 192 + ((current.data[i + k] as number) >> 2)
      out[i + 3] = 255
    }
  }
  const total = current.width * current.height
  return { pct: total > 0 ? (100 * differing) / total : 0, differing, image: { ...current, data: out } }
}

export type Verdict = "pass" | "regressed" | "new" | "approved" | "error"

/** One shot's verdict against its baseline (null: none yet). */
export function judge(diff: Diff | null, maxDiffPct: number, approve: boolean): Verdict {
  if (approve) return "approved"
  if (!diff) return "new"
  return diff.pct > maxDiffPct ? "regressed" : "pass"
}

/** Shoots every shot of a set into `out`; returns each shot's errors. */
async function shootSet(set: ShotSet, out: string, port?: number): Promise<Map<string, string[]>> {
  const server = await serveStudio(port)
  const browser = await launchChrome("shots set")
  const errors = new Map<string, string[]>()
  try {
    for (const shot of set.shots) {
      const size: Size = parseSize(shot.size ?? SET_DEFAULTS.size)
      const opened = await openPage(browser, { size, dpr: shot.dpr ?? SET_DEFAULTS.dpr })
      const mine: string[] = []
      try {
        await opened.page.goto(new URL(shot.url, server.origin).toString())
        await waitReady(opened.page)
        if (shot.camera) {
          const pose = parseCamera(shot.camera)
          await opened.page.evaluate((p) => window.guildhall?.camera.set(p), pose)
        }
        await opened.page.screenshot({ path: join(out, `${shot.name}.png`), type: "png" })
      } catch (error) {
        mine.push(`shots: ${(error as Error).message.split("\n")[0]}`)
      }
      errors.set(shot.name, [...opened.errors, ...mine])
      await opened.close()
    }
  } finally {
    await browser.close()
    await server.stop()
  }
  return errors
}

/** `bun shots set …`: the exit code (0 all pass or approved, 1 a regression or a page error, 2 bad usage). */
export async function runSet(argv: readonly string[]): Promise<number> {
  let args: SetArgs
  let set: ShotSet
  try {
    args = parseSetArgs(argv)
    const file = join(SETS, `${args.name}.json`)
    if (!existsSync(file)) throw new Error(`no set "${args.name}" (${file})`)
    set = parseSet(JSON.parse(readFileSync(file, "utf8")))
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${SET_USAGE}`)
    return 2
  }
  const out = resolve(args.out)
  const baselines = resolve(".probe/baselines", args.name)
  mkdirSync(out, { recursive: true })
  const errors = await shootSet(set, out, args.port)
  if (args.approve) mkdirSync(baselines, { recursive: true })
  let failed = 0
  for (const shot of set.shots) {
    const shotErrors = errors.get(shot.name) ?? []
    const current = join(out, `${shot.name}.png`)
    const baseline = join(baselines, `${shot.name}.png`)
    let verdict: Verdict
    let detail = ""
    if (shotErrors.length > 0 || !existsSync(current)) {
      verdict = "error"
      detail = shotErrors.join("; ")
    } else if (args.approve) {
      copyFileSync(current, baseline)
      verdict = "approved"
    } else {
      const diff = existsSync(baseline)
        ? diffImages(decodePng(readFileSync(baseline)), decodePng(readFileSync(current)), set.threshold)
        : null
      verdict = judge(diff, set.maxDiffPct, false)
      if (diff) detail = `${diff.pct.toFixed(3)}% differ`
      if (verdict === "regressed" && diff?.image) {
        await Bun.write(join(out, `${shot.name}.diff.png`), encodePng(diff.image))
        detail += ` → ${shot.name}.diff.png`
      }
      if (verdict === "new") detail = "no baseline: --approve to accept"
    }
    if (verdict === "error" || verdict === "regressed" || verdict === "new") failed++
    console.log(`${verdict.padEnd(9)} ${shot.name}${detail ? `  ${detail}` : ""}`)
  }
  console.log(`${args.name}: ${set.shots.length - failed}/${set.shots.length} ok · shots in ${out}`)
  return failed > 0 ? 1 : 0
}
