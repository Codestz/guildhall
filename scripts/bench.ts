/**
 * The benchmark scoreboard: what the shipped hall costs, scene by scene, as one JSON file per commit.
 *
 *   bun scripts/bench.ts [--scenes party,crowd-100] [--seconds 5] [--rounds 3] [--dpr 2] [--out path]
 *                        [--extra 'tsl=1']   more deep-link params on every scene (an A/B of a flag)
 *
 *   party            the party story at 13:00, clear                     ?story=party&t=0:30&hour=13
 *   rush-night-rain  the rush (12) at 22:00 in the rain                  ?story=rush&t=0:20&hour=22&weather=rain
 *   crowd-50/100/300 the rush with 50, 100, 300 adventurers at 13:00     ?story=rush&n=…&t=0:20&hour=13
 *   water-lab        (only when named) the water lab at 13:00             ?lab=water&hour=13
 *
 * Every scene is paused at its moment (the crowd stays put; idle clips, water, weather still run),
 * the Bard off, the tier pinned to High (guild/quality.ts). Per sample: a fresh page on the
 * production build (VITE_GUILDHALL_PROBE=1, built into .probe/bench/build and served by `vite
 * preview` on a free port — never the dev server's 5199 or the probe server's), WARMUP_S to settle,
 * then --seconds of rAF frame times → fps, p50, p95 (ms); draw calls and triangles per frame from
 * the Stats panel's numbers (guild/stats.ts frameStats, `worldEvents.stats`: renderer.info read
 * after the composer has drawn the whole frame), as medians; JS heap growth over the window in MB/s
 * (CDP Runtime.getHeapUsage: performance.memory only moves in coarse steps). Rounds interleave the scenes
 * round-robin so drift (thermals, background load) spreads evenly; the board keeps each scene's
 * median across rounds.
 *
 * Same Chrome and flags as shot.ts (Metal, uncapped: real headroom against the 120 fps budget),
 * Math.random seeded so the island's dressing is the same every load. The JSON lands in
 * .probe/bench/<git-short-sha>.json (with `dirty` when the tree had changes) unless --out says.
 */
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { type Browser, chromium } from "playwright-core"
import { acquireGpu } from "./gpulock.ts"
import { CAPPED, CHROME, CHROME_ARGS, PROBE_DIR, ROOT, VIEWPORT } from "./steps.ts"

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** Shared by every scene: paused at its moment, Bard off (the camera holds), High pinned. */
const BASE = "paused=1&bard=0&quality=2"
const SCENES: Record<string, string> = {
  party: "story=party&t=0:30&hour=13&weather=clear",
  "rush-night-rain": "story=rush&t=0:20&hour=22&weather=rain",
  "crowd-50": "story=rush&n=50&t=0:20&hour=13&weather=clear",
  "crowd-100": "story=rush&n=100&t=0:20&hour=13&weather=clear",
  "crowd-300": "story=rush&n=300&t=0:20&hour=13&weather=clear",
}
/**
 * Labs (lab/labs.ts), benched only when named in --scenes: a lab is ready when it says so
 * (`window.lab.ready`), not when the hall's island has mounted.
 */
const LABS: Record<string, string> = {
  "water-lab": "lab=water&hour=13&weather=clear",
}
const KNOWN = { ...SCENES, ...LABS }

const names = (arg("scenes") ?? Object.keys(SCENES).join(",")).split(",").filter(Boolean)
const unknown = names.filter((name) => !(name in KNOWN))
if (unknown.length) fail(`unknown scene ${unknown.join(", ")}; known: ${Object.keys(KNOWN).join(", ")}`)
const SECONDS = Number(arg("seconds") ?? 5)
const ROUNDS = Number(arg("rounds") ?? 3)
const DPR = Number(arg("dpr") ?? 2)
const EXTRA = arg("extra")
if (!(SECONDS > 0) || !(ROUNDS >= 1) || !(DPR > 0)) fail("--seconds, --rounds and --dpr must be positive")
/** After the world mounts: the seek's re-cast, the weather settling, shaders compiled. */
const WARMUP_S = 4
const MIN_MESHES = 60
const MOUNT_TIMEOUT_MS = 60_000
const SEED = 0x5a6a
const BENCH = `${PROBE_DIR}/bench`
const BUILD = `${BENCH}/build`
const HALL = `${ROOT}packages/hall`

