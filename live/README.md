# live/

What live mode runs on your machine: V1's hub and its Claude Code hook, unchanged in behaviour, moved
here from `legacy/packages/` at the V1 cutover. The rest of V1 is on the `v1` tag.

| Package | What it is |
|---|---|
| [`hub`](hub) (`@guildhall/hub`) | The local hub: takes adapters' POSTs and serves the hall a WebSocket on `127.0.0.1:4747` |
| [`claude-code`](claude-code) (`@guildhall/claude-code`) | The hook Claude Code runs on each event, and `install.ts`, which prints its settings block |
| [`core`](core) (`@guildhall/live-core`, so it never shadows V2's `@guildhall/core`) | The wire format (wire v1, [PROTOCOL.md](core/PROTOCOL.md)) and the session model |
| [`roster`](roster) (`@guildhall/roster`) | Archetypes, roles, ranks and deeds the hub and hook name agents with |

`hub` and `claude-code` must stay siblings: the hook starts the hub from `../../hub/src/main.ts`.
They are workspaces of the root `package.json`, so the root `bun install` installs them and the root
`bun run check` lints, typechecks and tests them.

## Run it

Install once, from the repo root:

```sh
bun install
```

Start the hub (the hook also starts it when it finds none listening):

```sh
bun live/hub/src/main.ts
```

Print the hook block to merge into a project's `.claude/settings.local.json` (or
`~/.claude/settings.json`); it only prints:

```sh
bun live/claude-code/src/install.ts --print
```

Every one of the 13 events gets the same command. With bun from mise, as on the Mac this was
written on, each entry reads:

```json
{
  "type": "command",
  "command": "/Users/codestz/.local/share/mise/installs/bun/1.3.13/bin/bun \"/Users/codestz/Documents/PersonalProjects/guildhall/live/claude-code/src/hook.ts\"",
  "timeout": 5
}
```

A settings file that still points at `legacy/packages/claude-code/src/hook.ts` must be updated: that
path is gone. A hub started from `legacy/packages/hub` keeps running until it is stopped; the next one
starts from here.
