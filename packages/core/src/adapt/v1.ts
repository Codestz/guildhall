// from opencode-cockpit: packages/subagents/src/core/adapt/v1.ts (ADR 0001)
/**
 * OpenCode 1's events and state, as changes.
 *
 * OpenCode 1 describes a run as parts of messages: a part is created (`message.part.updated`), may
 * stream (`message.part.delta`, which names the part but not its kind — so kinds are remembered), and
 * is updated as it completes. A user message's text is what the session was told; an assistant's
 * `reasoning` and `text` are its thinking and its answer; a `tool` part is a call. Shapes measured on
 * 1.18.32 (test/fixtures/v1.jsonl).
 *
 * Anything it does not recognise it returns nothing for, and says so through `unknown` — a new event
 * shape is logged, never guessed at.
 */

import type { Change, ToolState } from "../model/changes.ts"

type Json = Record<string, unknown>
const obj = (value: unknown): Json => (value && typeof value === "object" ? (value as Json) : {})
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)

const TOOL_STATES = new Set<ToolState>(["pending", "running", "completed", "failed"])
const toolState = (status: unknown): ToolState | undefined => {
  if (status === "error") return "failed"
  return TOOL_STATES.has(status as ToolState) ? (status as ToolState) : undefined
}

export interface V1Translator {
  /** One host event as changes. */
  event(event: unknown, at?: number): Change[]
  /** A session's stored messages (each `{ info, parts }`), for one that existed before we did. */
  history(messages: readonly { info: unknown; parts: readonly unknown[] }[], at?: number): Change[]
  /** A session as `session.children` or `state.session.get` returns it. */
  session(info: unknown, at?: number): Change[]
}

export function createV1Translator(unknown: (what: string, detail?: Json) => void = () => {}): V1Translator {
  /** Parts stream by id alone; what kind of part an id is, and whose. */
  const parts = new Map<string, { kind: "thinking" | "reply" | "prompt"; session: string }>()
  /** Message roles, since a part does not carry its message's. */
  const roles = new Map<string, string>()

  const sessionInfo = (info: Json, at: number): Change[] => {
    const id = str(info.id)
    if (!id) return []
    /**
     * The title's `(@general subagent)` names the agent the task tool ran it as. `info.agent` can be
     * the launcher's instead: measured on 1.18.32, a general subagent launched from `build` was stored
     * and announced with `agent: "build"`, and was listed to the main agent as a build subagent.
     */
    const agent = agentOfTitle(str(info.title)) ?? str(info.agent)
    const out: Change[] = [
      {
        type: "session",
        id,
        ...(str(info.parentID) ? { parentID: str(info.parentID) as string } : {}),
        ...(agent ? { agent } : {}),
        ...(str(info.title) ? { title: stripAgentSuffix(str(info.title) as string) } : {}),
        ...(denied(info.permission) ? { denied: denied(info.permission) as string[] } : {}),
        at: Number(obj(info.time).created) || at,
      },
    ]
    const tokens = obj(info.tokens)
    if (typeof info.cost === "number" || Object.keys(tokens).length > 0) {
      out.push({ type: "usage", id, tokens: tokenTotal(tokens), cost: Number(info.cost) || 0, at })
    }
    return out
  }

  const part = (p: Json, at: number): Change[] => {
    const id = str(p.sessionID)
    const partID = str(p.id)
    if (!id || !partID) return []
    const role = roles.get(str(p.messageID) ?? "")
    switch (p.type) {
      case "text":
        if (role === "user") {
          parts.set(partID, { kind: "prompt", session: id })
          return str(p.text) && !p.synthetic
            ? [{ type: "prompt", id, key: partID, text: str(p.text) as string, at }]
            : []
        }
        parts.set(partID, { kind: "reply", session: id })
        return [
          { type: "reply", id, key: partID, text: str(p.text) ?? "", done: Boolean(obj(p.time).end), at },
        ]
      case "reasoning":
        parts.set(partID, { kind: "thinking", session: id })
        return [
          { type: "thinking", id, key: partID, text: str(p.text) ?? "", done: Boolean(obj(p.time).end), at },
        ]
      case "tool": {
        const state = obj(p.state)
        const metadata = obj(state.metadata)
        const status = toolState(state.status)
        const output = str(state.output) ?? (status === "running" ? str(metadata.output) : undefined)
        const time = obj(state.time)
        const input = obj(state.input)
        const summary = summaryOf(str(p.tool), metadata)
        const out: Change[] = [
          {
            type: "tool",
            id,
            call: str(p.callID) ?? partID,
            ...(str(p.tool) ? { name: str(p.tool) as string } : {}),
            ...(status ? { state: status } : {}),
            ...(Object.keys(input).length > 0 ? { input } : {}),
            ...(output !== undefined ? { output } : {}),
            ...(str(state.error) ? { error: str(state.error) as string } : {}),
            ...(typeof time.start === "number" ? { started: time.start } : {}),
            ...(typeof time.end === "number" ? { ended: time.end } : {}),
            ...(summary ? { summary } : {}),
            at,
          },
        ]
        /** The `task` call that launched a subagent names it; `background` is how it was launched. */
        const child = str(metadata.sessionId)
        if (p.tool === "task" && child && input.background === true) {
          out.push({ type: "session", id: child, parentID: id, background: true, at })
        }
        return out
      }
      case "step-finish":
        return [{ type: "step", id, at }]
      case "step-start":
      case "patch":
      case "snapshot":
      case "file":
      case "agent":
      case "compaction":
      case "subtask":
      case "retry":
        return []
      default:
        unknown("part", { type: p.type })
        return []
    }
  }

  /** A message's role, remembered for its parts; an assistant's says the model it ran on. */
  const message = (info: Json, at: number): Change[] => {
    if (str(info.id) && str(info.role)) roles.set(str(info.id) as string, str(info.role) as string)
    const id = str(info.sessionID)
    return id && info.role === "assistant" && str(info.modelID)
      ? [
          {
            type: "session",
            id,
            model: str(info.modelID) as string,
            at: Number(obj(info.time).created) || at,
          },
        ]
      : []
  }

  return {
    event(raw, at = Date.now()) {
      const event = obj(raw)
      const props = obj(event.properties)
      const sessionID = str(props.sessionID)
      switch (event.type) {
        case "session.created":
        case "session.updated":
          return sessionInfo(obj(props.info), at)
        case "session.status": {
          const status = obj(props.status).type
          if (!sessionID) return []
          if (status === "busy" || status === "retry")
            return [{ type: "status", id: sessionID, status: "busy", at }]
          if (status === "idle") return [{ type: "status", id: sessionID, status: "idle", at }]
          return []
        }
        case "session.idle":
          return sessionID ? [{ type: "status", id: sessionID, status: "idle", at }] : []
        case "session.error": {
          if (!sessionID) return []
          const error = obj(props.error)
          const message = str(obj(error.data).message) ?? str(error.name) ?? "failed"
          return [{ type: "status", id: sessionID, status: "failed", error: message, at }]
        }
        case "permission.asked":
        case "question.asked":
          return sessionID ? [{ type: "status", id: sessionID, status: "waiting", at }] : []
        case "permission.replied":
        case "question.replied":
        case "question.rejected":
          return sessionID ? [{ type: "status", id: sessionID, status: "busy", at }] : []
        case "message.updated":
          return message(obj(props.info), at)
        case "message.part.updated":
          return part(obj(props.part), at)
        case "message.part.delta": {
          const known = parts.get(str(props.partID) ?? "")
          const delta = str(props.delta)
          if (!known || !delta || props.field !== "text" || known.kind === "prompt") return []
          return [{ type: known.kind, id: known.session, key: str(props.partID) as string, delta, at }]
        }
        case "session.deleted":
        case "session.diff":
        case "message.removed":
        case "message.part.removed":
        case "todo.updated":
          return []
        default:
          unknown("event", { type: event.type })
          return []
      }
    },
    history(messages, at = Date.now()) {
      const out: Change[] = []
      for (const each of messages) {
        const info = obj(each.info)
        const when = Number(obj(info.time).created) || at
        out.push(...message(info, when))
        for (const p of each.parts) out.push(...part(obj(p), when))
      }
      /**
       * A run that was stopped says so on its last answer (`MessageAbortedError`), not in a status the
       * store keeps — read without it, a cancelled subagent loaded as one that finished.
       */
      const last = obj(messages.at(-1)?.info)
      const error = obj(last.error)
      const id = str(last.sessionID)
      if (id && last.role === "assistant" && (str(error.name) || str(obj(error.data).message))) {
        const ended = Number(obj(last.time).completed) || Number(obj(last.time).created) || at
        out.push({
          type: "status",
          id,
          status: "failed",
          error: str(obj(error.data).message) ?? str(error.name) ?? "failed",
          at: ended,
        })
      }
      return out
    },
    session(info, at = Date.now()) {
      return sessionInfo(obj(info), at)
    },
  }
}

