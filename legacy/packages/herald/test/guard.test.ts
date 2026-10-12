import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inspect, v1Guard, v2Guard } from "../src/guard.ts"
import { ATTACKS, GUARD_ATTACKS, GUARD_CHECK_LINES } from "./support/shell-cases.ts"

/**
 * The shell guard (src/guard.ts) on its own: what it denies before a shell call runs, for each kind
 * of guild role, and that it never looks at anyone else's agent. How its verdicts combine with
 * OpenCode's own rules is in harness.test.ts.
 */

const BUILDERS = ["guild-implementer", "guild-designer"]
const ASKERS = [...BUILDERS, "guild-master"]
const NO_SHELL = [
  "guild-architect",
  "guild-product-owner",
  "guild-explorer",
  "guild-librarian",
  "guild-researcher",
]

/** Lines whose only fault is a write to a protected path, by every route the shell offers. */
const PROTECTED_WRITES = [
  "git status && git diff HEAD > AGENTS.md",
  "git status | git diff > .opencode/agents/x.md",
  "(git show) > CLAUDE.md",
  "{ git show; } > .claude/settings.json",
  "git status && git diff >> .git/hooks/pre-commit",
  "cd .git && git status > hooks/pre-commit",
  "cd .opencode; cd agents; echo x > x.md",
  "git diff > ./.opencode/opencode.jsonc",
  "git diff > ~/.config/opencode/opencode.json",
  "git diff > ../../AGENTS.md",
  "echo $(git diff > AGENTS.md)",
  'echo "`git diff > AGENTS.md`"',
  "bun test >(cat > AGENTS.md)",
  "cat <<EOF > AGENTS.md\nx\nEOF",
  "cat <<EOF\n$(git diff > AGENTS.md)\nEOF",
  "git diff > agents.md",
  'git status && git diff > "AGENTS.md"',
  "git diff > 'CLAUDE'.md",
  "git diff &> opencode.json",
  "git diff 2> skills/x/SKILL.md",
  "git diff >&commands/ship.md",
  "exec 3> .git/config",
  "> AGENTS.md",
  // a target or directory the shell expands can't be checked, so it is refused
  "git diff > $HOME/.config/opencode/x",
  "git diff > AGENTS.*",
  "cd $D && git diff > x",
]

/** Writes, reads and look-alikes that touch no protected path: left to OpenCode (which asks). */
const ORDINARY = [
  "echo '> AGENTS.md'",
  'echo "> AGENTS.md"',
  "echo \\> AGENTS.md",
  "cat <<'EOF'\n> AGENTS.md\nEOF",
  "cat <<EOF\nx > AGENTS.md\nEOF",
  "grep x # > AGENTS.md",
  "cat < AGENTS.md",
  "bun test > test-output.txt",
  "git diff > src/index.ts",
  "bun test 2>/dev/null",
  "bun test >&2",
  "ls 2>&-",
  "rm -rf ~",
  "git status && git diff",
]

const deniedBy = (id: string) => (line: string) => inspect(id, line) !== undefined

describe("the guard: the verifier runs only exact checks", () => {
  test("every attack line is denied by the guard itself", () => {
    const lines = [...ATTACKS, ...GUARD_ATTACKS]
    expect(lines.filter((line) => !deniedBy("guild-verifier")(line))).toEqual([])
  })

  test("the checks pass, alone, chained, after cd and with 2>&1", () => {
    expect(GUARD_CHECK_LINES.filter(deniedBy("guild-verifier"))).toEqual([])
  })

  test("the reason names what was refused, for the agent to read", () => {
    const why = (line: string) => inspect("guild-verifier", line)
    expect(why("git status && git diff HEAD > src/index.ts")).toBe(
      "Guildhall: the Verifier may only run project checks; redirects are not allowed",
    )
    expect(why("git diff $(id)")).toContain("command substitution")
    expect(why("bun test <(id)")).toContain("process substitution")
    expect(why("bun test <<< x")).toContain("here-documents")
    expect(why("(git show) > f")).toContain("grouping")
    expect(why("git status | sh")).toContain("pipes")
    expect(why("git log -p")).toContain("`git log -p` is not one of the exact checks")
  })

  test("'>' in quotes is not read as a redirect, but a quoted check is still not a check", () => {
    const why = inspect("guild-verifier", "git status '>' f")
    expect(why).toContain("quotes")
    expect(why).not.toContain("redirect")
  })

  test("a line it can't read is denied", () => {
    expect(inspect("guild-verifier", "git diff 'HEAD")).toContain("could not be read safely")
    expect(inspect("guild-verifier", { not: "a string" })).toContain("no command")
  })
})

describe("the guard: roles whose shell asks never write a protected path", () => {
  test("every route to a protected path is denied", () => {
    for (const id of ASKERS)
      expect([id, PROTECTED_WRITES.filter((line) => !deniedBy(id)(line))]).toEqual([id, []])
  })

  test("anything else is left to OpenCode's rules", () => {
    for (const id of ASKERS) expect([id, ORDINARY.filter(deniedBy(id))]).toEqual([id, []])
  })

  test("the shell tool's workdir counts as a cd", () => {
    expect(inspect("guild-implementer", "git status > hooks/pre-commit", ".git")).toBe(
      "Guildhall: the Implementer may not write `.git/hooks/pre-commit`: it is a protected path (agent, command and skill definitions, OpenCode's config, AGENTS.md, CLAUDE.md, .claude, .git)",
    )
    expect(inspect("guild-implementer", "git status > hooks/pre-commit", "src")).toBeUndefined()
  })
})

