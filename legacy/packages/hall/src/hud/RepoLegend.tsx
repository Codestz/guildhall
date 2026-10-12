import { useSyncExternalStore } from "react"
import { quality } from "../guild/quality.ts"
import { growth } from "../world/chronicle/growthControl.ts"
import { censusOf } from "../world/folk/census.ts"
import { hasFolk } from "../world/folk/plan.ts"
import { ROLES } from "../world/folk/types.ts"
import { useWorld, useWorldStatus } from "../world/source.ts"
import type { World } from "../world/world.ts"
import { deepenLink } from "./chronicleLinks.ts"
import { Icon } from "./icons.tsx"
import { repoDoor } from "./RepoDoor.tsx"
import { repoPanel, useRepoPanel } from "./repoPanel.ts"
import { SplitIslands } from "./SplitIslands.tsx"
import { useGrowthPhase } from "./TimelineGrowth.tsx"
import { useDeepChronicle } from "./useCatalog.ts"

/** How each biome reads in the legend. */
const BIOME: Record<string, string> = {
  harbour: "harbour",
  village: "village",
  proving: "proving grounds",
  library: "library",
  quarry: "quarry",
  forest: "forest",
  farms: "farms",
  wilds: "wilds",
}

const ROLE_NAMES: Record<(typeof ROLES)[number], string> = {
  villager: "villagers",
  guard: "guards",
  farmer: "farmers",
  fisher: "fishers",
  trader: "traders",
  miner: "miners",
}

/** A gen 2 island's life: how many folk and animals it shows at this quality, by trade (world/folk). */
function Life({ world }: { world: World }) {
  const tier = useSyncExternalStore(quality.subscribe, quality.snapshot)
  if (!hasFolk(world)) return null
  const census = censusOf(world, tier)
  const trades = ROLES.filter((role) => census.roles[role] > 0)
    .map((role) => `${census.roles[role]} ${ROLE_NAMES[role]}`)
    .join(", ")
  return (
    <p className="repo-meta" title={trades}>
      Life · {census.folk} folk · {census.animals} animals
    </p>
  )
}

/**
 * `?repo=` (world/source.ts): which repo the island was grown from and its districts — one per
 * top-level folder, coloured by its main language — or why it couldn't be grown (the guild's own
 * island is shown instead). Nothing without `?repo=`. An island whose history is only a quick sketch
 * (no deep chronicle in world/chronicle/catalog.ts) offers "Deepen this island": a request on GitHub.
 */
export function RepoLegend() {
  const status = useWorldStatus()
  const world = useWorld()
  const { repo } = world
  const filming = useGrowthPhase()
  const deep = useDeepChronicle(repo?.repo)
  const open = useRepoPanel()

  if (status.state === "loading")
    return (
      <section className="plaque repo-legend repo-panel" aria-live="polite">
        <p className="repo-note">Growing {status.repo}'s island…</p>
      </section>
    )
  if (status.state === "failed")
    return (
      <section className="plaque repo-legend repo-panel" role="status">
        <p className="repo-note">
          Couldn't grow {status.repo}: {status.reason}. This is the guild's own island.
        </p>
        <button type="button" className="repo-again" aria-haspopup="dialog" onClick={repoDoor.open}>
          <Icon.retry />
          Try another repo
        </button>
      </section>
    )
  if (!repo) return null

  // The growth film owns the screen while it plays: the panel waits, the viewer's choice stays.
  const shown = open && (filming === "off" || filming === "failed")
  const files = repo.districts.reduce((sum, district) => sum + district.files, 0)
  return (
    <>
      {/* Folded: one chip with the repo's name, set like the toolbar's buttons; unfolded: the full panel below it. */}
      <button
        type="button"
        className="plaque repo-chip"
        aria-expanded={shown}
        aria-controls="repo-panel"
        aria-label={`Island grown from ${repo.repo}: districts`}
        title={repo.repo}
        onClick={() => repoPanel.set(!open)}
      >
        <Icon.island />
        <span className="repo-chip-name">
          <span className="repo-owner">{repo.repo.split("/")[0]}/</span>
          {repo.repo.split("/").slice(1).join("/")}
        </span>
        <span className="fold" aria-hidden="true">
          <Icon.chevron />
        </span>
      </button>
      <section className="plaque repo-legend repo-panel" id="repo-panel" hidden={!shown}>
        <div className="repo-head">
          <h2 className="repo-name">{repo.repo}</h2>
          <button
            type="button"
            className="icon-btn repo-door"
            aria-haspopup="dialog"
            aria-label="Your repo as an island: grow another, share this one"
            title="Grow another · share"
            onClick={repoDoor.open}
          >
            <Icon.island />
          </button>
        </div>
        <p className="repo-meta">
          {files.toLocaleString("en")} files · {repo.districts.length} districts
          {repo.truncated ? " · partial tree" : ""}
        </p>
        <Life world={world} />
        {/* Its history as a timelapse, first commit to today (`?grow`, scene/growth). */}
        {filming !== "playing" && filming !== "paused" && (
          <button type="button" className="repo-again" onClick={() => growth.request(repo.repo)}>
            <Icon.play />
            Watch it grow
          </button>
        )}
        {deep === false && (
          <a
            className="repo-again"
            href={deepenLink(repo.repo)}
            target="_blank"
            rel="noopener noreferrer"
            title="Its history here is a quick sketch. Ask for the whole of it (opens a GitHub issue)"
          >
            <Icon.book />
            Deepen this island
          </a>
        )}
        <ul className="repo-districts">
          {repo.districts.map((district) => (
            <li key={district.id}>
              <i className="repo-swatch" style={{ background: district.accent }} aria-hidden="true" />
              <span className="repo-folder">{district.label}</span>
              <span className="repo-biome">
                {BIOME[district.biome] ?? district.biome} · {district.language.name}
              </span>
            </li>
          ))}
        </ul>
        <SplitIslands />
      </section>
    </>
  )
}
