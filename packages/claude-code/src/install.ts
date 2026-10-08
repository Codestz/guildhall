import { fileURLToPath } from "node:url"

/**
 * `bun packages/claude-code/src/install.ts --print` — prints the `hooks` block to add to a Claude
 * Code settings file (`~/.claude/settings.json` for every project, `.claude/settings.local.json` for
 * one). It prints only: it never edits a settings file.
 */

/** The events the hook translates (src/translate.ts); every other one would only cost a process. */
export const EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "PermissionDenied",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "StopFailure",
  "SessionEnd",
] as const

/**
 * Seconds Claude Code allows the hook. It finishes in tens of ms and bounds its own wait on the hub;
 * this is the backstop for a machine under load, not the budget.
 */
const TIMEOUT_S = 5

export interface HookCommand {
  type: "command"
  command: string
  timeout: number
}

export function settings(
  hook = fileURLToPath(new URL("./hook.ts", import.meta.url)),
  bun = "bun",
): { hooks: Record<string, { hooks: HookCommand[] }[]> } {
  const command = `${bun} ${JSON.stringify(hook)}`
  const hooks: Record<string, { hooks: HookCommand[] }[]> = {}
  // No matcher: every tool, every notification type, every agent type.
  for (const event of EVENTS) hooks[event] = [{ hooks: [{ type: "command", command, timeout: TIMEOUT_S }] }]
  return { hooks }
}

if (import.meta.main) {
  if (process.argv.includes("--print")) {
    console.log(JSON.stringify(settings(), null, 2))
  } else {
    console.error(
      "usage: bun packages/claude-code/src/install.ts --print\n" +
        "Prints the hooks block to merge into ~/.claude/settings.json (or a project's " +
        ".claude/settings.local.json). Nothing is written.",
    )
    process.exit(1)
  }
}