describe("the guard: everyone else", () => {
  test("roles without a shell are denied every call", () => {
    for (const id of NO_SHELL)
      expect([id, inspect(id, "bun test")]).toEqual([id, expect.stringContaining("has no shell")])
  })

  test("non-guild agents are never looked at, whatever they run", () => {
    for (const agent of ["build", "plan", "general", "explore", "my-agent", "guild-impostor"])
      expect([agent, [...GUARD_ATTACKS, ...PROTECTED_WRITES].filter(deniedBy(agent))]).toEqual([agent, []])
  })
})

describe("the guard on OpenCode 1: chat.params, then tool.execute.before", () => {
  const call = (guard: ReturnType<typeof v1Guard>, sessionID: string, tool: string, args: unknown) =>
    guard["tool.execute.before"]({ tool, sessionID, callID: "c" }, { args })

  test("a guild agent's bash call is refused with the reason", async () => {
    const guard = v1Guard(() => {})
    await guard["chat.params"]({ sessionID: "s1", agent: "guild-verifier" })
    await expect(
      call(guard, "s1", "bash", { command: "git status && git diff HEAD > src/index.ts" }),
    ).rejects.toThrow("Guildhall: the Verifier may only run project checks; redirects are not allowed")
    await expect(call(guard, "s1", "bash", { command: "bun test 2>&1" })).resolves.toBeUndefined()
  })

  test("the workdir argument is honoured", async () => {
    const guard = v1Guard(() => {})
    await guard["chat.params"]({ sessionID: "s1", agent: "guild-implementer" })
    await expect(call(guard, "s1", "bash", { command: "echo > hooks/x", workdir: ".git" })).rejects.toThrow(
      "protected",
    )
  })

  test("OpenCode's hidden title agent on the same session doesn't unguard it", async () => {
    const guard = v1Guard(() => {})
    await guard["chat.params"]({ sessionID: "s1", agent: "guild-verifier" })
    await guard["chat.params"]({ sessionID: "s1", agent: "title" })
    await expect(call(guard, "s1", "bash", { command: "> src/index.ts" })).rejects.toThrow("Guildhall")
  })

  test("the user's agents, other sessions and other tools are untouched", async () => {
    const guard = v1Guard(() => {})
    await guard["chat.params"]({ sessionID: "mine", agent: "build" })
    await guard["chat.params"]({ sessionID: "guild", agent: "guild-verifier" })
    const attack = { command: "git status && git diff HEAD > AGENTS.md" }
    await expect(call(guard, "mine", "bash", attack)).resolves.toBeUndefined()
    await expect(call(guard, "unknown", "bash", attack)).resolves.toBeUndefined()
    await expect(call(guard, "guild", "read", { filePath: "AGENTS.md" })).resolves.toBeUndefined()
  })

  test("switching a session from a guild agent to the user's own releases it", async () => {
    const guard = v1Guard(() => {})
    await guard["chat.params"]({ sessionID: "s1", agent: "guild-verifier" })
    await guard["chat.params"]({ sessionID: "s1", agent: "build" })
    await expect(call(guard, "s1", "bash", { command: "ls > x" })).resolves.toBeUndefined()
  })
})

describe("the guard on OpenCode 2: tool execute.before", () => {
  const guard = v2Guard(() => {})

  test("a guild agent's shell call is refused with the reason", () => {
    expect(() =>
      guard({ tool: "shell", agent: "guild-verifier", input: { command: "(git show) > src/index.ts" } }),
    ).toThrow("Guildhall: the Verifier may only run project checks; grouping with ( ) is not allowed")
    expect(() =>
      guard({
        tool: "shell",
        agent: "guild-designer",
        input: { command: "git diff > x", workdir: ".claude" },
      }),
    ).toThrow("protected")
  })

  test("checks, other tools and the user's agents pass", () => {
    expect(
      guard({ tool: "shell", agent: "guild-verifier", input: { command: "bun test 2>&1" } }),
    ).toBeUndefined()
    expect(guard({ tool: "edit", agent: "guild-verifier", input: { command: "> f" } })).toBeUndefined()
    expect(
      guard({ tool: "shell", agent: "build", input: { command: "git diff > AGENTS.md" } }),
    ).toBeUndefined()
  })
})

describe("the herald registers the guard on both versions", () => {
  // The herald logs at import; keep its log out of the user's cache.
  process.env.GUILDHALL_HOME = mkdtempSync(join(tmpdir(), "guildhall-guard-"))

  test("v1: server() returns chat.params and tool.execute.before, unless agents are off", async () => {
    const herald = (await import("../src/index.ts")).default
    const hooks = (await herald.server({ directory: "/tmp/x" })) as unknown as ReturnType<typeof v1Guard>
    await hooks["chat.params"]({ sessionID: "s", agent: "guild-verifier" })
    await expect(
      hooks["tool.execute.before"]({ tool: "bash", sessionID: "s" }, { args: { command: "a && b > f" } }),
    ).rejects.toThrow("Guildhall")
    const off = await herald.server({ directory: "/tmp/x" }, { agents: false })
    expect("tool.execute.before" in off).toBe(false)
  })

  test("v2: setup() hooks tool execute.before, unless agents are off", async () => {
    const herald = (await import("../src/index.ts")).default
    const hooked: string[] = []
    let callback: ((call: { tool: string; agent: string; input: unknown }) => void) | undefined
    const ctx = (options?: unknown) => ({
      options,
      location: { directory: "/tmp/x" },
      tool: {
        hook: async (name: string, cb: typeof callback) => {
          hooked.push(name)
          callback = cb
          return {}
        },
      },
    })
    await herald.setup(ctx())
    expect(hooked).toEqual(["execute.before"])
    expect(() => callback?.({ tool: "shell", agent: "guild-verifier", input: { command: "> f" } })).toThrow(
      "Guildhall",
    )
    await herald.setup(ctx({ agents: false }))
    expect(hooked).toEqual(["execute.before"])
  })
})
