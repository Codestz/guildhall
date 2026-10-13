/**
 * The perf bench (docs perf2-contract §1): `/town/<seed>` at two sizes, six fixed poses, each sampled
 * three times under the GPU lock, with the GPU time per pass, the CPU split, draw calls, triangles and
 * the main-thread long tasks after the first frame. One JSON and one markdown table per run, and the
 * run appended to the ledger.
 *
 *   bun shots bench --label before                      .probe/perf2/bench-before.{json,md}, ledger.md appended
 *   bun shots bench --label after --files 4000 --runs 1 --poses hero,wide
 *   bun shots bench --out /path/to/.probe/perf2 --port 5501 --note "shadow cache"
 *
 * Poses (all from the page's opening view, whose target is the island's heart): hero, mid and wide at
 * 12:00; hero at 19:30 (lanterns lit); the square from low and close at noon (crowd-heavy); the free
 * camera low over the sea looking back at the island. The DPR is pinned at 1.5 (the contract's), so the
 * governor cannot trade resolution for time under the bench's nose. A still camera costs no shadow
 * passes (the cascades re-render only as their snapped centre moves), so `--turn` poses are sampled
 * again while the orbit turns slowly (`<pose>-turn`, where LOD crossfades cost) and `--pan` poses while
 * the target slides (`<pose>-pan`, the one motion that re-renders the near cascades every frame).
 *
 * Frames run uncapped (no vsync): on this GPU the main thread then blocks inside `renderer.render` on
 * the GPU's back-pressure, so the frame time is the GPU's throughput, which a vsync-capped run hides at
 * 60 or 120 Hz. What each part costs is measured by taking it away (`--variants`: `post=0`, `life=0`,
 * `atmo=0`, `lod=0`, each its own page load) and reading the p95 difference: the GPU timer queries
 * (`passes`) are kept in the report, but on ANGLE's Metal backend they measure command-buffer wall
 * time, not pass cost, and the markdown says so when their sum does not fit the frame.
 */