/** `input + output + reasoning + cache`, the host's own total. */
export function tokenTotal(tokens: Json): number {
  const cache = obj(tokens.cache)
  const n = (value: unknown) => (typeof value === "number" ? value : 0)
  return n(tokens.input) + n(tokens.output) + n(tokens.reasoning) + n(cache.read) + n(cache.write)
}

/** OpenCode 1 titles a subagent session "Task title (@explore subagent)"; the agent is shown apart. */
export function stripAgentSuffix(title: string): string {
  return title.replace(/\s*\(@[\w-]+ subagent\)\s*$/, "")
}

/** The agent that suffix names: `general` in "Map the repo (@general subagent)". */
export function agentOfTitle(title: string | undefined): string | undefined {
  return title ? /\(@([\w-]+) subagent\)\s*$/.exec(title)?.[1] : undefined
}

/** Permissions an agent's rules deny outright: `[{ permission: "task", action: "deny" }]`. */
function denied(rules: unknown): string[] | undefined {
  if (!Array.isArray(rules)) return undefined
  const names = rules
    .map((rule) => obj(rule))
    .filter((rule) => rule.action === "deny" && (rule.pattern === undefined || rule.pattern === "*"))
    .map((rule) => str(rule.permission))
    .filter((name): name is string => Boolean(name))
  return names.length > 0 ? [...new Set(names)] : undefined
}

/** A call's result in a few words, when the host gives the number. */
export function summaryOf(tool: string | undefined, metadata: Json): string | undefined {
  if (typeof metadata.matches === "number")
    return `${metadata.matches} match${metadata.matches === 1 ? "" : "es"}`
  if (typeof metadata.count === "number") return `${metadata.count} result${metadata.count === 1 ? "" : "s"}`
  if ((tool === "bash" || tool === "shell") && typeof metadata.exit === "number" && metadata.exit !== 0)
    return `exit ${metadata.exit}`
  return undefined
}
