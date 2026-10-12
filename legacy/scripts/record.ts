/**
 * Films The Saga (packages/sim/src/saga.ts), the showcase's story, frame by frame: deterministic,
 * smooth video whatever the machine's speed.
 *
 *   bun scripts/record.ts --cut full|highlight|loop|social [--from mm:ss --to mm:ss] [--quality 2|3]
 *
 *   full       the whole film, 1920×1080 H.264 at 30 fps (~17 min)  .probe/film/saga-full.mp4
 *              with --from/--to: just that stretch                   .probe/film/saga-full-0100-0105.mp4
 *   highlight  ~70 s by chapter: act title cards, short crossfades   .probe/film/saga-highlight.mp4
 *              and a 9 Mbps copy with a silent track, for posting   .probe/film/saga-highlight-social.mp4
 *   loop       ~10 s seamless loop for the README, 1200 px wide      .github/media/saga-loop.webp (+ .mp4)
 *   social     ~25 s, 1080×1080 square crop                          .probe/film/saga-social.mp4
 *
 * Times are film time: the full film's clock, from the opening's reveal. Every cut plays the story
 * from its start (the only way to land on a frame exactly as the full film has it) and films only
 * its shots, each anchored to a beat as it happens: an act's start, a world event's, the first quest
 * sent. Between shots nothing is captured, so a cut costs the story's simulation plus its own
 * seconds. --from/--to pick the stretch for full, loop and social (highlight has its shot list).
 * --quality: 3 Ultra (default), 2 High. Each output's frame hashes go to a .json beside it.
 *
 * How it stays frame-exact: the production build (VITE_GUILDHALL_PROBE=1, VITE_GUILDHALL_SHOWCASE=1,
 * built into .probe/film/build) is served by `vite preview` on a free port and opened in your
 * installed Chrome with Playwright's fake clock, paused. Each frame advances that clock by 1/30 s
 * (timers, performance.now, Date: captions, world events, the opening, sound cues), then draws one
 * frame on the render loop's probe bridge (`r3f.step`, frameloop "never"), so the story clock, the
 * fast-forward and the director move on the same stepped time. Page CSS animations are paused and
 * set to the same clock, Math.random is seeded, shader compiles are synchronous, and the clock never
 * moves while a download is in flight. Two runs give the same story frame for frame; the GPU may
 * still differ by a level in a pixel or two at an edge (Metal's rasterisation, not the clock).
 *
 * No audio track: the hall's sound is off until a viewer turns it on, and real-time Web Audio can't
 * be captured frame-exactly (it would need an OfflineAudioContext render of the cues).
 *
 * Needs ffmpeg (with libx264), and img2webp for the loop: `brew install ffmpeg webp`.
 */
import { createHash } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import { type Browser, chromium, type Page } from "playwright-core"
import { acquireGpu } from "./gpulock.ts"
import { CHROME } from "./steps.ts"

type Cut = "full" | "highlight" | "loop" | "social"

const ROOT = new URL("..", import.meta.url).pathname
const FILM = `${ROOT}.probe/film`
const BUILD = `${FILM}/build`
const MEDIA = `${ROOT}.github/media`
const FPS = 30
const WIDTH = 1920
const HEIGHT = 1080
/** The page's clock starts here (a fixed date: Date.now() is the same every run). */
const EPOCH = Date.UTC(2026, 0, 1, 6, 0, 0)
const SEED = 0x5a6a
/** The longest the title card may hold before the reveal: past this the world failed to load. */
const WARM_MAX_S = 90
/** Crossfade between shots, seconds. */
const FADE_S = 0.5
/** The README loop: its length, the crossfade that joins its end to its start, its size and rate. */
const LOOP = { length: 10, blend: 1, width: 1200, fps: 15, maxBytes: 6e6 }
/** A shot of the highlight, the act whose title card goes before it. */
type Planned = Omit<Segment, "out" | "crf"> & { act: string }

