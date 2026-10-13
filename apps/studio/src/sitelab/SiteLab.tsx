/**
 * The site lab: the four site pieces (@guildhall/ui site) over a still of the island, each as its own
 * `view`. The pieces are live: the crest menu moves between views, Open and Generate say what the shell
 * would do (in the note, top-right). The real wiring (routes, the remembered dismissal) is Track S part 2.
 */
import { BuiltPage, CrestMenu, DemoPicker, type SiteDest, type Story, WelcomeCard } from "@guildhall/ui"
import { useState } from "react"
import { BUILT } from "../site/built.ts"
import { STORIES } from "../site/stories.ts"

export type SiteView = "welcome" | "menu" | "demos" | "built"
export const VIEWS: readonly SiteView[] = ["welcome", "menu", "demos", "built"]

export interface SiteLabOptions {
  view: SiteView
  /** The welcome field's starting text, to shoot the validation states. */
  repo: string
  busy: boolean
  error: string
}

const HERE: Record<SiteView, SiteDest | undefined> = {
  welcome: undefined,
  menu: undefined,
  demos: "demos",
  built: "built",
}

export function SiteLab(opts: SiteLabOptions) {
  const [view, setView] = useState<SiteView>(opts.view)
  const [menu, setMenu] = useState(opts.view === "menu")
  const [welcome, setWelcome] = useState(true)
  const [note, setNote] = useState("")

  const go = (dest: SiteDest) => {
    setMenu(false)
    if (dest === "demos") setView("demos")
    else if (dest === "built") setView("built")
    else if (dest === "repo") {
      setWelcome(true)
      setView("welcome")
    } else setNote("The shell would open /studio")
  }
  const open = (story: Story, act?: number) => {
    setView("welcome")
    setWelcome(false)
    setNote(`The shell would open ${story.link}${act ? ` at act ${act}` : ""}`)
  }

  return (
    <div className="lab-site">
      <CrestMenu
        open={menu}
        onOpenChange={setMenu}
        onSelect={go}
        current={HERE[view]}
        hrefs={{ repo: "/hall", demos: "/demos", studio: "/studio", built: "/built" }}
      />
      {view === "welcome" && welcome && (
        <WelcomeCard
          initial={opts.repo}
          busy={opts.busy}
          error={opts.error || undefined}
          demoHref="/demos"
          builtHref="/built"
          onGenerate={(slug) => setNote(`The shell would open /hall/${slug}`)}
          onDemo={() => setView("demos")}
          onBuilt={() => setView("built")}
          onDismiss={() => {
            setWelcome(false)
            setNote("Dismissed: the shell remembers it")
          }}
        />
      )}
      {view === "demos" && <DemoPicker stories={STORIES} onOpen={open} onClose={() => setView("welcome")} />}
      {view === "built" && (
        <BuiltPage
          content={BUILT}
          onBack={() => setView("welcome")}
          onTry={(href) => setNote(`The shell would open ${href}`)}
        />
      )}
      {note && (
        <p className="lab-note" role="status">
          {note}
        </p>
      )}
    </div>
  )
}
