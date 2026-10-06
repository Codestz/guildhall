import type { Entry, Session } from "@guildhall/core"
import { EVENT_KINDS, type EventKind, type Renown, renownOf } from "./events.ts"
import type { Moment } from "./moments.ts"
import {
  CRAFT_ORDER,
  type Craft,
  capital,
  clip,
  craftOf,
  errorLine,
  failing,
  hash,
  lastReply,
  listOf,
  NOUNS,
  nth,
  pick,
  quote,
  sameQuest,
  spell,
  targetOf,
  toolEntry,
} from "./story.ts"

/**
 * Legends (roadmap S3): the session's story as a book — a title from the root quest, one chapter
 * per quest (who was sent, what they did, what went wrong, what they brought home, what it cost),
 * and a closing line. Pure: built from the moment history plus the sessions as they stand, so a
 * seek gives the same book as playing through (test/story.test.ts). hud/Legends.tsx draws it;
 * `legendMarkdown` is the "Copy as text" artifact.
 */
export type NotableKind = "plea" | "flaw" | "fall" | "rise" | "renown"

export interface Notable {
  kind: NotableKind
  /** Run time, ms. */
  at: number
  text: string
}

export interface DeedCount {
  craft: Craft
  count: number
  /** `3 edits`. */
  label: string
}

export interface Chapter {
  /** `I`, `II`, … */
  numeral: string
  id: string
  /** `Implementer II`. */
  who: string
  color: string
  /** Who sent them; absent for the guildmaster's own chapter. */
  sentBy?: string
  /** The quest's words. */
  quest: string
  /** Called back for this one: the same adventurer as an earlier chapter. */
  resumed: boolean
  /** Run time it began and (when it has) ended, ms. */
  begin: number
  end?: number
  outcome: "done" | "fallen" | "underway"
  deeds: DeedCount[]
  notables: Notable[]
  /** What they brought home, their last word. */
  loot?: string
  /** The adventurer's tokens and cost; on the last of their chapters when they had several. */
  tokens?: number
  cost?: number
  /** `for both quests`, when the usage covers more than this chapter. */
  usageNote?: string
}

/** One line of the book's Deeds of Renown (guild/events.ts): earned, with how many times. */
export interface RenownEntry {
  kind: EventKind
  /** Groups repeats: the kind, or a comet's milestone. */
  id: string
  title: string
  /** What happened, the first time. */
  text: string
  count: number
  /** Forced by the probe hook, not earned. */
  forced: boolean
}

/** A deed of renown not yet earned this session: a cryptic hint, Bruno-style. */
export interface Unsung {
  kind: EventKind
  hint: string
}

export interface Legend {
  title: string
  /** Everyone in the party, the guildmaster included. */
  party: number
  /** Run time from the first moment to the last told, ms. */
  span: number
  tokens: number
  cost: number
  outcome: "complete" | "lost" | "underway"
  opening: string
  chapters: Chapter[]
  /** The guildmaster's last word, when the quest is done. */
  lastWord?: string
  closing: string
  /** The Deeds of Renown earned this session, in the order first earned. */
  renown: RenownEntry[]
  /** The kinds still unearned. */
  unsung: Unsung[]
}

const ROMAN: [number, string][] = [
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
]

function numeral(n: number): string {
  let rest = n
  let out = ""
  for (const [value, letters] of ROMAN) {
    while (rest >= value) {
      out += letters
      rest -= value
    }
  }
  return out || String(n)
}

