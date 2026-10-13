import { COMPONENTS_CSS } from "./components.ts"
import { FACES, FONTS_URL, TOKENS_CSS } from "./tokens.ts"

let users = 0
let nodes: HTMLElement[] = []
let loaded: Promise<void> = Promise.resolve()

export interface StyleHold {
  /** Settles once the faces have loaded, or after the timeout (offline, the fallback faces are used). */
  ready: Promise<void>
  release(): void
}

/**
 * Adds the tokens, the component sheet and the fonts while at least one holder needs them. A page that
 * already carries the tokens (the studio shell) may hold this too: the sheets are added once.
 */
export function holdUiStyle(ms = 3000): StyleHold {
  if (users++ === 0) {
    const style = document.createElement("style")
    style.dataset.gh = "ui"
    style.textContent = TOKENS_CSS + COMPONENTS_CSS
    const fonts = document.createElement("link")
    fonts.rel = "stylesheet"
    fonts.href = FONTS_URL
    const sheet = new Promise<void>((done) => {
      fonts.onload = () => done()
      fonts.onerror = () => done()
    })
    // first in <head>: a screen's own sheet, added later, wins a tie
    document.head.prepend(fonts, style)
    nodes = [fonts, style]
    const faces = sheet.then(() => Promise.all(FACES.map((face) => document.fonts.load(face))))
    loaded = Promise.race([faces.then(() => undefined), new Promise<void>((done) => setTimeout(done, ms))])
  }
  let released = false
  return {
    ready: loaded.catch(() => undefined),
    release() {
      if (released) return
      released = true
      if (--users > 0) return
      for (const node of nodes) node.remove()
      nodes = []
    },
  }
}
