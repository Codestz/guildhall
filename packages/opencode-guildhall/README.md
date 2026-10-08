# opencode-guildhall

Nine guild agents for [OpenCode](https://opencode.ai), and a live 3D hall where you watch them work.

One plugin gives you:

- **The guild.** A Guildmaster you talk to, and eight specialists it briefs, checks and reports on
  (architect, implementer, verifier, librarian, explorer, researcher, designer, product owner). Each
  has its own permissions, enforced by OpenCode rather than just described in a prompt.
- **The hall.** A small 3D guildhall in your browser. Each OpenCode session shows up as an adventurer
  at the station for its role, and you can watch subagents set out, work, and come back.

Everything runs on your machine. Nothing is written to your OpenCode config or your repo, and
uninstalling the plugin removes it all.

## Install

**OpenCode 1** (1.18 or later). Add one line to `opencode.json`:

```jsonc
{ "plugin": ["opencode-guildhall"] }
```

**OpenCode 2** (2.0.18 or later). Use `plugins`, or let OpenCode add it for you:

```jsonc
{ "plugins": ["opencode-guildhall"] }
```

```sh
opencode plugin add opencode-guildhall
```

Restart OpenCode. That's all: there is no separate web app to install.

## What you get

| Agent | Mode | Job | Tier |
|---|---|---|---|
| `guild-master` | primary | Talks to you, sizes the request, briefs specialists, has their work verified, reports back | strong |
| `guild-architect` | subagent | Structure before code: boundaries, ADRs, plans, task contracts | strong |
| `guild-implementer` | subagent | Builds one bounded task: code and tests inside the files it is given | standard |
| `guild-verifier` | subagent | Tries to prove the work wrong, and returns a cited verdict | strong |
| `guild-librarian` | subagent | Library docs at your installed version, plus the project's own decisions | fast |
| `guild-explorer` | subagent | Maps this repo's code, read-only | fast |
| `guild-researcher` | subagent | Open questions from the web, with cited and cross-checked findings | standard |
| `guild-designer` | subagent | Designs and builds UI within your design system, and checks how it renders | standard |
| `guild-product-owner` | subagent | Turns a vague goal into a spec with observable acceptance criteria | standard |

Pick **guild-master** with Tab (OpenCode 1) or shift+tab (OpenCode 2), or run
`opencode run --agent guild-master "…"`. The guild never makes itself your default agent. You can
also @-mention any specialist directly.

Behind the agents, the plugin:

- forwards OpenCode's session events to a small local **hub**, which the plugin starts the first
  time it needs one. The hub is shared by every OpenCode window you have open.
- serves the **hall** from that hub.

## Open the hall

Start OpenCode in a project, then open **<http://127.0.0.1:4747/>**.

The hall connects to the hub that served it and follows your sessions live. Every OpenCode window
shows up in the same hall. To watch the demo stories, open Settings and pick one under *Story*;
*Live* takes you back.

- The hub runs on [Bun](https://bun.sh). If `bun` is on your `PATH` the plugin uses it; otherwise
  it runs the hub with OpenCode's own binary, which is built on Bun.
- To use a port other than 4747, set `GUILDHALL_PORT` in the environment OpenCode starts in.
- **After upgrading the plugin**, the hub that's already running is still the old version. Stop it
  (`kill $(lsof -ti tcp:4747)`), and the next OpenCode event starts the new one. The plugin writes a
  `WARNING: stale hub` line to `~/.cache/guildhall/herald.log` when it finds an old hub.

## Models

By default **no role sets a model**. The Guildmaster runs on whatever model you have selected, and
each subagent uses its parent session's model. The guild works with any provider, and never picks
one you might not have.

Each role has a **tier** (see the table). To give tiers real models, pass plugin options:

```jsonc
{
  "plugin": [
    ["opencode-guildhall", {
      "models": {
        "strong": "anthropic/claude-opus-4-5",    // master, architect, verifier
        "fast": "anthropic/claude-haiku-4-5",     // explorer, librarian
        "guild-researcher": "openrouter/x/y"      // one agent; beats its tier
      }
    }]
  ]
}
```

On OpenCode 2, the same entry goes in `plugins`. An unset tier inherits your model. Values must be
`provider/model`; a bad value is logged to `~/.cache/guildhall/herald.log` and ignored.

## Permissions

Every guild agent starts from **deny-all** and gets back only what its job needs. OpenCode
enforces these rules; they are not only described in the prompts.

| Agent | Edit files | Shell | Web | Launches subagents |
|---|---|---|---|---|
| `guild-master` | no | asks | no | the eight guild specialists, by name |
| `guild-architect` | Markdown under `docs/` only | no | no | no |
| `guild-implementer` | yes, except protected paths | the checks below run freely; anything else asks | no | no |
| `guild-verifier` | no | **the checks below only**; anything else is denied | no | no |
| `guild-librarian` | no | no | yes | no |
| `guild-explorer` | no | no | no | no |
| `guild-researcher` | no | no | yes | no |
| `guild-designer` | yes, except protected paths | the checks below run freely; anything else asks | no | no |
| `guild-product-owner` | Markdown under `docs/` only | no | no | no |

- **Every agent** may read, search and load skills. Reading `.env` and `.env.*` files still asks
  (`.env.example` is allowed). Paths outside the project ask.
- **Everything else is denied**, including every MCP tool and any tool a later OpenCode adds. To give
  one agent an MCP server, grant it in your config, e.g. OpenCode 1:
  `"agent": { "guild-designer": { "permission": { "chrome-devtools_*": "allow" } } }`.
- **The checks** are exact command lines, as written or followed by `2>&1`: the usual test, lint
  and typecheck scripts (`bun test`, `bun run lint`, `bun run typecheck`, `bun run check`,
  `npm test`, `npm run lint`, `pnpm test`, `yarn test`, `pytest`, `ruff check`, `mypy`,
  `cargo test`, `cargo clippy`, `go test ./...`, `go vet ./...`, `make test`, `make lint`, …) and
  read-only git (`git status`, `git diff`, `git diff --cached`, `git log --oneline`, `git show`, …).
  The same commands with other arguments are not checks. `bunx` and `npx` are never checks, because
  they fetch and run any package.
- **Protected paths** no agent may write, at any depth: `.opencode/`, `opencode.json*`,
  `~/.config/opencode/`, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/`, `.git/`, `skill(s)/`,
  and Markdown in `agent(s)/` and `command(s)/` folders.

Known limits:

- The implementer and the designer run your project's code when they run its checks, and they can
  edit that code first (a test, `package.json`, a Makefile). On an untrusted branch, that code is
  the branch's.
- OpenCode doesn't see a redirect after `&&`, `||` or `|` (`git status && git diff > file`), so the
  shell rules can't stop one.
- On macOS, `agents.md` is the same file as `AGENTS.md`, but OpenCode's matching is
  case-sensitive. Symlinks aren't resolved before matching.
- On OpenCode 2, a global `permission` in your config (for example `"bash": "ask"`) is applied
  after each agent's rules and overrides them. If you set one, restate the guild's shell limits
  per agent.

## Change or turn off agents

Your own config wins over the plugin's, field by field:

```jsonc
// OpenCode 1
{ "agent": { "guild-explorer": { "model": "anthropic/claude-haiku-4-5" } } }
{ "agent": { "guild-designer": { "disable": true } } }

// OpenCode 2
{ "agents": { "guild-designer": { "disabled": true } } }
```

To turn off **all** the agents and keep only the hall:

```jsonc
{ "plugin": [["opencode-guildhall", { "agents": false }]] }
```

## Claude Code

The package also carries a hook that brings your Claude Code sessions into the same hall. Install
the package globally, so the hook's path stays put, then print the hooks block:

```sh
npm install -g opencode-guildhall
opencode-guildhall claude-code --print
```

Merge the printed `hooks` into `~/.claude/settings.json` (every project) or a project's
`.claude/settings.local.json`. The command only prints; it never edits your settings. The hook says
nothing back to Claude Code, always lets it go on, and starts the hub (with Bun from your `PATH`)
the first time it's needed. A project open in both OpenCode and Claude Code is one guild.

## Eject the agents

The prompts live inside the package. To read or edit them, eject them into your project:

```sh
npx opencode-guildhall eject           # writes .opencode/agents/guild-*.md
npx opencode-guildhall eject --force   # overwrites files that are already there
```

Without `--force`, existing files are left as they are. OpenCode reads the files as your own agents,
so they win over the plugin's copies, field by field. Permissions are merged key by key, so if you
delete a permission key from a file, the plugin's rule for that key still applies. To loosen a rule,
set it to a different value instead of deleting it. To use only your files, add
`{ "agents": false }` as shown above.

## Privacy

Everything stays on your machine.

- The hub listens on `127.0.0.1` only. It refuses events from web pages and connections from
  non-local origins.
- Sessions are recorded as **chronicles** in `~/.cache/guildhall/chronicles/<project>/`, with the
  raw OpenCode events beside them. These files contain your prompts and code, so treat them like
  your shell history. Nothing is ever uploaded. Delete the folder at any time; set `GUILDHALL_HOME`
  to keep them somewhere else.
- The plugin's log is `~/.cache/guildhall/herald.log`.
- For a project whose remote is on GitHub, the hub asks api.github.com about the repo (commits, pull
  requests, CI, releases) to fill the hall's sea. It uses `gh auth token` if the GitHub CLI is logged
  in, keeps the token in memory only, and never stores or logs it. Set `GUILDHALL_GITHUB=0` to turn
  this off.
- When you open the hall, your browser loads its fonts from Google Fonts. No session data is sent
  with that request.

## Credits

- 3D models and animations by **Kay Lousberg**, [KayKit](https://kaylousberg.itch.io/), under
  [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
- Sound effects and ships by **Kenney**, [kenney.nl](https://kenney.nl/) (RPG Audio, Impact
  Sounds, Pirate Kit), under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
- The full asset list ships in `dist/CREDITS.md`.
- The event translators come from opencode-cockpit, and the agent prompts are adapted from Agentry.

Guildhall's own code is MIT licensed (see `LICENSE`).
