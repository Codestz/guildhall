/**
 * The top nav of the site's long pages (How it's built, the Harbour): the island, the demos, the harbour and
 * the article, the current one marked. It sits in the page's sticky bar, right of the crest the shell draws
 * over every page. A phone keeps the four on one row (the labels shorten) with the island first.
 */
import { ArrowIcon, Dest } from "./parts.tsx"

export type SiteNavId = "island" | "demos" | "harbour" | "built"

const LINKS: readonly { id: SiteNavId; label: string; short: string }[] = [
  { id: "island", label: "Island", short: "Island" },
  { id: "demos", label: "Demos", short: "Demos" },
  { id: "harbour", label: "Harbour", short: "Harbour" },
  { id: "built", label: "How it's built", short: "Built" },
]

export interface SiteNavProps {
  current: SiteNavId
  /** Real addresses (middle-click, copy link). */
  hrefs: Record<SiteNavId, string>
  onNavigate(id: SiteNavId): void
}

export function SiteNav({ current, hrefs, onNavigate }: SiteNavProps) {
  return (
    <nav className="site-topnav" aria-label="The site">
      <ul>
        {LINKS.map((l) => (
          <li key={l.id}>
            <Dest
              href={hrefs[l.id]}
              onNavigate={() => onNavigate(l.id)}
              className="site-topnav-link"
              aria-current={current === l.id ? "page" : undefined}
            >
              {l.id === "island" && (
                <span className="site-back-arrow" aria-hidden="true">
                  <ArrowIcon />
                </span>
              )}
              <span className="site-topnav-long">{l.label}</span>
              <span className="site-topnav-short" aria-hidden="true">
                {l.short}
              </span>
            </Dest>
          </li>
        ))}
      </ul>
    </nav>
  )
}