/** The highlight's shot list, by chapter: each shot anchored to its beat, seconds after it. */
const SHOT_LIST: Planned[] = [
  { name: "dawn dispatch: the first quest is sent", act: "I", anchor: "first-quest", offset: 0, length: 10 },
  { name: "the forge: many hands at work", act: "II", anchor: { act: "II" }, offset: 6, length: 10 },
  { name: "the dragon over the peaks", act: "III", anchor: { show: "dragon" }, offset: 3, length: 11 },
  { name: "the ghost ship", act: "III", anchor: { show: "ghost-ship" }, offset: 7, length: 9 },
  { name: "the rainbow", act: "IV", anchor: { show: "rainbow" }, offset: 3, length: 7 },
  { name: "the festival's fireworks", act: "V", anchor: { show: "festival" }, offset: 4, length: 14 },
]
/** H.264 for every output: high quality, BT.709 tagged, plays everywhere, starts streaming at once. */
const H264 = [
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-pix_fmt",
  "yuv420p",
  "-colorspace",
  "bt709",
  "-color_primaries",
  "bt709",
  "-color_trc",
  "bt709",
  "-movflags",
  "+faststart",
]
const TO_709 = "scale=out_color_matrix=bt709:out_range=tv"
/** In-flight requests: the clock waits for them (a lazy event chunk, a font, a model). */
const network = { inflight: 0, seen: 0, settled: -1 }

// ── the command line ──

const args = parseArgs(process.argv.slice(2))
const missing = ["ffmpeg", ...(args.cut === "loop" ? ["img2webp"] : [])].filter((tool) => !Bun.which(tool))
if (missing.length > 0) {
  console.error(`record: ${missing.join(" and ")} not found. Install with: brew install ffmpeg webp`)
  process.exit(1)
}
await acquireGpu(`record ${args.cut}`)
await mkdir(FILM, { recursive: true })
if (args.cut === "full") await full(args)
else if (args.cut === "highlight") await highlight(args.quality)
else if (args.cut === "loop") await loop(args)
else await social(args)

interface Args {
  cut: Cut
  from?: number
  to?: number
  quality: 2 | 3
}

function parseArgs(argv: string[]): Args {
  const value = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const cut = (value("--cut") ?? "full") as Cut
  if (!["full", "highlight", "loop", "social"].includes(cut)) fail(`--cut must be full|highlight|loop|social`)
  const quality = Number(value("--quality") ?? 3)
  if (quality !== 2 && quality !== 3) fail("--quality must be 2 (High) or 3 (Ultra)")
  const from = value("--from")
  const to = value("--to")
  const out: Args = { cut, quality }
  if (from !== undefined) out.from = seconds(from)
  if (to !== undefined) out.to = seconds(to)
  if (out.from !== undefined && out.to !== undefined && out.to <= out.from) fail("--to must be after --from")
  return out
}

/** `mm:ss` (or `ss`, decimals allowed) in seconds. */
function seconds(text: string): number {
  const parts = text.split(":").map(Number)
  const total = parts.reduce((sum, part) => sum * 60 + part, 0)
  if (parts.some((part) => !Number.isFinite(part)) || total < 0) fail(`not a time: ${text} (mm:ss)`)
  return total
}

function fail(message: string): never {
  console.error(`record: ${message}`)
  process.exit(1)
}

// ── one pass through the story ──

/** Where a shot is anchored: the film's start, an act's start, a world event's start, the first quest sent. */
type Anchor = "start" | "first-quest" | { act: string } | { show: string }

interface Segment {
  /** Why it's here (the shot list). */
  name: string
  anchor: Anchor
  /** Seconds after the anchor; and how long (Infinity: to the story's end). */
  offset: number
  length: number
  /** The MP4 written, and its x264 CRF. */
  out: string
  crf: number
}

