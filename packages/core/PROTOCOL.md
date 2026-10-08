# The Guildhall protocol

Guildhall is a world engine for live systems. Something that works (a coding agent, a deploy, a
service) is drawn as a guild of adventurers who take quests, do deeds, plead for help and bring
back loot. An **adapter** watches one kind of source and reports what happens there to the **hub**,
a local process. The hub numbers each report, records it, and streams it to every open **hall**,
the 3D view.

This document covers the world's vocabulary, the wire format and how an adapter talks to the hub.
Everything here is taken from the code. Each section names the source file that defines it, and
that file wins if the two ever disagree.

```
source ──► adapter ──POST /events──► hub (127.0.0.1:4747) ──WebSocket /ws──► hall
                                        └─► chronicles (.jsonl on disk)
```

Adapters today:

- **OpenCode**: `packages/herald`, a plugin inside OpenCode 1 and 2.
- **Claude Code**: `packages/claude-code`, a hook command.

Each adapter translates its source into one shared vocabulary of **changes**. The hall reads only
changes, so it can't tell which adapter (or which simulation) a guild came from.

---

## 1. The world vocabulary

| Word | What it is | On the wire |
|---|---|---|
| **Guild** | One project or system being watched. Its name is a short string such as `shop` or `my-service`. | `Dispatch.guild`, `GuildEvent.guild` |
| **Adventurer** (actor) | One worker in the guild: a session. | every change's `id` |
| **Guildmaster** | An adventurer with no parent: the root of a party. Whatever its agent is called, the hall draws it as the Guildmaster. | `session` change without `parentID` |
| **Party** | A guildmaster plus everyone it sent, at any depth. | the `parentID` tree |
| **Role** | What kind of adventurer it is, read from its agent name. | `session.agent` |
| **Quest** | Work handed to a new adventurer: a deed named `task` or `subagent`. Its `input.description` is the quest's text. | `tool` change |
| **Deed** | One action: a tool call, moving from `pending`/`running` to `completed` or `failed`. | `tool` change |
| **Outcome** | Whether a deed failed. One rule, `failedDeed`, decides it. See §1.3. | derived |
| **Plea** | An adventurer held on a human decision (a permission, a question). | `status: "waiting"` |
| **Loot** | A finished run: the session goes idle after working. | `status: "idle"` |
| **Moment** | A typed thing that *happened*, derived by comparing the model just before and just after a change. See §1.5. | derived |
| **Chronicle** | A recorded stream of guild events, one per line, replayable. | `GuildEvent` lines |

### 1.1 Roles

A session's `agent` names its role. The roster (`packages/roster/src/roles.ts`) ships nine:

| Agent name | Role |
|---|---|
| `guild-master` | Guildmaster |
| `guild-architect` | Architect |
| `guild-implementer` | Implementer |
| `guild-verifier` | Verifier |
| `guild-librarian` | Librarian |
| `guild-explorer` | Explorer |
| `guild-researcher` | Researcher |
| `guild-designer` | Designer |
| `guild-product-owner` | Product owner |

Any other agent name is drawn as a **Wanderer**, a grey adventurer from outside the guild
(`STRANGER`). An adapter should send the source's own agent name unchanged unless it is truly one of
the roles above. Wanderers are expected.

### 1.2 Deeds: names and inputs the world reads

Deed names follow OpenCode's spelling, which is lower case. The hall picks the animation for a deed
from its name (`packages/roster/src/deeds.ts`):

| Canonical name | Aliases read the same | Shown as |
|---|---|---|
| `task` | `subagent` | a quest (walk to the quest board) |
| `webfetch` | `websearch` | a walk to the map table |
| `read`, `grep`, `glob` | `list` → `glob` | reading |
| `edit`, `write` | `patch`, `multiedit` → `edit` | smithing |
| `bash` | `shell` | steam at the station |
| `todowrite` | | a scroll |
| anything containing `_` | | an MCP tool (spellcasting) |
| anything else | | a plain interaction |