import { appendFileSync, existsSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import type { CameraPose, FrameStats, FreeCamera } from "@guildhall/core"
import { openPage, waitReady } from "./app.ts"
import { launchChrome } from "./chrome.ts"
import { serveStudio } from "./server.ts"

export const BENCH_USAGE =
  "usage: bun shots bench [--label name] [--out dir] [--port n] [--seed n] [--files a,b] [--runs n]\n" +
  "                       [--sample ms] [--poses a,b,…] [--turn a,b,…] [--pan a,b,…] [--variants q,q,…|none] [--note text] [--no-ledger]"

export const POSE_NAMES = ["hero", "mid", "wide", "lanterns", "square", "sea"] as const
export type PoseName = (typeof POSE_NAMES)[number]

export interface BenchArgs {
  label: string
  out: string
  port?: number
  seed: number
  files: number[]
  runs: number
  sampleMs: number
  poses: PoseName[]
  /** Poses sampled again while the camera turns slowly. */
  turn: PoseName[]
  /** Poses sampled again while the target slides slowly (the shadows' only cost). */
  pan: PoseName[]
  /** Queries the page is loaded again with, each part taken away (`post=0`, `life=0`…); the still poses only. */
  variants: string[]
  note: string
  ledger: boolean
}

export const BENCH_DEFAULTS = {
  out: ".probe/perf2",
  seed: 1,
  files: [4000, 12000],
  runs: 3,
  sampleMs: 2000,
  size: { width: 1440, height: 860 },
  dpr: 1.5,
  /** Frames to let a new pose settle (the rig eases, shadows re-render) before sampling. */
  settleMs: 700,
  turn: ["hero", "wide"] as PoseName[],
  /** Degrees of azimuth a frame while turning: the flicker hunt's creep, slow enough to read as a pan. */
  turnStep: 0.05,
  pan: ["hero", "wide"] as PoseName[],
  /** Metres the target slides a frame while panning: a walking pace at 90 fps. */
  panStep: 0.02,
  variants: ["post=0", "life=0", "atmo=0", "lod=0"],
} as const

const NAME = /^[a-z0-9]+([-.][a-z0-9]+)*$/

/** argv after `bench` → options; throws a message naming what is wrong. */
export function parseBenchArgs(argv: readonly string[]): BenchArgs {
  const args: BenchArgs = {
    label: new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").toLowerCase(),
    out: BENCH_DEFAULTS.out,
    seed: BENCH_DEFAULTS.seed,
    files: [...BENCH_DEFAULTS.files],
    runs: BENCH_DEFAULTS.runs,
    sampleMs: BENCH_DEFAULTS.sampleMs,
    poses: [...POSE_NAMES],
    turn: [...BENCH_DEFAULTS.turn],
    pan: [...BENCH_DEFAULTS.pan],
    variants: [...BENCH_DEFAULTS.variants],
    note: "",
    ledger: true,
  }
  const numbers = (flag: string, text: string): number[] => {
    const values = text.split(",").map((t) => Number(t.trim()))
    if (values.length === 0 || values.some((v) => !Number.isFinite(v) || v <= 0))
      throw new Error(`${flag} wants positive numbers, got "${text}"`)
    return values
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string
    if (arg === "--no-ledger") {
      args.ledger = false
      continue
    }
    if (!arg.startsWith("--")) throw new Error(`unknown argument ${arg}`)
    const value = argv[++i]
    if (value === undefined) throw new Error(`${arg} wants a value`)
    if (arg === "--label") {
      if (!NAME.test(value)) throw new Error(`--label wants kebab-case, got "${value}"`)
      args.label = value
    } else if (arg === "--out") args.out = value
    else if (arg === "--note") args.note = value
    else if (arg === "--port" || arg === "--seed" || arg === "--runs" || arg === "--sample") {
      const [n] = numbers(arg, value)
      if (n === undefined || !Number.isInteger(n))
        throw new Error(`${arg} wants a whole number, got "${value}"`)
      if (arg === "--port") args.port = n
      else if (arg === "--seed") args.seed = n
      else if (arg === "--runs") args.runs = n
      else args.sampleMs = n
    } else if (arg === "--files") args.files = numbers(arg, value)
    else if (arg === "--variants") {
      const variants = value === "" || value === "none" ? [] : value.split(",").map((v) => v.trim())
      const bad = variants.find((v) => !/^[a-z]+=[a-z0-9.]+$/.test(v))
      if (bad !== undefined) throw new Error(`--variants wants key=value queries, got "${bad}"`)
      args.variants = variants
    } else if (arg === "--poses" || arg === "--turn" || arg === "--pan") {
      const poses = value === "" || value === "none" ? [] : value.split(",").map((p) => p.trim())
      const bad = poses.find((p) => !(POSE_NAMES as readonly string[]).includes(p))
      if (bad !== undefined) throw new Error(`${arg}: no pose "${bad}" (${POSE_NAMES.join(", ")})`)
      if (arg === "--poses") args.poses = poses as PoseName[]
      else if (arg === "--turn") args.turn = poses as PoseName[]
      else args.pan = poses as PoseName[]
    } else throw new Error(`unknown option ${arg}`)
  }
  return args
}

/** One pose of the bench: an orbit pose or a free flight, and the clock it is seen at. */
export interface BenchPose {
  name: PoseName
  hour: number
  orbit?: CameraPose
  free?: FreeCamera
}

/** The bench's poses from the page's opening (hero) pose. `wide` asks for more than the rig allows: it clamps. */
export function benchPoses(hero: CameraPose, names: readonly PoseName[] = POSE_NAMES): BenchPose[] {
  const [tx, ty, tz] = hero.target
  const rad = (hero.azimuth * Math.PI) / 180
  const all: Record<PoseName, BenchPose> = {
    hero: { name: "hero", hour: 12, orbit: hero },
    mid: { name: "mid", hour: 12, orbit: { ...hero, elevation: 50, distance: hero.distance * 2.3 } },
    wide: { name: "wide", hour: 12, orbit: { ...hero, elevation: 80, distance: 1e5 } },
    lanterns: { name: "lanterns", hour: 19.5, orbit: hero },
    square: { name: "square", hour: 12, orbit: { ...hero, elevation: 30, distance: hero.distance * 0.5 } },
    // the eye well out from the heart along the view's own azimuth (the rig sits the orbit camera that
    // way), a few metres over the water, looking back at the island
    sea: {
      name: "sea",
      hour: 12,
      free: {
        eye: [tx + Math.sin(rad) * 150, ty + 4, tz + Math.cos(rad) * 150],
        yaw: hero.azimuth,
        pitch: -3,
      },
    },
  }
  return names.map((n) => all[n])
}

export interface LongTask {
  start: number
  duration: number
}

export interface PoseResult {
  /** A pose's name, or `<pose>-turn` / `<pose>-pan` for the same pose sampled while the camera turns or its target slides. */
  name: string
  hour: number
  /** The pose as drawn (the rig may have clamped what was asked). */
  camera: CameraPose | null
  runs: FrameStats[]
}

export interface SizeResult {
  files: number
  url: string
  /** The first frame with the ground in it, ms from the screen's mount; and ms from navigation. */
  firstFrame: number | null
  firstAt: number | null
  longTasks: LongTask[]
  poses: PoseResult[]
  /** The same still poses with one part taken away, per `--variants` query. */
  variants: { query: string; poses: PoseResult[] }[]
  errors: string[]
}

export interface BenchEnv {
  at: string
  git: string
  power: string
  lowPowerMode: boolean | null
  /** Other Chromium processes on the machine when the bench started (other agents' browsers). */
  otherBrowsers: number
  /** Frames uncapped (no vsync, the GPU's throughput) or at the display's rate. */
  uncapped: boolean
  size: { width: number; height: number }
  dpr: number
  userAgent: string
}

export interface BenchReport {
  label: string
  note: string
  env: BenchEnv
  seed: number
  runs: number
  sampleMs: number
  sizes: SizeResult[]
}

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)] as number
}
const mean = (values: readonly number[]): number =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0

