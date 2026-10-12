# Changelog

## 0.2.0

### Added

- **Claude Code.** The package now carries a hook for Claude Code. Run
  `opencode-guildhall claude-code --print` and merge the printed `hooks` block into your Claude Code
  settings; your Claude Code sessions then show up in the hall beside your OpenCode ones. The command
  only prints, and the hook starts the hub when it's needed: with Bun when it's on your `PATH`, with
  Node otherwise (the hub now runs on either).
- **GitHub seas.** For a project whose remote is on GitHub, the hub watches the repo and the hall's
  sea shows it: commits and pull requests as ships, CI on the lighthouse, a release as a galleon.
  It uses `gh auth token` when the GitHub CLI is logged in, and watches public repos without a token
  otherwise. The token is never stored. Set `GUILDHALL_GITHUB=0` to turn it off.
- **Repo islands.** `?repo=owner/name` grows the island from a public repo's file tree; monorepos
  grow as towns of package villages.
- **Crowds.** The hall holds hundreds of adventurers at once. Try `?story=rush&n=300`.
- **New story.** `?story=seas` plays a party's run with its GitHub sea beside it.
- **WebGPU (experimental).** Where the browser supports it, *Settings › Renderer* switches to a
  WebGPU renderer. WebGL stays the default.

### Changed

- **One guild per project.** Two projects with the same folder name get their own guilds (`app`,
  `app·2`) instead of sharing one.
- **Chronicles are kept bounded.** Event chronicles are kept for 30 days (256 MB per project at
  most), raw event logs for 3 days (64 MB). The hub reads back only the last day when it starts.

### Upgrading

A hub that's already running is still the 0.1.0 one. Stop it (`kill $(lsof -ti tcp:4747)`) and the
next event starts the new one.

## 0.1.0

First release: the nine guild agents for OpenCode 1 and 2, the hub, the hall, and
`opencode-guildhall eject`.
