/**
 * The studio's vite server for headless runs: reuse one that is already up, otherwise start the dev
 * server (no build needed) and stop it when done.
 */
import { fileURLToPath } from "node:url"

const STUDIO = fileURLToPath(new URL("../../../apps/studio/", import.meta.url))
/** The studio's own dev port (apps/studio/vite.config.ts). */
export const STUDIO_PORT = 5300
const START_TIMEOUT_MS = 30_000

export interface Server {
  origin: string
  /** Stops the server if this process started it; a no-op for one that was already up. */
  stop(): Promise<void>
}

async function answers(origin: string): Promise<boolean> {
  try {
    const response = await fetch(origin, { signal: AbortSignal.timeout(1000) })
    await response.body?.cancel()
    return true
  } catch {
    return false
  }
}

function freePort(): number {
  const probe = Bun.listen({ hostname: "localhost", port: 0, socket: { data() {} } })
  const port = probe.port
  probe.stop(true)
  return port
}

/**
 * The studio at `port` if something answers there; otherwise a dev server started on `port`, or on a
 * free port when none is given and the studio's own port is quiet.
 */
export async function serveStudio(port?: number): Promise<Server> {
  const wanted = `http://localhost:${port ?? STUDIO_PORT}`
  if (await answers(wanted)) return { origin: wanted, stop: async () => {} }

  const listen = port ?? freePort()
  const origin = `http://localhost:${listen}`
  // The studio's own vite bin, run the way `bun run dev` runs it (its shebang).
  const child = Bun.spawn([`${STUDIO}node_modules/.bin/vite`, "--port", String(listen), "--strictPort"], {
    cwd: STUDIO,
    stdout: "ignore",
    stderr: "pipe",
  })
  const stop = async () => {
    child.kill()
    await child.exited
  }
  const deadline = Date.now() + START_TIMEOUT_MS
  while (!(await answers(origin))) {
    if (child.exitCode !== null) {
      const stderr = await new Response(child.stderr).text()
      throw new Error(`vite exited (${child.exitCode}) before serving ${origin}\n${stderr}`)
    }
    if (Date.now() > deadline) {
      await stop()
      throw new Error(`vite did not serve ${origin} within ${START_TIMEOUT_MS / 1000}s`)
    }
    await Bun.sleep(100)
  }
  return { origin, stop }
}