interface Filmed {
  /** The Saga's acts, for title cards. */
  chapters: { numeral: string; title: string; tagline: string }[]
  /** Film second each segment started at, and its length as filmed. */
  shots: { name: string; out: string; start: number; length: number }[]
}

interface FrameState {
  story: number
  ff: number
  chapter: string
  shows: string
  stage: string
}

/** The page's store, as much of it as the recorder reads (window.guild under PROBE). */
interface GuildProbe {
  time: number
  fastForward: number
  chapter?: { numeral: string }
  chapters: { numeral: string; title: string; tagline: string; at: number }[]
  markers: { at: number; kind: string }[]
}

/**
 * Plays the story once from the reveal, filming each segment as its anchor comes round. Stops when
 * every segment is filmed (or the story ends: an open-ended one closes there; one never reached fails).
 */
async function shoot(quality: 2 | 3, segments: Segment[]): Promise<Filmed> {
  await build()
  const server = await serve()
  const browser = await launch()
  try {
    const page = await open(browser, server.url, quality)
    const step = stepper(page)
    // The title card holds while the world loads and compiles; the film starts with the reveal.
    let warm = 0
    for (let state = await step(); state.stage !== "reveal"; state = await step()) {
      if (++warm > WARM_MAX_S * FPS) throw new Error(`the world never loaded (opening: ${state.stage})`)
    }
    const facts = await page.evaluate(() => {
      const guild = (window as unknown as { guild: GuildProbe }).guild
      return {
        chapters: guild.chapters.map(({ numeral, title, tagline }) => ({ numeral, title, tagline })),
        quest: guild.markers.find((marker) => marker.kind === "quest")?.at ?? Number.POSITIVE_INFINITY,
      }
    })
    console.error(`record: world up after ${(warm / FPS).toFixed(1)} s (stepped); playing the story`)

    const cdp = await page.context().newCDPSession(page)
    /** Film second each anchor came round. */
    const anchors = new Map<string, number>([["start", 0]])
    const live = segments.map((segment) => ({
      segment,
      start: Number.NaN,
      frames: 0,
      hashes: [] as string[],
      encoder: undefined as ReturnType<typeof spawnEncoder> | undefined,
      closed: false,
    }))
    const started = performance.now()
    let state = await snapshot(page)
    let ended = false
    for (let i = 0; ; i++) {
      const t = i / FPS
      if (state.chapter && !anchors.has(`act:${state.chapter}`)) anchors.set(`act:${state.chapter}`, t)
      for (const kind of state.shows.split(","))
        if (kind && !anchors.has(`show:${kind}`)) anchors.set(`show:${kind}`, t)
      if (state.story >= facts.quest && !anchors.has("first-quest")) anchors.set("first-quest", t)

      let png: Buffer | undefined
      for (const shot of live) {
        const at = anchors.get(keyOf(shot.segment.anchor))
        if (Number.isNaN(shot.start) && at !== undefined) shot.start = at + shot.segment.offset
        const end = shot.start + shot.segment.length
        if (!(t >= shot.start && t < end) || shot.frames >= Math.round(shot.segment.length * FPS)) continue
        if (!png) {
          await page.evaluate(() => (window as unknown as { __film: { sync: () => void } }).__film.sync())
          const { data } = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true })
          png = Buffer.from(data, "base64")
        }
        shot.encoder ??= spawnEncoder(shot.segment.out, ["-crf", String(shot.segment.crf)])
        shot.hashes.push(createHash("sha1").update(png).digest("hex").slice(0, 16))
        shot.encoder.stdin.write(png)
        await shot.encoder.stdin.flush()
        shot.frames++
      }
      for (const shot of live) if (shot.frames >= Math.round(shot.segment.length * FPS)) await close(shot)
      if (live.every((shot) => shot.frames >= Math.round(shot.segment.length * FPS))) break
      if (i > 0 && i % (FPS * 30) === 0) progress(i, state, started)
      const next = await step()
      // The Player loops: back at the start means the story is over.
      if (next.story < state.story - 1000) {
        ended = true
        break
      }
      state = next
    }
    for (const shot of live) {
      if (ended && shot.segment.length === Number.POSITIVE_INFINITY && shot.frames > 0) await close(shot)
      else if (!shot.encoder || shot.frames < Math.round(shot.segment.length * FPS))
        throw new Error(`the story ended before "${shot.segment.name}" was filmed`)
      await Bun.write(
        shot.segment.out.replace(/\.mp4$/, ".json"),
        JSON.stringify({
          fps: FPS,
          quality,
          seed: SEED,
          name: shot.segment.name,
          start: shot.start,
          hashes: shot.hashes,
        }),
      )
      console.error(`record: ${shot.segment.out} (${clock(shot.start)}, ${shot.frames} frames)`)
    }
    return {
      chapters: facts.chapters,
      shots: live.map((shot) => ({
        name: shot.segment.name,
        out: shot.segment.out,
        start: shot.start,
        length: shot.frames / FPS,
      })),
    }
  } finally {
    await browser.close()
    server.stop()
  }
}

