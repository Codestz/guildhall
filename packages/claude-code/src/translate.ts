import type { Change } from "@guildhall/core"
import { type ArchetypeId, ROLES } from "@guildhall/roster"

/**
 * Claude Code's hook events, translated into the world's `Change`s. Pure and stateless: every hook
 * runs as its own process, so each payload is translated on its own, and every change it makes is
 * one the model can take twice (a repeated `session` or `status` changes nothing).
 *
 * Shapes are Claude Code's documented hook inputs (https://code.claude.com/docs/en/hooks):
 *
 *   - the conversation is a session (`session_id`); a subagent is a session of its own, named by the
 *     `agent_id` its events carry, under the conversation that launched it;
 *   - tools are deeds: `PreToolUse` starts one, `PostToolUse` completes it, `PostToolUseFailure` and
 *     `PermissionDenied` fail it (a shell command that ran and exited non-zero is a *completed* call
 *     with its exit code, as on OpenCode, so core's `failedDeed` decides whether that is red work);
 *   - `PermissionRequest` and a permission or elicitation `Notification` are pleas (`waiting`);
 *   - `Stop` / `SubagentStop` are loot (`idle`, with the last answer as the reply), `StopFailure` a
 *     failure.
 */

/** Text kept from a tool's result: enough for the transcript, small enough for a hook to send fast. */
export const MAX_OUTPUT = 16_000

/** What every hook payload carries (the documented common input fields), plus the event's own. */
export interface HookInput {
  hook_event_name: string
  session_id: string
  prompt_id?: string
  cwd?: string
  /** Set when the hook fires inside a subagent: that subagent's id. */
  agent_id?: string
  /** The subagent's type (`Explore`, `my-plugin:reviewer`), or the session's `--agent`. */
  agent_type?: string
  [field: string]: unknown
}

export function translate(payload: unknown, at: number): Change[] {
  if (!isInput(payload)) return []
  const input = payload
  const main = input.session_id
  const actor = input.agent_id ? subagentId(input.agent_id) : main
  /** A subagent's every event says where it belongs, so the tree holds even if its start was missed. */
  const join: Change[] = input.agent_id ? [sessionOf(input, actor, main, at)] : []
  switch (input.hook_event_name) {
    case "SessionStart":
      return [
        {
          type: "session",
          id: main,
          ...(str(input.model) ? { model: str(input.model) } : {}),
          ...(str(input.session_title) ? { title: str(input.session_title) } : {}),
          ...(input.agent_type ? actorOf(input.agent_type) : {}),
          at,
        },
      ]
    case "UserPromptSubmit": {
      const text = str(input.prompt)
      if (text === undefined) return []
      return [
        ...join,
        { type: "prompt", id: actor, key: input.prompt_id ?? `prompt-${at}`, text, at },
        { type: "status", id: actor, status: "busy", at },
      ]
    }
    case "PreToolUse": {
      const call = str(input.tool_use_id)
      if (!call) return []
      return [
        ...join,
        { type: "status", id: actor, status: "busy", at },
        { type: "tool", id: actor, call, ...deedOf(input), state: "running", started: at, at },
      ]
    }
    case "PostToolUse": {
      const call = str(input.tool_use_id)
      if (!call) return []
      const output = outputOf(input.tool_response)
      return [
        ...join,
        { type: "status", id: actor, status: "busy", at },
        {
          type: "tool",
          id: actor,
          call,
          ...deedOf(input),
          state: "completed",
          ...(output === undefined ? {} : { output }),
          ...startedOf(input, at),
          ended: at,
          at,
        },
        ...questOf(input, actor, call, at),
      ]
    }
    case "PostToolUseFailure": {
      const call = str(input.tool_use_id)
      if (!call) return []
      return [
        ...join,
        { type: "status", id: actor, status: "busy", at },
        {
          type: "tool",
          id: actor,
          call,
          ...deedOf(input),
          ...failureOf(input),
          ...startedOf(input, at),
          ended: at,
          at,
        },
      ]
    }
    case "PermissionDenied": {
      const call = str(input.tool_use_id)
      if (!call) return []
      const reason = str(input.reason) ?? "denied"
      return [
        ...join,
        { type: "tool", id: actor, call, ...deedOf(input), state: "failed", error: reason, ended: at, at },
      ]
    }
    case "PermissionRequest":
      return [...join, { type: "status", id: actor, status: "waiting", at }]
    case "Notification":
      return PLEAS.has(str(input.notification_type) ?? "")
        ? [...join, { type: "status", id: actor, status: "waiting", at }]
        : []
    case "SubagentStart":
      if (!input.agent_id) return []
      return [...join, { type: "status", id: actor, status: "busy", at }]
    case "SubagentStop":
      // Claude Code's own helpers (prompt suggestions, `/btw`) stop with an empty type: not a party member.
      if (!input.agent_id || !input.agent_type) return []
      return [...join, ...replyOf(input, actor, at), { type: "status", id: actor, status: "idle", at }]
    case "Stop":
      return [...replyOf(input, main, at), { type: "status", id: main, status: "idle", at }]
    case "StopFailure":
      return [
        {
          type: "status",
          id: main,
          status: "failed",
          error: str(input.last_assistant_message) ?? str(input.error) ?? "failed",
          at,
        },
      ]
    case "SessionEnd":
      return [{ type: "status", id: main, status: "idle", at }]
    default:
      // PreCompact and the rest have nothing in the vocabulary to say.
      return []
  }
}

