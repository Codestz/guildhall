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
import { useChronicle, useLiveStories } from "./chronicle.ts"
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
  const live = useLiveStories()

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

const n = (v: number) => v.toLocaleString("en-US")

/**
 * A repo's hall, until the hall screen exists: what the island was grown from (the repo's chronicle: its
 * size, its figures, its folders and packages as named places), or, with no chronicle, that the island
 * is a sketch and how to ask for one. Where the HUD (roster, chronicle, history) will sit.
 */
function HallNote({ slug, onGo }: { slug: string; onGo(url: string): void }) {
  const { state } = useChronicle(slug)
  // a retry opens the hall again with a fresh try, so the island is rebuilt from what the retry finds
  const retry = () => onGo(href("hall", { repo: slug, try: String(Date.now() % 100000) }))
  const repo = state.status === "ok" ? state.repo : null
  return (
    <section className="ui-panel site-note" aria-label={`The hall of ${slug}`}>
      <p className="ui-eyebrow">Your repo</p>
      <h2>{slug}</h2>
      {state.status === "loading" && <p>Reading this repo's chronicle…</p>}
      {repo && (
        <p>
          {n(repo.files)} files, {repo.commits !== undefined ? `${n(repo.commits)} commits, ` : ""}
          {n(repo.contributors)} contributor{repo.contributors === 1 ? "" : "s"},{" "}
          {repo.years[0] === repo.years[1] ? repo.years[0] : `${repo.years[0]} – ${repo.years[1]}`}. The
          island is sized by its files; its {repo.places.length} places are its folders and packages, named on
          their plates.
        </p>
      )}
      {state.status === "not-chronicled" && (
        <p>
          A sketch, not this repo's island: there is no chronicle for it yet, so the land below is the
          generator's own at a default size.
        </p>
      )}
      {state.status === "unavailable" && (
        <p>
          A sketch, not this repo's island: its chronicle could not be read ({state.reason}), so the land
          below is the generator's own at a default size.
        </p>
      )}
      <div className="site-note-hud" role="status">
        {state.status === "loading" && "Looking for this repo's chronicle…"}
        {repo &&
          `Chronicle built ${repo.generatedAt.slice(0, 10)}${repo.source === "local" ? " (the studio's copy)" : ""}.`}
        {state.status === "not-chronicled" && (
          <>
            No chronicle for this repo yet.{" "}
            <a className="site-link" href={state.request} target="_blank" rel="noreferrer">
              Request a chronicle
            </a>
          </>
        )}
        {state.status === "unavailable" && (
          <>
            The chronicles could not be reached.{" "}
            <button type="button" className="site-link" onClick={retry}>
              Try again
            </button>
          </>
        )}
      </div>
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
