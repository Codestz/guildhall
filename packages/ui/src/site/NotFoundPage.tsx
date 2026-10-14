/**
 * A path nothing answers: the site's own page, not the engineer's. The crest, "Lost at sea" in the display
 * face, one line saying where, and the three ways back (the island, the demos, the harbour). Props only:
 * the shell knows the address and routes the buttons.
 */
import { Crest } from "../hud/glyphs.tsx"
import { Dest } from "./parts.tsx"

export type LostDest = "island" | "demos" | "harbour"

export interface NotFoundPageProps {
  /** The path nothing answered, shown in the line. */
  path: string
  /** Real addresses for the buttons (middle-click, copy link). */
  hrefs: Record<LostDest, string>
  onNavigate(id: LostDest): void
}

const WAYS: readonly { id: LostDest; label: string }[] = [
  { id: "island", label: "Island" },
  { id: "demos", label: "Demos" },
  { id: "harbour", label: "Harbour" },
]

export function NotFoundPage({ path, hrefs, onNavigate }: NotFoundPageProps) {
  return (
    <div className="gh site-lost">
      <main className="site-lost-body" tabIndex={-1}>
        <span className="site-lost-crest" aria-hidden="true">
          <Crest size={30} />
        </span>
        <h1>Lost at sea</h1>
        <p>
          Nothing is charted at <code>{path}</code>.
        </p>
        <nav className="site-lost-ways" aria-label="Back to shore">
          {WAYS.map((w) => (
            <Dest
              key={w.id}
              href={hrefs[w.id]}
              onNavigate={() => onNavigate(w.id)}
              className="site-lost-btn"
              data-primary={w.id === "island" ? "" : undefined}
            >
              {w.label}
            </Dest>
          ))}
        </nav>
      </main>
    </div>
  )
}
