import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { startOnIsland } from "./guild/archipelagoStart.ts"
import { boot } from "./guild/boot.ts"
import { applyDeepLink, type Hall as LinkedHall, parseDeepLink } from "./guild/deeplink.ts"
import { worldEventsOf } from "./guild/events.ts"
import { HOME_REPO, homeOf } from "./guild/home.ts"
import { startHome } from "./guild/homeShow.ts"
import { islandView } from "./guild/islandView.ts"
import { MODE, PROBE } from "./guild/mode.ts"
import { reducedMotion } from "./guild/opening.ts"
import { quality } from "./guild/quality.ts"
import { GuildStore, liveUrlOf } from "./guild/store.ts"
import { positions } from "./guild/useGuild.ts"
import { Hall } from "./Hall.tsx"
import "./hall.css"
import { hudPrefs } from "./hud/prefs.ts"
import { islandIndexOf, parseArchipelagoLink, parseSplitLink } from "./world/archipelagoLink.ts"
import { archipelagoSource, loadArchipelago, loadSplitRepo } from "./world/archipelagoSource.ts"

const root = document.getElementById("root")
if (!root) throw new Error("#root missing from index.html")

// The labs (lab/labs.ts): dev and probe builds only, `?lab=grips|character|prop|event`, instead of
// the hall. `?grips` is the grip lab's old address.
const params = new URLSearchParams(location.search)
const lab = PROBE ? (params.get("lab") ?? (params.has("grips") ? "grips" : null)) : null
// The build-time test spelled out here (not just PROBE): the bundler drops the import, and with it
// every lab chunk, before it plans the chunks of a showcase build.
if ((import.meta.env.DEV || import.meta.env.VITE_GUILDHALL_PROBE === "1") && lab)
  void import("./lab/labs.ts").then((module) => module.start(root, lab, params))

const store = new GuildStore()
// The showcase tells the Saga (sim/saga.ts): five acts, every world event, the story's own hours.
if (MODE === "showcase") store.load("saga")
// Until the world has mounted (scene/Scene.tsx WorldReady): see GuildStore.hold.
store.hold()
// The safety release, here rather than only inside the <Canvas>: if WebGL fails the canvas never
// mounts, and the HUD must not stay frozen by the hold (review-2 #23). Idempotent.
setTimeout(() => store.release(), 20_000)
// `?live` follows the hub (real OpenCode sessions); `?live=ws://localhost:port/ws` picks another
// hub on this machine (`&anyhub=1` for one elsewhere).
const live = liveUrlOf(location.search)
if (live !== null) store.live(live)

// The showcase's home (guild/home.ts): a bare `/` is React, grown as an archipelago of its packages
// after a short cut of its growth film (guild/homeShow.ts). The link read from here on is that
// spelled out; any other link opens as it always did. Reduced motion has no film: straight to the packages.
const showHome = live === null && !lab ? homeOf(location.search, reducedMotion()) : null
const filmed = showHome?.film === true
const search = showHome ? `repo=${HOME_REPO}&${location.search.slice(1)}` : location.search

// Deep links (guild/deeplink.ts): `?story=saga&t=11:53&hour=23&look=quarry`… Quality and HUD from
// a link last for the visit: the viewer's own remembered choices are left as they were.
const linked: LinkedHall = {
  store,
  quality(tier) {
    quality.choice = tier
    quality.set(tier)
  },
  hud(mode) {
    let kept: string | null = null
    try {
      kept = localStorage.getItem("guildhall.hud")
    } catch {}
    hudPrefs.set({ mode })
    try {
      if (kept === null) localStorage.removeItem("guildhall.hud")
      else localStorage.setItem("guildhall.hud", kept)
    } catch {}
  },
  ...(PROBE ? { force: (kind) => void worldEventsOf(store).force(kind) } : {}),
}
// `?repo=owner/name&split` (world/archipelagoLink.ts): the repo as an archipelago of its packages. It
// adopts the core as the home world first, so the link's own `repo=` (applyDeepLink) finds it loading.
const split = live === null && !lab && !filmed ? parseSplitLink(search) : null
if (split) {
  const patches = import("./scene/archipelago/footprint.ts").then(({ patchesOf }) => patchesOf)
  const splitting = loadSplitRepo(split.repo, patches).then((grown) => {
    if (!grown || !split.island) return
    const stop = islandIndexOf(
      split.island,
      grown.islands.map((island) => island.repo),
    )
    if (stop !== undefined) islandView.start(stop)
  })
  boot.hold(splitting)
}

if (live === null && !lab) applyDeepLink(parseDeepLink(search, PROBE).link, linked)
if (showHome)
  startHome(store, showHome, () =>
    import("./scene/archipelago/footprint.ts").then(({ patchesOf }) => patchesOf),
  )

// The archipelago (`?archipelago`, `?repos=`, `&island=`; world/archipelagoLink.ts): the far islands
// grow beside the home one, and a link's island is where the camera starts.
const archipelago = live === null && !lab ? parseArchipelagoLink(location.search) : null
if (archipelago) {
  // The far islands come as they are grown, each drawn when it is ready (a big one takes a while):
  // the loader waits for the home island only, and a link's island= starts when its island is in.
  if (archipelago.island) startOnIsland(archipelago.island)
  void import("./scene/archipelago/footprint.ts").then(({ patchesOf }) =>
    loadArchipelago(archipelago.repos, patchesOf),
  )
}

if (PROBE)
  Object.assign(window, {
    guild: store,
    /** Where each adventurer stands now, by id (guild/useGuild.ts): a probe reads who is aboard a ferry. */
    positions,
    archipelago: archipelagoSource,
    quality,
    /**
     * scripts/probe-server.ts: `deeplink.apply("story=saga&hour=23")` sets a state on the warm page
     * (after `reset()`), returning what it ignored or couldn't do.
     */
    deeplink: {
      apply(search: string): string[] {
        const { link, ignored } = parseDeepLink(search, true)
        return [...ignored, ...applyDeepLink(link, linked)]
      },
      /** Back to a plain hall: no panel, pick, framing or forced event; the clock running, the Bard on. */
      reset(): void {
        // Esc unwinds the HUD one layer at a time (hud/Hud.tsx): an open book or panel closes.
        for (let i = 0; i < 3; i++) window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
        const events = worldEventsOf(store)
        for (const show of [...events.shows]) events.done(show.id)
        store.select(null)
        store.frame(null)
        store.setSpeed(1)
        store.setView("diorama")
        store.setEnvironment({ time: MODE === "showcase" ? "story" : "real", weather: "auto" })
        store.setBard(true)
        linked.hud("minimal")
      },
    },
  })

if (!lab)
  createRoot(root).render(
    <StrictMode>
      <Hall store={store} />
    </StrictMode>,
  )