/** One pose's figures over its runs: medians of the percentiles, means of the passes, the last run's counters. */
export function summarizePose(p: PoseResult) {
  const runs = p.runs
  const last = runs.at(-1)
  const of = (pick: (s: FrameStats) => number | undefined) =>
    runs.map(pick).filter((v): v is number => v !== undefined)
  const passNames = [...new Set(runs.flatMap((s) => Object.keys(s.passes ?? {})))]
  const cpuNames = [...new Set(runs.flatMap((s) => Object.keys(s.cpu ?? {})))]
  const passes: Record<string, number> = {}
  for (const n of passNames) passes[n] = mean(of((s) => s.passes?.[n]))
  const cpu: Record<string, number> = {}
  for (const n of cpuNames) cpu[n] = mean(of((s) => s.cpu?.[n]))
  const p95s = of((s) => s.frameMs.p95)
  return {
    fps: median(of((s) => s.fps)),
    p50: median(of((s) => s.frameMs.p50)),
    p95: median(p95s),
    /** The spread of p95 over the runs: the noise a change must beat. */
    noise: p95s.length > 1 ? Math.max(...p95s) - Math.min(...p95s) : 0,
    costP95: median(of((s) => s.costMs?.p95)),
    gpu: Object.values(passes).reduce((a, b) => a + b, 0),
    passes,
    cpu,
    calls: last?.calls ?? 0,
    tris: last?.tris ?? 0,
    dpr: last?.dpr ?? 0,
  }
}

