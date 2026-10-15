/**
 * The site's pieces over the island (or, on `/harbour` and `/built`, alone): the crest menu everywhere, ⌘K,
 * the first-visit welcome bar, the demo picker (on `/demos`, or over any page in place), the repo field on a bare `/hall`, the harbour,
 * How it's built, and "Connect a source". A story the link names plays on the island's HUD (homeHud.tsx).
 * It reads the URL itself (so a move between `/`,
 * `/demos` and a bare `/hall` keeps the island that is already built) and moves by `openUrl`.
 */
import {
  BuiltPage,
  CrestMenu,
  DemoPicker,
  HarbourPage,
  readWelcomeDismissed,
  type SiteDest,
  type SiteNavId,
  SourcesCard,
  type Story,
  WelcomeCard,
  writeWelcomeDismissed,
} from "@guildhall/ui"
import { useEffect, useState } from "react"
import { current, href } from "../shell/router.ts"
import { Switcher } from "../shell/Switcher.tsx"
import { BUILT } from "./built.ts"
import { repoArt, useCatalog, useLiveStories } from "./chronicle.ts"
import { homeStoryOf } from "./homeFeed.ts"
import { homeStage } from "./homeHud.tsx"
import { openDemosWith, openUrl } from "./nav.ts"
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

const HERE: Record<string, SiteDest | undefined> = {
  demos: "demos",
  harbour: "harbour",
  built: "built",
  hall: "repo",
}

/** The top nav's four places, as screen ids. */
const NAV: Record<SiteNavId, string> = {
  island: "island",
  demos: "demos",
  harbour: "harbour",
  built: "built",
}

/** The site's pieces over the island (the island's HUD, its timeline bar included, is hall/hud's). */
export function SiteApp() {
  const { screen, query } = useLocationNow()
  const [menu, setMenu] = useState(false)
  const [palette, setPalette] = useState(false)
  const [welcome, setWelcome] = useState(() => !readWelcomeDismissed())
  const [busy, setBusy] = useState(false)
  const [sources, setSources] = useState(false)
  // the demos over the page in place (the crest menu's Demos, the welcome card's, the HUD's): nothing
  // under it moves, and closing it leaves the visitor where they were (nav.ts `openDemosWith`)
  const [demosOver, setDemosOver] = useState(false)
  useEffect(() => {
    openDemosWith(() => {
      setMenu(false)
      setPalette(false)
      setDemosOver(true)
    })
    return () => openDemosWith(null)
  }, [])
  // a move elsewhere (back, forward, a link) takes it down
  const address = `${screen}?${query}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: the address is what changed
  useEffect(() => setDemosOver(false), [address])
  const live = useLiveStories()
  const catalog = useCatalog()

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
    if (d === "repo" || d === "demos" || d === "harbour" || d === "built") seen()
    go(destHref(d))
  }

  const world = screen === "island" || screen === "demos" || screen === "hall"
  const slug = hallSlug(query)
  const story = openedStory(query, STORIES)
  // a story the link names plays on the home's island in place (the picker, an act, back and forward)
  const storyId = story?.story.id ?? null
  const storyAct = story?.act
  useEffect(() => {
    if (!world || slug) return
    const stage = homeStage()
    if (stage) stage.play(homeStoryOf(storyId), storyAct)
  }, [storyId, storyAct, world, slug])
  // the card: the first visit to the island, or `/hall` asking for the repo
  const card = !story && ((screen === "island" && welcome) || (screen === "hall" && !slug))
  // the welcome bar and the HUD's bottom-centre share the foot of the screen: while the bar is up the HUD's
  // bottom row (the timeline, the captions, the act chip) rides above it (`--welcome-h`, site/style.ts)
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".site-root")
    const bar = card ? document.querySelector<HTMLElement>(".site-welcome-card") : null
    if (!root || !bar) return
    const set = () => {
      root.style.setProperty("--welcome-h", `${bar.offsetHeight}px`)
      root.dataset.welcome = ""
    }
    set()
    const watch = new ResizeObserver(set)
    watch.observe(bar)
    return () => {
      watch.disconnect()
      root.style.removeProperty("--welcome-h")
      delete root.dataset.welcome
    }
  }, [card])
  const hrefFor = (s: Story, act?: number) => storyHref(s.link, act)
  const nav = (here: SiteNavId) => ({
    current: here,
    hrefs: {
      island: href("island"),
      demos: destHref("demos"),
      harbour: destHref("harbour"),
      built: destHref("built"),
    },
    onNavigate: (id: SiteNavId) => go(href(NAV[id])),
  })

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
          harbour: destHref("harbour"),
          studio: destHref("studio"),
          built: destHref("built"),
        }}
        onPalette={() => setPalette(true)}
        onSources={() => setSources(true)}
      />

      {card && (
        <WelcomeCard
          key={screen}
          busy={busy}
          startOpen={screen === "hall"}
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
          onSources={() => setSources(true)}
          onDismiss={() => {
            seen()
            if (screen === "hall") go(href("island"))
          }}
        />
      )}

      {(screen === "demos" || demosOver) && (
        <DemoPicker
          stories={[...STORIES, ...live]}
          hrefFor={hrefFor}
          onOpen={(s, act) => {
            seen()
            setDemosOver(false)
            go(hrefFor(s, act))
          }}
          onClose={() => {
            setDemosOver(false)
            // `/demos` visited directly is a page of its own: closing it lands on the island under it
            if (screen === "demos") go(href("island"))
          }}
        />
      )}

      {screen === "built" && (
        <BuiltPage
          content={BUILT}
          backHref={href("island")}
          onBack={() => go(href("island"))}
          nav={nav("built")}
          onTry={(link) => go(storyHref(link))}
        />
      )}

      {screen === "harbour" && (
        <HarbourPage
          state={catalog.status}
          entries={
            catalog.status === "ok"
              ? catalog.repos.map((r) => ({
                  ...r,
                  art: repoArt(r.repo),
                  fallbackArt: "/site/demos/island.webp",
                }))
              : []
          }
          {...(catalog.status === "unavailable" ? { reason: catalog.reason } : {})}
          hrefFor={(r) => href("hall", { repo: r.repo })}
          onOpen={(r) => go(href("hall", { repo: r.repo }))}
          nav={nav("harbour")}
        />
      )}

      {sources && <SourcesCard onClose={() => setSources(false)} />}

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