Matching ignores case, except for quests: a quest is detected only when the name is exactly `task`
or `subagent`.

Inputs are free-form objects. These keys are read when present:

| Key | Read for |
|---|---|
| `filePath` (else `path`, `file`) | what a read, write or edit is about |
| `pattern`, `include` | what a grep or glob is about |
| `command` | the shell line. It also decides outcomes (§1.3). |
| `description` | a quest's text |
| `url`, `query` | what a fetch or search is about |
| `content` (on `write`), `newString` (on `edit`, `patch`, `multiedit`) | lines written, the size of a `deed` moment |

For any other tool, the first string value in the input stands for what the deed is about.

### 1.3 Outcomes

`failedDeed` (`packages/core/src/model/outcome.ts`) is the single rule every view of failure reads:

- A call in state `failed` failed: it was refused, denied or cancelled, or the tool threw.
- A `completed` call with a non-zero `exit` failed **only if** its `input.command` is a **check**:
  a test runner, linter or typechecker (`isCheck`). Examples: `bun test`, `npm run lint`,
  `tsc -b`, `cargo test`, `uv run pytest`. The command judged is the one whose exit status is the
  line's: the last stage of the last pipeline.
- Any other non-zero exit is an answer, not a failure. `grep` exiting 1 means "no match". `diff`
  exiting 1 means "they differ".

So an adapter should report a shell command that ran and exited non-zero as a **completed** call
with its `exit` code, not as a `failed` one. Whether that exit is red work is `failedDeed`'s call.
Use `failed` for calls that never produced an answer.

### 1.4 Phases

A `status` change sets a session's state in the model (`packages/core/src/model/model.ts`):

| `status` sent | Model status | Notes |
|---|---|---|
| `busy` | `running` | Also clears a past failure. |
| `waiting` | `waiting` | A plea. It lasts until the next `busy`, `idle` or `failed`. |
| `failed` | `failed` | Running deeds are settled as failed (`stopped`). Everything the session launched that is still working fails with it (`cascade`). |
| `idle` | `done` | Running deeds are settled. If the session went idle before doing anything, it stays `starting` unless the change is `settled: true`. |

A session the model hasn't heard of yet starts as `starting`. Its first deed, thought or reply
moves it to `running`.

The hall turns model status into a **phase** for each adventurer: `working`, `waiting`, `loot`
(just finished, handing in), `resting` (the tavern), `leaving` (out through the gate), `idle` (a
guildmaster with nothing to do) or `failed`.

### 1.5 Moments

The hall derives moments, one per transition. A change repeated with no effect on the model makes
no new moment.

| Moment | When |
|---|---|
| `join` | A session learns its parent: a subagent joins a party. |
| `quest` | A `task` or `subagent` call starts running. |
| `deed` | A tool call completes. `size` is the lines written, when the input says. |
| `deed-failed` | A tool call fails, or a check exits non-zero (`failedDeed`). |
| `fail` | A session fails. |
| `recover` | A failed session works again. |
| `loot` | A session finishes (`done`). |
| `plea` | A session starts waiting on a human. |
| `plea-answered` | It stops waiting. |
| `leave` | A finished subagent walks out of the gate, a while after it ended. |

---

## 2. Changes

A change is one fact about one session. The union is `Change` in
`packages/core/src/model/changes.ts`. Every change has:

- `type`: one of the eight below.
- `id`: the session the change is about. A non-empty string of at most 1024 characters.
- `at`: when it happened, in ms since the epoch. It must be greater than 0 and at most 24 h ahead
  of the hub's clock.

A change names only the fields it knows. **Only the fields present are applied.** A session the
model has never seen is created on first mention, so order never loses anything. Changes are
safe to repeat: a second identical `session`, `status` or `tool` change leaves the model as it was.

