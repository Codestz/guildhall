import type { Entry, Session } from "@guildhall/core"
import type { Renown } from "./events.ts"
import type { Moment } from "./moments.ts"

/**
 * The story (roadmap S3): what the moments *mean*, in words. Two tellers, both pure.
 *
 *   Narrator   live captions, one line at a time. It hears only live moments (a seek, a loop or a
 *              live hello never makes one), gathers a burst into one beat, lets important beats
 *              (a fall, a plea, the quest complete, a rise) go before routine deeds, and keeps a
 *              gap between lines so they can be read. The words come from a small phrase grammar;
 *              which variant is chosen depends only on the beat itself, so a replay tells the same
 *              story in the same words.
 *
 *   legendOf   (guild/legends.ts) the session's book, from the same words.
 *
 * No LLM, no React, no three: the HUD draws both (hud/Captions.tsx, hud/Legends.tsx).
 */

// ─────────────────────────────── words ───────────────────────────────

const NUMBERS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
]

/** `three`, `twenty`: a storyteller spells small numbers out. */
export function spell(n: number): string {
  return NUMBERS[n] ?? String(n)
}

/** `Three`. */
/** `The Explorer` → `the Explorer`, for a line that now follows a lead-in; `API` stays `API`. */
export function uncapital(text: string): string {
  const [first = "", second = ""] = text
  return second && second === second.toUpperCase() && /\p{L}/u.test(second)
    ? text
    : first.toLowerCase() + text.slice(1)
}

export function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** `a`, `a and b`, `a, b and c`. */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ""
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
}

/** The first line of a text, whitespace folded. */
export function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? ""
  return line.replace(/\s+/g, " ").trim()
}

/** Cut at a word boundary, with an ellipsis, so a quote never ends mid-word. */
export function clip(text: string, max: number): string {
  const line = firstLine(text)
  if (line.length <= max) return line
  const cut = line.slice(0, max - 1)
  const space = cut.lastIndexOf(" ")
  const base = space > max * 0.6 ? cut.slice(0, space) : cut
  return `${base.replace(/[\s,;:.—-]+$/, "")}…`
}

/** A quotation in curly quotes, clipped. */
export function quote(text: string, max = 64): string {
  return `“${clip(text, max)}”`
}

