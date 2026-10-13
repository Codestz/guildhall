/**
 * Names the main thread's long tasks (perf2-contract §2: none over 100 ms after the first frame):
 *
 *   PORT=5311 bun tools/shots/trace.ts "http://localhost:5311/town/1?files=12000&dpr=1.5" .probe/perf2/trace-12k [MIN=50]
 *
 * Records a Chrome trace with the V8 sampling profiler from navigation until the page is ready plus a
 * settle, then prints every top-level task on the page's main thread longer than MIN ms (default 50)
 * with where its time went: the functions on top of the stack (self time) and the frames that held the
 * most of it (inclusive), plus the trace's own events inside it (script evaluation, compiles, GC).
 * Writes `<out>.json` (the raw trace, for the DevTools Performance panel) and `<out>.md` (the summary).
 * A localhost URL nobody answers gets the studio dev server started on its port (and stopped after).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { openPage, waitReady } from "./src/app.ts"
import { launchChrome } from "./src/chrome.ts"
import { serveStudio } from "./src/server.ts"

const [url, out, minArg] = process.argv.slice(2)
if (!url || !out) {
  console.error("usage: bun tools/shots/trace.ts <url> <out> [MIN ms]")
  process.exit(2)
}
const MIN_MS = Number(minArg ?? process.env.MIN ?? 50)
const SETTLE_MS = Number(process.env.SETTLE ?? 2500)
const SIZE = { width: 1440, height: 860 }
const DPR = 1.5

interface TraceEvent {
  name: string
  cat: string
  ph: string
  ts: number
  dur?: number
  pid: number
  tid: number
  args?: Record<string, unknown>
  id?: string
}
interface CallFrame {
  functionName: string
  url: string
  lineNumber: number
  columnNumber: number
}
interface ProfileNode {
  id: number
  callFrame: CallFrame
  parent?: number
}
interface Profile {
  startTime: number
  nodes: Map<number, ProfileNode>
  /** Sample timestamps (µs, trace clock) and the node each was on. */
  samples: { t: number; node: number }[]
}

/** A saved `<out>.json` in place of the url: summarised again without a browser. */
const saved = url.endsWith(".json") ? url : null
const target = new URL(saved ? "http://localhost" : url)
const server =
  !saved && (target.hostname === "localhost" || target.hostname === "127.0.0.1")
    ? await serveStudio(Number(target.port || 80))
    : null
const browser = saved ? null : await launchChrome("trace")
let json = saved ? readFileSync(saved, "utf8") : ""
/** The page's own log (ms from its time origin, one line each), read beside the tasks. */
let pageLog: { t: number; line: string }[] = []
if (browser)
  try {
    const opened = await openPage(browser, { size: SIZE, dpr: DPR })
    const { page } = opened
    await browser.startTracing(page, {
      categories: [
        "toplevel",
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-v8.cpu_profiler",
        "v8.execute",
        "blink.user_timing",
        "disabled-by-default-devtools.timeline.stack",
      ],
    })
    await page.goto(url)
    await waitReady(page)
    await page.waitForTimeout(SETTLE_MS)
    // what the page itself saw, to cross-check the trace's tasks, and its log (the stage names the
    // programs each frame built, the builders say when they finished), to read beside them
    const seen = await page.evaluate(() => ({
      longTasks: window.guildhall?.perf.longTasks?.() ?? [],
      build: window.guildhall?.ext.build as { first?: number; firstAt?: number } | undefined,
      log: (window.guildhall?.log.records({ level: "info" }) ?? []).map((r) => ({
        t: Math.round(r.t),
        line: `${r.channel} ${r.msg}${r.data === undefined ? "" : ` ${JSON.stringify(r.data)}`}`,
      })),
    }))
    json = (await browser.stopTracing()).toString()
    pageLog = seen.log
    if (opened.errors.length) console.error(opened.errors.join("\n"))
    console.error(
      `page: first frame ${seen.build?.first ?? "?"} ms, long tasks ${seen.longTasks.length}` +
        (seen.longTasks.length
          ? `: ${seen.longTasks.map((t) => `${t.duration}@${t.start}`).join(", ")}`
          : ""),
    )
    await opened.close()
  } finally {
    await browser.close()
    await server?.stop()
  }

const events = (JSON.parse(json) as { traceEvents: TraceEvent[] }).traceEvents
const path = resolve(out)
mkdirSync(dirname(path), { recursive: true })
if (!saved) writeFileSync(`${path}.json`, json)

// ---- the page's main thread: the renderer whose main thread ran the most tasks ----
const mains = events.filter(
  (e) => e.name === "thread_name" && (e.args as { name?: string })?.name === "CrRendererMain",
)
const tasksOf = (pid: number, tid: number) =>
  events.filter((e) => e.pid === pid && e.tid === tid && e.ph === "X" && e.name === "RunTask")
let main = mains[0]
let mainTasks: TraceEvent[] = []
for (const m of mains) {
  const tasks = tasksOf(m.pid, m.tid)
  if (tasks.length > mainTasks.length) {
    main = m
    mainTasks = tasks
  }
}
if (!main) {
  console.error("no renderer main thread in the trace")
  process.exit(1)
}
const { pid, tid } = main
const onMain = events.filter((e) => e.pid === pid && e.tid === tid)

