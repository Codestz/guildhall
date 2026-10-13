/**
 * The Harbour (V1's /harbour): every repo whose whole history has been chronicled, as a page of cards, each
 * opening its island. Props only: the shell reads the catalog (`state`, `entries`) and routes the links.
 * Nothing to pick from is said plainly: a chronicle catalogue that could not be read is not an empty harbour.
 */

import { ArrowIcon, Dest } from "./parts.tsx"
import { SiteNav, type SiteNavProps } from "./SiteNav.tsx"

export interface HarbourEntry {
  /** `owner/name`. */
  repo: string
  description?: string
  languages: readonly string[]
  /** First and last year of its history. */
  years: readonly [number, number]
  files: number
  bytes: number
  /** `YYYY-MM-DD` the chronicle was built. */
  built: string
  /** Its island's picture; `fallbackArt` when that one is not there. */
  art: string
  fallbackArt?: string
}

export interface HarbourPageProps {
  state: "loading" | "ok" | "unavailable"
  entries: readonly HarbourEntry[]
  /** Why the catalogue could not be read, in a few words. */
  reason?: string
  hrefFor(entry: HarbourEntry): string
  onOpen(entry: HarbourEntry): void
  nav: SiteNavProps
}

const n = (v: number) => v.toLocaleString("en-US")
const size = (b: number) =>
  b >= 1e9
    ? `${(b / 1e9).toFixed(1)} GB`
    : b >= 1e6
      ? `${(b / 1e6).toFixed(1)} MB`
      : `${Math.max(1, Math.round(b / 1e3))} kB`

export function HarbourPage({ state, entries, reason, hrefFor, onOpen, nav }: HarbourPageProps) {
  return (
    <div className="site-page">
      <a className="site-skip" href="#harbour-main">
        Skip to the repos
      </a>
      <header className="site-page-top">
        <SiteNav {...nav} />
      </header>
      <main id="harbour-main" className="site-article site-harbour" tabIndex={-1}>
        <div className="site-hero">
          <p className="ui-eyebrow">The Harbour</p>
          <h1>Repos chronicled from their first commit</h1>
          <span className="site-rule" aria-hidden="true" />
          <p className="site-lede">
            Every repo moored here has had its whole history read: each folder a district, each release a
            milestone, each contributor a townsfolk. Open one to watch it grow.
          </p>
          <p className="site-harbour-count" aria-live="polite">
            {state === "ok"
              ? `${entries.length} ${entries.length === 1 ? "island" : "islands"} moored`
              : state === "loading"
                ? "Reading the harbour…"
                : "The harbour could not be read"}
          </p>
        </div>

        {state === "unavailable" && (
          <p className="ui-panel site-harbour-empty" role="status">
            The list of chronicles could not be read{reason ? ` (${reason})` : ""}. Any public repo still
            opens as <code>/hall/owner/repo</code> once it has a chronicle.
          </p>
        )}

        {state === "ok" && entries.length === 0 && (
          <p className="ui-panel site-harbour-empty" role="status">
            No repo has been chronicled yet.
          </p>
        )}

        {entries.length > 0 && (
          <ul className="site-cards site-harbour-cards" aria-label="Chronicled repos">
            {entries.map((r) => {
              const [owner = "", name = r.repo] = r.repo.split("/")
              return (
                <li key={r.repo} className="site-card">
                  <article aria-label={r.repo}>
                    <img
                      className="site-card-art"
                      src={r.art}
                      alt={`${r.repo} as an island, as its hall draws it.`}
                      width={640}
                      height={400}
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        const img = e.currentTarget
                        if (r.fallbackArt && !img.src.endsWith(r.fallbackArt)) img.src = r.fallbackArt
                      }}
                    />
                    <div className="site-card-body">
                      <h2 className="site-card-title">
                        <span className="site-harbour-owner">{owner}/</span>
                        {name}
                      </h2>
                      <p className="site-card-blurb">
                        {r.description ?? `${r.repo}, read from its public history.`}
                      </p>
                      <p className="site-harbour-figures">
                        {r.years[0]} – {r.years[1]} · {n(r.files)} files · {size(r.bytes)}
                      </p>
                      {r.languages.length > 0 && (
                        <ul className="site-card-shows" data-chips="" aria-label="Languages">
                          {r.languages.slice(0, 3).map((l) => (
                            <li key={l}>{l}</li>
                          ))}
                        </ul>
                      )}
                      <div className="site-card-acts">
                        <Dest
                          href={hrefFor(r)}
                          onNavigate={() => onOpen(r)}
                          className="site-open"
                          aria-label={`Open ${r.repo}`}
                        >
                          Open island
                          <ArrowIcon />
                        </Dest>
                        <span className="site-card-link">Chronicled {r.built}</span>
                      </div>
                    </div>
                  </article>
                </li>
              )
            })}
          </ul>
        )}

        <footer className="site-foot">
          <p>Guildhall · MIT · public file trees only, never the code.</p>
          <Dest href={nav.hrefs.island} onNavigate={() => nav.onNavigate("island")}>
            Back to the island
          </Dest>
        </footer>
      </main>
    </div>
  )
}
