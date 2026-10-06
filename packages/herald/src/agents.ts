import { type Access, type Permissions, ROLES, type Role, type Rules } from "@guildhall/roster"

/**
 * The guild's agents, written into OpenCode in memory (ADR 0002, docs/harness.md). The roster
 * says what each role is in OpenCode-neutral words; this module speaks each version's dialect:
 *
 *   v1 (1.18)  the server `config` hook: `cfg.agent[id] = { ...ours, ...theirs }`, so the user wins
 *   v2 (2.0)   `ctx.agent.transform(e => e.update(id, …))`; OpenCode applies user config afterwards
 *
 * Neither ever sets `default_agent`: the user picks the Guildmaster with Tab / shift+tab.
 */

/** The herald's plugin options: `["opencode-guildhall", { agents: false }]`. */
export interface HeraldOptions {
  /** `false` ships no agents at all, on either version. */
  agents?: boolean
  /**
   * `provider/model` per tier (`strong`, `standard`, `fast`) or per agent id (`guild-explorer`);
   * an id beats its tier. A role with neither inherits the model the user runs.
   */
  models?: Record<string, string>
}

const TIERS = new Set(["strong", "standard", "fast"])
const MODEL = /^[^/\s]+\/\S+$/

/** Options as OpenCode hands them over: anything, from a hand-written config. */
export function readOptions(raw: unknown, log: (message: string) => void): HeraldOptions {
  if (typeof raw !== "object" || raw === null) return {}
  const { agents, models } = raw as Record<string, unknown>
  const options: HeraldOptions = {}
  if (agents === false) options.agents = false
  if (typeof models === "object" && models !== null) {
    options.models = {}
    for (const [key, value] of Object.entries(models)) {
      if (!TIERS.has(key) && !ROLES.some((role) => role.id === key))
        log(`models: unknown key "${key}", ignored`)
      else if (typeof value !== "string" || !MODEL.test(value))
        log(`models.${key}: expected "provider/model", got ${JSON.stringify(value)}; ignored`)
      else options.models[key] = value
    }
  }
  return options
}

/** The model a role runs on, or undefined to inherit the user's. */
export function modelOf(role: Role, models: HeraldOptions["models"]): string | undefined {
  return models?.[role.id] ?? models?.[role.tier]
}

// ---- OpenCode 1 ----------------------------------------------------------------------------

export type V1Rules = Access | Record<string, Access>

export interface V1Agent {
  description: string
  mode: Role["mode"]
  prompt: string
  color: string
  model?: string
  permission: Record<string, V1Rules>
}

function copy(rules: Rules): V1Rules {
  return typeof rules === "string" ? rules : { ...rules }
}

/** v1's `permission` object. The pattern order is kept: v1's last matching rule wins. */
export function v1Permission(permissions: Permissions): Record<string, V1Rules> {
  return {
    edit: copy(permissions.edit),
    bash: copy(permissions.bash),
    webfetch: permissions.web,
    websearch: permissions.web,
    task:
      permissions.dispatch.length === 0
        ? "deny"
        : { "*": "deny", ...Object.fromEntries(permissions.dispatch.map((id) => [id, "allow" as const])) },
  }
}

export function v1Agent(role: Role, models?: HeraldOptions["models"]): V1Agent {
  const model = modelOf(role, models)
  return {
    description: role.description,
    mode: role.mode,
    prompt: role.prompt,
    color: role.color,
    ...(model ? { model } : {}),
    permission: v1Permission(role.permissions),
  }
}

/**
 * The v1 `config` hook's edit. Merged beneath the user's own entry for the same id, so their
 * fields win and their `disable: true` is honoured (measured: an assignment re-enabled it).
 */
export function injectV1(cfg: { agent?: Record<string, unknown> }, options: HeraldOptions): void {
  if (options.agents === false) return
  cfg.agent ??= {}
  for (const role of ROLES) {
    const theirs = cfg.agent[role.id]
    cfg.agent[role.id] = { ...v1Agent(role, options.models), ...(isObject(theirs) ? theirs : {}) }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

// ---- OpenCode 2 ----------------------------------------------------------------------------

/** One v2 permission rule (`@opencode/schema` Agent.Info.permissions); the last match wins. */
export interface V2Rule {
  action: string
  resource: string
  effect: Access
}

function rules(action: string, rules: Rules): V2Rule[] {
  if (typeof rules === "string") return [{ action, resource: "*", effect: rules }]
  return Object.entries(rules).map(([resource, effect]) => ({ action, resource, effect }))
}

/** v2's ordered rules: `bash` is `shell`, `task` is `subagent`. */
export function v2Permissions(permissions: Permissions): V2Rule[] {
  return [
    ...rules("edit", permissions.edit),
    ...rules("shell", permissions.bash),
    ...rules("webfetch", permissions.web),
    ...rules("websearch", permissions.web),
    { action: "subagent", resource: "*", effect: "deny" },
    ...permissions.dispatch.map((id): V2Rule => ({ action: "subagent", resource: id, effect: "allow" })),
  ]
}

/** The part of v2's `Agent.Info` the guild writes (the editor hands over a mutable copy). */
export interface V2Agent {
  description?: string
  mode: string
  system?: string
  color?: string
  model?: { id: string; providerID: string }
  permissions: V2Rule[]
}

export interface V2AgentEditor {
  update(id: string, update: (agent: V2Agent) => void): void
}

export interface V2AgentDomain {
  transform(transform: (editor: V2AgentEditor) => void): unknown
}

/** `openrouter/deepseek/deepseek-v4` → provider `openrouter`, model `deepseek/deepseek-v4`. */
function v2Model(model: string): { id: string; providerID: string } {
  const slash = model.indexOf("/")
  return { providerID: model.slice(0, slash), id: model.slice(slash + 1) }
}

/** Writes one role into the agent v2's editor hands over (its defaults, on first sight). */
export function v2Agent(agent: V2Agent, role: Role, models?: HeraldOptions["models"]): void {
  agent.description = role.description
  agent.mode = role.mode
  agent.system = role.prompt
  agent.color = role.color
  const model = modelOf(role, models)
  if (model) agent.model = v2Model(model)
  // Ours go last so they win over v2's defaults (allow `*`, ask for .env and outside paths),
  // which stay. Ours are dropped first, so a transform that runs again doesn't stack them.
  const ours = v2Permissions(role.permissions)
  const key = (rule: V2Rule) => `${rule.action}\0${rule.resource}\0${rule.effect}`
  const mine = new Set(ours.map(key))
  agent.permissions = [...agent.permissions.filter((rule) => !mine.has(key(rule))), ...ours]
}

/**
 * The v2 transform. `update` on an unknown id creates the agent (measured on 2.0.18, not
 * documented); the user's `agents.<id>` config is applied after it, field by field, so it wins.
 * The callback stays synchronous and side-effect free, as v2's docs ask.
 */
export function injectV2(agents: V2AgentDomain, options: HeraldOptions): void {
  if (options.agents === false) return
  agents.transform((editor) => {
    for (const role of ROLES) editor.update(role.id, (agent) => v2Agent(agent, role, options.models))
  })
}
