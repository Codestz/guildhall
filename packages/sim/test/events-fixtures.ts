import type { Change, SeaEvent } from "@guildhall/core"
import { EventLog, type NormalizeContext, normalize, normalizer, type WorldEvent } from "../src/index.ts"

/** Four packages, as places 0–3, for tests that need a binding without an island. */
export const PACKAGES = ["core", "world", "sim", "render"] as const

export function placeOf(path: string): number | undefined {
  const m = /packages\/([\w-]+)\//.exec(path)
  const i = m ? PACKAGES.indexOf(m[1] as (typeof PACKAGES)[number]) : -1
  return i < 0 ? undefined : i
}

export const fileIn = (pkg: (typeof PACKAGES)[number], name = "index.ts") =>
  `/Users/me/guildhall/packages/${pkg}/src/${name}`

/** A guild's wire, fed through a normaliser into a log. */
export class Feed {
  readonly ctx: NormalizeContext
  readonly log: EventLog
  readonly made: WorldEvent[] = []
  private seq = 0
  private calls = 0

  constructor(every?: number, ctx: NormalizeContext = normalizer({ placeOf })) {
    this.ctx = ctx
    this.log = new EventLog(every)
  }

  change(change: Change): WorldEvent[] {
    const out = normalize({ v: 1, guild: "g", seq: ++this.seq, change }, this.ctx)
    this.made.push(...out)
    this.log.append(...out)
    return out
  }

  sea(event: SeaEvent): WorldEvent[] {
    const out = normalize(event, this.ctx)
    this.made.push(...out)
    this.log.append(...out)
    return out
  }

  /** A call that runs at `at` and completes 200 ms later. */
  tool(id: string, name: string, input: Record<string, unknown>, at: number, extra: Partial<Change> = {}) {
    const call = `c${++this.calls}`
    return [
      ...this.change({ type: "tool", id, call, name, state: "running", input, at }),
      ...this.change({
        type: "tool",
        id,
        call,
        name,
        state: "completed",
        input,
        at: at + 200,
        ...extra,
      } as Change),
    ]
  }

  edit(id: string, pkg: (typeof PACKAGES)[number], at: number) {
    return this.tool(id, "edit", { filePath: fileIn(pkg), newString: "x" }, at)
  }

  grep(id: string, pkg: (typeof PACKAGES)[number], at: number) {
    return this.tool(id, "grep", { pattern: "foo", path: `/Users/me/guildhall/packages/${pkg}/` }, at)
  }

  /** A root session that is busy from `at`. */
  start(id: string, at: number, parentID?: string, agent = "build") {
    this.change({ type: "session", id, agent, ...(parentID ? { parentID } : {}), at })
    this.change({ type: "status", id, status: "busy", at })
  }

  actor(id: string) {
    return this.log.head.actors.get(id)
  }
}