/** Ends a segment's encoding (once). */
async function close(shot: { encoder?: ReturnType<typeof spawnEncoder>; closed?: boolean }): Promise<void> {
  if (!shot.encoder || shot.closed) return
  shot.closed = true
  shot.encoder.stdin.end()
  if ((await shot.encoder.exited) !== 0) throw new Error("ffmpeg failed encoding a shot")
}

function keyOf(anchor: Anchor): string {
  if (typeof anchor === "string") return anchor
  return "act" in anchor ? `act:${anchor.act}` : `show:${anchor.show}`
}

function progress(i: number, state: FrameState, started: number): void {
  const rate = (i / (performance.now() - started)) * 1000
  console.error(
    `  film ${clock(i / FPS)}  story ${clock(state.story / 1000)}  act ${state.chapter || "-"}  ` +
      `${state.ff.toFixed(1)}×  ${state.shows || ""}  (${rate.toFixed(1)} frames/s)`,
  )
}

// ── the build, the server, the browser ──

async function build(): Promise<void> {
  const proc = Bun.spawn(["bunx", "vite", "build", "--outDir", BUILD, "--emptyOutDir"], {
    cwd: `${ROOT}packages/hall`,
    env: { ...process.env, VITE_GUILDHALL_PROBE: "1", VITE_GUILDHALL_SHOWCASE: "1" },
    stdout: "ignore",
    stderr: "pipe",
  })
  if ((await proc.exited) !== 0) fail(`vite build failed:\n${await new Response(proc.stderr).text()}`)
}

/** `vite preview` of the build on a free port; `stop()` ends it. */
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
    { cwd: `${ROOT}packages/hall`, stdout: "ignore", stderr: "ignore" },
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

async function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: CHROME, args: ["--use-angle=metal", "--enable-gpu"] })
}

/** The hall in a fresh context: pinned quality, HUD hidden but for captions, paused fake clock. */
async function open(browser: Browser, url: string, quality: 2 | 3): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
  })
  await context.addInitScript(prepare, { quality, seed: SEED })
  await context.clock.install({ time: EPOCH })
  await context.clock.pauseAt(EPOCH + 1000)
  const page = await context.newPage()
  page.on("pageerror", (error) => console.error(`  page error: ${error.message}`))
  watchNetwork(page)
  await page.goto(url)
  // Every face the captions and cards use, before the first frame: no fallback-font frames.
  await page.evaluate(async () => {
    await Promise.all(
      [
        '30px "Marcellus SC"',
        '17px "Alegreya Sans"',
        'italic 17px "Alegreya Sans"',
        '600 17px "Alegreya Sans"',
      ].map((font) => document.fonts.load(font)),
    )
  })
  return page
}