| `type` | Required | Optional | Meaning |
|---|---|---|---|
| `session` | | `parentID`, `agent`, `title`, `model`, `background`, `denied` (string[] ≤ 100) | The session exists or learned something about itself. `parentID` makes it a subagent of that session. An `at` earlier than when it was first heard of becomes its start. |
| `status` | `status`: `busy` \| `idle` \| `failed` \| `waiting` | `error`, `settled` | Whether it is working (§1.4). |
| `prompt` | `key`, `text` | | Something said *to* it. The first prompt is its task. A repeated `key` is ignored. |
| `thinking` | `key` | `text`, `delta`, `done` | Its thinking: `text` replaces, `delta` appends, `done` closes the block named `key`. |
| `reply` | `key` | `text`, `delta`, `done` | What it writes back, the same way. |
| `tool` | `call` | `name`, `state` (`pending` \| `running` \| `completed` \| `failed`), `input` (object), `output`, `error`, `started`, `ended`, `summary`, `exit` (integer) | A deed, keyed by `call`. Later changes for the same `call` fill it in. `ended` defaults to `at` when the state becomes `completed` or `failed`. |
| `step` | | | It finished one model turn. |
| `usage` | | `tokens`, `cost` | Running totals for the session (they replace, not add). |

Limits on fields (`packages/hub/src/validate.ts`):

| What | Limit |
|---|---|
| ids, keys, names (`id`, `call`, `key`, `name`, `agent`, `parentID`, `model`) | 1–1024 characters |
| text (`text`, `delta`, `output`, `error`, `title`, `summary`) | ≤ 1,000,000 characters |
| `input` as JSON | ≤ 1,000,000 characters |
| numbers (`started`, `ended`, `tokens`, `cost`) | finite, ≥ 0 |

The hub drops a change that breaks these rules on its own; the rest of the batch still counts. It
lets through fields the union doesn't name, so a newer adapter may add some.

---

## 3. The wire

### 3.1 Dispatch: adapter → hub

What an adapter POSTs (`packages/hub/src/protocol.ts`):

```ts
interface Dispatch {
  guild: string        // 1–200 chars; no "/", "\", control characters, or leading "."
  changes: Change[]    // at most 500
  raw?: unknown[]      // the source's own events, kept on disk for re-translation, never served
  opencode: 1 | 2      // OpenCode adapter only: which OpenCode sent it
}
```

The hub reads `opencode` only to label raw events, and treats any value other than `1` as `2`. An
adapter for any other source should leave out `opencode` and `raw`.

### 3.2 GuildEvent: hub → hall and chronicles

The hub wraps each accepted change (`packages/core/src/event.ts`):

```ts
interface GuildEvent {
  v: 1          // WIRE_VERSION
  guild: string
  seq: number   // per-guild, starts at 1, +1 per change, in the order the hub took them
  change: Change
}
```

Over the WebSocket (`ws://127.0.0.1:4747/ws`), a hall first gets
`{ type: "hello", version: 1, events: GuildEvent[] }` with recent history: the 8 most recently
active guilds, up to 50,000 events in all. After that it gets
`{ type: "events", events: GuildEvent[] }` as dispatches arrive. A WebSocket connection is accepted
only with no `Origin`, or a `localhost` / `127.0.0.1` / `[::1]` one.

Chronicles are written under `$GUILDHALL_HOME` (default `~/.cache/guildhall`):

- `chronicles/<guild>/<boot>.jsonl`: one `GuildEvent` per line.
- `<boot>.raw.jsonl`: the raw events, as `{ at, opencode, raw }`.

### 3.3 Versioning

`WIRE_VERSION` is `1`. It is bumped on any breaking change to `GuildEvent`, and chronicles record
it on every line. Adding an optional field to a change is not breaking: the validator lets unknown
fields through, and the model ignores fields it doesn't read. `Dispatch` carries no version of its
own. `GET /health` reports the hub's `wire` version.

---

## 4. Talking to the hub

