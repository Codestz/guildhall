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
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv
  }
}

/** The path the studio is served under, ending in "/": "/" unless the build sets a `base`. */
export const BASE: string = import.meta.env.BASE_URL ?? "/"

/** The read-only public build: no writes, saves become downloads, dev-only screens hidden. */
export const SHOWCASE: boolean = import.meta.env.VITE_STUDIO_SHOWCASE === "1"
