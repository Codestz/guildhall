import { chmodSync, cpSync, rmSync } from "node:fs"
import { join } from "node:path"

/**
 * Builds what `opencode-guildhall` publishes into `dist/`:
 *   server.js  the plugin (herald + roster + core), for OpenCode's Bun
 *   hub.js     the hub, which the herald starts as its own Bun process
 *   cli.js     `npx opencode-guildhall eject`, for Node
 *   hall/      the hall's production build, served by the hub at `/`
 * Everything is bundled: the package has no runtime dependencies.
 */

const pkg = join(import.meta.dir, "..")
const dist = join(pkg, "dist")
const hall = join(pkg, "..", "hall")

rmSync(dist, { recursive: true, force: true })

async function bundle(entry: string, target: "bun" | "node", banner?: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [join(pkg, "src", entry)],
    outdir: dist,
    target,
    format: "esm",
    banner,
  })
  if (!result.success) {
    for (const message of result.logs) console.error(message)
    throw new Error(`bundling ${entry} failed`)
  }
}

await bundle("server.ts", "bun")
await bundle("hub.ts", "bun")
await bundle("cli.ts", "node", "#!/usr/bin/env node")
chmodSync(join(dist, "cli.js"), 0o755)

// The hall, built to follow the hub that serves it (packages/hall/src/guild/mode.ts SERVED).
const vite = Bun.spawnSync(["bun", "x", "vite", "build", "--outDir", join(dist, "hall"), "--emptyOutDir"], {
  cwd: hall,
  env: { ...process.env, VITE_GUILDHALL_SERVED: "1" },
  stdout: "inherit",
  stderr: "inherit",
})
if (vite.exitCode !== 0) throw new Error("building the hall failed")
// The asset credits travel with the hall (dist/hall/assets/CREDITS.md); a copy at the top too.
cpSync(join(dist, "hall", "assets", "CREDITS.md"), join(dist, "CREDITS.md"))
console.log(`built ${dist}`)
