// from opencode-cockpit: packages/subagents/src/core/adapt/v2.ts (ADR 0001)
/**
 * OpenCode 2's events and state, as changes.
 *
 * OpenCode 2 names what happened: `session.reasoning.delta`, `session.tool.called`,
 * `session.execution.succeeded`. Its interface context hands them over as
 * `{ name, details: { data } }` (`ctx.data.listen`). Thinking and text are keyed by the assistant
 * message and their ordinal in it; a tool call by its id; what the session was told arrives as an
 * inbox item. Shapes measured on 2.0.15 (test/fixtures/v2.jsonl).
 */

import type { Change } from "../model/changes.ts"
import { summaryOf, tokenTotal } from "./v1.ts"

type Json = Record<string, unknown>
const obj = (value: unknown): Json => (value && typeof value === "object" ? (value as Json) : {})
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)

/** A tool's result as text: v2 returns content parts. */
const contentText = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .map((part) => str(obj(part).text) ?? "")
        .filter(Boolean)
        .join("\n")
    : (str(content) ?? "")

export interface V2Translator {
  event(event: unknown, at?: number): Change[]
  /** One session's loaded messages (`ctx.data.session.message.list(id)`). */
  history(id: string, messages: readonly unknown[], at?: number): Change[]
  /** A session as `ctx.data.session.list()` returns it. */
  session(info: unknown, at?: number): Change[]
  /** A status as `ctx.data.session.status(id)` returns it: "busy", "idle"… */
  status(id: string, status: unknown, at?: number): Change[]
}

