import { useEffect, useRef } from "react"
import { BASE } from "../env.ts"
import { GROUPS, linkTo, type Tool, type ToolGroup } from "../shell/directory.ts"
import { Arrow, Mark, MOD_KEY } from "../shell/icons.tsx"
import { follow } from "../shell/nav.ts"
import { formatCount, type StudioStats } from "./stats.ts"

/** Where the committed card previews are served (apps/studio/public/home/). */
export const PREVIEWS = `${BASE}home`

const SOURCES = [
  {
    name: "KayKit",
    by: "Kay Lousberg",
    href: "https://kaylousberg.com/game-assets",
    what: "characters, rigs, tools",
  },
  { name: "Kenney", by: "Kenney Vleugels", href: "https://kenney.nl/assets", what: "town, castle, nature" },
  {
    name: "Quaternius",
    by: "Quaternius",
    href: "https://quaternius.com",
    what: "buildings, nature, animals",
  },
] as const

const STAT_ROWS: readonly { key: keyof Omit<StudioStats, "palette">; label: string }[] = [
  { key: "pieces", label: "pieces" },
  { key: "packs", label: "packs" },
  { key: "clips", label: "animation clips" },
  { key: "rigs", label: "rigs" },
  { key: "mounts", label: "grips authored" },
  { key: "recipes", label: "recipes saved" },
]

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
  const lab = GROUPS.find((g) => g.id === "lab")
  const toolGroups = GROUPS.filter((g) => g.id !== "lab")

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
              Guildhall turns what happens into a town that lives it. This is the workshop where its world is
              made: every piece sized to one hero, tinted from one palette, built into houses and put into
              people’s hands.
            </p>
            <div className="actions">
              <a className="gh-btn primary" href={linkTo("pieces")} onClick={follow("pieces")}>
                Browse the library
                <Arrow />
              </a>
              <a className="gh-btn" href={linkTo("composer")} onClick={follow("composer")}>
                Compose a house
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
              <span>
                Library houses, a knight with an authored sword, a mage with a lantern, at golden hour.
              </span>
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
          {toolGroups.map((group) => (
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
              <p>Every model is public-domain, from three makers whose work this stands on:</p>
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
              <h3>World-fixed shadows</h3>
              <p>
                The sun’s shadow cascades are pinned to the world and snapped to whole texels, so shadows hold
                still while the camera moves: no swimming, no shimmer.
              </p>
            </article>
          </div>
        </section>

        <footer className="gh-home-foot">
          <span className="brand">
            <Mark size={20} />
            Guildhall Studio
          </span>
          {lab && (
            <span>
              Lab:{" "}
              {lab.tools.map((t) => (
                <a key={t.id} href={linkTo(t.id)} onClick={follow(t.id)}>
                  {t.name}
                </a>
              ))}
            </span>
          )}
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