/** End a sentence once: no full stop after one that already ends. */
function sentence(text: string): string {
  const t = text.trim()
  return /[.!?…]["”’)]?$/.test(t) ? t : `${t}.`
}

/** FNV-1a: a stable 32-bit hash, so a beat picks the same words every time it is told. */
export function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function pick<T>(items: readonly T[], seed: number): T {
  const item = items[seed % items.length]
  if (item === undefined) throw new Error("pick from nothing")
  return item
}

// ─────────────────────────────── crafts ───────────────────────────────

/** What kind of work a tool is, in the story's words. */
export type Craft = "read" | "search" | "forge" | "test" | "run" | "consult" | "plan" | "quest" | "other"

const CRAFT_OF: Record<string, Craft> = {
  read: "read",
  grep: "search",
  glob: "search",
  list: "search",
  ls: "search",
  codesearch: "search",
  edit: "forge",
  write: "forge",
  patch: "forge",
  multiedit: "forge",
  apply_patch: "forge",
  bash: "run",
  shell: "run",
  webfetch: "consult",
  websearch: "consult",
  todowrite: "plan",
  todoread: "plan",
  task: "quest",
  subagent: "quest",
}

const TESTS = /\b(test|tests|vitest|jest|pytest|spec|check)\b/i

/** A tool's craft; a shell command that runs tests is a trial, an MCP tool (`a_b`) a consultation. */
export function craftOf(tool: string, input: Record<string, unknown> = {}): Craft {
  const craft = CRAFT_OF[tool] ?? (tool.includes("_") ? "consult" : "other")
  if (craft === "run" && typeof input.command === "string" && TESTS.test(input.command)) return "test"
  return craft
}

/** Longest a deed's target or summary runs in a caption (review-2 #19: they had no cap). */
export const TARGET_MAX = 48

/** The thing a deed worked on, short: a file's name, a pattern, a command, a site. */
export function targetOf(input: Record<string, unknown> = {}): string | undefined {
  if (typeof input.filePath === "string" && input.filePath) return clip(basename(input.filePath), TARGET_MAX)
  if (typeof input.pattern === "string") return clip(input.pattern, TARGET_MAX)
  if (typeof input.command === "string") return clip(input.command, 36)
  if (typeof input.url === "string") {
    try {
      const url = new URL(input.url)
      return clip(url.pathname.split("/").filter(Boolean).at(-1) ?? url.hostname, TARGET_MAX)
    } catch {
      return clip(input.url, 36)
    }
  }
  if (typeof input.query === "string") return clip(input.query, 36)
  if (typeof input.path === "string" && input.path) return clip(basename(input.path), TARGET_MAX)
  return undefined
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path
}

/** Legend nouns: `2 reads`, `3 edits`, `1 test run`. */
export const NOUNS: Record<Craft, [string, string]> = {
  read: ["read", "reads"],
  search: ["search", "searches"],
  forge: ["edit", "edits"],
  test: ["test run", "test runs"],
  run: ["command", "commands"],
  consult: ["consultation", "consultations"],
  plan: ["plan", "plans"],
  quest: ["quest sent", "quests sent"],
  other: ["other deed", "other deeds"],
}

/** Caption nouns for a burst across the guild: `three files forged`. */
const BURST: Record<Craft, [string, string]> = {
  read: ["file read", "files read"],
  search: ["search made", "searches made"],
  forge: ["file forged", "files forged"],
  test: ["trial run", "trials run"],
  run: ["command run", "commands run"],
  consult: ["scroll consulted", "scrolls consulted"],
  plan: ["plan drawn", "plans drawn"],
  quest: ["quest sent", "quests sent"],
  other: ["deed done", "deeds done"],
}

/** What a crowd was mostly doing: `22 deeds, mostly consulting the archives`. */
const MOSTLY: Record<Craft, string> = {
  read: "reading",
  search: "searching the code",
  forge: "forging",
  test: "testing",
  run: "running commands",
  consult: "consulting the archives",
  plan: "planning",
  quest: "sending quests",
  other: "odd jobs",
}

export const CRAFT_ORDER: Craft[] = [
  "forge",
  "test",
  "run",
  "read",
  "search",
  "consult",
  "plan",
  "quest",
  "other",
]

/** Doing it, for a plea: `running bun run migrate`. */
function doing(craft: Craft, target: string | undefined): string {
  const on = target ? ` ${target}` : ""
  switch (craft) {
    case "read":
      return `reading${on}`
    case "search":
      return target ? `searching for ${target}` : "searching"
    case "forge":
      return target ? `changing ${target}` : "changing the code"
    case "test":
      return "running the tests"
    case "run":
      return target ? `running ${target}` : "running a command"
    case "consult":
      return "reaching beyond the hall"
    case "plan":
      return "rewriting the plan"
    case "quest":
      return "sending a quest"
    default:
      return "going on"
  }
}

// ─────────────────────────────── telling a moment ───────────────────────────────

/** What the teller can look up: the session behind an actor, as it stands now. */
export interface Lookup {
  session(id: string): Session | undefined
  /** How the hall named an adventurer last, when it has heard of them. */
  actor?(id: string): Pick<Moment, "title" | "color"> | undefined
  /** A party on the island by its guildmaster's id: its short name and banner (guild/parties.ts). */
  party?(master: string): { name: string; color: string } | undefined
  /** How many parties are on the island: captions name the party only when there are several. */
  parties?(): number
  /** The party being followed (its guildmaster's id), or null for all: captions tell only its story. */
  following?(): string | null
}

type ToolEntry = Extract<Entry, { kind: "tool" }>

export function toolEntry(session: Session | undefined, call: string): ToolEntry | undefined {
  const entry = session?.entries.find((e) => e.kind === "tool" && e.call === call)
  return entry?.kind === "tool" ? entry : undefined
}

/** The last thing a session said back, finished. */
export function lastReply(entries: readonly Entry[]): string | undefined {
  const reply = entries.findLast((e) => e.kind === "reply" && e.done && e.text.trim() !== "")
  return reply?.kind === "reply" ? reply.text : undefined
}

/** `3 failed` → 3. */
export function failing(text: string | undefined): number | undefined {
  const match = text?.match(/(\d+)\s+(failed|failing|failures?)/i)
  return match?.[1] ? Number(match[1]) : undefined
}

/** An error's first line, without the `Error:` noise. */
export function errorLine(text: string | undefined, max = 60): string | undefined {
  if (!text) return undefined
  const line = firstLine(text).replace(/^(error|err|fatal)\s*:\s*/i, "")
  return line ? clip(line, max) : undefined
}

// ─────────────────────────────── beats ───────────────────────────────

/** A caption's kind of beat, highest priority first. */
export type BeatKind =
  | "chapter"
  | "renown"
  | "complete"
  | "fall"
  | "plea"
  | "rise"
  | "flaw"
  | "quest"
  | "loot"
  | "answered"
  | "join"
  | "deed"
  | "sea"

/** Which beat a moment belongs to; `leave` makes no caption (the tavern and gate already say it). */
export function beatOf(m: Moment): BeatKind | undefined {
  switch (m.kind) {
    case "loot":
      return m.parent ? "loot" : "complete"
    case "fail":
      return "fall"
    case "plea":
      return "plea"
    case "recover":
      return "rise"
    case "deed-failed":
      return "flaw"
    case "quest":
      return "quest"
    case "plea-answered":
      return "answered"
    case "join":
      return "join"
    case "deed":
      return m.tool === "task" || m.tool === "subagent" ? undefined : "deed"
    // The GitHub sea: a merge, red CI, a recovery, a release. A push sails quietly.
    case "sea-merged":
    case "sea-red":
    case "sea-green":
    case "sea-release":
      return "sea"
    default:
      return undefined
  }
}

/** Important beats go first; routine ones wait for a quiet moment and go stale sooner. */
export const PRIORITY: Record<BeatKind, number> = {
  /** A chapter's title card between a told story's acts (the Saga's): the story's own voice. */
  chapter: 8,
  /** A secret world event (guild/events.ts): rare, so it goes before everything. */
  renown: 7,
  complete: 6,
  fall: 5,
  plea: 5,
  rise: 4,
  /** Something happened on GitHub (guild/moments.ts sea moments): news from outside the hall. */
  sea: 4,
  flaw: 3,
  quest: 3,
  loot: 2,
  answered: 1,
  join: 1,
  deed: 0,
}

/** One line of a caption: plain text, or an adventurer's name in their colour. */
export type CaptionPart = { text: string; color?: string }

export interface Caption {
  /** Grows by one per caption: a key for the strip's fade. */
  key: number
  kind: BeatKind
  priority: number
  /** The whole line, for a screen reader and for tests. */
  text: string
  parts: CaptionPart[]
  /** How long to show it, ms: longer lines and bigger beats stay longer. */
  hold: number
  /** Sessions it is about. */
  ids: string[]
}

/**
 * Builds a line with names in it. A name is written as a marker into the template's text and
 * expanded to a part, so templates stay plain strings and the first word is capitalised once.
 */
class Line {
  private names: { text: string; color: string }[] = []

  who(m: Pick<Moment, "title" | "color">): string {
    this.names.push({ text: `the ${m.title}`, color: m.color })
    return `\u0000${this.names.length - 1}\u0000`
  }

  /** `the Explorer and the Architect`, or `the Explorer, the Architect and two others`. */
  whoAll(actors: readonly Pick<Moment, "title" | "color">[]): string {
    if (actors.length <= 3) return listOf(actors.map((a) => this.who(a)))
    const rest = actors.length - 2
    return `${this.who(actors[0] as Moment)}, ${this.who(actors[1] as Moment)} and ${spell(rest)} others`
  }

  parts(template: string): CaptionPart[] {
    const out: CaptionPart[] = []
    const pieces = sentence(template).split("\u0000")
    pieces.forEach((piece, i) => {
      if (i % 2 === 0) {
        if (piece) out.push({ text: piece })
        return
      }
      const name = this.names[Number(piece)]
      if (name) out.push({ text: name.text, color: name.color })
    })
    const head = out[0]
    if (head) out[0] = { ...head, text: capital(head.text) }
    return out
  }
}

/** Unique actors, in the order they first appear. */
function actorsOf(moments: readonly Moment[]): Moment[] {
  const seen = new Map<string, Moment>()
  for (const m of moments) if (!seen.has(m.id)) seen.set(m.id, m)
  return [...seen.values()]
}

/** What one deed was, looked up in its session. */
interface Deed {
  craft: Craft
  target?: string
  summary?: string
  error?: string
  size?: number
}

function deedOf(m: Moment, lookup: Lookup): Deed {
  const call = "call" in m ? m.call : ""
  const tool = "tool" in m ? m.tool : "tool"
  const entry = toolEntry(lookup.session(m.id), call)
  const input = entry?.input ?? {}
  const target = targetOf(input)
  const error = m.kind === "deed-failed" ? (m.error ?? entry?.error) : undefined
  const summary = entry?.summary ? clip(entry.summary, 60) : undefined
  const size = m.kind === "deed" ? m.size : undefined
  return {
    craft: craftOf(tool, input),
    ...(target ? { target } : {}),
    ...(summary ? { summary } : {}),
    ...(error ? { error } : {}),
    ...(size !== undefined ? { size } : {}),
  }
}

/** A verb phrase for one adventurer's deeds of one craft: `reads routes.ts and queries.ts`. */
function deedPhrase(craft: Craft, deeds: readonly Deed[], seed: number): string {
  const targets = [...new Set(deeds.flatMap((d) => (d.target ? [d.target] : [])))]
  const named = targets.length > 0 && targets.length <= 2 ? listOf(targets) : undefined
  const n = deeds.length
  const summary = deeds.at(-1)?.summary
  const tail = summary ? ` — ${summary}` : ""
  switch (craft) {
    case "read":
      return named ? `${pick(["reads", "pores over", "studies"], seed)} ${named}` : `reads ${spell(n)} files`
    case "search":
      return named
        ? `${pick(["searches the code for", "hunts through the code for", "scours the code for"], seed)} ${named}${tail}`
        : `searches the code ${spell(n)} times${tail}`
    case "forge": {
      const lines = deeds.reduce((sum, d) => sum + (d.size ?? 0), 0)
      const weight = lines > 0 && n === 1 ? `, ${lines} ${lines === 1 ? "line" : "lines"}` : ""
      return named
        ? `${pick(["reworks", "sets hammer to", "reshapes", "forges"], seed)} ${named}${weight}`
        : `forges ${spell(n)} files`
    }
    case "test":
      return summary
        ? pick([`puts the work to the test${tail}`, `runs the tests${tail}`, `tries the work${tail}`], seed)
        : pick(["puts the work to the test", "runs the tests"], seed)
    case "run":
      return named ? `runs ${named}${tail}` : `runs ${spell(n)} commands${tail}`
    case "consult":
      return named
        ? `${pick(["consults distant scrolls on", "sends for word on", "asks the archives about"], seed)} ${named}`
        : pick(["consults distant scrolls", "asks the archives", "sends for word from afar"], seed)
    case "plan":
      return pick(["sets out the plan", "pins the plan to the board", "draws up the plan"], seed)
    default:
      return n === 1 ? "finishes a deed" : `finishes ${spell(n)} deeds`
  }
}

/** Deeds across the guild, counted: `three files forged, two read`. */
function burst(deeds: readonly Deed[]): string {
  const counts = new Map<Craft, number>()
  for (const d of deeds) counts.set(d.craft, (counts.get(d.craft) ?? 0) + 1)
  if (counts.size > 2) {
    // A crowd: the count and the craft most of them were, not an inventory.
    const [top] = [...counts].sort(
      (a, b) => b[1] - a[1] || CRAFT_ORDER.indexOf(a[0]) - CRAFT_ORDER.indexOf(b[0]),
    )
    return `${spell(deeds.length)} deeds, mostly ${top ? MOSTLY[top[0]] : "odd jobs"}`
  }
  const parts = CRAFT_ORDER.flatMap((craft) => {
    const n = counts.get(craft)
    if (!n) return []
    const [one, many] = BURST[craft]
    return [`${spell(n)} ${n === 1 ? one : many}`]
  })
  return listOf(parts)
}

/** A quest as an errand: `to map how GET /users flows` when it reads as an order, else quoted. */
const ORDERS = new Set(
  (
    "add map design check verify re-verify fix find write build implement review test refactor explore " +
    "research plan update remove migrate document investigate sweep retry run create make read look scan " +
    "audit port rename clean improve wire trace measure debug profile polish draft prepare ship deploy " +
    "analyse analyze compare summarize summarise list search gather collect learn study draw sketch outline " +
    "split merge move replace delete upgrade install configure set"
  ).split(" "),
)

function errand(text: string): string | undefined {
  const line = clip(text, 64)
  const [word = ""] = line.split(" ")
  if (!/^[A-Z][a-z-]+$/.test(word) || !ORDERS.has(word.toLowerCase())) return undefined
  return `to ${word.toLowerCase()}${line.slice(word.length)}`
}

/** Who a quest went to: a resumed session by its `task_id`, else the child it made, else a join. */
function recipientOf(q: Moment, lookup: Lookup, joins: readonly Moment[]): Session | Moment | undefined {
  if (q.kind !== "quest") return undefined
  const input = toolEntry(lookup.session(q.id), q.call)?.input ?? {}
  const resumed = typeof input.task_id === "string" ? lookup.session(input.task_id) : undefined
  if (resumed) return resumed
  const mine = joins.filter((j) => j.parent === q.id)
  return mine.find((j) => sameQuest(lookup.session(j.id)?.task, q.text)) ?? mine[0]
}

/** A child's task is the quest it was sent on (OpenCode 2 prefixes a preamble core strips). */
export function sameQuest(task: string | undefined, text: string): boolean {
  return task !== undefined && task.trim() === text.trim()
}

// ─────────────────────────────── lines ───────────────────────────────

/** One caption from a beat's moments. `extra` are deeds a bigger beat absorbed as a lead-in clause. */
export function lineOf(
  kind: BeatKind,
  moments: readonly Moment[],
  lookup: Lookup,
  extra: readonly Moment[] = [],
): CaptionPart[] {
  const first = moments[0] as Moment
  const seed = hash(moments.map((m) => `${m.kind}|${m.title}|${m.at}|${"call" in m ? m.call : ""}`).join(";"))
  const line = new Line()
  const actors = actorsOf(moments)
  const many = actors.length > 1

  switch (kind) {
    case "complete": {
      const reply = lastReply(lookup.session(first.id)?.entries ?? [])
      if (!reply) return line.parts(pick(["The quest is complete", "And so the quest is done"], seed))
      return line.parts(
        pick(
          [
            `The quest is complete: ${quote(reply, 72)}`,
            `And so it is done: ${quote(reply, 72)}`,
            `The quest is complete. ${capital(line.who(first))} has the last word: ${quote(reply, 60)}`,
          ],
          seed,
        ),
      )
    }

    case "fall": {
      // A failure settles what the fallen launched: name the first, count the rest.
      const own = moments.filter((m) => m.kind === "fail" && !/cancel/i.test(m.error ?? ""))
      const lead = own[0] ?? first
      const below = actors.length - (own.length || 1)
      const error = errorLine(lead.kind === "fail" ? lead.error : undefined)
      if (!lead.parent)
        return line.parts(
          error
            ? `${line.who(lead)} falls: ${quote(error)}. The quest is lost`
            : `${line.who(lead)} falls, and the quest with them`,
        )
      if (own.length > 1)
        return line.parts(
          pick(
            [
              `${line.whoAll(own)} fall — and the graveyard stirs`,
              `${capital(spell(own.length))} fall at once; the graveyard stirs`,
            ],
            seed,
          ),
        )
      const others = below > 0 ? `, and ${spell(below)} below with them,` : ""
      return line.parts(
        error
          ? pick(
              [
                `${line.who(lead)} falls${others} — ${quote(error)} — and rises in the graveyard`,
                `${line.who(lead)} gives up the quest: ${quote(error)}. The graveyard stirs`,
                `${line.who(lead)} falls${others} and rises in the graveyard: ${quote(error)}`,
              ],
              seed,
            )
          : pick(
              [
                `${line.who(lead)} falls${others} — and rises in the graveyard`,
                `${line.who(lead)} falls; a skeleton claws out of the graveyard`,
              ],
              seed,
            ),
      )
    }

    case "plea": {
      if (many) return line.parts(`${line.whoAll(actors)} await your word`)
      const session = lookup.session(first.id)
      const asking = session?.entries.findLast(
        (e) => e.kind === "tool" && (e.state === "running" || e.state === "pending"),
      )
      if (asking?.kind === "tool" && asking.name !== "task" && asking.name !== "subagent") {
        const act = doing(craftOf(asking.name, asking.input), targetOf(asking.input))
        return line.parts(
          pick(
            [
              `${line.who(first)} asks for your word before ${act}`,
              `${line.who(first)} will not go on ${act} without your word`,
              `${line.who(first)} awaits your word before ${act}`,
            ],
            seed,
          ),
        )
      }
      return line.parts(
        pick(
          [
            `${line.who(first)} asks for your word before going on`,
            `${line.who(first)} stops and awaits your word`,
            `${line.who(first)} will go no further without your word`,
          ],
          seed,
        ),
      )
    }

    case "rise":
      if (many) return line.parts(`${line.whoAll(actors)} rise again and take up the work`)
      return line.parts(
        pick(
          [
            `${line.who(first)} rises again and takes up the work`,
            `Called back, ${line.who(first)} is on their feet again; the skeleton sinks into the earth`,
            `${line.who(first)} is back on their feet, and back to work`,
          ],
          seed,
        ),
      )

    case "flaw": {
      const deeds = moments.map((m) => deedOf(m, lookup))
      const lead = deeds[0] as Deed
      const n = failing(lead.error) ?? failing(lead.summary)
      // Deeds that went with it lead in, when there are enough to matter: "Three files forged; …".
      const before = extra.length > 1 ? `${capital(burst(extra.map((m) => deedOf(m, lookup))))}; ` : ""
      if (many)
        return line.parts(
          `${before}${capital(spell(moments.length))} deeds fail — ${line.whoAll(actors)}${
            lead.error ? `: ${quote(errorLine(lead.error) ?? "", 48)}` : ""
          }`,
        )
      const who = line.who(first)
      if (lead.craft === "test" || n !== undefined) {
        const count = n !== undefined ? `${spell(n)} failing` : "failures"
        return line.parts(
          before +
            pick(
              [
                `${who} finds ${count}`,
                `${who} runs the tests — ${count}`,
                `the tests turn on ${who}: ${count}`,
              ],
              seed,
            ),
        )
      }
      const what = lead.target ?? ("tool" in first ? first.tool : "the deed")
      const err = errorLine(lead.error)
      return line.parts(
        before +
          (err
            ? pick(
                [
                  `${who}'s ${what} fails: ${quote(err, 52)}`,
                  `${what} breaks in ${who}'s hands: ${quote(err, 52)}`,
                ],
                seed,
              )
            : `${who}'s ${what} fails`),
      )
    }

    case "quest": {
      const quests = moments.filter((m) => m.kind === "quest")
      const joins = moments.filter((m) => m.kind === "join")
      const sender = quests[0] ?? first
      if (quests.length === 0) return line.parts(`${line.whoAll(actorsOf(joins))} join the party`)
      if (quests.length > 1) {
        const named = actorsOf(joins)
        if (named.length === quests.length && named.length <= 3)
          return line.parts(
            pick(
              [
                `${line.who(sender)} sends ${line.whoAll(named)} out at once`,
                `${line.who(sender)} splits the work: ${line.whoAll(named)} set out together`,
              ],
              seed,
            ),
          )
        return line.parts(
          pick(
            [
              `${line.who(sender)} sends ${spell(quests.length)} adventurers out at once`,
              `${capital(spell(quests.length))} quests leave the board at once`,
              `${line.who(sender)} fans the work out: ${spell(quests.length)} quests, all at once`,
            ],
            seed,
          ),
        )
      }
      const q = sender
      const text = q.kind === "quest" ? q.text : ""
      const to = recipientOf(q, lookup, joins)
      const order = errand(text)
      if (to && "entries" in to) {
        // Called back: the session already existed (a `task_id`).
        const known =
          joins.find((j) => j.id === to.id) ?? moments.find((m) => m.id === to.id) ?? lookup.actor?.(to.id)
        const back = known ?? { title: to.title.replace(/ \(@.*\)$/, ""), color: q.color }
        if (moments.some((m) => m.kind === "recover" && m.id === to.id))
          return line.parts(
            pick(
              [
                `${line.who(q)} calls ${line.who(back)} back from the fall: ${quote(text, 56)}`,
                `${line.who(back)} rises again, called back by ${line.who(q)}: ${quote(text, 56)}`,
              ],
              seed,
            ),
          )
        return line.parts(
          pick(
            [
              `${line.who(q)} calls ${line.who(back)} back: ${quote(text, 56)}`,
              `${line.who(back)} is called back from the tavern: ${quote(text, 56)}`,
            ],
            seed,
          ),
        )
      }
      if (to) {
        return line.parts(
          order
            ? pick(
                [
                  `${line.who(q)} sends ${line.who(to)} ${order}`,
                  `${line.who(q)} asks ${line.who(to)} ${order}`,
                  `A quest leaves the board: ${line.who(to)} is ${order}`,
                ],
                seed,
              )
            : pick(
                [
                  `${line.who(q)} hands ${line.who(to)} a quest: ${quote(text, 56)}`,
                  `${line.who(q)} sends ${line.who(to)} out: ${quote(text, 56)}`,
                ],
                seed,
              ),
        )
      }
      return line.parts(`${line.who(q)} posts a quest: ${quote(text, 60)}`)
    }

    case "loot": {
      if (many) return line.parts(`${line.whoAll(actors)} bring their loot home`)
      const reply = lastReply(lookup.session(first.id)?.entries ?? [])
      if (!reply)
        return line.parts(
          pick([`${line.who(first)}'s quest is done`, `${line.who(first)} brings the loot home`], seed),
        )
      const verdict = /^\s*(fail|✗|✘|error)/i.test(reply)
        ? "bad"
        : /^\s*(pass|✓|✔|ok\b)/i.test(reply)
          ? "good"
          : ""
      if (verdict === "bad")
        return line.parts(
          pick(
            [
              `${line.who(first)} returns with bad news: ${quote(reply)}`,
              `Ill tidings from ${line.who(first)}: ${quote(reply)}`,
            ],
            seed,
          ),
        )
      if (verdict === "good")
        return line.parts(
          pick(
            [
              `${line.who(first)} returns with good news: ${quote(reply)}`,
              `Good tidings from ${line.who(first)}: ${quote(reply)}`,
            ],
            seed,
          ),
        )
      return line.parts(
        pick(
          [
            `${line.who(first)} returns with the loot: ${quote(reply)}`,
            `${line.who(first)}'s quest is done: ${quote(reply)}`,
            `${line.who(first)} comes home: ${quote(reply)}`,
          ],
          seed,
        ),
      )
    }

    case "answered":
      if (many) return line.parts(`${line.whoAll(actors)} have their answers and carry on`)
      return line.parts(
        pick(
          [`${line.who(first)} has your answer and carries on`, `Word given, ${line.who(first)} carries on`],
          seed,
        ),
      )

    case "join":
      return line.parts(
        many
          ? `${line.whoAll(actors)} join the party`
          : pick([`${line.who(first)} joins the party`, `${line.who(first)} arrives at the hall`], seed),
      )

    case "deed": {
      const deeds = moments.map((m) => ({ m, d: deedOf(m, lookup) }))
      if (!many) {
        // One adventurer: say what they did, craft by craft, in the order they did it.
        const crafts = [...new Set(deeds.map((x) => x.d.craft))]
        const phrases = crafts.map((craft, i) =>
          deedPhrase(
            craft,
            deeds.filter((x) => x.d.craft === craft).map((x) => x.d),
            seed + i,
          ),
        )
        return line.parts(`${line.who(first)} ${listOf(phrases)}`)
      }
      const counted = burst(deeds.map((x) => x.d))
      return line.parts(
        pick(
          [
            `Across the guild: ${counted}`,
            `${capital(counted)}, all at once`,
            actors.length <= 3
              ? `Busy hands — ${counted}, by ${line.whoAll(actors)}`
              : `All over the island: ${counted}`,
          ],
          seed,
        ),
      )
    }

    case "sea": {
      // A burst (a merge and its CI landing together) tells the biggest news: release, red, merge, green.
      const lead = [...moments].sort((a, b) => SEA_RANK.indexOf(a.kind) - SEA_RANK.indexOf(b.kind))[0]
      return line.parts(lead ? seaLine(lead, seed) : "News from the harbour")
    }

    // Told by `renownLine` and handed to the narrator whole (`Narrator.proclaim`).
    case "renown":
      return line.parts("Something stirs on the island")
    // Told by `chapterLine` and handed to the narrator whole (`Narrator.announce`).
    case "chapter":
      return line.parts("A new chapter")
  }
}

// ─────────────────────────────── the sea ───────────────────────────────

/** Which sea news leads a burst. */
const SEA_RANK: readonly string[] = ["sea-release", "sea-red", "sea-merged", "sea-green"]

/** A pull request as a storyteller names it: `#128 “Dark mode for the settings page”`. */
function prName(event: { number: number; title: string }): string {
  return `#${event.number} ${quote(event.title, 50)}`
}

/** The caption for a sea moment (guild/moments.ts): what GitHub said, and what the sea does about it. */
export function seaLine(m: Moment, seed: number): string {
  if (!("event" in m)) return "News from the harbour"
  const e = m.event
  switch (m.kind) {
    case "sea-merged":
      return e.kind === "pr_merged"
        ? pick(
            [
              `Pull request ${prName(e)} is merged — its ship sails into the harbour under full sail`,
              `${prName(e)} is merged, and its ship comes home to the quay`,
            ],
            seed,
          )
        : "A pull request is merged"
    case "sea-red":
      return e.kind === "ci"
        ? pick(
            [
              `The lighthouse burns red: ${e.name} failed on ${e.branch}`,
              `Red light at the harbour — ${e.name} failed on ${e.branch}`,
            ],
            seed,
          )
        : "The lighthouse burns red"
    case "sea-green":
      return e.kind === "ci"
        ? pick(
            [
              `The lighthouse burns warm again: ${e.name} passes on ${e.branch}`,
              `Green again on ${e.branch}: the lighthouse's red light goes warm`,
            ],
            seed,
          )
        : "The lighthouse burns warm again"
    case "sea-release":
      return e.kind === "release"
        ? pick(
            [
              `Release ${e.tag}${e.name ? ` ${quote(e.name, 40)}` : ""} is out — a galleon drops anchor, flags flying`,
              `A galleon sails in for ${e.tag}: the release is out`,
            ],
            seed,
          )
        : "A galleon sails in"
    default:
      return "News from the harbour"
  }
}

// ─────────────────────────────── deeds of renown ───────────────────────────────

/** `the 100th`. */
export function nth(n: number): string {
  const tens = n % 100
  const ones = n % 10
  const suffix =
    tens >= 11 && tens <= 13 ? "th" : ones === 1 ? "st" : ones === 2 ? "nd" : ones === 3 ? "rd" : "th"
  return `${n.toLocaleString("en")}${suffix}`
}

/**
 * The caption for a secret world event (guild/events.ts), as it starts: rare and a little grand,
 * so it reads like a chapter heading. Variants are picked by the deed's key, so a replay says the
 * same words.
 */
export function renownLine(renown: Renown): CaptionPart[] {
  const line = new Line()
  const seed = hash(renown.key)
  const who = renown.hero ? line.who(renown.hero) : undefined
  const f = renown.facts
  switch (renown.kind) {
    case "festival":
      return line.parts(
        f.whole || !who
          ? pick(
              [
                `A clean sweep — ${spell(f.deeds ?? 0)} deeds and not one failed. The village lights its lanterns`,
                `Not a single deed failed. The village hangs out the bunting for the whole guild`,
              ],
              seed,
            )
          : pick(
              [
                `${who} comes home with ${spell(f.deeds ?? 0)} deeds and not one failed — the village throws a festival`,
                `Lanterns go up in the square: ${who} finished clean, ${spell(f.deeds ?? 0)} deeds without a slip`,
              ],
              seed,
            ),
      )
    case "ghost-ship":
      return line.parts(
        (f.fallen ?? 1) > 1
          ? pick(
              [
                `${capital(spell(f.fallen ?? 2))} fell in one quest. Out in the mist, a green sail passes without a sound`,
                `The sea goes still. A ghost ship glides by for the ${spell(f.fallen ?? 2)} who fell`,
              ],
              seed,
            )
          : `${who ?? "One"} fell after ${spell(f.minutes ?? 6)} minutes of work. A ghost ship glides past in the mist`,
      )
    case "rainbow":
      return line.parts(
        pick(
          [
            "The storm breaks. The deeds come back clean, and a rainbow stands over the island",
            "The sky clears after the storm, and a rainbow arcs over the keep",
          ],
          seed,
        ),
      )
    case "raid":
      return line.parts(
        f.spent === "time"
          ? `${spell(f.minutes ?? 45)} minutes at the treasury's door: a pirate ship drops anchor offshore`
          : pick(
              [
                f.spent === "cost"
                  ? "The treasury runs low — a pirate ship drops anchor and runs up the black flag"
                  : "Two million tokens spent — a pirate ship drops anchor and runs up the black flag",
                "Pirates! The guild's spending has drawn a raider to the coast",
              ],
              seed,
            ),
      )
    case "comet":
      return line.parts(
        f.lines
          ? `The ${nth(f.lines)} line is written, and a comet crosses the sky`
          : pick(
              [
                `The ${nth(f.deeds ?? 100)} deed — and stars fall over the island`,
                `A comet marks the guild's ${nth(f.deeds ?? 100)} deed`,
              ],
              seed,
            ),
      )
    case "dragon":
      return line.parts(
        who && f.tool
          ? `${who}'s ${f.tool === "bash" ? "commands fail" : `${f.tool} fails`} ${spell(f.streak ?? 3)} times running. A dragon wakes over the peaks`
          : `${capital(spell(f.streak ?? 5))} deeds fail in quick succession. A dragon circles the mountains`,
      )
  }
}

/** A chapter of a told story, as its title card needs it (the store's `StoryChapter`). */
export interface ChapterTitle {
  /** `III`. */
  numeral: string
  /** `The storm`. */
  title: string
  /** `The tests turn red`. */
  tagline: string
}

/**
 * A chapter's title card, in three parts the strip sets on their own lines: the act, its title and
 * its tagline (`Act III` · `The storm` · `The tests turn red`).
 */
export function chapterLine(chapter: ChapterTitle): CaptionPart[] {
  return [{ text: `Act ${chapter.numeral}` }, { text: chapter.title }, { text: chapter.tagline }]
}

// ─────────────────────────────── the narrator ───────────────────────────────

export interface NarratorOptions {
  /** Least time between two captions, ms. */
  gap?: number
  /** Least time after any caption before a routine one (a deed, a join), ms. */
  routineGap?: number
  /** How long a beat waits after its first moment for the rest of its burst, ms. */
  gather?: number
  /** A routine moment no one had time to tell is dropped after this long, ms. */
  routineStale?: number
  /** Anything else is dropped after this long, ms. */
  stale?: number
}

/** How recently the quest's end must have been heard to outlive a rebuild. */
const ENDING_MS = 1500

const DEFAULTS: Required<NarratorOptions> = {
  gap: 3400,
  routineGap: 5200,
  gather: 700,
  routineStale: 6000,
  stale: 24_000,
}

interface Heard {
  moment: Moment
  beat: BeatKind
  /** Told at once, while its session can still be looked up (the quest's end: a loop restarts next). */
  parts?: CaptionPart[]
  /** The narrator's clock when it was heard. */
  heard: number
}

/**
 * Live captions. The HUD feeds it `store.moments.on` and asks `next(now)` when `wake(now)` says
 * something could be due; nothing here re-renders anything. Rebuilt moments (`live: false`) are
 * ignored by construction, and `reset()` (on `onRebuild`) forgets anything not yet told.
 */
export class Narrator {
  private heard: Heard[] = []
  /** Every adventurer heard of, as last named: a resumed one is called by their hall name. */
  private names = new Map<string, Pick<Moment, "title" | "color">>()
  private last = Number.NEGATIVE_INFINITY
  private key = 0
  private options: Required<NarratorOptions>
  /** No caption before this time: lets the showcase's own opening caption speak first. */
  quietUntil = Number.NEGATIVE_INFINITY

  private lookup: Lookup

  constructor(lookup: Lookup, options: NarratorOptions = {}) {
    this.options = { ...DEFAULTS, ...options }
    this.lookup = {
      session: (id) => lookup.session(id),
      actor: (id) => this.names.get(id) ?? lookup.actor?.(id),
      party: (master) => lookup.party?.(master),
      parties: () => lookup.parties?.() ?? 1,
      following: () => lookup.following?.() ?? null,
    }
  }

  /** Waiting to be told, oldest first. */
  get pending(): readonly Moment[] {
    return this.heard.map((h) => h.moment)
  }

  hear(moment: Moment, now: number): void {
    if (!moment.live) return
    // Following one party: the others' stories go untold (they still live on the island).
    const following = this.lookup.following?.() ?? null
    if (following !== null && moment.master !== following) return
    this.names.set(moment.id, { title: moment.title, color: moment.color })
    const beat = beatOf(moment)
    if (!beat) return
    const parts = beat === "complete" ? lineOf(beat, [moment], this.lookup) : undefined
    this.heard.push({ moment, beat, heard: now, ...(parts ? { parts } : {}) })
  }

  /**
   * A secret world event begins (guild/events.ts): told before anything else, alone, in its own
   * words. Never merged with a burst. A rebuild forgets it like any other untold beat.
   */
  proclaim(renown: Renown, now: number): void {
    const moment = {
      kind: "loot",
      id: renown.hero?.id ?? renown.master,
      agent: "",
      title: renown.hero?.title ?? "",
      color: renown.hero?.color ?? "",
      master: renown.master,
      seq: 0,
      at: renown.at,
      live: true,
    } as Moment
    this.heard.push({ moment, beat: "renown", heard: now, parts: renownLine(renown) })
  }

  /**
   * A chapter of the story begins (the store's `onChapter`): its title card goes before anything
   * else, alone, and waits for the strip however long the opening keeps it quiet. A newer chapter
   * replaces one not yet shown: a title card never tells an act that is over.
   */
  announce(chapter: ChapterTitle, now: number): void {
    const moment = {
      kind: "loot",
      id: "",
      agent: "",
      title: "",
      color: "",
      master: "",
      seq: 0,
      at: 0,
      live: true,
    } as Moment
    this.heard = this.heard.filter((h) => h.beat !== "chapter")
    this.heard.push({ moment, beat: "chapter", heard: now, parts: chapterLine(chapter) })
  }

  /**
   * History was thrown away (a seek, a loop restart, a live hello): forget what was not yet told.
   * Only the quest's end survives, when it was heard just now — a replay loops the instant its
   * story ends, and the last line of a film should still be said.
   */
  reset(now = Number.NEGATIVE_INFINITY): void {
    this.heard = this.heard.filter((h) => h.beat === "complete" && h.parts && now - h.heard < ENDING_MS)
  }

  /** When `next` could next give a caption (narrator clock, ms), or undefined with nothing waiting. */
  wake(now: number): number | undefined {
    this.prune(now)
    if (this.heard.length === 0) return undefined
    const { gap, routineGap, gather } = this.options
    let soonest = Number.POSITIVE_INFINITY
    for (const h of this.heard) {
      const spacing = PRIORITY[h.beat] <= 1 ? routineGap : gap
      soonest = Math.min(soonest, Math.max(h.heard + gather, this.last + spacing, this.quietUntil))
    }
    return soonest
  }

  /** The caption due now, if any: the most important beat waiting, its burst merged into one line. */
  next(now: number): Caption | undefined {
    this.prune(now)
    const { gap, routineGap, gather } = this.options
    if (now < this.quietUntil || now - this.last < gap) return undefined
    const ready = this.heard.filter((h) => now - h.heard >= gather)
    if (ready.length === 0) return undefined
    const routine = now - this.last < routineGap
    const best = ready
      .filter((h) => !routine || PRIORITY[h.beat] > 1)
      .reduce<Heard | undefined>(
        (top, h) => (!top || PRIORITY[h.beat] > PRIORITY[top.beat] ? h : top),
        undefined,
      )
    if (!best) return undefined

    if (best.beat === "chapter" && best.parts) {
      this.heard = this.heard.filter((h) => h !== best)
      this.last = now
      const [act, title, tagline] = best.parts.map((p) => p.text)
      return {
        key: ++this.key,
        kind: "chapter",
        priority: PRIORITY.chapter,
        text: `${act} — ${title}. ${tagline}`,
        parts: best.parts,
        hold: 5200,
        ids: [],
      }
    }

    if (best.beat === "renown" && best.parts) {
      this.heard = this.heard.filter((h) => h !== best)
      const text = best.parts.map((p) => p.text).join("")
      this.last = now
      return {
        key: ++this.key,
        kind: "renown",
        priority: PRIORITY.renown,
        text,
        parts: best.parts,
        hold: Math.min(9000, 6000 + Math.max(0, text.length - 60) * 30),
        ids: best.moment.title ? [best.moment.id] : [],
      }
    }

    // The burst: everything waiting in the same beat (a quest takes the joins it caused with it),
    // in the same party — two conversations' deeds are never told as one.
    const party = best.moment.master
    const pool = this.heard.filter((h) => h.moment.master === party)
    let beat = best.beat
    let taken = pool.filter((h) => h.beat === beat)
    // A rise that a call-back caused is told with the call-back, in that order.
    const callbacks = pool.filter((h) => h.beat === "quest" && this.resumes(h.moment))
    if (beat === "rise" && callbacks.some((h) => taken.some((r) => r.moment.id === this.resumes(h.moment)))) {
      beat = "quest"
      taken = pool.filter((h) => h.beat === "quest")
    }
    if (beat === "quest") {
      const back = new Set(taken.map((h) => this.resumes(h.moment)))
      taken = taken.concat(
        pool.filter((h) => h.beat === "join" || (h.beat === "rise" && back.has(h.moment.id))),
      )
    }
    // A failed deed tells the deeds that went with it, as a lead-in: "Three files forged; …".
    const extra = beat === "flaw" ? pool.filter((h) => h.beat === "deed").map((h) => h.moment) : []
    const used = new Set([...taken, ...(extra.length ? pool.filter((h) => h.beat === "deed") : [])])
    // An ending says the rest: a fall makes its own failed deed old news, loot its last deeds.
    const ids = new Set(taken.map((h) => h.moment.id))
    const ends = beat === "fall" || beat === "loot" || beat === "complete"
    if (ends)
      for (const h of pool) if (ids.has(h.moment.id) && (h.beat === "deed" || h.beat === "flaw")) used.add(h)
    this.heard = this.heard.filter((h) => !used.has(h))
    const moments = taken.map((h) => h.moment).sort((a, b) => a.at - b.at || a.seq - b.seq)

    const told = beat === "complete" ? taken.find((h) => h.parts)?.parts : undefined
    const parts = this.named(party, told ?? lineOf(beat, moments, this.lookup, extra))
    const text = parts.map((p) => p.text).join("")
    this.last = now
    const priority = PRIORITY[beat]
    const base = beat === "complete" ? 6500 : priority >= 5 ? 4800 : 3400
    return {
      key: ++this.key,
      kind: beat,
      priority,
      text,
      parts,
      hold: Math.min(8000, base + Math.max(0, text.length - 60) * 30),
      ids: [...new Set(moments.map((m) => m.id))],
    }
  }

  /**
   * With several parties on the island (and none followed), a line opens with whose story it is:
   * `In the Pagination quest, the Explorer reads routes.ts`. The party's name is in its banner colour.
   */
  private named(master: string, parts: CaptionPart[]): CaptionPart[] {
    if ((this.lookup.parties?.() ?? 1) < 2 || (this.lookup.following?.() ?? null) !== null) return parts
    const party = this.lookup.party?.(master)
    if (!party?.name) return parts
    const [head, ...rest] = parts
    const lead: CaptionPart[] = [
      { text: "In the " },
      { text: party.name, color: party.color },
      { text: " quest, " },
    ]
    return head ? [...lead, { ...head, text: uncapital(head.text) }, ...rest] : lead
  }

  /** The session a quest calls back (its `task_id`), if it is a call-back. */
  private resumes(m: Moment): string | undefined {
    if (m.kind !== "quest") return undefined
    const input = toolEntry(this.lookup.session(m.id), m.call)?.input ?? {}
    return typeof input.task_id === "string" ? input.task_id : undefined
  }

  private prune(now: number): void {
    const { routineStale, stale } = this.options
    // Following one party: anything heard before the follow from the others goes untold too.
    const following = this.lookup.following?.() ?? null
    this.heard = this.heard.filter(
      (h) =>
        (following === null ||
          h.beat === "renown" ||
          h.beat === "chapter" ||
          h.moment.master === following) &&
        (h.beat === "complete" ||
          h.beat === "chapter" ||
          now - h.heard < (PRIORITY[h.beat] <= 1 ? routineStale : stale)),
    )
  }
}

/** What the narrator listens to: a moment stream (the store's `moments`). */
export interface Stream {
  on(fn: (moment: Moment) => void): () => void
  onRebuild(fn: () => void): () => void
}

/**
 * Hang a narrator on a moment stream: live moments in, rebuilds forget. `clock` is the narrator's
 * time (performance.now in the hall); `heard` is told after each live moment so the caller can
 * schedule its next look. Returns the unsubscribe.
 */
/** Narrators listening to each stream, so a world event can be told on the same strip. */
const narrators = new WeakMap<object, Set<{ narrator: Narrator; clock: () => number; heard: () => void }>>()

/**
 * Tell a secret world event (guild/events.ts) on every narrator listening to `stream` (the store's
 * `moments`): the scheduler speaks through the captions without the HUD wiring anything new.
 */
export function proclaim(stream: object, renown: Renown): void {
  for (const n of narrators.get(stream) ?? []) {
    n.narrator.proclaim(renown, n.clock())
    n.heard()
  }
}

export function listen(
  stream: Stream,
  narrator: Narrator,
  clock: () => number,
  heard: () => void = () => {},
  rebuilt: () => void = () => {},
): () => void {
  const off = stream.on((moment) => {
    narrator.hear(moment, clock())
    heard()
  })
  const entry = { narrator, clock, heard }
  const set = narrators.get(stream) ?? new Set()
  set.add(entry)
  narrators.set(stream, set)
  const offRebuild = stream.onRebuild(() => {
    narrator.reset(clock())
    rebuilt()
  })
  return () => {
    off()
    offRebuild()
    set.delete(entry)
  }
}