/**
 * Runs in the page before its own scripts (an init script: nothing here ships). The viewer's choices
 * the film wants, a seeded Math.random, synchronous shader compiles (three's compileAsync then
 * resolves on the stepped clock, not the GPU's), the showcase's "about" chip, the Show-HUD button and the fast-forward chip
 * hidden, and `__film.sync()`: every CSS animation paused and set to the page's (stepped) clock.
 */
function prepare({ quality, seed }: { quality: number; seed: number }): void {
  localStorage.setItem("guildhall.quality", String(quality))
  localStorage.setItem(
    "guildhall.hud",
    JSON.stringify({ mode: "hidden", stats: false, sigils: true, captions: true }),
  )
  let s = seed >>> 0
  Math.random = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (const gl of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype]) {
    const getExtension = gl.getExtension as (this: WebGLRenderingContext, name: string) => unknown
    Object.defineProperty(gl, "getExtension", {
      value(this: WebGLRenderingContext, name: string) {
        return name === "KHR_parallel_shader_compile" ? null : getExtension.call(this, name)
      },
    })
  }
  addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style")
    style.textContent = ".opening-caption, .show-hud, .ffwd { display: none !important; }"
    document.head.append(style)
  })
  const born = new WeakMap<Animation, number>()
  Object.assign(window, {
    __film: {
      sync(): void {
        const now = performance.now()
        for (const animation of document.getAnimations()) {
          let at = born.get(animation)
          if (at === undefined) {
            at = now
            born.set(animation, at)
          }
          animation.pause()
          animation.currentTime = now - at
        }
      },
    },
  })
}

function watchNetwork(page: Page): void {
  page.on("request", () => {
    network.inflight++
    network.seen++
  })
  const done = () => {
    network.inflight = Math.max(0, network.inflight - 1)
  }
  page.on("requestfinished", done)
  page.on("requestfailed", done)
}

/** Returns once nothing is downloading and nothing new has started for a moment. */
async function quiet(): Promise<void> {
  for (;;) {
    if (network.inflight > 0) {
      await Bun.sleep(20)
      continue
    }
    if (network.seen === network.settled) return
    network.settled = network.seen
    await Bun.sleep(200)
  }
}

/**
 * One frame: wait out downloads, move the page's clock 1/30 s (whole ms, 33/33/34), draw the frame
 * at exactly that step, let React commit what the timers set, set the CSS animations to the clock.
 */
function stepper(page: Page): () => Promise<FrameState> {
  let frame = 0
  return async () => {
    await quiet()
    const ms = Math.round(((frame + 1) * 1000) / FPS) - Math.round((frame * 1000) / FPS)
    frame++
    await page.clock.runFor(ms)
    await page.evaluate(async (dt) => {
      const w = window as unknown as {
        r3f?: { setFrameloop: (mode: string) => void; step: (dt: number) => void }
        __stepping?: boolean
        __film: { sync: () => void }
      }
      if (w.r3f) {
        if (!w.__stepping) {
          w.r3f.setFrameloop("never")
          w.__stepping = true
        }
        w.r3f.step(dt)
      }
      // React commits on message-channel tasks: let them run before anything is read or shot.
      for (let i = 0; i < 8; i++)
        await new Promise((resolve) => {
          const channel = new MessageChannel()
          channel.port1.onmessage = resolve
          channel.port2.postMessage(0)
        })
      w.__film.sync()
    }, ms / 1000)
    return snapshot(page)
  }
}

async function snapshot(page: Page): Promise<FrameState> {
  return page.evaluate(() => {
    const w = window as unknown as { guild?: GuildProbe; worldEvents?: { shows: { kind: string }[] } }
    return {
      story: Math.round(w.guild?.time ?? 0),
      ff: w.guild?.fastForward ?? 1,
      chapter: w.guild?.chapter?.numeral ?? "",
      shows: (w.worldEvents?.shows ?? []).map((show) => show.kind).join(","),
      stage: document.querySelector("[data-opening]")?.getAttribute("data-opening") ?? "",
    }
  })
}

