/**
 * OpenCode 2 finds a plugin configured by *path* through a `server` file at the package root, not
 * through `exports` (docs/opencode/v2.md). Installed from npm, `exports` resolves `./server` too.
 */
export { default } from "./dist/server.js"