**Endpoint**: `POST http://127.0.0.1:4747/events`. The hub binds `127.0.0.1` only. Its port is
`$GUILDHALL_PORT`, default 4747.

**Required**:

- Header `x-guildhall-herald: 1`. A custom header forces a CORS preflight, which the hub never
  answers, so a web page can't forge events.
- No `Origin` header. Browsers always send one; adapters don't.
- `Host` must be `127.0.0.1:<port>` or `localhost:<port>`.
- `content-type: application/json`, body a `Dispatch`, at most 16 MB.

**Answers**:

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ ok: true, count, rejected? }` | `count` changes recorded. `rejected` changes failed validation and were dropped. |
| 400 | `bad dispatch` | Bad JSON, invalid `guild`, or `changes` not an array. |
| 400 | `too many changes: at most 500 per dispatch` | Split the batch. |
| 403 | `forbidden` | Missing header, an `Origin`, or a non-loopback `Host`. |
| 413 | `raw events over 12000000 chars` | The `raw` events total more than 12,000,000 characters as JSON. A single raw event over 4,000,000 is dropped quietly. |

**Other endpoint**: `GET /health` answers `{ ok, build, started, pid, wire, guilds, halls,
writeFailures, lastWriteError? }`.

**Order**: the hub records each guild's dispatches one at a time, in the order they arrive. Within
a dispatch, changes keep their order. The model copes with most reordering, because unknown sessions
are created on first mention and fields only fill in. The exception is a deed's `state`: it is
set, not merged, so a late `running` after a `completed` would set it back. Send a deed's changes
in order.

**Batching** is up to the adapter. The OpenCode adapter's courier (`packages/herald/src/courier.ts`)
is the reference:

- It flushes every 120 ms, at most 500 changes and 8 MB per POST, one POST at a time.
- A 413 splits the batch in half. Any other 4xx is dropped, since the hub will never take it.
- A 5xx, 408, 429, timeout or no answer is kept (at most 10,000 queued) and retried with backoff
  from 600 ms up to 10 s.
- With nothing listening, it starts a hub (`bun packages/hub/src/main.ts`), at most once every
  30 s.

An adapter that runs as a short-lived process (a hook) sends one small dispatch per event and gives
up quickly instead (see §6).

**Rule for every adapter**: never break the source you watch. Swallow every error, bound every
wait, and treat an absent hub as normal.

---

## 5. Write your own adapter in 30 lines

A deploy, told as one adventurer's run. It runs on Node 18+ or Bun with no dependencies:
`node my-adapter.mjs`.

```js
// my-adapter.mjs
const HUB = `http://127.0.0.1:${process.env.GUILDHALL_PORT ?? 4747}/events`

/** One POST of changes for one guild. Never throws: the source you watch must not care. */
async function dispatch(guild, changes) {
  try {
    const response = await fetch(HUB, {
      method: "POST",
      headers: { "content-type": "application/json", "x-guildhall-herald": "1" },
      body: JSON.stringify({ guild, changes }),
      signal: AbortSignal.timeout(1000),
    })
    return response.ok
  } catch {
    return false // no hub listening
  }
}

