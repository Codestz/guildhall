/**
 * The demos, as a picker over the world: V1's "Every scene, one link away" cards (art, title, kicker, what
 * it shows, a story's acts I–V, Open) fed by a `stories` array, grouped in shelves. Modal while open (focus
 * wraps, Esc closes); the world shows through the scrim at its edges. On a phone the cards are one
 * vertical list, the art a short band, the sheet scrolling under a pinned title.
 */
import { useId, useRef } from "react"
import { roman } from "../components/controls.tsx"
import { useDialog } from "./hooks.ts"
import { ArrowIcon, CloseGlyph, Dest } from "./parts.tsx"

export interface StoryAct {
  /** 1–5: shown as a roman numeral. */
  n: number
  title: string
}

export interface Story {
  id: string
  /** The shelf it sits on ("Stories", "Repos", "The world"). */
  shelf: string
  title: string
  /** The small brass line over the title: "OpenCode · five acts · about 17 minutes". */
  kicker: string
  blurb: string
  /** "What it shows": two or three short lines. */
  shows: readonly string[]
  art: string
  alt: string
  /** A story's acts, each opening the story at that act. */
  acts?: readonly StoryAct[]
  /** The deep link, shown in mono for those who share them: `?story=saga`. */
  link: string
  /** Wide, across the shelf (the Saga). */
  feature?: boolean
}

export interface DemoPickerProps {
  stories: readonly Story[]
  onOpen(story: Story, act?: number): void
  onClose(): void
  /** Real address for a story (and act): the Open button becomes a link. */
  hrefFor?(story: Story, act?: number): string | undefined
}

export function DemoPicker({ stories, onOpen, onClose, hrefFor }: DemoPickerProps) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  useDialog(panel, true, onClose, () => panel.current?.querySelector<HTMLElement>("[data-close]"))
  const shelves = [...new Set(stories.map((s) => s.shelf))]

  return (
    <div className="site-layer">
      <div className="site-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        className="ui-panel site-demos"
        data-solid=""
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-h`}
      >
        <header className="site-demos-head">
          <div>
            <p className="ui-eyebrow">Demos</p>
            <h2 className="site-demos-title" id={`${id}-h`}>
              Every scene, one link away
            </h2>
          </div>
          <button
            type="button"
            className="ui-icon-btn"
            data-close=""
            aria-label="Close the demos"
            onClick={onClose}
          >
            <CloseGlyph size={16} />
          </button>
        </header>
        <div className="site-demos-scroll">
          <p className="site-demos-lede">
            These open the island on a chosen scene: a story, a crowd, a repo, an hour. Each one comes with
            the Director's controls in Settings.
          </p>
          {shelves.map((shelf) => (
            <section key={shelf} className="site-shelf" aria-labelledby={`${id}-${shelf}`}>
              <h3 className="ui-section-head" id={`${id}-${shelf}`}>
                {shelf}
              </h3>
              <ul className="site-cards">
                {stories
                  .filter((s) => s.shelf === shelf)
                  .map((s) => (
                    <StoryCard key={s.id} story={s} onOpen={onOpen} hrefFor={hrefFor} />
                  ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

function StoryCard({
  story: s,
  onOpen,
  hrefFor,
}: {
  story: Story
  onOpen: DemoPickerProps["onOpen"]
  hrefFor: DemoPickerProps["hrefFor"]
}) {
  const id = useId()
  return (
    <li className="site-card" data-feature={s.feature ? "" : undefined}>
      <article aria-labelledby={id}>
        <img
          className="site-card-art"
          src={s.art}
          alt={s.alt}
          width={640}
          height={400}
          loading="lazy"
          decoding="async"
        />
        <div className="site-card-body">
          <p className="site-card-kicker">{s.kicker}</p>
          <h4 className="site-card-title" id={id}>
            {s.title}
          </h4>
          <p className="site-card-blurb">{s.blurb}</p>
          <ul className="site-card-shows" aria-label="What it shows">
            {s.shows.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {s.acts && (
            <ul className="site-acts" aria-label={`${s.title}'s acts`}>
              {s.acts.map((act) => (
                <li key={act.n}>
                  <Dest
                    href={hrefFor?.(s, act.n)}
                    onNavigate={() => onOpen(s, act.n)}
                    className="site-act"
                    aria-label={`Act ${roman(act.n)}: ${act.title}`}
                  >
                    {roman(act.n)}
                    <span aria-hidden="true">{act.title}</span>
                  </Dest>
                </li>
              ))}
            </ul>
          )}
          <div className="site-card-acts">
            <Dest
              href={hrefFor?.(s)}
              onNavigate={() => onOpen(s)}
              className="site-open"
              aria-label={`Open ${s.title}`}
            >
              Open
              <ArrowIcon />
            </Dest>
            <code className="site-card-link">{s.link}</code>
          </div>
        </div>
      </article>
    </li>
  )
}
