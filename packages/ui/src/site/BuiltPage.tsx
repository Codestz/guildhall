/**
 * "How it's built": a readable long page in V1's site style (how.html): a hero with headline numbers, a
 * contents list, numbered sections made of paragraphs, plaques (tables, bars, pictures, definition lists)
 * and "Try it" links, then the Journey: the posts written along the way. All content arrives as props
 * (`BuiltContent`), so the page owns layout and type, not words. Text takes **bold** and `code`.
 */
import { Fragment, type ReactNode, useId } from "react"
import { roman } from "../components/controls.tsx"
import { ArrowIcon, Dest } from "./parts.tsx"
import { SiteNav, type SiteNavProps } from "./SiteNav.tsx"

export type Block =
  | { kind: "p"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "list"; items: readonly string[] }
  /** Titled paragraphs: "what did it". */
  | { kind: "techs"; items: readonly { title: string; text: string }[] }
  | {
      kind: "table"
      caption: string
      head: readonly string[]
      rows: readonly (readonly string[])[]
      note?: string
    }
  | {
      kind: "bars"
      caption: string
      rows: readonly { label: string; sub?: string; value: string; pct: number; win?: boolean }[]
      note?: string
    }
  | { kind: "map"; caption: string; rows: readonly { term: string; text: string }[] }
  | { kind: "image"; src: string; alt: string; caption: string; wide?: boolean }
  | { kind: "try"; links: readonly { label: string; href: string }[]; text?: string }

export interface BuiltSection {
  id: string
  title: string
  blocks: readonly Block[]
}

export interface JourneyPost {
  id: string
  title: string
  /** One line for the card. */
  summary: string
  image?: { src: string; alt: string }
  /** The post, as paragraphs (and the lesson last). */
  blocks: readonly Block[]
}

export interface BuiltContent {
  eyebrow: string
  title: string
  lede: string
  stats: readonly { n: string; unit?: string; label: string }[]
  note?: string
  sections: readonly BuiltSection[]
  journey: { title: string; intro: string; posts: readonly JourneyPost[] }
}

export interface BuiltPageProps {
  content: BuiltContent
  /** Back to the island. */
  onBack(): void
  backHref?: string
  /** The top nav (island, demos, harbour, this page); without it the bar is a single link back. */
  nav?: SiteNavProps
  /** A "Try it" link inside the page, handled by the shell (a story, a repo). */
  onTry?(href: string): void
}

/** `**bold**` and `code` in a line of text. */
function rich(text: string): ReactNode {
  // biome-ignore-start lint/suspicious/noArrayIndexKey: the parts of a line are positional and static
  const out = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, k) => {
    if (part.startsWith("**")) return <strong key={k}>{part.slice(2, -2)}</strong>
    if (part.startsWith("`")) return <code key={k}>{part.slice(1, -1)}</code>
    return <Fragment key={k}>{part}</Fragment>
  })
  // biome-ignore-end lint/suspicious/noArrayIndexKey: see above
  return out
}

