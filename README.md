<h1 align="center">Guildhall</h1>

<p align="center">
  <strong>Your AI coding agents, working as a fantasy guild on a living island.</strong><br />
  A 3D world you can watch, and a real nine-agent harness for <a href="https://opencode.ai">OpenCode</a>.<br />
  Claude Code sessions can join the island too.
</p>

<p align="center">
  <a href="https://guildhall.codestz.dev"><strong>Visit the guild</strong></a> ·
  <a href="#install">Install</a> ·
  <a href="#claude-code">Claude Code</a> ·
  <a href="packages/opencode-guildhall/README.md">Plugin docs</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/opencode-guildhall"><img alt="npm" src="https://img.shields.io/npm/v/opencode-guildhall?color=c9a227&label=npm" /></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-c9a227" /></a>
  <img alt="OpenCode 1 and 2" src="https://img.shields.io/badge/OpenCode-v1%20%C2%B7%20v2-4f8fd6" />
</p>

<p align="center">
  <img src=".github/media/island-sunset.webp" alt="The guild's island at sunset from a low angle: a walled keep with a glowing hearth, a village, forest and mountains, ships on a pink sea, and a story caption reading 'The Architect and the Librarian bring their loot home.'" width="100%" />
</p>

Every session you run in OpenCode (or Claude Code) becomes an adventurer on the island. The Guildmaster posts a
quest, specialists set out to the forest, the river or the proving grounds, and they come home with
loot. Each tool call is a **deed**, with its own sigil above the hero's head. When they need you, a
**plea** goes up. Everything you see comes from a real session, played out as it happens.

The world reacts to your repo, too. The weather follows your test health: clear skies while things
pass, rain and then storms as failures pile up. A session that fails rises as a skeleton in the
graveyard. Ravens fly out when a quest begins and carry the loot home. And it all has a voice: a bard writes
the story as captions and collects it into a book of Legends, and the guild makes music as it works.

## Try it