const PASS_ORDER = ["shadows", "opaque", "water", "sky", "crowd", "post"]
const f1 = (v: number) => v.toFixed(1)
const f2 = (v: number) => v.toFixed(2)

/** What each variant's absence saves at a pose: p95(full) − p95(without), ms; null when the pose was not sampled. */
export function variantSavings(size: SizeResult, pose: string): Record<string, number | null> {
  const full = size.poses.find((p) => p.name === pose)
  const out: Record<string, number | null> = {}
  for (const v of size.variants) {
    const without = v.poses.find((p) => p.name === pose)
    out[v.query] = full && without ? summarizePose(full).p95 - summarizePose(without).p95 : null
  }
  return out
}

/** The long tasks after the first frame, and the longest of them. */
export function longTasksAfter(tasks: readonly LongTask[], firstAt: number | null) {
  const after = firstAt === null ? [...tasks] : tasks.filter((t) => t.start >= firstAt)
  return { after, longest: after.reduce((m, t) => Math.max(m, t.duration), 0) }
}

/** The report as markdown: a line of context, then one table per size, then the long tasks. */
export function benchMarkdown(r: BenchReport): string {
  const lines: string[] = []
  const e = r.env
  lines.push(`### ${r.label} — ${e.at}`)
  if (r.note) lines.push(`${r.note}`)
  lines.push(
    `git ${e.git} · ${e.power}, low power mode ${e.lowPowerMode === null ? "unknown" : e.lowPowerMode ? "ON" : "off"} · ` +
      `other browsers running: ${e.otherBrowsers} · ${e.size.width}×${e.size.height} @ DPR ${e.dpr} · ` +
      `${e.uncapped ? "uncapped (no vsync)" : "vsync"} · ${r.runs} runs × ${r.sampleMs} ms · seed ${r.seed}`,
  )
  for (const size of r.sizes) {
    const passNames = PASS_ORDER.filter((n) =>
      size.poses.some((p) => p.runs.some((s) => n in (s.passes ?? {}))),
    )
    const extra = [...new Set(size.poses.flatMap((p) => p.runs.flatMap((s) => Object.keys(s.passes ?? {}))))]
      .filter((n) => !PASS_ORDER.includes(n))
      .sort()
    const cols = [...passNames, ...extra]
    // the gpu timer columns only when the page had the queries on (`?timers=1`)
    const gpuHead = cols.length > 0 ? ` gpu | ${cols.join(" | ")} |` : ""
    lines.push("")
    lines.push(`**${size.files.toLocaleString("en-US")} files** · first frame ${size.firstFrame ?? "?"} ms`)
    lines.push("")
    lines.push(`| pose | fps | p50 | p95 | ±noise | cpu p95 |${gpuHead} calls | tris |`)
    lines.push(`|---|${"---:|".repeat(cols.length + (cols.length > 0 ? 8 : 7))}`)
    for (const p of size.poses) {
      const s = summarizePose(p)
      const gpuCells =
        cols.length > 0
          ? ` ${f1(s.gpu)} | ${cols.map((n) => (s.passes[n] === undefined ? "–" : f2(s.passes[n] as number))).join(" | ")} |`
          : ""
      lines.push(
        `| ${p.name} | ${Math.round(s.fps)} | ${f1(s.p50)} | ${f1(s.p95)} | ${f1(s.noise)} | ${f1(s.costP95)} |${gpuCells} ` +
          `${s.calls} | ${Math.round(s.tris / 1000)}k |`,
      )
    }
    // the timer queries only mean something when a frame's passes fit inside the frame
    const worst = size.poses.reduce((m, p) => {
      const s = summarizePose(p)
      return s.p50 > 0 ? Math.max(m, s.gpu / s.p50) : m
    }, 0)
    if (worst > 1.5)
      lines.push(
        "",
        `gpu timer columns are not pass costs here (their sum is ${worst.toFixed(1)}× the frame): ANGLE/Metal times ` +
          "command buffers, not passes. Read the savings table instead.",
      )
    if (size.variants.length > 0) {
      lines.push("")
      lines.push(`what each part costs (p95 full − p95 without, ms):`)
      lines.push("")
      lines.push(`| pose | ${size.variants.map((v) => v.query).join(" | ")} |`)
      lines.push(`|---|${"---:|".repeat(size.variants.length)}`)
      for (const p of size.poses) {
        if (p.name.endsWith("-turn") || p.name.endsWith("-pan")) continue
        const saved = variantSavings(size, p.name)
        lines.push(
          `| ${p.name} | ${size.variants.map((v) => (saved[v.query] === null ? "–" : f1(saved[v.query] as number))).join(" | ")} |`,
        )
      }
    }
    const cpuNames = [...new Set(size.poses.flatMap((p) => Object.keys(summarizePose(p).cpu)))]
    if (cpuNames.length > 0) {
      const hero = size.poses.find((p) => p.name === "hero" || p.name === "square") ?? size.poses[0]
      if (hero) {
        const s = summarizePose(hero)
        lines.push("")
        lines.push(
          `cpu split at ${hero.name}: ${Object.entries(s.cpu)
            .map(([n, v]) => `${n} ${f2(v)}`)
            .join(", ")} ms`,
        )
      }
    }
    const { after, longest } = longTasksAfter(size.longTasks, size.firstAt)
    lines.push("")
    lines.push(
      `long tasks after first frame: ${after.length} (longest ${longest} ms${
        after.length ? `: ${after.map((t) => `${t.duration}@${t.start}`).join(", ")}` : ""
      })`,
    )
    if (size.errors.length > 0) lines.push(`errors: ${size.errors.join("; ")}`)
  }
  lines.push("")
  return lines.join("\n")
}