// ---- the sampling profile of that thread: the `Profile` lands on it, its chunks on the profiler's own thread ----
const profiles = new Map<string, Profile>()
for (const e of onMain) {
  if (e.name !== "Profile") continue
  const data = e.args?.data as { startTime: number } | undefined
  if (!data) continue
  profiles.set(e.id ?? "", { startTime: data.startTime, nodes: new Map(), samples: [] })
}
for (const e of events) {
  if (e.name !== "ProfileChunk" || e.pid !== pid) continue
  const profile = profiles.get(e.id ?? "")
  const data = e.args?.data as
    | { cpuProfile?: { nodes?: ProfileNode[]; samples?: number[] }; timeDeltas?: number[] }
    | undefined
  if (!profile || !data) continue
  for (const n of data.cpuProfile?.nodes ?? []) profile.nodes.set(n.id, n)
  const samples = data.cpuProfile?.samples ?? []
  const deltas = data.timeDeltas ?? []
  let t = profile.samples.at(-1)?.t ?? profile.startTime
  for (let i = 0; i < samples.length; i++) {
    t += deltas[i] ?? 0
    profile.samples.push({ t, node: samples[i] as number })
  }
}
const profile = [...profiles.values()].sort((a, b) => b.samples.length - a.samples.length)[0]

const navStart = onMain.find((e) => e.name === "navigationStart")?.ts ?? Math.min(...onMain.map((e) => e.ts))
const msFromNav = (ts: number) => Math.round((ts - navStart) / 1000)

const frameName = (f: CallFrame) => {
  const file = f.url ? f.url.replace(/^.*\/(?=[^/]+$)/, "").replace(/\?.*$/, "") : ""
  const where = file ? ` ${file}:${f.lineNumber + 1}` : ""
  return `${f.functionName || "(anonymous)"}${where}`
}

interface Named {
  name: string
  ms: number
}
const top = (m: Map<string, number>, n: number, perSample: number): Named[] =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, ms: count * perSample }))

/** Self and inclusive time by function for the samples inside [from, to]. */
function attribute(from: number, to: number) {
  const self = new Map<string, number>()
  const inclusive = new Map<string, number>()
  let count = 0
  if (!profile) return { self, inclusive, count, perSample: 0 }
  // sample spacing (ms): the profiler's interval, from the samples themselves
  const inWindow = profile.samples.filter((s) => s.t >= from && s.t <= to)
  count = inWindow.length
  const span = inWindow.length > 1 ? (inWindow.at(-1)!.t - inWindow[0]!.t) / 1000 / (inWindow.length - 1) : 1
  for (const s of inWindow) {
    const leaf = profile.nodes.get(s.node)
    if (!leaf) continue
    const leafName = frameName(leaf.callFrame)
    self.set(leafName, (self.get(leafName) ?? 0) + 1)
    const seen = new Set<string>()
    for (
      let n: ProfileNode | undefined = leaf;
      n;
      n = n.parent === undefined ? undefined : profile.nodes.get(n.parent)
    ) {
      const name = frameName(n.callFrame)
      if (name.startsWith("(root)") || seen.has(name)) continue
      seen.add(name)
      inclusive.set(name, (inclusive.get(name) ?? 0) + 1)
    }
  }
  return { self, inclusive, count, perSample: span }
}

/** The trace's own events inside a task (compiles, script runs, GC, layout…), the longest first. */
function inside(task: TraceEvent, n: number): Named[] {
  const from = task.ts
  const to = task.ts + (task.dur ?? 0)
  const by = new Map<string, number>()
  for (const e of onMain) {
    if (e.ph !== "X" || e === task || !e.dur || e.ts < from || e.ts + e.dur > to + 1) continue
    if (e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask") continue
    const data = e.args?.data as { functionName?: string; url?: string; type?: string } | undefined
    const detail = data?.functionName ? ` ${data.functionName}` : data?.type ? ` ${data.type}` : ""
    const key = `${e.name}${detail}`
    by.set(key, (by.get(key) ?? 0) + e.dur / 1000)
  }
  return [...by.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, ms]) => ({ name, ms }))
}

const f1 = (v: number) => v.toFixed(1)
const list = (items: Named[]) => items.map((i) => `    ${f1(i.ms).padStart(7)} ms  ${i.name}`).join("\n")

const long = mainTasks.filter((t) => (t.dur ?? 0) / 1000 >= MIN_MS).sort((a, b) => a.ts - b.ts)
const lines: string[] = []
lines.push(`# trace: ${url}`)
lines.push(
  `main thread pid ${pid} tid ${tid}: ${mainTasks.length} tasks, ${long.length} of ${MIN_MS} ms or more; ` +
    `profile samples ${profile?.samples.length ?? 0}`,
)
lines.push("")
for (const task of long) {
  const ms = (task.dur ?? 0) / 1000
  const { self, inclusive, count, perSample } = attribute(task.ts, task.ts + (task.dur ?? 0))
  lines.push(`## ${Math.round(ms)} ms at ${msFromNav(task.ts)} ms from navigation (${count} samples)`)
  lines.push("  self (top of stack):")
  lines.push(list(top(self, 10, perSample)))
  lines.push("  inclusive (anywhere on the stack):")
  lines.push(list(top(inclusive, 14, perSample).filter((i) => !/^\((program|idle)\)/.test(i.name))))
  const nested = inside(task, 8)
  if (nested.length) {
    lines.push("  trace events inside:")
    lines.push(list(nested))
  }
  // the page's log from just before the task to its end (its clock and the trace's share a base)
  const from = msFromNav(task.ts) - 150
  const to = msFromNav(task.ts) + ms
  const logged = pageLog.filter((l) => l.t >= from && l.t <= to)
  if (logged.length) {
    lines.push("  page log around it:")
    for (const l of logged) lines.push(`    ${String(l.t).padStart(7)} ms  ${l.line.slice(0, 160)}`)
  }
  lines.push("")
}
const md = lines.join("\n")
writeFileSync(`${path}.md`, `${md}\n`)
console.log(md)
console.log(`written: ${path}.json, ${path}.md`)