function Blocks({ blocks, onTry }: { blocks: readonly Block[]; onTry: BuiltPageProps["onTry"] }) {
  const id = useId()
  return (
    <>
      {blocks.map((b, k) => {
        const key = `${id}-${k}`
        switch (b.kind) {
          case "p":
            return <p key={key}>{rich(b.text)}</p>
          case "h3":
            return <h3 key={key}>{b.text}</h3>
          case "list":
            return (
              <ul key={key} className="site-prose-list">
                {b.items.map((item) => (
                  <li key={item}>{rich(item)}</li>
                ))}
              </ul>
            )
          case "techs":
            return (
              <ul key={key} className="site-techs">
                {b.items.map((t) => (
                  <li key={t.title}>
                    <h4>{t.title}</h4>
                    <p>{rich(t.text)}</p>
                  </li>
                ))}
              </ul>
            )
          case "table":
            return (
              <figure key={key} className="ui-panel site-plaque">
                {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard */}
                <section className="site-table-wrap" aria-label={b.caption} tabIndex={0}>
                  <table>
                    <caption>{b.caption}</caption>
                    <thead>
                      <tr>
                        {b.head.map((h, i) => (
                          <th key={h} scope="col" className={i > 0 ? "n" : undefined}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {b.rows.map((row) => (
                        <tr key={row[0]}>
                          {row.map((cell, i) =>
                            i === 0 ? (
                              <th key={cell} scope="row">
                                {cell}
                              </th>
                            ) : (
                              // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                              <td key={i} className={i === row.length - 1 ? "n win" : "n"}>
                                {cell}
                              </td>
                            ),
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                {b.note && <p className="site-fig-note">{rich(b.note)}</p>}
              </figure>
            )
          case "bars":
            return (
              <figure key={key} className="ui-panel site-plaque">
                <figcaption>{b.caption}</figcaption>
                <ol className="site-bars">
                  {b.rows.map((r) => (
                    <li key={r.label} className="site-bar" data-win={r.win ? "" : undefined}>
                      <span className="site-bar-label">
                        {r.label}
                        {r.sub && <small>{r.sub}</small>}
                      </span>
                      <span className="site-bar-value">{r.value}</span>
                      <span className="site-bar-track" aria-hidden="true">
                        <i style={{ width: `${r.pct}%` }} />
                      </span>
                    </li>
                  ))}
                </ol>
                {b.note && <p className="site-fig-note">{rich(b.note)}</p>}
              </figure>
            )
          case "map":
            return (
              <figure key={key} className="ui-panel site-plaque">
                <figcaption>{b.caption}</figcaption>
                <dl className="site-map">
                  {b.rows.map((r) => (
                    <Fragment key={r.term}>
                      <dt>{r.term}</dt>
                      <dd>{rich(r.text)}</dd>
                    </Fragment>
                  ))}
                </dl>
              </figure>
            )
          case "image":
            return (
              <figure key={key} className="site-shot" data-wide={b.wide ? "" : undefined}>
                <img src={b.src} alt={b.alt} loading="lazy" decoding="async" />
                <figcaption>{b.caption}</figcaption>
              </figure>
            )
          case "try":
            return (
              <div key={key} className="ui-panel site-plaque site-try">
                <span className="site-try-label">Try it</span>
                {b.links.map((l) => (
                  <Dest key={l.href} href={l.href} onNavigate={onTry ? () => onTry(l.href) : undefined}>
                    <code>{l.label}</code>
                  </Dest>
                ))}
                {b.text && <p>{rich(b.text)}</p>}
              </div>
            )
          default:
            return null
        }
      })}
    </>
  )
}

export function BuiltPage({ content: c, onBack, backHref, nav, onTry }: BuiltPageProps) {
  const toc = [
    ...c.sections.map((s) => ({ id: s.id, title: s.title })),
    { id: "journey", title: c.journey.title },
  ]
  return (
    <div className="site-page">
      <a className="site-skip" href="#built-main">
        Skip to the article
      </a>
      <header className="site-page-top">
        {nav ? (
          <SiteNav {...nav} />
        ) : (
          <Dest href={backHref} onNavigate={onBack} className="site-back">
            <span className="site-back-arrow">
              <ArrowIcon />
            </span>
            Back to the island
          </Dest>
        )}
      </header>
      <main id="built-main" className="site-article" tabIndex={-1}>
        <div className="site-hero">
          <p className="ui-eyebrow">{c.eyebrow}</p>
          <h1>{c.title}</h1>
          <span className="site-rule" aria-hidden="true" />
          <p className="site-lede">{rich(c.lede)}</p>
          <ul className="site-stats" aria-label="Headline numbers">
            {c.stats.map((s) => (
              <li key={s.label}>
                <span className="site-stat-n">
                  {s.n}
                  {s.unit && <small> {s.unit}</small>}
                </span>
                <span className="site-stat-l">{s.label}</span>
              </li>
            ))}
          </ul>
          {c.note && <p className="site-built-note">{rich(c.note)}</p>}
        </div>

        <nav className="site-toc" aria-label="Contents">
          <ol>
            {toc.map((t) => (
              <li key={t.id}>
                <a href={`#${t.id}`}>{t.title}</a>
              </li>
            ))}
          </ol>
        </nav>

        {c.sections.map((s, i) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="site-sec">
            <p className="site-sec-num" aria-hidden="true">
              {roman(i + 1)}
            </p>
            <h2 id={`${s.id}-h`}>{s.title}</h2>
            <Blocks blocks={s.blocks} onTry={onTry} />
          </section>
        ))}

        <section id="journey" aria-labelledby="journey-h" className="site-sec">
          <p className="site-sec-num" aria-hidden="true">
            {roman(c.sections.length + 1)}
          </p>
          <h2 id="journey-h">{c.journey.title}</h2>
          <p>{rich(c.journey.intro)}</p>
          <ol className="site-posts">
            {c.journey.posts.map((p, i) => (
              <li key={p.id}>
                <article className="ui-panel site-post" aria-labelledby={`post-${p.id}`}>
                  {p.image && <img src={p.image.src} alt={p.image.alt} loading="lazy" decoding="async" />}
                  <div className="site-post-body">
                    <p className="site-post-n">Post {i + 1}</p>
                    <h3 id={`post-${p.id}`}>{p.title}</h3>
                    <p className="site-post-sum">{rich(p.summary)}</p>
                    <details>
                      <summary>Read the post</summary>
                      <div className="site-post-text">
                        <Blocks blocks={p.blocks} onTry={onTry} />
                      </div>
                    </details>
                  </div>
                </article>
              </li>
            ))}
          </ol>
        </section>

        <footer className="site-foot">
          <p>Guildhall · MIT · built with three.js and React.</p>
          <Dest href={backHref} onNavigate={onBack}>
            Back to the island
          </Dest>
        </footer>
      </main>
    </div>
  )
}