/** What the machine is doing, for the ledger: power, low power mode, other agents' browsers. */
export function benchEnv(size: BenchEnv["size"], dpr: number): BenchEnv {
  const run = (cmd: string[]) => {
    try {
      return Bun.spawnSync(cmd).stdout.toString()
    } catch {
      return ""
    }
  }
  const batt = run(["pmset", "-g", "batt"])
  const lpm = run(["pmset", "-g"]).match(/lowpowermode\s+(\d)/)
  const ps = run(["ps", "-axo", "pid,ppid,command"])
  const mine = new Set<number>([process.pid])
  // our own children (a vite server) are not "other browsers"; neither is this process
  const others = ps
    .split("\n")
    .filter((line) => /Chrome for Testing|chromium|chrome-mac-arm64/i.test(line) && !/--type=/.test(line))
    .filter((line) => !mine.has(Number(line.trim().split(/\s+/)[1])))
  return {
    at: new Date().toISOString().slice(0, 16).replace("T", " "),
    git: run(["git", "rev-parse", "--short", "HEAD"]).trim() || "?",
    power: /Battery Power/.test(batt) ? `battery ${batt.match(/(\d+)%/)?.[1] ?? "?"}%` : "AC power",
    lowPowerMode: lpm ? lpm[1] === "1" : null,
    otherBrowsers: others.length,
    uncapped: process.env.GUILDHALL_UNCAPPED === "1",
    size,
    dpr,
    userAgent: "",
  }
}

declare global {
  interface Window {
    guildhall?: import("@guildhall/core").GuildhallDebug
  }
}