export function createV2Translator(unknown: (what: string, detail?: Json) => void = () => {}): V2Translator {
  const sessionInfo = (info: Json, at: number): Change[] => {
    const id = str(info.sessionID) ?? str(info.id)
    if (!id) return []
    return [
      {
        type: "session",
        id,
        ...(str(info.parentID) ? { parentID: str(info.parentID) as string } : {}),
        ...(str(info.agent) ? { agent: str(info.agent) as string } : {}),
        ...(str(info.title) ? { title: str(info.title) as string } : {}),
        ...(str(obj(info.model).id) ? { model: str(obj(info.model).id) as string } : {}),
        at: Number(obj(info.time).created) || at,
      },
    ]
  }

  const statusChange = (id: string, value: unknown, at: number): Change[] => {
    const status = str(value) ?? str(obj(value).type)
    if (status === "busy" || status === "running" || status === "retry")
      return [{ type: "status", id, status: "busy", at }]
    if (status === "idle") return [{ type: "status", id, status: "idle", at }]
    return []
  }

  /** `subagent` calls launched with `background: true`, until their child session is named. */
  const background = new Set<string>()

  return {
    event(raw, at = Date.now()) {
      const event = obj(raw)
      const name = str(event.name) ?? str(event.type)
      /** The interface's events carry `details.data`; the agent side's carry `data`. */
      const details = obj(event.details)
      const data = obj("data" in details ? details.data : event.data)
      const id = str(data.sessionID)
      if (!name) return []
      const key = () => `${str(data.assistantMessageID) ?? "?"}:${String(data.ordinal ?? 0)}`
      switch (name) {
        case "session.created":
        case "session.renamed":
          return sessionInfo(data, at)
        case "session.execution.started":
          return id ? [{ type: "status", id, status: "busy", at }] : []
        case "session.execution.succeeded":
          return id ? [{ type: "status", id, status: "idle", at }] : []
        case "session.execution.failed":
        case "session.execution.interrupted": {
          if (!id) return []
          const error =
            str(data.message) ??
            str(obj(data.error).message) ??
            (name.endsWith("interrupted") ? "interrupted" : "failed")
          return [{ type: "status", id, status: "failed", error, at }]
        }
        case "session.inbox.enqueued": {
          const item = obj(data.item)
          const text = str(obj(item.payload).text)
          return id && text && item.type === "user"
            ? [{ type: "prompt", id, key: str(data.inboxID) ?? `${at}`, text, at }]
            : []
        }
        case "session.reasoning.started":
          return id ? [{ type: "thinking", id, key: `r:${key()}`, text: "", at }] : []
        case "session.reasoning.delta":
          return id && str(data.delta)
            ? [{ type: "thinking", id, key: `r:${key()}`, delta: str(data.delta) as string, at }]
            : []
        case "session.reasoning.ended":
          return id
            ? [
                {
                  type: "thinking",
                  id,
                  key: `r:${key()}`,
                  ...(str(data.text) !== undefined ? { text: str(data.text) as string } : {}),
                  done: true,
                  at,
                },
              ]
            : []
        case "session.text.started":
          return id ? [{ type: "reply", id, key: `t:${key()}`, text: "", at }] : []
        case "session.text.delta":
          return id && str(data.delta)
            ? [{ type: "reply", id, key: `t:${key()}`, delta: str(data.delta) as string, at }]
            : []
        case "session.text.ended":
          return id
            ? [
                {
                  type: "reply",
                  id,
                  key: `t:${key()}`,
                  ...(str(data.text) !== undefined ? { text: str(data.text) as string } : {}),
                  done: true,
                  at,
                },
              ]
            : []
        case "session.tool.input.started":
          return id && str(data.id)
            ? [
                {
                  type: "tool",
                  id,
                  call: str(data.id) as string,
                  ...(str(data.name) ? { name: str(data.name) as string } : {}),
                  state: "pending",
                  at,
                },
              ]
            : []
        case "session.step.ended":
          return id ? [{ type: "step", id, at }] : []
        case "session.tool.called":
          if (obj(data.input).background === true && str(data.id)) background.add(str(data.id) as string)
          return id && str(data.id)
            ? [
                {
                  type: "tool",
                  id,
                  call: str(data.id) as string,
                  state: "running",
                  input: obj(data.input),
                  started: at,
                  at,
                },
              ]
            : []
        case "session.tool.progress": {
          const metadata = obj(data.metadata)
          const output = str(metadata.output)
          const out: Change[] = []
          if (id && str(data.id) && output !== undefined)
            out.push({ type: "tool", id, call: str(data.id) as string, output, at })
          /** A background subagent's call names its child as it starts. */
          const child = str(metadata.sessionID)
          if (id && child && background.has(str(data.id) ?? ""))
            out.push({ type: "session", id: child, parentID: id, background: true, at })
          return out
        }
        case "session.tool.success":
          return id && str(data.id)
            ? [
                {
                  type: "tool",
                  id,
                  call: str(data.id) as string,
                  state: "completed",
                  output: contentText(data.content),
                  ...(summaryOf(undefined, obj(data.metadata))
                    ? { summary: summaryOf(undefined, obj(data.metadata)) as string }
                    : {}),
                  at,
                },
              ]
            : []
        case "session.tool.failed": {
          const error =
            str(obj(data.error).message) ?? str(data.error) ?? contentText(data.content) ?? "failed"
          return id && str(data.id)
            ? [{ type: "tool", id, call: str(data.id) as string, state: "failed", error, at }]
            : []
        }
        /** The input streaming in; `session.tool.called` carries it whole. */
        case "session.tool.input.delta":
        case "session.tool.input.ended":
          return []
        case "session.usage.updated":
          return id
            ? [{ type: "usage", id, tokens: tokenTotal(obj(data.tokens)), cost: Number(data.cost) || 0, at }]
            : []
        case "session.status":
          return id ? statusChange(id, data.status, at) : []
        /**
         * Held on a person (a plea): measured on 2.0.18 with `"permission": { "bash": "ask" }` —
         * `permission.asked` carries `data.sessionID`, `action: "shell"` and the commands. Cockpit's
         * v2 translator never mapped it, so pleas never showed (guildhall-validation.md).
         */
        case "permission.asked":
        case "question.asked":
          return id ? [{ type: "status", id, status: "waiting", at }] : []
        case "permission.replied":
        case "question.replied":
        case "question.rejected":
          return id ? [{ type: "status", id, status: "busy", at }] : []
        default:
          // Deltas of kinds we do not draw, bookkeeping, and everything not about a session.
          if (
            /^(session\.(inbox|step|instructions|compaction|revert|usage|permissions|model|agent|moved|synthetic|shell|skill|metadata|message|forked|retry|diff)|shell\.|skill\.|catalog\.|mcp\.|lsp\.|file\.|vcs\.|project\.|pty\.)/.test(
              name,
            )
          )
            return []
          unknown("event", { name })
          return []
      }
    },
    history(id, messages, at = Date.now()) {
      const out: Change[] = []
      /** A message's tokens are its own; the session's total is their sum (live events send the total). */
      let tokens = 0
      let cost = 0
      let counted = false
      for (const raw of messages) {
        const message = obj(raw)
        const when = Number(obj(message.time).created) || at
        const mid = str(message.id) ?? `${when}`
        if (message.type === "user" && str(message.text)) {
          out.push({ type: "prompt", id, key: mid, text: str(message.text) as string, at: when })
          continue
        }
        if (message.type !== "assistant") continue
        out.push({ type: "step", id, at: when })
        if (str(obj(message.model).id))
          out.push({ type: "session", id, model: str(obj(message.model).id) as string, at: when })
        const content = Array.isArray(message.content) ? message.content : []
        /** Live events number thinking and text blocks separately; the keys must match across a reload. */
        let thought = 0
        let wrote = 0
        for (const partRaw of content) {
          const part = obj(partRaw)
          const time = obj(part.time)
          const partAt = Number(time.created) || when
          if (part.type === "reasoning") {
            out.push({
              type: "thinking",
              id,
              key: `r:${mid}:${thought++}`,
              text: str(part.text) ?? "",
              done: true,
              at: partAt,
            })
          } else if (part.type === "text") {
            out.push({
              type: "reply",
              id,
              key: `t:${mid}:${wrote++}`,
              text: str(part.text) ?? "",
              done: true,
              at: partAt,
            })
          } else if (part.type === "tool" && str(part.id)) {
            const state = obj(part.state)
            const status = str(state.status)
            const ended =
              status === "completed"
                ? "completed"
                : status === "failed" || status === "error"
                  ? "failed"
                  : undefined
            out.push({
              type: "tool",
              id,
              call: str(part.id) as string,
              ...(str(part.name) ? { name: str(part.name) as string } : {}),
              state: "running",
              input: obj(state.input),
              started: Number(time.ran) || partAt,
              at: partAt,
            })
            /** A second change carries the ending, so the call keeps when it started and when it ended. */
            if (ended) {
              out.push({
                type: "tool",
                id,
                call: str(part.id) as string,
                state: ended,
                output: contentText(state.content),
                ...(str(obj(state.error).message) ? { error: str(obj(state.error).message) as string } : {}),
                ...(summaryOf(str(part.name), obj(state.metadata))
                  ? { summary: summaryOf(str(part.name), obj(state.metadata)) as string }
                  : {}),
                ended: Number(time.completed) || partAt,
                at: Number(time.completed) || partAt,
              })
            }
          }
        }
        if (Object.keys(obj(message.tokens)).length > 0) {
          tokens += tokenTotal(obj(message.tokens))
          cost += Number(message.cost) || 0
          counted = true
        }
      }
      /** Stamped with the run's own last moment: "now" made a reopened run look like it ended now. */
      const latest = out.reduce((most, change) => Math.max(most, change.at), 0) || at
      if (counted) out.push({ type: "usage", id, tokens, cost, at: latest })
      return out
    },
    session(info, at = Date.now()) {
      return sessionInfo(obj(info), at)
    },
    status(id, status, at = Date.now()) {
      return statusChange(id, status, at)
    },
  }
}