function spawnEncoder(out: string, quality: string[]) {
  return Bun.spawn(
    [
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "image2pipe",
      "-framerate",
      String(FPS),
      "-c:v",
      "png",
      "-i",
      "-",
      "-vf",
      TO_709,
      ...H264,
      ...quality,
      out,
    ],
    { stdin: "pipe", stdout: "inherit", stderr: "inherit" },
  )
}

// ── the cuts ──

/** The whole film, or the stretch --from/--to of it. */
async function full(args: Args): Promise<void> {
  const from = args.from ?? 0
  const to = args.to ?? Number.POSITIVE_INFINITY
  const stem =
    from === 0 && to === Number.POSITIVE_INFINITY ? "saga-full" : `saga-full-${stamp(from)}-${stamp(to)}`
  await shoot(args.quality, [
    {
      name: "the film",
      anchor: "start",
      offset: from,
      length: to - from,
      out: `${FILM}/${stem}.mp4`,
      crf: 16,
    },
  ])
}

async function highlight(quality: 2 | 3): Promise<void> {
  const dir = `${FILM}/shots`
  await mkdir(dir, { recursive: true })
  const filmed = await shoot(
    quality,
    SHOT_LIST.map((shot, i) => ({ ...shot, out: `${dir}/highlight-${i + 1}.mp4`, crf: 14 })),
  )
  const acts = [...new Set(SHOT_LIST.map((shot) => shot.act))]
  const cards = await titleCards(filmed.chapters.filter((c) => acts.includes(c.numeral)))
  const parts: Part[] = []
  let act = ""
  filmed.shots.forEach((shot, i) => {
    const planned = SHOT_LIST[i] as Planned
    if (planned.act !== act) {
      act = planned.act
      parts.push({ card: cards.get(act) as string, length: 2.6 })
    }
    parts.push({ file: shot.out, length: shot.length })
  })
  console.error("record: highlight shot list (film time)")
  for (const [i, shot] of filmed.shots.entries())
    console.error(`  ${clock(shot.start)}  ${shot.length}s  act ${SHOT_LIST[i]?.act}  ${shot.name}`)
  await montage(parts, `${FILM}/saga-highlight.mp4`, { width: WIDTH, height: HEIGHT })
  await socialEncode(`${FILM}/saga-highlight.mp4`, `${FILM}/saga-highlight-social.mp4`)
}

/**
 * The same cut for posting (LinkedIn, X): H.264 High at ~9 Mbps (well under their 100 MB caps), a
 * silent AAC track (some players and uploaders want one), faststart.
 */
async function socialEncode(source: string, out: string): Promise<void> {
  await ffmpeg([
    ...[
      "-i",
      source,
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-shortest",
    ],
    ...H264,
    ...[
      "-profile:v",
      "high",
      "-level",
      "4.2",
      "-r",
      String(FPS),
      "-b:v",
      "9M",
      "-maxrate",
      "10M",
      "-bufsize",
      "18M",
    ],
    ...["-c:a", "aac", "-b:a", "128k", out],
  ])
  console.error(`record: ${out} (${(Bun.file(out).size / 1e6).toFixed(1)} MB)`)
}

/** The social clip: dragon, ghost ship, fireworks, square. --from/--to: one stretch instead. */
async function social(args: Args): Promise<void> {
  const dir = `${FILM}/shots`
  await mkdir(dir, { recursive: true })
  const planned: Omit<Segment, "out" | "crf">[] =
    args.from !== undefined && args.to !== undefined
      ? [{ name: "the stretch asked for", anchor: "start", offset: args.from, length: args.to - args.from }]
      : [
          { name: "the dragon", anchor: { show: "dragon" }, offset: 4, length: 8.5 },
          { name: "the ghost ship", anchor: { show: "ghost-ship" }, offset: 8, length: 7.5 },
          { name: "the fireworks", anchor: { show: "festival" }, offset: 5, length: 10 },
        ]
  const filmed = await shoot(
    args.quality,
    planned.map((shot, i) => ({ ...shot, out: `${dir}/social-${i + 1}.mp4`, crf: 14 })),
  )
  const parts = filmed.shots.map((shot) => ({ file: shot.out, length: shot.length }))
  await montage(parts, `${FILM}/saga-social.mp4`, { width: 1080, height: 1080, square: true })
}