/** Turns the orbit `step` degrees every animation frame until `stopTurn()`; runs in the page. */
function startTurn(step: number) {
  const g = window.guildhall
  const w = window as unknown as { __benchTurn?: number }
  const tick = () => {
    const p = g?.camera.get()
    if (p) void g?.camera.set({ ...p, azimuth: p.azimuth + step })
    w.__benchTurn = requestAnimationFrame(tick)
  }
  w.__benchTurn = requestAnimationFrame(tick)
}
function stopTurn() {
  const w = window as unknown as { __benchTurn?: number }
  if (w.__benchTurn !== undefined) cancelAnimationFrame(w.__benchTurn)
  w.__benchTurn = undefined
}
/** Slides the orbit's target `step` metres along the view every frame until `stopTurn()`; runs in the page. */
function startPan(step: number) {
  const g = window.guildhall
  const w = window as unknown as { __benchTurn?: number }
  const tick = () => {
    const p = g?.camera.get()
    if (p) {
      // the rig looks along (-sin az, -cos az): the target walks away from the eye
      const rad = (p.azimuth * Math.PI) / 180
      const [x, y, z] = p.target
      void g?.camera.set({ ...p, target: [x - Math.sin(rad) * step, y, z - Math.cos(rad) * step] })
    }
    w.__benchTurn = requestAnimationFrame(tick)
  }
  w.__benchTurn = requestAnimationFrame(tick)
}

/**
 * Runs the bench; returns the report. The browser holds the GPU lock for the whole run (one batch:
 * `launchChrome` takes it and the lock goes when the browser does).
 */
export async function runBenchReport(args: BenchArgs): Promise<BenchReport> {
  // the GPU's throughput, not the display's rate (chrome.ts caps on battery otherwise)
  process.env.GUILDHALL_UNCAPPED = "1"
  const env = benchEnv(BENCH_DEFAULTS.size, BENCH_DEFAULTS.dpr)
  const report: BenchReport = {
    label: args.label,
    note: args.note,
    env,
    seed: args.seed,
    runs: args.runs,
    sampleMs: args.sampleMs,
    sizes: [],
  }
  {
    const server = await serveStudio(args.port)
    const browser = await launchChrome("bench")
    try {
      for (const files of args.files) {
        const size: SizeResult = {
          files,
          url: "",
          firstFrame: null,
          firstAt: null,
          longTasks: [],
          poses: [],
          variants: [],
          errors: [],
        }
        report.sizes.push(size)
        for (const variant of [null, ...args.variants]) {
          const url = new URL(`/town/${args.seed}`, server.origin)
          url.searchParams.set("files", String(files))
          url.searchParams.set("dpr", String(BENCH_DEFAULTS.dpr))
          if (variant) {
            const [k, v] = variant.split("=") as [string, string]
            url.searchParams.set(k, v)
          } else size.url = url.toString()
          const into: PoseResult[] = variant ? [] : size.poses
          if (variant) size.variants.push({ query: variant, poses: into })
          const opened = await openPage(browser, { size: BENCH_DEFAULTS.size, dpr: BENCH_DEFAULTS.dpr })
          const { page } = opened
          try {
            await page.goto(url.toString())
            await waitReady(page)
            env.userAgent ||= await page.evaluate(() => navigator.userAgent)
            // the build settles: the heroes load, the shaders compile, the long tasks land
            await page.waitForTimeout(1500)
            if (!variant) {
              const build = await page.evaluate(() => {
                const g = window.guildhall
                const b = g?.ext.build as { first?: number; firstAt?: number } | undefined
                return {
                  first: b?.first ?? null,
                  firstAt: b?.firstAt ?? null,
                  longTasks: g?.perf.longTasks?.() ?? [],
                }
              })
              size.firstFrame = build.first
              size.firstAt = build.firstAt
              size.longTasks = build.longTasks
            }
            const hero = await page.evaluate(() => window.guildhall?.camera.get() ?? null)
            if (!hero) throw new Error("no camera")
            for (const pose of benchPoses(hero, args.poses)) {
              await page.evaluate(async (p) => {
                const g = window.guildhall
                if (!g) return
                const clock = g.ext.clock as { set(h: number): void } | undefined
                clock?.set(p.hour)
                if (p.free && g.camera.fly) await g.camera.fly(p.free)
                else if (p.orbit) await g.camera.set(p.orbit)
              }, pose)
              await page.waitForTimeout(BENCH_DEFAULTS.settleMs)
              const result: PoseResult = {
                name: pose.name,
                hour: pose.hour,
                camera: await page.evaluate(() => window.guildhall?.camera.get() ?? null),
                runs: [],
              }
              const sample = async (into: FrameStats[]) => {
                for (let k = 0; k < args.runs; k++) {
                  const stats = await page.evaluate(
                    (ms) => window.guildhall?.perf.sample(ms) ?? null,
                    args.sampleMs,
                  )
                  if (stats) into.push(stats)
                }
              }
              await sample(result.runs)
              into.push(result)
              if (!variant) {
                mkdirSync(resolve(args.out, "shots"), { recursive: true })
                await page.screenshot({
                  path: resolve(args.out, "shots", `${args.label}-${pose.name}-${files}.png`),
                  type: "png",
                })
              }
              if (!variant && pose.orbit && args.turn.includes(pose.name)) {
                const turning: PoseResult = { ...result, name: `${pose.name}-turn`, runs: [] }
                await page.evaluate(startTurn, BENCH_DEFAULTS.turnStep)
                await page.waitForTimeout(BENCH_DEFAULTS.settleMs)
                await sample(turning.runs)
                await page.evaluate(stopTurn)
                into.push(turning)
              }
              if (!variant && pose.orbit && args.pan.includes(pose.name)) {
                const panning: PoseResult = { ...result, name: `${pose.name}-pan`, runs: [] }
                await page.evaluate(startPan, BENCH_DEFAULTS.panStep)
                await page.waitForTimeout(BENCH_DEFAULTS.settleMs)
                await sample(panning.runs)
                await page.evaluate(stopTurn)
                // back where the pose was, for the next one
                await page.evaluate((p) => window.guildhall?.camera.set(p), pose.orbit)
                into.push(panning)
              }
              // back to the orbit before the next pose (a free flight would otherwise stay)
              if (
                pose.free &&
                (await page.evaluate(() => window.guildhall?.camera.mode?.() ?? "orbit")) === "free"
              )
                await page.evaluate(() => window.guildhall?.camera.setMode?.("orbit"))
            }
          } catch (error) {
            size.errors.push(
              `bench${variant ? ` (${variant})` : ""}: ${(error as Error).message.split("\n")[0]}`,
            )
          }
          size.errors.unshift(...opened.errors.filter((e) => !/404/.test(e)))
          await opened.close()
        }
      }
    } finally {
      await browser.close()
      await server.stop()
    }
  }
  return report
}