interface Sample {
  fps: number
  /** Frame time, ms. */
  p50: number
  p95: number
  calls: number
  triangles: number
  /** JS heap growth over the measured window, MB/s (negative when a GC ran). */
  heapMBps: number
  errors: string[]
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function git(...args: string[]): string {
  return new TextDecoder().decode(Bun.spawnSync(["git", ...args], { cwd: ROOT }).stdout).trim()
}

async function build(): Promise<void> {
  const proc = Bun.spawn(["bunx", "vite", "build", "--outDir", BUILD, "--emptyOutDir"], {
    cwd: HALL,
    env: { ...process.env, VITE_GUILDHALL_PROBE: "1" },
    stdout: "ignore",
    stderr: "pipe",
  })
  if ((await proc.exited) !== 0) fail(`vite build failed:\n${await new Response(proc.stderr).text()}`)
}

/** `vite preview` of the build on a free port (as scripts/record.ts serves it); `stop()` ends it. */
async function serve(): Promise<{ url: string; stop: () => void }> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = probe.port
  probe.stop(true)
  const proc = Bun.spawn(
    [
      "bunx",
      "vite",
      "preview",
      "--outDir",
      BUILD,
      "--port",
      String(port),
      "--strictPort",
      "--host",
      "127.0.0.1",
    ],
    { cwd: HALL, stdout: "ignore", stderr: "ignore" },
  )
  const url = `http://127.0.0.1:${port}/`
  for (let tries = 0; tries < 100; tries++) {
    if (
      await fetch(url).then(
        (r) => r.ok,
        () => false,
      )
    )
      return { url, stop: () => proc.kill() }
    await Bun.sleep(100)
  }
  proc.kill()
  return fail("vite preview did not start")
}

