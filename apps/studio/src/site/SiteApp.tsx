/**
 * The site's pieces over the island (or, on `/built`, alone): the crest menu everywhere, ⌘K, the
 * first-visit welcome card, the demo picker on `/demos`, a repo's hall note on `/hall/<owner>/<repo>`,
 * the story chip on `?story=`, and How it's built. It reads the URL itself (so a move between `/`,
 * `/demos` and a bare `/hall` keeps the island that is already built) and moves by `openUrl`.
 */
import {
  BuiltPage,
  Button,
  CrestMenu,
  DemoPicker,
  readWelcomeDismissed,
  type SiteDest,
  type Story,
  WelcomeCard,
  writeWelcomeDismissed,
} from "@guildhall/ui"
import { useEffect, useState } from "react"
import { current, href } from "../shell/router.ts"
import { Switcher } from "../shell/Switcher.tsx"
import { BUILT } from "./built.ts"
import { openUrl } from "./nav.ts"
import { destHref, hallSlug, openedStory, storyHref } from "./routes.ts"
import { STORIES } from "./stories.ts"

/** The URL the site is at, kept in step with back and forward and with `guildhall.open`. */
function useLocationNow() {
  const [now, setNow] = useState(current)
  useEffect(() => {
    const on = () => setNow(current())
    addEventListener("popstate", on)
    return () => removeEventListener("popstate", on)
  }, [])
  return now
}

const HERE: Record<string, SiteDest | undefined> = { demos: "demos", built: "built", hall: "repo" }

export function SiteApp() {
  const { screen, query } = useLocationNow()
  const [menu, setMenu] = useState(false)
  const [palette, setPalette] = useState(false)
  const [welcome, setWelcome] = useState(() => !readWelcomeDismissed())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setMenu(false)
        setPalette((was) => !was)
      }
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [])

  const seen = () => {
    writeWelcomeDismissed()
    setWelcome(false)
  }
  const go = (url: string) => {
    setMenu(false)
    setPalette(false)
    openUrl(url)
  }
  const dest = (d: SiteDest) => {
    if (d === "repo" || d === "demos" || d === "built") seen()
    go(destHref(d))
  }

  const slug = hallSlug(query)
  const story = openedStory(query, STORIES)
  const world = screen === "island" || screen === "demos" || screen === "hall"
  // the card: the first visit to the island, or `/hall` asking for the repo
  const card = !story && ((screen === "island" && welcome) || (screen === "hall" && !slug))
  const hrefFor = (s: Story, act?: number) => storyHref(s.link, act)

  return (
    <div className="site-pieces">
      <CrestMenu
        open={menu}
        onOpenChange={setMenu}
        onSelect={dest}
        current={screen ? HERE[screen] : undefined}
        hrefs={{
          repo: destHref("repo"),
          demos: destHref("demos"),
          studio: destHref("studio"),
          built: destHref("built"),
        }}
        onPalette={() => setPalette(true)}
      />

      {card && (
        <WelcomeCard
          busy={busy}
          demoHref={destHref("demos")}
          builtHref={destHref("built")}
          onGenerate={(repo) => {
            setBusy(true)
            seen()
            go(href("hall", { repo }))
          }}
          onDemo={() => {
            seen()
            go(destHref("demos"))
          }}
          onBuilt={() => {
            seen()
            go(destHref("built"))
          }}
          onDismiss={() => {
            seen()
            if (screen === "hall") go(href("island"))
          }}
        />
      )}

      {screen === "demos" && (
        <DemoPicker
          stories={STORIES}
          hrefFor={hrefFor}
          onOpen={(s, act) => {
            seen()
            go(hrefFor(s, act))
          }}
          onClose={() => go(href("island"))}
        />
      )}

      {screen === "hall" && slug && <HallNote slug={slug} onGo={go} />}

      {world && story && screen !== "demos" && (
        <section className="ui-panel site-chip" aria-label="Story">
          <b>{story.story.title}</b>
          <span>{story.act ? `Act ${story.act} · ` : ""}Told here once the HUD's story player is built.</span>
          <Button size="sm" onClick={() => go(href(screen ?? "island", slug ? { repo: slug } : ""))}>
            Close
          </Button>
        </section>
      )}

      {screen === "built" && (
        <BuiltPage
          content={BUILT}
          backHref={href("island")}
          onBack={() => go(href("island"))}
          onTry={(link) => go(storyHref(link))}
        />
      )}

      {palette && (
        <Switcher
          current={screen ?? "island"}
          onClose={() => setPalette(false)}
          onOpen={(id) => go(href(id))}
        />
      )}
    </div>
  )
}

/**
 * The seam where a repo's chronicle plugs in (packages/sim/src/repo: `chronicleFor(owner/repo)`): one call
 * that says whether the repo has one. Nothing is read yet, so every repo is "without a chronicle".
 */
export function chronicleOf(_slug: string): null {
  return null
}

/** Where to ask for a repo's chronicle to be built. */
export const REQUEST_CHRONICLE = "https://github.com/Codestz/guildhall-chronicles/issues/new/choose"

/**
 * A repo's hall, until the hall screen exists: the island this name grows, and where the HUD (roster,
 * chronicle, history) will sit. Says plainly that the island is the generator's own for now.
 */
function HallNote({ slug, onGo }: { slug: string; onGo(url: string): void }) {
  const chronicle = chronicleOf(slug)
  return (
    <section className="ui-panel site-note" aria-label={`The hall of ${slug}`}>
      <p className="ui-eyebrow">Your repo</p>
      <h2>{slug}</h2>
      <p>
        An island grown from this name: the same name always grows the same island. Reading the repo's own
        file tree is the next step.
      </p>
      {chronicle === null && (
        <div className="site-note-hud">
          No chronicle for this repo yet, so there is no history to replay.{" "}
          <a className="site-link" href={REQUEST_CHRONICLE} target="_blank" rel="noreferrer">
            Request a chronicle
          </a>
        </div>
      )}
      <div className="site-note-hud">
        HUD · roster, chronicle and history open here once the hall screen is built.
      </div>
      <div className="site-note-links">
        <a
          className="site-link"
          href={href("hall")}
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
            e.preventDefault()
            onGo(href("hall"))
          }}
        >
          Another repo
        </a>
        <a
          className="site-link"
          href={href("demos")}
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
            e.preventDefault()
            onGo(href("demos"))
          }}
        >
          Watch a demo
        </a>
      </div>
    </section>
  )
}