/** Notification types that hold the agent on a human: a permission prompt, an MCP elicitation. */
const PLEAS = new Set(["permission_prompt", "elicitation_dialog", "elicitation_url_dialog"])

/**
 * A subagent's session id. Claude Code's examples spell the same id bare (`a4d2c8f1…`, a tool
 * result's `agentId`) and prefixed (`agent-abc123`, a transcript's file name): one id for both.
 */
export function subagentId(agentId: string): string {
  return agentId.replace(/^agent-/, "")
}

const ROLE_IDS: ReadonlySet<string> = new Set(ROLES.map((role) => role.id))

/** Claude Code's own subagent types, by the archetype that does their work in the world. */
const BUILT_IN: Readonly<Record<string, ArchetypeId>> = {
  Explore: "scout",
  Plan: "architect",
}

/**
 * The agent name the world knows a Claude Code agent type by: a roster role when the name matches
 * one (`implementer`, `agentry:implementer`, `guild-implementer` → `guild-implementer`), else the
 * type as Claude Code names it (`Explore`, `general-purpose`).
 */
export function agentOf(type: string): string {
  const bare = type
    .slice(type.lastIndexOf(":") + 1)
    .trim()
    .toLowerCase()
  const id = bare.startsWith("guild-") ? bare : `guild-${bare}`
  return ROLE_IDS.has(id) ? id : type
}

/**
 * A session change's `agent`, plus the `archetype` for a built-in type that does an archetype's work
 * (`Explore` → the Scout, `Plan` → the Architect: PROTOCOL.md §1.1). Anything else is drawn from
 * its agent name (a roster role's archetype, or a Wanderer).
 */
export function actorOf(type: string): { agent: string; archetype?: ArchetypeId } {
  const archetype = BUILT_IN[type]
  return archetype ? { agent: type, archetype } : { agent: agentOf(type) }
}

/**
 * Claude Code's tool names, as the world spells deeds: OpenCode's lower-case names (`bash`, `read`,
 * `task`, …), which is what deed looks, quests and outcomes read. MCP tools (`mcp__server__tool`)
 * keep their name.
 */
export function deedName(tool: string): string {
  if (tool.startsWith("mcp__")) return tool
  return NAMES[tool] ?? tool.toLowerCase()
}

const NAMES: Record<string, string> = {
  /** The subagent tool, `Task` before Claude Code renamed it. A quest. */
  Agent: "task",
  Task: "task",
  /** OpenCode 2's name for its shell, read as `bash`. */
  PowerShell: "shell",
}

/** Input keys renamed to the spelling the world reads (`filePath`, `newString`); the rest kept. */
const KEYS: Record<string, string> = {
  file_path: "filePath",
  notebook_path: "filePath",
  old_string: "oldString",
  new_string: "newString",
}

export function deedInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) out[KEYS[key] ?? key] = value
  return out
}