/**
 * The README loop: a seamless stretch of the night festival's fireworks (or --from/--to). One more
 * second is filmed than is shown: that tail crossfades over the head, so the end flows into the start.
 */
async function loop(args: Args): Promise<void> {
  const length = args.from !== undefined && args.to !== undefined ? args.to - args.from : LOOP.length
  const { blend, width, fps } = LOOP
  const source = `${FILM}/shots/loop-source.mp4`
  await mkdir(`${FILM}/shots`, { recursive: true })
  const filmed = await shoot(args.quality, [
    {
      name: "the README loop",
      ...(args.from !== undefined
        ? { anchor: "start" as const, offset: args.from }
        : { anchor: { show: "festival" }, offset: 5 }),
      length: length + blend,
      out: source,
      crf: 12,
    },
  ])
  const graph =
    `[0:v]split=3[a][b][c];` +
    `[a]trim=start=${length}:end=${length + blend},setpts=PTS-STARTPTS[tail];` +
    `[b]trim=end=${blend},setpts=PTS-STARTPTS[head];` +
    `[c]trim=start=${blend}:end=${length},setpts=PTS-STARTPTS[mid];` +
    `[tail][head]xfade=transition=fade:duration=${blend}:offset=0[x];` +
    `[x][mid]concat=n=2:v=1,fps=${fps},scale=${width}:-2:flags=lanczos`
  await ffmpeg([
    "-i",
    source,
    "-filter_complex",
    `${graph},${TO_709}`,
    ...H264,
    "-crf",
    "20",
    `${MEDIA}/saga-loop.mp4`,
  ])

  const frames = `${FILM}/loop-frames`
  await rm(frames, { recursive: true, force: true })
  await mkdir(frames, { recursive: true })
  await ffmpeg(["-i", source, "-filter_complex", graph, `${frames}/%04d.png`])
  const pngs = [...new Bun.Glob("*.png").scanSync(frames)].sort().map((name) => `${frames}/${name}`)
  const out = `${MEDIA}/saga-loop.webp`
  // The README budget: step the quality down until it fits.
  for (const q of [60, 52, 44, 36]) {
    const proc = Bun.spawn(
      [
        "img2webp",
        "-loop",
        "0",
        "-lossy",
        "-q",
        String(q),
        "-m",
        "4",
        "-d",
        String(Math.round(1000 / fps)),
        ...pngs,
        "-o",
        out,
      ],
      { stdout: "ignore", stderr: "pipe" },
    )
    if ((await proc.exited) !== 0) fail(`img2webp failed:\n${await new Response(proc.stderr).text()}`)
    const size = Bun.file(out).size
    console.error(`record: ${out} at q${q}: ${(size / 1e6).toFixed(2)} MB`)
    if (size <= LOOP.maxBytes) break
  }
  await rm(frames, { recursive: true, force: true })
  const at = filmed.shots[0]?.start ?? 0
  console.error(`record: loop is film ${clock(at)}–${clock(at + length)}`)
}

/** A filmed shot (its whole file), or a still title card held for `length`. */
type Part = { file: string; length: number } | { card: string; length: number }