/** `42s`, `3m 05s`. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`
}

/** `m:ss` run time. */
export function clockOf(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

export function tokensOf(n: number): string {
  if (n < 1000) return `${n} tokens`
  return `${n < 100_000 ? (n / 1000).toFixed(1) : Math.round(n / 1000)}k tokens`
}

export function costOf(n: number): string {
  return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`
}

/** A session's work split at its prompts: one segment per quest it was given (a resume adds one). */
function segmentsOf(session: Session): Entry[][] {
  const out: Entry[][] = []
  let current: Entry[] | undefined
  for (const entry of session.entries) {
    if (entry.kind === "prompt" || !current) {
      current = []
      out.push(current)
    }
    current.push(entry)
  }
  return out.length ? out : [[]]
}

function countDeeds(entries: readonly Entry[], skipQuests: boolean): DeedCount[] {
  const counts = new Map<Craft, number>()
  for (const e of entries) {
    if (e.kind !== "tool" || (e.state !== "completed" && e.state !== "failed")) continue
    const craft = craftOf(e.name, e.input)
    if (skipQuests && craft === "quest") continue
    counts.set(craft, (counts.get(craft) ?? 0) + 1)
  }
  return CRAFT_ORDER.flatMap((craft) => {
    const count = counts.get(craft)
    if (!count) return []
    const [one, many] = NOUNS[craft]
    return [{ craft, count, label: `${count} ${count === 1 ? one : many}` }]
  })
}

/** The notable things in a chapter's moments, in words. */
function notablesOf(moments: readonly Moment[], session: Session | undefined): Notable[] {
  const out: Notable[] = []
  for (let i = 0; i < moments.length; i++) {
    const m = moments[i] as Moment
    if (m.kind === "plea") {
      const answer = moments.slice(i + 1).find((n) => n.kind === "plea-answered")
      out.push({
        kind: "plea",
        at: m.at,
        text: answer
          ? `Asked for your word; it was given after ${duration(answer.at - m.at)}.`
          : "Asked for your word, and waits for it still.",
      })
    } else if (m.kind === "deed-failed") {
      const entry = toolEntry(session, m.call)
      const input = entry?.input ?? {}
      const craft = craftOf(m.tool, input)
      const what =
        typeof input.command === "string" ? `\`${clip(input.command, 40)}\`` : (targetOf(input) ?? m.tool)
      const n = failing(m.error) ?? failing(entry?.summary)
      const why = n !== undefined ? `${n} failing` : (errorLine(m.error, 70) ?? "it failed")
      out.push({
        kind: "flaw",
        at: m.at,
        text:
          craft === "test" ? `Tests failed: ${what}, ${why}.` : `${capital(m.tool)} failed: ${what}, ${why}.`,
      })
    } else if (m.kind === "fail") {
      const error = errorLine(m.error, 80)
      out.push({
        kind: "fall",
        at: m.at,
        text: `Fell${error ? `: “${error}”` : ""}${m.parent ? ", and rose in the graveyard" : ""}.`,
      })
    } else if (m.kind === "recover") {
      out.push({ kind: "rise", at: m.at, text: "Rose again and took up the work." })
    }
  }
  return out
}

/**
 * The legend of the party under `root` (the followed guildmaster), from the moment history and the
 * sessions as they stand. Pure and order-stable: after a seek it is the same book as after playing
 * through, because it reads neither `seq` nor `live`, nor the `leave` moments a seek finds late.
 * Undefined before the party has a guildmaster.
 */
