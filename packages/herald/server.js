/**
 * OpenCode 2 finds a plugin configured by *path* through a `server` file at the package root, not
 * through `exports` (docs/opencode/v2.md); OpenCode 1 loads the same default export.
 */
export { default } from "./src/index.ts"
