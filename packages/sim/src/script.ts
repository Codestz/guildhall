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
}

export class Script {
  readonly changes: Change[] = []
  private readonly random: () => number
  private ids = 0

  constructor(seed = 1) {
    this.random = rng(seed)
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
    })
    this.spend(ms)
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
    this.tokens += Math.round(ms * 2.5)
    this.cost += ms * 0.000004
    this.script.emit({ type: "usage", id: this.id, tokens: this.tokens, cost: this.cost, at: this.clock })
  }
}