export function legendOf(
  history: readonly Moment[],
  sessions: readonly Session[],
  /** Shows the probe hook forced (guild/events.ts `WorldEvents.forced`): listed, marked as forced. */
  forced: readonly Renown[] = [],
): Legend | undefined {
  const root = sessions.find((s) => !s.parentID)
  if (!root) return undefined
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const told = history.filter((m) => m.master === root.id && m.kind !== "leave")
  const masterTitle = told.find((m) => m.id === root.id)?.title ?? "Guildmaster"

  // Each quest, with who took it.
  interface Start {
    q: Extract<Moment, { kind: "quest" }>
    session: Session
    title: string
    color: string
    resumed: boolean
  }
  const starts: Start[] = []
  const taken = new Set<string>()
  for (const m of told) {
    if (m.kind !== "quest") continue
    const input = toolEntry(byId.get(m.id), m.call)?.input ?? {}
    const resumed = typeof input.task_id === "string" ? byId.get(input.task_id) : undefined
    const joins = resumed
      ? []
      : told.filter((j) => j.kind === "join" && j.parent === m.id && !taken.has(j.id) && j.at >= m.at)
    const fresh = joins.find((j) => sameQuest(byId.get(j.id)?.task, m.text)) ?? joins[0]
    const session = resumed ?? (fresh ? byId.get(fresh.id) : undefined)
    if (!session) continue
    taken.add(session.id)
    const named = fresh ?? told.find((x) => x.id === session.id)
    starts.push({
      q: m,
      session,
      title: named?.title ?? session.title,
      color: named?.color ?? m.color,
      resumed: Boolean(resumed) && starts.some((s) => s.session.id === session.id),
    })
  }

  const chapters: Chapter[] = []
  const masterDeeds = countDeeds(root.entries, true)
  const masterMoments = told.filter((m) => m.id === root.id)
  const masterNotables = notablesOf(masterMoments, root)
  if (masterDeeds.length > 0 || masterNotables.length > 0 || starts.length === 0) {
    const end = masterMoments.find((m) => m.kind === "loot" || m.kind === "fail")
    chapters.push({
      numeral: "",
      id: root.id,
      who: masterTitle,
      color: told.find((m) => m.id === root.id)?.color ?? "#dcb662",
      quest: root.task ?? root.title,
      resumed: false,
      begin: 0,
      ...(end ? { end: end.at } : {}),
      outcome: root.status === "done" ? "done" : root.status === "failed" ? "fallen" : "underway",
      deeds: masterDeeds,
      notables: masterNotables,
    })
  }

  for (const start of starts) {
    const { session } = start
    const mine = starts.filter((s) => s.session.id === session.id)
    const index = mine.indexOf(start)
    const next = mine[index + 1]
    const window = told.filter(
      (m) => m.id === session.id && m.at >= start.q.at && (!next || m.at < next.q.at) && m.kind !== "quest",
    )
    // The session's segments, aligned from the end (history may have dropped the oldest quests).
    const segments = segmentsOf(session)
    const segment = segments[segments.length - mine.length + index] ?? []
    const end = window.findLast((m) => m.kind === "loot" || m.kind === "fail")
    const reopened = end ? window.some((m) => m.kind === "recover" && m.at > end.at) : false
    const last = index === mine.length - 1
    const outcome: Chapter["outcome"] =
      end && !reopened ? (end.kind === "loot" ? "done" : "fallen") : !last ? "done" : "underway"
    const loot = outcome === "done" ? lastReply(segment) : undefined
    const sender = told.find((m) => m.id === start.q.id)
    chapters.push({
      numeral: "",
      id: session.id,
      who: start.title,
      color: start.color,
      ...(sender && sender.id !== root.id ? { sentBy: sender.title } : { sentBy: masterTitle }),
      quest: start.q.text,
      resumed: start.resumed,
      begin: start.q.at,
      ...(end && !reopened ? { end: end.at } : {}),
      outcome,
      deeds: countDeeds(segment, true),
      notables: notablesOf(window, session),
      ...(loot ? { loot } : {}),
      ...(last && (session.tokens > 0 || session.cost > 0)
        ? {
            tokens: session.tokens,
            cost: session.cost,
            ...(mine.length > 1
              ? { usageNote: `for ${mine.length === 2 ? "both" : `all ${mine.length}`} quests` }
              : {}),
          }
        : {}),
    })
  }
  chapters.forEach((c, i) => {
    c.numeral = numeral(i + 1)
  })
  // The guildmaster's own chapter, told first, carries the root's usage.
  const own = chapters.find((c) => c.id === root.id)
  if (own && (root.tokens > 0 || root.cost > 0)) {
    own.tokens = root.tokens
    own.cost = root.cost
  }

  const party = new Set(told.map((m) => m.id)).add(root.id).size
  const span = told.at(-1)?.at ?? 0
  const tokens = sessions.reduce((sum, s) => sum + s.tokens, 0)
  const cost = sessions.reduce((sum, s) => sum + s.cost, 0)
  const outcome: Legend["outcome"] =
    root.status === "done" ? "complete" : root.status === "failed" ? "lost" : "underway"
  const seed = hash(root.task ?? root.title)
  const sent = new Set(starts.filter((s) => !s.resumed).map((s) => s.session.id)).size
  const quest = root.task ?? root.title

  const opening =
    sent === 0
      ? `The ${masterTitle} took up the quest alone: ${quote(quest, 90)}.`
      : pick(
          [
            `The ${masterTitle} took up the quest ${quote(quest, 90)}, and sent ${spell(sent)} ${sent === 1 ? "adventurer" : "adventurers"} out to see it done.`,
            `It began at the quest board: ${quote(quest, 90)}. The ${masterTitle} called ${spell(sent)} ${sent === 1 ? "adventurer" : "adventurers"} to the work.`,
          ],
          seed,
        )

  const falls = chapters.flatMap((c) => c.notables.filter((n) => n.kind === "fall")).length
  const flaws = chapters.flatMap((c) => c.notables.filter((n) => n.kind === "flaw")).length
  const rises = chapters.flatMap((c) => c.notables.filter((n) => n.kind === "rise")).length
  const troubles = [
    falls ? `${spell(falls)} fell` : "",
    flaws ? `${spell(flaws)} ${flaws === 1 ? "trial" : "trials"} failed` : "",
    rises ? `${spell(rises)} rose again` : "",
  ].filter(Boolean)
  const lastWord = outcome === "complete" ? lastReply(root.entries) : undefined
  const waiting = sessions.filter((s) => s.status === "waiting").length
  const working = sessions.filter((s) => s.status === "running" || s.status === "starting").length
  const closing =
    outcome === "lost"
      ? `The quest was lost after ${duration(span)}${root.error ? `: “${errorLine(root.error, 80)}”` : ""}.`
      : outcome === "underway"
        ? `The tale is still being written: ${spell(Math.max(working, 0))} at work${
            waiting ? `, ${spell(waiting)} waiting on your word` : ""
          }.`
        : troubles.length
          ? pick(
              [
                `The quest was done in ${duration(span)}, though not without cost: ${listOf(troubles)}.`,
                `It took ${duration(span)}, and ${listOf(troubles)} — but the quest was done.`,
              ],
              seed,
            )
          : pick(
              [
                `And so the quest was done in ${duration(span)}, and the guild rested.`,
                `The quest was done in ${duration(span)}; the loot is home and the hearth is warm.`,
              ],
              seed,
            )

  // Deeds of Renown: the list, and a line in the chapter of whoever earned one on a moment.
  const earned = renownOf(history, sessions)
  for (const r of earned) {
    if (!r.anchored || !r.hero || r.kind === "comet" || r.kind === "raid" || r.kind === "rainbow") continue
    const chapter = chapters.findLast((c) => c.id === r.hero?.id && c.begin <= r.at)
    if (!chapter) continue
    chapter.notables.push({ kind: "renown", at: r.at, text: renownNote(r) })
    chapter.notables.sort((a, b) => a.at - b.at)
  }
  const renown = renownEntries([...earned, ...forced.filter((r) => r.master === root.id)])
  const have = new Set(renown.map((r) => r.kind))
  const unsung = EVENT_KINDS.filter((kind) => !have.has(kind)).map((kind) => ({ kind, hint: UNSUNG[kind] }))

  return {
    title: clip(quest, 80).replace(/\.$/, ""),
    party,
    span,
    tokens,
    cost,
    outcome,
    opening,
    chapters,
    ...(lastWord ? { lastWord } : {}),
    closing,
    renown,
    unsung,
  }
}

