/**
 * What the build tells the studio: where it is served from and whether it is the public showcase.
 * Vite replaces `import.meta.env.*` at build time; under bun (tests) they are unset, so the defaults hold.
 */

declare global {
  interface ImportMetaEnv {
    /** Vite's `base`, always ending in "/". */
    readonly BASE_URL?: string
    /** "1" in the read-only showcase build (`bun run build:showcase`). */
    readonly VITE_STUDIO_SHOWCASE?: string
    /**
     * The library's root in a showcase build: its versioned `/library/<hash>`, or a CDN's URL
     * (STUDIO_LIBRARY=<url>); "" in dev, where vite serves `/library/`.
     */
    readonly VITE_LIBRARY_URL?: string
    /** "1" when the build shipped every library GLB gzipped as `<name>.glb.gz` (render gltf.ts inflates it). */
    readonly VITE_LIBRARY_GZ?: string
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv
  }
}

/** The path the studio is served under, ending in "/": "/" unless the build sets a `base`. */
export const BASE: string = import.meta.env.BASE_URL ?? "/"

/** Where the asset library is read from: vite's `<base>library` unless the build names another root. */
export const LIBRARY_ROOT: string = import.meta.env.VITE_LIBRARY_URL || `${BASE}library`

/** Whether the library's GLBs are served gzipped under `<name>.glb.gz` (the showcase build); dev serves them plain. */
export const LIBRARY_GZ: boolean = import.meta.env.VITE_LIBRARY_GZ === "1"

/** The read-only public build: no writes, saves become downloads, dev-only screens hidden. */
export const SHOWCASE: boolean = import.meta.env.VITE_STUDIO_SHOWCASE === "1"

/** True for the machine's own addresses: `localhost` (and `*.localhost`), 127.0.0.1, ::1. */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  return h === "localhost" || h.endsWith(".localhost") || h === "127.0.0.1" || h === "::1"
}

/**
 * Whether the studio is view-only: the public build, or any page not served from this machine. Saving
 * is for localhost alone: elsewhere every edit mode still works but a save is a no-op (see data.ts), and the
 * top bar says so. The dev server's own endpoint refuses non-local writes as well. With no `hostname` (a test, a worker) the page is local.
 */
export function viewOnly(showcase: boolean, hostname: string | undefined): boolean {
  return showcase || (hostname !== undefined && !isLocalHost(hostname))
}

/** What the top bar says when the page is read-only: every edit mode works, nothing is kept. */
export const READ_ONLY_NOTICE = "Read-only: explore freely, nothing is saved"

/** This page's view-only state: the one gate every save and edit control reads. */
export const READ_ONLY: boolean = viewOnly(
  SHOWCASE,
  typeof location === "undefined" ? undefined : location.hostname,
)