const id = `deploy-${Date.now()}`
const call = "rollout-1"
const now = () => Date.now()
await dispatch("my-service", [
  { type: "session", id, agent: "deployer", title: "Deploy v1.4.2", at: now() },
  { type: "prompt", id, key: "task", text: "Roll v1.4.2 out to production", at: now() },
  { type: "status", id, status: "busy", at: now() },
  { type: "tool", id, call, name: "bash", state: "running", input: { command: "kubectl rollout status deploy/api" }, started: now(), at: now() },
])
await new Promise((done) => setTimeout(done, 3000))
await dispatch("my-service", [
  { type: "tool", id, call, state: "completed", exit: 0, output: "deployment \"api\" successfully rolled out", ended: now(), at: now() },
  { type: "reply", id, key: "answer", text: "v1.4.2 is live.", done: true, at: now() },
  { type: "status", id, status: "idle", at: now() },
])
```

With a hall open, a Wanderer named `deployer` takes the guildmaster's place in a new guild,
`my-service`. It works the `bash` deed for three seconds, says "v1.4.2 is live." and goes idle.

To show the structure of your source, send a second session with `parentID: id`. That session
joins the deployer's party. A `tool` change named `task` with an `input.description` on the parent
is the quest that sent it.

---

## 6. The Claude Code adapter

`packages/claude-code` is a command that Claude Code runs on each hook event. To set it up, run
`bun packages/claude-code/src/install.ts --print`. It prints the `hooks` block to merge into
`~/.claude/settings.json` and never edits that file itself. The hook reads the event's JSON from
stdin and POSTs one dispatch with no `raw`, giving the hub 200 ms to answer. It prints nothing and
always exits 0. If no hub is listening, it starts one for the events that follow (at most once
every 30 s) and drops the current event.

The **guild** is named after the git root above the event's `cwd`, or after `cwd` itself outside
git. A project opened in OpenCode at its root and in Claude Code therefore share one guild.

| Claude Code hook event | Changes |
|---|---|
| `SessionStart` | `session` for `session_id`, with `model`, plus `title` from `session_title` and `agent` from `--agent` when present |
| `UserPromptSubmit` | `prompt` (key: `prompt_id`), then `status: busy` |
| `PreToolUse` | `status: busy`, then a `tool` running (call: `tool_use_id`) |
| `PostToolUse` | `status: busy`, then the `tool` completed with the result as `output` and `started` from `duration_ms`. For an `Agent` call that returns an `agentId`, also the child's `session` (`parentID`, `agent`, `title` from `description`) and its task `prompt`, both dated when the call began. |
| `PostToolUseFailure` | For a `Bash`/`PowerShell` error starting `Exit code N`: the tool **completed** with `exit: N`, so `failedDeed` judges it (§1.3). If `is_interrupt`: failed, `interrupted`. Otherwise: failed with `error`. |
| `PermissionDenied` (auto mode) | the `tool` failed, with `reason` as its error |
| `PermissionRequest` | `status: waiting` (a plea) |
| `Notification` | `status: waiting` for `permission_prompt`, `elicitation_dialog` and `elicitation_url_dialog`. Nothing for other types. |
| `SubagentStart` | the child's `session`, then `status: busy` |
| `SubagentStop` | the child's `session`, a `reply` (`last_assistant_message`), then `status: idle`. Nothing when `agent_type` is empty: those are Claude Code's own helpers. |
| `Stop` | `reply` (`last_assistant_message`), then `status: idle` |
| `StopFailure` | `status: failed` with the API error |
| `SessionEnd` | `status: idle` |
| `PreCompact` and every other event | nothing |

Where Claude Code's names become the world's:

| Claude Code | World |
|---|---|
| `session_id` | the guildmaster's session id |
| `agent_id` (with or without an `agent-` prefix) | a subagent's session id. Every event a subagent fires also re-sends its `session` with `parentID: session_id`. |
| `agent_type` | `agent`: a roster role when the name matches one with or without a plugin scope (`implementer`, `agentry:implementer` → `guild-implementer`). Otherwise kept as is (`Explore`, `general-purpose`) and drawn as a Wanderer. |
| tool `Agent` (formerly `Task`) | deed `task`: a quest |
| tools `Bash`, `Read`, `Edit`, `Write`, `Grep`, `Glob`, `WebFetch`, `WebSearch`, `TodoWrite`, … | the same name in lower case |
| tool `PowerShell` | `shell` |
| `mcp__<server>__<tool>` | unchanged |
| input `file_path`, `notebook_path` / `old_string` / `new_string` | `filePath` / `oldString` / `newString` (other keys kept) |
| a tool result | `output`: a shell's stdout and stderr, a subagent's text, a file's content, otherwise its JSON. Capped at 16,000 characters. |
