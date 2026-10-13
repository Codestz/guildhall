/**
 * The site's pieces over the island (or, on `/built`, alone): the crest menu everywhere, ⌘K, the
 * first-visit welcome card, the demo picker on `/demos`, the repo field on a bare `/hall`,
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
import { createPortal } from "react-dom"
import type { HallTime } from "../hall/clock.ts"
import { HallTimeline } from "../hall/timeline.tsx"
import { current, href } from "../shell/router.ts"
import { Switcher } from "../shell/Switcher.tsx"
import { BUILT } from "./built.ts"
import { useLiveStories } from "./chronicle.ts"
import { useHudBottom } from "./hudSlot.ts"
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

/** `time`: a repo's hall's clock, for its timeline bar (null off a hall, or a hall with no history). */
export function SiteApp({ time = null }: { time?: HallTime | null } = {}) {
  const { screen, query } = useLocationNow()
  const [menu, setMenu] = useState(false)
  const [palette, setPalette] = useState(false)
  const [welcome, setWelcome] = useState(() => !readWelcomeDismissed())
  const [busy, setBusy] = useState(false)
  const live = useLiveStories()
  const bottom = useHudBottom()

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
          stories={[...STORIES, ...live]}
          hrefFor={hrefFor}
          onOpen={(s, act) => {
            seen()
            go(hrefFor(s, act))
          }}
          onClose={() => go(href("island"))}
        />
      )}

      {/* a repo's hall: its HUD is drawn on the island's Viewer (hall/hud); the timeline bar goes in the
          HUD's bottom-centre slot */}
      {screen === "hall" && slug && time && bottom && createPortal(<HallTimeline time={time} />, bottom)}

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
