import type { Change } from "@guildhall/core"

/**
 * Builds a believable guild run as a list of `Change`s — the same vocabulary the herald produces
 * from a live OpenCode, so the hall cannot tell a simulated guild from a real one (ADR 0003).
 *
 * Scripts are synchronous: each adventurer keeps its own clock (ms from the start), and every call
 * schedules changes at that clock and moves it forward. Durations jitter by a seeded RNG, so the
 * same seed always tells the same story.
 */

/** mulberry32: tiny, fast, good enough for jitter. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface DeedOptions {
  /** End in failure with this error instead of completing. */
  fail?: string
  /** One-line result, as OpenCode summarises it: `9 matches`, `exit 1`. */
  summary?: string
  /** What the tool printed (a test run's report): shown in the adventurer's transcript. */
  output?: string
  /** Called in the same model step as the deed before it (a batch of parallel reads): no turn first. */
  batch?: boolean
}

/**
 * What a model step costs: tokens and dollars added to the session's running totals by its
 * `step`-th deed (0-based), which took about `ms`. The default is the stories' small flat rate.
 */
export type Economy = (step: number, ms: number) => { tokens: number; cost: number }

const FLAT: Economy = (_, ms) => ({ tokens: Math.round(ms * 2.5), cost: ms * 0.000004 })

/**
 * A chapter of a told story (the Saga's acts): where it begins (ms from the start, like `Change.at`)
 * and the hour of the story's own clock it opens at.
 */
export interface Chapter {
  at: number
  /** `III`. */
  numeral: string
  /** `The storm`. */
  title: string
  /** One line under the title: `The tests turn red`. */
  tagline: string
  /** Hour of day (0–24, may run past 24) the story's clock shows as the chapter opens. */
  hour: number
}

export interface ScriptOptions {
  /** What each model step costs (default: a small flat rate). */
  economy?: Economy
  /**
   * The model's turn before each deed, ms (jittered): a step's thinking and writing, as recorded
   * runs show it (p50 4–6 s). 0 by default: the short stories fold it into each deed's length.
   */
  turnMs?: number
}

export class Script {
  readonly changes: Change[] = []
  /** Chapters marked so far (`chapter`), in the order they were marked. */
  readonly chapters: Chapter[] = []
  readonly economy: Economy
  readonly turnMs: number
  private readonly random: () => number
  private ids = 0

  constructor(seed = 1, options: ScriptOptions = {}) {
    this.random = rng(seed)
    this.economy = options.economy ?? FLAT
    this.turnMs = options.turnMs ?? 0
  }

  /** A new chapter begins at `at`. */
  chapter(at: number, chapter: Omit<Chapter, "at">): void {
    this.chapters.push({ at, ...chapter })
  }

  /** `ms` give or take 20%, never under 1. */
  jitter(ms: number): number {
    return Math.max(1, Math.round(ms * (0.8 + this.random() * 0.4)))
  }

  /** Picks one of `items`, deterministically for the seed. */
  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.random() * items.length)]
    if (item === undefined) throw new Error("pick from an empty list")
    return item
  }

  nextId(prefix: string): string {
    this.ids += 1
    return `${prefix}_sim${String(this.ids).padStart(4, "0")}`
  }

  emit(change: Change): void {
    this.changes.push(change)
  }

  /** The guildmaster — a root session with no parent. Starts at `at`. */
  guildmaster(task: string, at = 0): Adventurer {
    return new Adventurer(this, "guild-master", task, at)
  }

  /** Every change, in time order (stable for equal times). */
  done(): Change[] {
    return this.changes
      .map((change, index) => ({ change, index }))
      .sort((a, b) => a.change.at - b.change.at || a.index - b.index)
      .map(({ change }) => change)
  }
}

export class Adventurer {
  readonly id: string
  /** This adventurer's own clock, ms from the start of the run. */
  clock: number
  private tokens = 0
  private cost = 0
  private steps = 0

  constructor(
    private readonly script: Script,
    readonly role: string,
    task: string,
    at: number,
    parentID?: string,
  ) {
    this.id = script.nextId("ses")
    this.clock = at
    const title = parentID ? `${task} (@${role} subagent)` : task
    script.emit({ type: "session", id: this.id, agent: role, title, at, ...(parentID ? { parentID } : {}) })
    script.emit({ type: "prompt", id: this.id, key: script.nextId("msg"), text: task, at })
    script.emit({ type: "status", id: this.id, status: "busy", at })
  }

  /** Stand still for about `ms`. */
  wait(ms: number): this {
    this.clock += this.script.jitter(ms)
    return this
  }

  /** Think for about `ms`, then settle on `text`. */
  think(text: string, ms = 1500): this {
    const key = this.script.nextId("prt")
    this.script.emit({ type: "thinking", id: this.id, key, text, at: this.clock })
    this.clock += this.script.jitter(ms)
    this.script.emit({ type: "thinking", id: this.id, key, text, done: true, at: this.clock })
    return this
  }