/** `bun shots bench …`: the exit code (0 ran, 1 a page error, 2 bad usage). */
export async function runBench(argv: readonly string[]): Promise<number> {
  let args: BenchArgs
  try {
    args = parseBenchArgs(argv)
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${BENCH_USAGE}`)
    return 2
  }
  const out = resolve(args.out)
  mkdirSync(out, { recursive: true })
  const report = await runBenchReport(args)
  const md = benchMarkdown(report)
  await Bun.write(join(out, `bench-${args.label}.json`), `${JSON.stringify(report, null, 2)}\n`)
  await Bun.write(join(out, `bench-${args.label}.md`), md)
  if (args.ledger) {
    const ledger = join(out, "ledger.md")
    if (!existsSync(ledger))
      appendFileSync(
        ledger,
        "# Perf track 2 ledger\n\nEvery `bun shots bench` run, newest last. Frame times in ms (p50/p95 of rAF gaps, " +
          "±noise = spread of p95 over the runs); gpu columns are timer-query means per pass; cpu p95 is the main thread's " +
          "work inside the frame.\n\n",
      )
    appendFileSync(ledger, `${md}\n`)
  }
  console.log(md)
  console.log(`written: ${join(out, `bench-${args.label}.json`)}`)
  return report.sizes.some((s) => s.errors.length > 0) ? 1 : 0
}