/** Cuts shots (and cards) together with crossfades, fading in from and out to black. */
async function montage(
  parts: Part[],
  out: string,
  frame: { width: number; height: number; square?: boolean },
): Promise<void> {
  const inputs: string[] = []
  const chains: string[] = []
  parts.forEach((part, i) => {
    if ("card" in part)
      inputs.push("-loop", "1", "-framerate", String(FPS), "-t", String(part.length), "-i", part.card)
    else inputs.push("-i", part.file)
    const crop = frame.square ? "crop=ih:ih:(iw-ih)/2:0," : ""
    chains.push(
      `[${i}:v]${crop}fps=${FPS},scale=${frame.width}:${frame.height}:flags=lanczos,` +
        `${TO_709},format=yuv420p,setsar=1,settb=AVTB[v${i}]`,
    )
  })
  let last = "v0"
  let offset = 0
  parts.slice(1).forEach((_, k) => {
    offset += (parts[k] as Part).length - FADE_S
    chains.push(
      `[${last}][v${k + 1}]xfade=transition=fade:duration=${FADE_S}:offset=${offset.toFixed(3)}[x${k + 1}]`,
    )
    last = `x${k + 1}`
  })
  const total = parts.reduce((sum, part) => sum + part.length, 0) - FADE_S * (parts.length - 1)
  chains.push(`[${last}]fade=t=in:st=0:d=0.6,fade=t=out:st=${(total - 0.8).toFixed(3)}:d=0.8[out]`)
  await ffmpeg([...inputs, "-filter_complex", chains.join(";"), "-map", "[out]", ...H264, "-crf", "17", out])
  console.error(`record: ${out} (${clock(total)})`)
}

/** Act title cards (act, title, tagline), drawn by Chrome in the hall's own type and colours. */
async function titleCards(
  chapters: { numeral: string; title: string; tagline: string }[],
): Promise<Map<string, string>> {
  const browser = await launch()
  const cards = new Map<string, string>()
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })
    for (const chapter of chapters) {
      await page.setContent(cardHtml(chapter), { waitUntil: "networkidle" })
      await page.evaluate(() => document.fonts.ready)
      const path = `${FILM}/shots/card-${chapter.numeral}.png`
      await page.screenshot({ path })
      cards.set(chapter.numeral, path)
    }
  } finally {
    await browser.close()
  }
  return cards
}

function cardHtml(chapter: { numeral: string; title: string; tagline: string }): string {
  const html = (text: string) => text.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Marcellus+SC&family=Alegreya+Sans:ital@1&display=block" rel="stylesheet">
<style>
  html, body { margin: 0; height: 100%; }
  body { display: grid; place-items: center; background: radial-gradient(ellipse at 50% 45%, #2a1e14 0%, #0e0a07 70%); }
  main { display: grid; justify-items: center; gap: 18px; color: #f3e9d4; }
  small { font: 30px "Marcellus SC", Georgia, serif; letter-spacing: 0.32em; color: #dcb662; }
  h1 { margin: 0; font: 112px/1 "Marcellus SC", Georgia, serif; letter-spacing: 0.04em; color: #f1d590;
       text-shadow: 0 0 60px rgba(241, 213, 144, 0.25); }
  hr { width: 220px; border: 0; border-top: 1px solid rgba(241, 213, 144, 0.5); margin: 6px 0; }
  em { font: italic 40px "Alegreya Sans", sans-serif; opacity: 0.88; }
</style></head><body><main>
  <small>ACT ${html(chapter.numeral)}</small><h1>${html(chapter.title)}</h1><hr><em>${html(chapter.tagline)}</em>
</main></body></html>`
}

async function ffmpeg(rest: string[]): Promise<void> {
  const proc = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...rest], {
    stdout: "inherit",
    stderr: "inherit",
  })
  if ((await proc.exited) !== 0) fail(`ffmpeg failed: ffmpeg ${rest.join(" ")}`)
}

/** Seconds as m:ss. */
function clock(s: number): string {
  const whole = Math.max(0, Math.floor(s))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

/** Seconds as mmss, for file names. */
function stamp(s: number): string {
  return clock(s).replace(":", "").padStart(4, "0")
}