function deedOf(input: HookInput): { name?: string; input?: Record<string, unknown> } {
  const name = str(input.tool_name)
  const args = record(input.tool_input)
  return { ...(name ? { name: deedName(name) } : {}), ...(args ? { input: deedInput(args) } : {}) }
}

/** A shell tool's failure that is really an answer: the command ran and exited non-zero. */
const SHELLS = new Set(["Bash", "PowerShell"])
const EXIT = /^Exit code (-?\d+)\s*(?:\n|$)/

function failureOf(
  input: HookInput,
): Pick<Extract<Change, { type: "tool" }>, "state" | "exit" | "error" | "output"> {
  const error = str(input.error) ?? "failed"
  if (input.is_interrupt === true) return { state: "failed", error: "interrupted" }
  const exit = SHELLS.has(str(input.tool_name) ?? "") ? EXIT.exec(error) : null
  if (exit) return { state: "completed", exit: Number(exit[1]), output: cap(error.slice(exit[0].length)) }
  return { state: "failed", error: cap(error) }
}

/** When the call itself started, from the run time Claude Code reports with its result. */
function startedOf(input: HookInput, at: number): { started?: number } {
  const ms = input.duration_ms
  return typeof ms === "number" && Number.isFinite(ms) && ms >= 0 && ms < at ? { started: at - ms } : {}
}

/**
 * A subagent launched by an `Agent` call: its result names it (`agentId`), so the quest's child is
 * linked to its task here — `SubagentStart` says neither what it was asked nor who asked. A
 * foreground subagent's result comes once it has finished, so both are dated when the call began:
 * its run time is measured from its task.
 */
function questOf(input: HookInput, parent: string, call: string, now: number): Change[] {
  if (deedName(str(input.tool_name) ?? "") !== "task") return []
  const agentId = str(record(input.tool_response)?.agentId)
  if (!agentId) return []
  const args = record(input.tool_input) ?? {}
  const id = subagentId(agentId)
  const type = str(args.subagent_type)
  const title = str(args.description)
  const task = str(args.prompt)
  const at = startedOf(input, now).started ?? now
  return [
    {
      type: "session",
      id,
      parentID: parent,
      ...(type ? actorOf(type) : {}),
      ...(title ? { title } : {}),
      at,
    },
    ...(task ? [{ type: "prompt" as const, id, key: `task-${call}`, text: task, at }] : []),
  ]
}

function sessionOf(input: HookInput, id: string, parentID: string, at: number): Change {
  return {
    type: "session",
    id,
    parentID,
    ...(input.agent_type ? actorOf(input.agent_type) : {}),
    at,
  }
}

function replyOf(input: HookInput, id: string, at: number): Change[] {
  const text = str(input.last_assistant_message)
  if (!text) return []
  return [{ type: "reply", id, key: `reply-${input.prompt_id ?? at}`, text: cap(text), done: true, at }]
}

/** A tool's result as text: a shell's output, a subagent's answer, a file read, else its JSON. */
export function outputOf(response: unknown): string | undefined {
  if (response === undefined || response === null) return undefined
  if (typeof response === "string") return cap(response)
  const fields = record(response)
  if (fields) {
    if (typeof fields.stdout === "string" || typeof fields.stderr === "string")
      return cap([fields.stdout, fields.stderr].filter((s) => typeof s === "string" && s).join("\n"))
    if (Array.isArray(fields.content)) {
      const text = fields.content.flatMap((block) => (typeof block?.text === "string" ? [block.text] : []))
      if (text.length > 0) return cap(text.join("\n"))
    }
    const file = record(fields.file)
    if (typeof file?.content === "string") return cap(file.content)
  }
  try {
    return cap(JSON.stringify(response))
  } catch {
    return undefined
  }
}

function cap(text: string): string {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}…` : text
}

function isInput(value: unknown): value is HookInput {
  const fields = record(value)
  return (
    !!fields &&
    typeof fields.hook_event_name === "string" &&
    typeof fields.session_id === "string" &&
    fields.session_id.length > 0 &&
    (fields.agent_id === undefined || (typeof fields.agent_id === "string" && fields.agent_id.length > 0)) &&
    (fields.agent_type === undefined || typeof fields.agent_type === "string") &&
    (fields.prompt_id === undefined || typeof fields.prompt_id === "string")
  )
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}