**In your browser.** [guildhall.codestz.dev](https://guildhall.codestz.dev) runs a simulated guild.
Nothing to install. A few links straight into a scene:

- [`?story=seas`](https://guildhall.codestz.dev/?story=seas): a party's run with its GitHub sea
  beside it, from the first push to the release.
- [`?repo=owner/name`](https://guildhall.codestz.dev/?repo=facebook/react): an island grown from
  any public repo's file tree.
- [`?story=rush&n=300`](https://guildhall.codestz.dev/?story=rush&n=300): a crowd of 300
  adventurers (1 to 500).

<a id="install"></a>**With your own agents.** Add the plugin to `opencode.json`, restart OpenCode,
and open <http://127.0.0.1:4747>.

```jsonc
{ "plugin": ["opencode-guildhall"] }
```

That's OpenCode 1.18 or later. On OpenCode 2.0.18 or later, use `"plugins"`, or run
`opencode plugin add opencode-guildhall`. Pick **guild-master** with
Tab (shift+tab on v2), and the hall follows every OpenCode window you have open. Ports, options
and upgrade notes are in the [plugin README](packages/opencode-guildhall/README.md).

## Claude Code

The same package carries a hook for [Claude Code](https://claude.com/claude-code). Install it once, then
print the hooks block and merge it into `~/.claude/settings.json` (every project) or a project's
`.claude/settings.local.json`:

```sh
npm install -g opencode-guildhall
opencode-guildhall claude-code --print
```

The command only prints; it never edits your settings. The hook runs on every Claude Code event,
says nothing back to Claude, and always lets it carry on. It starts the hub the first time it's
needed, so open <http://127.0.0.1:4747> once a session is going. Each project is its own guild, and
a project open in both OpenCode and Claude Code shares one. The hub runs on [Bun](https://bun.sh),
so have it on your PATH. A global install keeps the hook's path stable: `npx` and `bunx` run from
a cache that gets cleared.

## Watch it work

<p align="center">
  <img src=".github/media/saga-loop.webp" alt="An animated loop of the island at night during the closing festival: lanterns and bunting strung over the village square, the keep's hearth glowing, fireworks bursting above the keep, and a caption reading 'The quest is complete. The Guildmaster has the last word.'" width="100%" />
  <br /><sub><a href=".github/media/saga-loop.mp4">Watch the loop as MP4</a></sub>
</p>

<table>
  <tr>
    <td colspan="2">
      <img src=".github/media/work-sites.webp" alt="Three close-ups: an explorer chopping at the forest edge, two researchers fishing at the river bend, a verifier shooting arrows at the proving grounds." width="100%" />
      <p><strong>Real work, real places.</strong> Each role has a trade. Explorers chop wood while they
      search your code, researchers fish while they read the web, verifiers shoot at targets while your
      tests run, and implementers raise a building in the yard as they write. Logs, fish and arrows
      pile up as the deeds finish.</p>
    </td>
  </tr>
  <tr>
    <td colspan="2">
      <img src=".github/media/weather.webp" alt="The same village four ways: a clear noon, a rainy night lit by lanterns, a grey storm and a snowy morning." width="100%" />
      <p><strong>A living island.</strong> Day and night follow your clock (or a fixed hour), and the
      weather follows the share of recent deeds that failed. A busy guild runs warm; a guild left
      quiet for a long time turns cold.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src=".github/media/graveyard.webp" alt="A graveyard at night. Two hooded skeletons have risen by their graves near a lit crypt. Caption: 'The Verifier and the Explorer II fall, and the graveyard stirs.'" width="100%" />
      <p><strong>The graveyard.</strong> A failed session rises as a skeleton and keeps vigil until it
      recovers. Failed deeds raise minions that crumble away.</p>
    </td>
    <td width="50%">
      <img src=".github/media/legends.webp" alt="The Legends book open over the island: a party's quest told chapter by chapter, with each adventurer's deeds, loot, time, tokens and cost." width="100%" />
      <p><strong>Captions and Legends.</strong> The bard narrates as it happens. The Legends book tells
      each quest chapter by chapter, with deeds, loot, tokens and cost, and copies out as text.</p>
    </td>
  </tr>
  <tr>
    <td colspan="2">
      <img src=".github/media/parties.webp" alt="The full HUD: a plea banner waiting for permission, a parties panel listing three quests, the guild roster, and a chronicle of every deed with a timeline." width="100%" />
      <p><strong>Parties, pleas and the chronicle.</strong> Several conversations at once become
      separate parties, each under its own banner. A permission request shows up as a plea you can
      open. The chronicle lists every deed, and the timeline lets you scrub through the whole session.</p>
    </td>
  </tr>
</table>

**A cinematic director.** With the bard on, the camera picks its own shots: establishing views,
follows, close-ups, two-shots. It cuts to whatever matters most, and a plea outranks everything.
In replays it fast-forwards through the quiet stretches. Take the camera back any time.

**Sound.** Every deed plays a note in a key that follows the mood (minor at night), over a bed of
wind, rain, sea, fire and night insects. It is synthesized in the browser, apart from a few
recorded effects. Sound is off until you turn it on.

**GitHub seas.** When a project's remote is on GitHub, the hub watches it and the sea fills with
ships: commits and pull requests sail in, the lighthouse burns steady while CI passes and pulses
red when it fails, and a release arrives as a galleon. It uses `gh auth token` if the GitHub CLI is installed and logged in (public
repos are watched without a token, less often). The token is read when needed and never stored.
Set `GUILDHALL_GITHUB=0` to turn the watch off.

**Townsfolk.** Farmers, a fisher, merchants, gate guards, children and a graveyard keeper go about
their day around the guild.

**Secret events.** The island answers rare moments in your work. A clean quest earns a festival.
A long run that ends in a fall may bring a ghost ship out of the mist. There are more: a rainbow,
pirates, comets, a dragon. Each has its own trigger, and they're more fun to find than to read
about.

<p align="center">
  <img src=".github/media/rainbow-dragon.webp" alt="A rainbow over the village while a red dragon circles above the mountains." width="100%" />
</p>
<p align="center">
  <img src=".github/media/events-pair.webp" alt="Left: lanterns and bunting strung across the square at night for a festival. Right: a glowing green ghost ship on a dark sea." width="100%" />
</p>

## The guild

The plugin gives OpenCode nine agents. You talk to the **Guildmaster**. It sizes your request,
briefs the specialists, has their work checked by a verifier, and reports back.

| Role | What it does | What it may do | Where it works |
|---|---|---|---|
| **Guildmaster** | Talks to you, plans, briefs specialists, reports back | Read; shell asks first; may launch the eight specialists | Quest board in the keep |
| **Architect** | Designs the structure first: boundaries, plans, task contracts | Write Markdown under `docs/` only | Drafting table in the keep |
| **Implementer** | Builds one bounded task: the code and its tests | Edit files; run the project's checks; any other command asks | Forge, then the construction yard |
| **Verifier** | Tries to prove the work wrong, returns a cited verdict | Read; run the checks; every other command is denied | Inspection bench, then the proving grounds |
| **Librarian** | Library docs at your installed version, plus the project's decisions | Read and use the web | Library, then the wizard tower |
| **Explorer** | Maps your codebase | Read only | Map table, then the forest edge |
| **Researcher** | Answers open questions from the web, with sources | Read and use the web | Map table, then the river bend |
| **Designer** | Designs and builds UI within your design system | Edit files; run the checks; any other command asks | Easel in the keep |
| **Product owner** | Turns a vague goal into a spec with testable criteria | Write Markdown under `docs/` only | Scroll desk in the keep |

Agents from outside the guild, such as OpenCode's own `general`, show up as grey wanderers working
the quarry.

- **Permissions are enforced twice.** OpenCode's own rules: every agent starts from deny-all and
  gets back only what its job needs. "Checks" means an exact list of test, lint, typecheck and
  read-only git commands. Protected paths (your OpenCode config, `AGENTS.md`, `.git/` and others)
  can't be written by any agent. Then a pre-run guard in the plugin reads every shell line a guild
  agent runs, with a real shell parser, before it runs: the Verifier may only run those exact
  checks, and no agent may redirect output into a protected path, however the line is written. The [plugin README](packages/opencode-guildhall/README.md#permissions) has
  the full rules and their known limits.
- **Models.** By default no role sets a model: everyone runs on the one you picked, with any
  provider. If you want, map the `strong`, `standard` and `fast` tiers, or a single agent, to
  models of your choice.
- **Make them yours.** Your config overrides the plugin's, field by field.
  `npx opencode-guildhall eject` writes the prompts into `.opencode/agents/` for you to edit.
  `{ "agents": false }` turns the guild off and keeps only the hall.

## How it works

```mermaid
flowchart LR
  OC["OpenCode<br/>(v1 or v2)"] -- session events --> H["herald<br/>(the plugin)"]
  H -- "POST changes" --> HUB["hub<br/>127.0.0.1:4747"]
  HUB -- chronicles --> DISK[("~/.cache/guildhall")]
  CC["Claude Code"] -- "hook events" --> HUB
  HUB -- WebSocket --> HALL["hall<br/>(your browser)"]
  GH["GitHub"] -. "commits, PRs, CI" .-> HUB
```

The **herald** runs inside OpenCode. It adds the guild's agents and translates OpenCode's events
into a small model of sessions and deeds. It sends them to the **hub**, a tiny local server that
the herald starts the first time it's needed. Every OpenCode window shares that one hub, and so
does the Claude Code hook, which sends the same changes from Claude Code's hook events. The hub
records each session as a chronicle on disk and serves the **hall**, a React Three Fiber app that
turns the stream into the island.

## Performance

The target is 120 fps on a Retina MacBook, and the hall measures itself against it. On a
production build at the default High tier, the party scene runs at about 121 to 131 fps. The
busiest scene, thirteen adventurers in rain at night, runs at 117 to 120 fps, with its 95th-percentile
frame at 12.5 to 13.7 ms. That is just short of the target, and the rest of the cost is fill rate at
Retina resolution. A few things keep it fast:

- Island tiles are instanced and placed props are batched per material. Each character's parts are
  merged into two skinned meshes.
- One shadow-casting sun, and its shadow map is redrawn only when something it covers changes: a
  few times every four seconds instead of every frame. Moving characters get cheap blob shadows.
- Outlines, mist, sun shafts and colour grading run in a single post-processing pass.
- Occasional layers, like the graveyard's undead and the ghost ship, load the first time they're needed.
- Quality adapts on its own across three tiers. An Ultra tier with a tilt-shift miniature look is
  there if you choose it.
- Where the browser has WebGPU, **Settings › Renderer** switches to an experimental WebGPU
  renderer. WebGL stays the default.

## Privacy

Everything runs on your machine. The hub listens on `127.0.0.1` only and refuses events from web
pages and non-local origins. Chronicles are kept in `~/.cache/guildhall/chronicles/<project>/`.
They hold your prompts and code, so treat them like your shell history. Nothing is uploaded. The
outside requests are few: the hall's fonts, which your browser loads from Google Fonts; the GitHub
seas, where the hub asks api.github.com about your project's repo (`GUILDHALL_GITHUB=0` turns it
off); and `?repo=`, where your browser reads a public repo's file tree from GitHub. No session data
goes with any of them.

## Develop

Needs [Bun](https://bun.sh) 1.3.5 or later.

```sh
bun install
bun run dev          # the hall, with simulated stories (Settings › Story)
bun test             # unit tests
bun run check        # lint, typecheck and tests
```

To watch real sessions while developing, run the hub with `bun packages/hub/src/main.ts`, then add
`?live` to the hall's URL.

| Package | What it is |
|---|---|
| [`packages/opencode-guildhall`](packages/opencode-guildhall) | The published plugin: herald, hub and a built hall in one package, plus the `eject` and `claude-code` CLI |
| [`packages/herald`](packages/herald) | The OpenCode side: adds the agents, translates events, sends them to the hub |
| [`packages/claude-code`](packages/claude-code) | The Claude Code side: a hook that translates Claude Code's events and sends them to the hub |
| [`packages/hub`](packages/hub) | The local server: takes events, keeps chronicles, serves the hall over WebSocket |
| [`packages/hall`](packages/hall) | The 3D world and HUD: `scene/`, `guild/` (state, story, director), `hud/`, `audio/` |
| [`packages/roster`](packages/roster) | The nine roles: prompts, permissions, model tiers, and how each looks and where it works |
| [`packages/core`](packages/core) | The shared event model, and the translators for OpenCode 1 and 2 |
| [`packages/sim`](packages/sim) | Scripted demo stories (`solo`, `party`, `rush`, `parties`) and their player |

<details>
<summary><strong>Building the 3D assets</strong></summary>

The web-ready models in `packages/hall/public/assets/` are committed, so you only need this to
change them. `bun scripts/assets.ts` turns the original packs into compressed `.glb` files: it
prunes them, shares one animation rig between all the characters, merges the meshes and applies
meshopt compression.

The source packs aren't in the repo. Download the free versions from
[KayKit on itch.io](https://kaylousberg.itch.io/) (Adventurers 2.0, Character Animations 1.1,
Dungeon Pack 1.1, Furniture Bits, RPG Tools Bits, Fantasy Weapons Bits, Medieval Hexagon Pack,
Forest Nature Pack, Restaurant Bits, Skeletons 1.1, Halloween Bits) and Kenney's
[Pirate Kit](https://kenney.nl/assets/pirate-kit). Put the zips in `assets/raw/` and unzip each one
into `assets/src/<zip name>/`. Then run `bun scripts/assets.ts` for everything, or name some
outputs: `bun scripts/assets.ts forest lands`.

</details>

## Credits

- 3D models and animations by **Kay Lousberg**, [KayKit](https://kaylousberg.itch.io/), under
  [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). From the free tiers of Character
  Pack: Adventurers 2.0, Character Animations 1.1, Dungeon Pack 1.1, Furniture Bits, RPG Tools Bits,
  Fantasy Weapons Bits, Medieval Hexagon Pack, Forest Nature Pack, Restaurant Bits, Skeletons 1.1
  and Halloween Bits.
- Sound effects by **Kenney**, [kenney.nl](https://kenney.nl/), under
  [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/): a curated subset of
  [RPG Audio](https://kenney.nl/assets/rpg-audio) and [Impact Sounds](https://kenney.nl/assets/impact-sounds).
  The notes and ambience are synthesized in the browser.
- Ships by **Kenney**: [Pirate Kit](https://kenney.nl/assets/pirate-kit), under
  [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
- Built with [three.js](https://threejs.org), [React Three Fiber](https://r3f.docs.pmnd.rs) and the
  pmndrs ecosystem (drei, postprocessing), for [OpenCode](https://opencode.ai).
- The event translators come from opencode-cockpit, and the agent prompts are adapted from Agentry.

The full asset list is in [`packages/hall/public/assets/CREDITS.md`](packages/hall/public/assets/CREDITS.md).

## License

[MIT](LICENSE) © 2026 Codestz. The bundled assets are CC0, as credited above.