  /** One tool call, from running to completed (or failed). */
  deed(tool: string, input: Record<string, unknown>, ms = 800, options: DeedOptions = {}): this {
    if (this.script.turnMs > 0 && !options.batch) this.clock += this.script.jitter(this.script.turnMs)
    const call = this.script.nextId("call")
    const started = this.clock
    this.script.emit({
      type: "tool",
      id: this.id,
      call,
      name: tool,
      state: "running",
      input,
      started,
      at: started,
    })
    this.clock += this.script.jitter(ms)
    this.script.emit({
      type: "tool",
      id: this.id,
      call,
      state: options.fail ? "failed" : "completed",
      ended: this.clock,
      at: this.clock,
      ...(options.fail ? { error: options.fail } : {}),
      ...(options.summary ? { summary: options.summary } : {}),
      ...(options.output ? { output: options.output } : {}),
    })
    if (!options.batch) this.spend(ms)
    return this
  }

  /**
   * Spoken to again in the same session (a user's follow-up in their conversation): it gets to
   * work once more, the way OpenCode re-opens a session on a new message.
   */
  prompt(text: string): this {
    this.script.emit({ type: "prompt", id: this.id, key: this.script.nextId("msg"), text, at: this.clock })
    this.script.emit({ type: "status", id: this.id, status: "busy", at: this.clock })
    return this
  }

  /** Held on a permission for about `ms`, then let go (CONTEXT.md: Plea). */
  plea(ms = 4000): this {
    this.script.emit({ type: "status", id: this.id, status: "waiting", at: this.clock })
    this.clock += this.script.jitter(ms)
    this.script.emit({ type: "status", id: this.id, status: "busy", at: this.clock })
    return this
  }

  /**
   * Hand a quest to a new adventurer. `work` scripts the child; this adventurer's `task` call runs
   * until the child is done. With `wait: false` this adventurer carries on at once (a background
   * quest) — use it to send several quests out together, then `waitFor` them.
   */
  quest(
    role: string,
    task: string,
    work: (child: Adventurer) => void,
    options: { wait?: boolean } = {},
  ): Adventurer {
    const call = this.script.nextId("call")
    const started = this.clock
    const input = { description: task, subagent_type: role }
    this.script.emit({
      type: "tool",
      id: this.id,
      call,
      name: "task",
      state: "running",
      input,
      started,
      at: started,
    })
    const child = new Adventurer(this.script, role, task, started + this.script.jitter(400), this.id)
    work(child)
    const ended = child.clock + this.script.jitter(300)
    this.script.emit({ type: "tool", id: this.id, call, state: "completed", ended, at: ended })
    if (options.wait !== false) this.clock = ended
    return child
  }

  /**
   * Call a finished adventurer back for more (OpenCode's `task_id` / `sessionID` continuation):
   * same session, new prompt. In the hall they get up from the tavern and go back to work.
   */
  resume(
    child: Adventurer,
    task: string,
    work: (child: Adventurer) => void,
    options: { wait?: boolean } = {},
  ): Adventurer {
    const call = this.script.nextId("call")
    const started = this.clock
    const input = { description: task, subagent_type: child.role, task_id: child.id }
    this.script.emit({
      type: "tool",
      id: this.id,
      call,
      name: "task",
      state: "running",
      input,
      started,
      at: started,
    })
    child.clock = Math.max(child.clock, started) + this.script.jitter(400)
    this.script.emit({
      type: "prompt",
      id: child.id,
      key: this.script.nextId("msg"),
      text: task,
      at: child.clock,
    })
    this.script.emit({ type: "status", id: child.id, status: "busy", at: child.clock })
    work(child)
    const ended = child.clock + this.script.jitter(300)
    this.script.emit({ type: "tool", id: this.id, call, state: "completed", ended, at: ended })
    if (options.wait !== false) this.clock = ended
    return child
  }

  /** Catch up with background quests: this clock moves to the last of them to finish. */
  waitFor(...children: Adventurer[]): this {
    this.clock = Math.max(this.clock, ...children.map((child) => child.clock + 400))
    return this
  }

  /** Answer back, then go idle (done). */
  finish(reply: string, ms = 1200): this {
    const key = this.script.nextId("prt")
    this.script.emit({ type: "reply", id: this.id, key, text: "", at: this.clock })
    this.clock += this.script.jitter(ms)
    this.script.emit({ type: "reply", id: this.id, key, text: reply, done: true, at: this.clock })
    this.script.emit({ type: "status", id: this.id, status: "idle", at: this.clock })
    return this
  }

  /** Give up with an error. */
  fail(error: string): this {
    this.script.emit({ type: "status", id: this.id, status: "failed", error, at: this.clock })
    return this
  }

  private spend(ms: number): void {
    const step = this.script.economy(this.steps++, ms)
    this.tokens += step.tokens
    this.cost += step.cost
    this.script.emit({ type: "usage", id: this.id, tokens: this.tokens, cost: this.cost, at: this.clock })
  }
}