/** One scene on a fresh page: mount, warm up, measure. */
async function measure(browser: Browser, url: string): Promise<Sample> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR })
  // The same random island dressing every load (mulberry32, as scripts/probe-server.ts seeds it).
  await context.addInitScript((seed: number) => {
    let s = seed >>> 0
    Math.random = () => {
      s = (s + 0x6d2b79f5) >>> 0
      let t = s
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }, SEED)
  const page = await context.newPage()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text().slice(0, 300)}`)
  })
  try {
    await page.goto(url)
    if (/[?&]lab=/.test(url))
      await page.waitForFunction(
        () => (window as { lab?: { ready?: boolean } }).lab?.ready === true,
        undefined,
        {
          timeout: MOUNT_TIMEOUT_MS,
          polling: 250,
        },
      )
    // Mounted: the island's meshes are there and the world released the store's hold (probe-server.ts).
    else
      await page.waitForFunction(
        (min: number) => {
          const w = window as unknown as {
            r3f?: { scene: { traverse(f: (o: { isMesh?: boolean }) => void): void } }
            guild?: { held: boolean }
          }
          if (!w.r3f?.scene || w.guild?.held !== false) return false
          if ((document.documentElement.dataset.boot ?? "revealed") !== "revealed") return false
          let meshes = 0
          w.r3f.scene.traverse((o) => {
            if (o.isMesh) meshes++
          })
          return meshes >= min
        },
        MIN_MESHES,
        { timeout: MOUNT_TIMEOUT_MS, polling: 250 },
      )
    await page.waitForTimeout(WARMUP_S * 1000)
    const cdp = await context.newCDPSession(page)
    const heap = async () => ((await cdp.send("Runtime.getHeapUsage")) as { usedSize: number }).usedSize
    const heap0 = await heap()
    const { elapsed, ...sample } = await page.evaluate(
      (secs: number) =>
        new Promise<Omit<Sample, "errors" | "heapMBps"> & { elapsed: number }>((resolve) => {
          const w = window as unknown as {
            worldEvents?: { stats: { calls: number; triangles: number } }
            natureStats?: () => { calls: number; triangles: number }
          }
          const stats = () => w.worldEvents?.stats ?? w.natureStats?.() ?? { calls: 0, triangles: 0 }
          const times: number[] = []
          const calls: number[] = []
          const triangles: number[] = []
          const t0 = performance.now()
          let last = t0
          const frame = () => {
            const now = performance.now()
            times.push(now - last)
            last = now
            // Last frame's totals: FrameStats writes them after the composer, every frame.
            const s = stats()
            calls.push(s.calls)
            triangles.push(s.triangles)
            if (now - t0 < secs * 1000) {
              requestAnimationFrame(frame)
              return
            }
            const elapsed = (now - t0) / 1000
            const at = (list: number[], q: number) => {
              const sorted = [...list].sort((a, b) => a - b)
              return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? Number.NaN
            }
            resolve({
              fps: times.length / elapsed,
              p50: at(times, 0.5),
              p95: at(times, 0.95),
              calls: at(calls, 0.5),
              triangles: at(triangles, 0.5),
              elapsed,
            })
          }
          requestAnimationFrame(frame)
        }),
      SECONDS,
    )
    const grown = (await heap()) - heap0
    return { ...sample, heapMBps: grown / 1024 / 1024 / elapsed, errors }
  } finally {
    await context.close()
  }
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (!sorted.length) return Number.NaN
  return sorted.length % 2 ? (sorted[mid] ?? Number.NaN) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

const sha = git("rev-parse", "--short", "HEAD")
const dirty = git("status", "--porcelain").length > 0
const out = arg("out") ?? `${BENCH}/${sha}.json`

await acquireGpu("bench")
console.log(`building (VITE_GUILDHALL_PROBE=1) → ${BUILD}`)
if (CAPPED)
  console.log(
    "on battery: capped at 60 fps — readings show whether a scene holds 60, not headroom (GUILDHALL_UNCAPPED=1 to override)",
  )
await build()
const server = await serve()
const browser = await chromium.launch({
  executablePath: CHROME,
  args: CHROME_ARGS,
})
const samples: Record<string, Sample[]> = Object.fromEntries(names.map((name) => [name, []]))
try {
  for (let round = 0; round < ROUNDS; round++)
    for (const name of names) {
      const sample = await measure(browser, `${server.url}?${BASE}&${KNOWN[name]}${EXTRA ? `&${EXTRA}` : ""}`)
      samples[name]?.push(sample)
      console.log(
        `  round ${round + 1}/${ROUNDS} ${name.padEnd(16)} ${sample.fps.toFixed(0)} fps  p95 ${sample.p95.toFixed(2)} ms` +
          (sample.errors.length ? `  (${sample.errors.length} errors)` : ""),
      )
    }
} finally {
  await browser.close()
  server.stop()
}

const round2 = (n: number) => Math.round(n * 100) / 100
const scenes = Object.fromEntries(
  names.map((name) => {
    const rs = samples[name] ?? []
    return [
      name,
      {
        link: `?${BASE}&${KNOWN[name]}`,
        fps: round2(median(rs.map((r) => r.fps))),
        p50: round2(median(rs.map((r) => r.p50))),
        p95: round2(median(rs.map((r) => r.p95))),
        calls: Math.round(median(rs.map((r) => r.calls))),
        triangles: Math.round(median(rs.map((r) => r.triangles))),
        heapMBps: round2(median(rs.map((r) => r.heapMBps))),
        errors: [...new Set(rs.flatMap((r) => r.errors))],
        rounds: rs.map(({ errors: _, ...r }) => ({
          ...r,
          fps: round2(r.fps),
          p50: round2(r.p50),
          p95: round2(r.p95),
          heapMBps: round2(r.heapMBps),
        })),
      },
    ]
  }),
)
const board = {
  sha,
  dirty,
  ...(EXTRA ? { extra: EXTRA } : {}),
  date: new Date().toISOString(),
  config: { seconds: SECONDS, rounds: ROUNDS, warmup: WARMUP_S, dpr: DPR, viewport: VIEWPORT, tier: "High" },
  scenes,
}
await mkdir(dirname(out), { recursive: true })
await Bun.write(out, `${JSON.stringify(board, null, 2)}\n`)

console.log(
  `\n${sha}${dirty ? " (dirty)" : ""}  ${SECONDS}s × ${ROUNDS} round${ROUNDS > 1 ? "s" : ""}, DPR ${DPR}, High\n`,
)
console.log(
  `${"scene".padEnd(16)} ${"fps".padStart(6)} ${"p50".padStart(7)} ${"p95".padStart(7)} ${"calls".padStart(6)} ${"tris".padStart(9)} ${"heap MB/s".padStart(10)}`,
)
for (const [name, s] of Object.entries(scenes))
  console.log(
    `${name.padEnd(16)} ${s.fps.toFixed(0).padStart(6)} ${s.p50.toFixed(2).padStart(7)} ${s.p95.toFixed(2).padStart(7)} ${String(s.calls).padStart(6)} ${s.triangles.toLocaleString("en-US").padStart(9)} ${s.heapMBps.toFixed(2).padStart(10)}` +
      (s.errors.length ? `  ${s.errors.length} page errors` : ""),
  )
console.log(`\n→ ${out}`)
