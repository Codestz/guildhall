/** The pure side of `bun shots`: the command line in, the JSON report out. */
import type { CameraPose, FrameStats } from "@guildhall/core"

export const USAGE =
  "usage: bun shots <url> [--camera az,el,dist,tx,ty,tz] [--sample ms] [--size WxH] [--dpr n] --out <path>\n" +
  "  writes <path>.png and <path>.json ({ url, camera, stats, errors, at })"

export interface Size {
  width: number
  height: number
}

export interface ShotOptions {
  url: string
  /** The output path without extension: `<out>.png` and `<out>.json`. */
  out: string
  /** Set before sampling; the page's own camera when absent. */
  camera?: CameraPose
  sampleMs: number
  size: Size
  dpr: number
}

export const DEFAULTS = { sampleMs: 1000, size: { width: 1440, height: 860 }, dpr: 2 } as const

export interface ShotReport {
  url: string
  camera: CameraPose | null
  stats: FrameStats | null
  errors: string[]
  /** ISO time the shot was taken. */
  at: string
}

/** `az,el,dist,tx,ty,tz` (degrees, metres) → a pose. */
export function parseCamera(text: string): CameraPose {
  const parts = text.split(",").map((part) => part.trim())
  const values = parts.map(Number)
  if (parts.length !== 6 || parts.some((part) => part === "") || values.some((v) => !Number.isFinite(v)))
    throw new Error(`--camera wants six numbers az,el,dist,tx,ty,tz, got "${text}"`)
  const [azimuth, elevation, distance, tx, ty, tz] = values as [
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  if (distance <= 0) throw new Error(`--camera distance must be > 0, got ${distance}`)
  return { azimuth, elevation, distance, target: [tx, ty, tz] }
}

/** `WxH` → a viewport in CSS pixels. */
export function parseSize(text: string): Size {
  const match = /^(\d+)x(\d+)$/.exec(text.trim())
  const width = Number(match?.[1])
  const height = Number(match?.[2])
  if (!match || width < 1 || height < 1) throw new Error(`--size wants WxH, got "${text}"`)
  return { width, height }
}

function positive(flag: string, text: string): number {
  const value = Number(text)
  if (text.trim() === "" || !Number.isFinite(value) || value <= 0)
    throw new Error(`${flag} wants a positive number, got "${text}"`)
  return value
}

/** argv (after the script) → options; throws a message naming what is wrong. */
export function parseArgs(argv: readonly string[]): ShotOptions {
  let url: string | undefined
  let out: string | undefined
  let camera: CameraPose | undefined
  let sampleMs: number = DEFAULTS.sampleMs
  let size: Size = { ...DEFAULTS.size }
  let dpr: number = DEFAULTS.dpr
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string
    if (!arg.startsWith("--")) {
      if (url !== undefined) throw new Error(`one url only, got "${url}" and "${arg}"`)
      url = arg
      continue
    }
    const value = argv[++i]
    if (value === undefined) throw new Error(`${arg} wants a value`)
    if (arg === "--out") out = value
    else if (arg === "--camera") camera = parseCamera(value)
    else if (arg === "--sample") sampleMs = positive(arg, value)
    else if (arg === "--size") size = parseSize(value)
    else if (arg === "--dpr") dpr = positive(arg, value)
    else throw new Error(`unknown option ${arg}`)
  }
  if (url === undefined) throw new Error("a url is required")
  if (!URL.canParse(url)) throw new Error(`not a url: "${url}"`)
  if (out === undefined || out === "") throw new Error("--out is required")
  return { url, out, camera, sampleMs, size, dpr }
}

/** The JSON written beside the PNG. */
export function report(
  url: string,
  camera: CameraPose | null,
  stats: FrameStats | null,
  errors: readonly string[],
  at: Date,
): ShotReport {
  return { url, camera, stats, errors: [...errors], at: at.toISOString() }
}