// ─────────────────────────────── deeds of renown ───────────────────────────────

const MILESTONE_TITLE: Record<string, string> = {
  "deeds-100": "The Hundredth Deed",
  "deeds-500": "Five Hundred Deeds",
  "deeds-1000": "A Thousand Deeds",
  "lines-1000": "A Thousand Lines",
  "lines-5000": "Five Thousand Lines",
}

/** The name a deed of renown is listed under. */
export function renownTitle(r: Renown): string {
  switch (r.kind) {
    case "festival":
      return "A Clean Sweep"
    case "ghost-ship":
      return "The Ghost Ship"
    case "rainbow":
      return "After the Storm"
    case "raid":
      return "The Treasury Raided"
    case "comet":
      return MILESTONE_TITLE[milestoneOf(r)] ?? "A Falling Star"
    case "dragon":
      return "The Dragon of the Peaks"
  }
}

function milestoneOf(r: Renown): string {
  return r.facts.lines ? `lines-${r.facts.lines}` : `deeds-${r.facts.deeds ?? 100}`
}

/** What a deed of renown was, in one line for the book. */
export function renownText(r: Renown): string {
  const who = r.hero ? `the ${r.hero.title}` : "the guild"
  const f = r.facts
  switch (r.kind) {
    case "festival":
      return f.whole
        ? `The whole quest came home clean — ${spell(f.deeds ?? 0)} deeds, not one failed — and the village held a festival.`
        : `${capital(who)} finished ${spell(f.deeds ?? 0)} deeds without a single failure; lanterns went up in the square.`
    case "ghost-ship":
      return (f.fallen ?? 1) > 1
        ? `${capital(spell(f.fallen ?? 2))} fell in one quest, and a ghost ship passed in the mist.`
        : `${capital(who)} fell after ${spell(f.minutes ?? 6)} minutes, and a ghost ship passed in the mist.`
    case "rainbow":
      return "The storm broke, the deeds came back clean, and a rainbow stood over the island."
    case "raid":
      return f.spent === "time"
        ? `After ${f.minutes ?? 45} minutes at work, pirates anchored offshore under the black flag.`
        : f.spent === "cost"
          ? "The guild spent past ten in gold, and pirates anchored offshore under the black flag."
          : "The guild spent past two million tokens, and pirates anchored offshore under the black flag."
    case "comet":
      return f.lines
        ? `A comet crossed the sky as the ${nth(f.lines)} line was written.`
        : `Stars fell over the island at the guild's ${nth(f.deeds ?? 100)} deed.`
    case "dragon":
      return f.tool && r.hero
        ? `${capital(who)}'s ${f.tool} failed ${spell(f.streak ?? 3)} times running, and a dragon circled the peaks.`
        : `${capital(spell(f.streak ?? 5))} deeds failed in quick succession, and a dragon circled the peaks.`
  }
}

