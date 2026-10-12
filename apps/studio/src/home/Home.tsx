import { type MouseEvent, useEffect, useRef } from "react"
import { BASE } from "../env.ts"
import { GROUPS, linkTo, type Tool, type ToolGroup } from "../shell/directory.ts"
import { Arrow, Mark, MOD_KEY } from "../shell/icons.tsx"
import { follow } from "../shell/nav.ts"
import { href } from "../shell/router.ts"
import { formatCount, type StudioStats } from "./stats.ts"

/** Where the committed card previews are served (apps/studio/public/home/). */
export const PREVIEWS = `${BASE}home`

const SOURCES = [
  {
    name: "KayKit",
    by: "Kay Lousberg",
    href: "https://kaylousberg.com/game-assets",
    what: "hex tiles, characters, rigs",
  },
  { name: "Kenney", by: "Kenney Vleugels", href: "https://kenney.nl/assets", what: "town, castle, nature" },
] as const

const STAT_ROWS: readonly { key: keyof Omit<StudioStats, "palette">; label: string }[] = [
  { key: "pieces", label: "pieces" },
  { key: "packs", label: "packs" },
  { key: "tiles", label: "tile prefabs" },
  { key: "spots", label: "activity spots" },
  { key: "clips", label: "animation clips" },
]

/** The island the hero button opens (the Town screen's first seed). */
export const ISLAND_LINK = href("town", { town: "1" })

/** A plain click opens `url` in place (through `guildhall.open` when it is there); others go to the browser. */
const openInPlace = (url: string) => (e: MouseEvent<HTMLAnchorElement>) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  if (window.guildhall) {
    void window.guildhall.open(url)
    return
  }
  history.pushState(null, "", url)
  dispatchEvent(new PopStateEvent("popstate"))
}

function Card({ tool }: { tool: Tool }) {
  const body = (
    <>
      <div className="shot" aria-hidden="true">
        {tool.preview ? (
          <img
            src={`${PREVIEWS}/${tool.id}.webp`}
            alt=""
            width={640}
            height={400}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="blank">
            <Mark size={34} />
          </span>
        )}
      </div>
      <div className="body">
        <h4>
          {tool.name}
          {tool.soon && <span className="soon">soon</span>}
        </h4>
        <p>{tool.purpose}</p>
        {!tool.soon && (
          <span className="go">
            <code>{linkTo(tool.id)}</code>
            <Arrow />
          </span>
        )}
      </div>
    </>
  )
  if (tool.soon)
    return (
      <div className="gh-card" data-soon="true">
        {body}
      </div>
    )
  return (
    <a className="gh-card" href={linkTo(tool.id)} onClick={follow(tool.id)}>
      {body}
    </a>
  )
}

function Group({ group }: { group: ToolGroup }) {
  const titleId = `group-${group.id}`
  return (
    <section className="gh-group-row" aria-labelledby={titleId}>
      <header>
        <h3 id={titleId}>{group.name}</h3>
        <p>{group.blurb}</p>
      </header>
      <div className="cards">
        {group.tools.map((tool) => (
          <Card key={tool.id} tool={tool} />
        ))}
      </div>
    </section>
  )
}

/**
 * The studio's front door. `vignette` receives the element the 3D diorama draws into; `stats` is null
 * until the numbers are read.
 */
export function Home({
  stats,
  vignette,
}: {
  stats: StudioStats | null
  vignette(host: HTMLElement): () => void
}) {
  const plate = useRef<HTMLDivElement>(null)
  useEffect(() => (plate.current ? vignette(plate.current) : undefined), [vignette])

  return (
    <div className="gh gh-home">
      <main className="gh-home-page">
        <section className="gh-hero" aria-labelledby="home-title">
          <div className="copy">
            <p className="gh-eyebrow">A world-building workshop</p>
            <h1 id="home-title">
              Guildhall <span>Studio</span>
            </h1>
            <p className="pitch">Events in. A living world out.</p>
            <p className="lede">
              Guildhall turns what happens in a repository into a hex island that lives it: towns, farms and
              harbours grown tile by tile, folk at work, agents walking their errands. This is the workshop
              where that world is made, every tile composed from free pieces, every bench, stall and anvil a
              spot where someone sits, sells or works.
            </p>
            <div className="actions">
              <a className="gh-btn primary" href={ISLAND_LINK} onClick={openInPlace(ISLAND_LINK)}>
                Open the island
                <Arrow />
              </a>
              <a className="gh-btn" href={linkTo("composer")} onClick={follow("composer")}>
                Compose a tile
              </a>
            </div>
            <p className="hint">
              Press <kbd className="gh-kbd">{MOD_KEY} K</kbd> anywhere to jump to a tool.
            </p>
          </div>
          <figure className="plate">
            <div className="stage" ref={plate} />
            <figcaption>
              <span className="live">live</span>
              <span>A canteen and its beer garden at five, built from the island’s own tile prefabs.</span>
            </figcaption>
          </figure>
        </section>

        <section className="gh-home-stats" aria-label="The library at a glance">
          <dl>
            {STAT_ROWS.map(({ key, label }) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd className="num">{stats ? formatCount(stats[key]) : "—"}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="gh-home-tools" aria-labelledby="tools-title">
          <div className="gh-section-head">
            <p className="gh-eyebrow">The tools</p>
            <h2 id="tools-title">Everything the world is made with</h2>
          </div>
          {GROUPS.map((group) => (
            <Group key={group.id} group={group} />
          ))}
        </section>

        <section className="gh-made" aria-labelledby="made-title">
          <div className="gh-section-head">
            <p className="gh-eyebrow">How it’s made</p>
            <h2 id="made-title">Free assets, one look</h2>
          </div>
          <div className="cols">
            <article>
              <h3>CC0 sources</h3>
              <p>Every model is public-domain, from two makers whose work this stands on:</p>
              <ul className="sources">
                {SOURCES.map((s) => (
                  <li key={s.name}>
                    <a href={s.href} target="_blank" rel="noreferrer">
                      {s.name}
                      <Arrow size={10} />
                    </a>
                    <span>
                      by {s.by} · {s.what}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
            <article>
              <h3>One palette</h3>
              <p>
                Each pack arrives in its own colours. On import every piece is re-tinted to one shared palette
                of ramps, so a Kenney roof and a KayKit door belong to the same street.
              </p>
            </article>
            <article>
              <h3>Life at spots</h3>
              <p>
                Every tile carries the spots its scene offers: a seat, a stall, a fishing pier, open at their
                hours. People go only to spots, one to a spot, so the noon crowd spreads over benches and
                stalls and the evening fills the beer garden.
              </p>
            </article>
          </div>
        </section>

        <footer className="gh-home-foot">
          <span className="brand">
            <Mark size={20} />
            Guildhall Studio
          </span>
          {stats?.palette && (
            <span className="num">
              palette <b>{stats.palette}</b>
            </span>
          )}
        </footer>
      </main>
    </div>
  )
}