/** The line in the earner's chapter. */
function renownNote(r: Renown): string {
  switch (r.kind) {
    case "festival":
      return "Came home clean; the village held a festival in their honour."
    case "ghost-ship":
      return "A ghost ship passed in the mist for the fallen."
    default:
      return "A dragon woke over the peaks."
  }
}

/** Earned deeds grouped (a repeat counts, the first one's words stay), in the order first earned. */
function renownEntries(earned: readonly Renown[]): RenownEntry[] {
  const out: RenownEntry[] = []
  for (const r of earned) {
    const forced = r.key.startsWith("forced:")
    const id = `${r.kind === "comet" ? milestoneOf(r) : r.kind}${forced ? ":forced" : ""}`
    const known = out.find((e) => e.id === id)
    if (known) {
      known.count++
      continue
    }
    out.push({ kind: r.kind, id, title: renownTitle(r), text: renownText(r), count: 1, forced })
  }
  return out
}

/** Hints for the deeds not yet earned: enough to hunt for, not enough to spoil. */
export const UNSUNG: Record<EventKind, string> = {
  festival: "When every deed of a long quest comes home clean…",
  "ghost-ship": "A sail with no crew, for those who fall…",
  rainbow: "What follows the storm, if the work comes good…",
  raid: "Spend long enough, and someone notices the treasury…",
  comet: "Count the deeds, and look up…",
  dragon: "Fail the same trial three times running…",
}

/**
 * Agent text made inert for Markdown (review-2 #18): an agent's words (a prompt-injected reply, a
 * command) must not become an image, a link, HTML or a mention where the legend is pasted. With
 * `[`, `]`, `<` and `>` escaped no image, link or tag can form; emphasis and code marks are escaped
 * so the text reads as written; `@` is followed by a zero-width space so it mentions nobody.
 */
export function markdownText(text: string): string {
  return text
    .replace(/[\\`*_[\]~]/g, "\\$&")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@(?=[\w-])/g, "@\u200b")
}

/** The legend as Markdown, to paste anywhere: the shareable artifact. Every told string is escaped. */
export function legendMarkdown(legend: Legend): string {
  const md = markdownText
  const out: string[] = []
  out.push(`# The Legend of “${md(legend.title)}”`, "")
  const meta = [
    `A party of ${spell(legend.party)}`,
    duration(legend.span),
    ...(legend.tokens > 0 ? [tokensOf(legend.tokens)] : []),
    ...(legend.cost > 0 ? [costOf(legend.cost)] : []),
  ]
  out.push(`*${meta.join(" · ")}*`, "", md(legend.opening), "")
  for (const c of legend.chapters) {
    const heading = c.sentBy
      ? `The ${md(c.who)} — ${md(quote(c.quest, 90))}`
      : `The ${md(c.who)} at the Quest Board`
    out.push(`## ${c.numeral}. ${heading}`, "")
    const facts = [
      c.sentBy ? `${c.resumed ? "Called back by" : "Sent by"} the ${md(c.sentBy)}` : "",
      c.end !== undefined
        ? `${clockOf(c.begin)}–${clockOf(c.end)} (${duration(c.end - c.begin)})`
        : `from ${clockOf(c.begin)}`,
      c.outcome === "underway" ? "still at work" : c.outcome === "fallen" ? "fallen" : "",
      c.tokens
        ? `${tokensOf(c.tokens)}${c.cost ? ` · ${costOf(c.cost)}` : ""}${c.usageNote ? ` ${c.usageNote}` : ""}`
        : "",
    ].filter(Boolean)
    out.push(`*${facts.join(" · ")}*`, "")
    if (c.deeds.length) out.push(`- **Deeds:** ${md(c.deeds.map((d) => d.label).join(", "))}`)
    for (const n of c.notables) out.push(`- **${NOTABLE_LABEL[n.kind]}** (${clockOf(n.at)}): ${md(n.text)}`)
    if (c.loot) out.push(`- **Loot:** ${md(clip(c.loot, 240))}`)
    out.push("")
  }
  if (legend.renown.length) {
    out.push("## Deeds of Renown", "")
    for (const r of legend.renown)
      out.push(
        `- **${md(r.title)}**${r.count > 1 ? ` ×${r.count}` : ""}${r.forced ? " *(forced)*" : ""}: ${md(r.text)}`,
      )
    out.push("")
  }
  out.push("---", "")
  if (legend.lastWord) out.push(`> ${md(clip(legend.lastWord, 240))}`, "")
  out.push(`*${md(legend.closing)}*`, "")
  return out.join("\n")
}

export const NOTABLE_LABEL: Record<NotableKind, string> = {
  plea: "Plea",
  flaw: "Failure",
  fall: "Fall",
  rise: "Rise",
  renown: "Renown",
}
