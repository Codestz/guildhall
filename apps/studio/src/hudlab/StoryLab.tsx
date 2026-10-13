/**
 * The HUD lab's story layer (U3): an icon rail (Legends, the Chronicle card, the README badge) whose
 * icons open the on-demand overlays, the captions strip, the chapter chip and a place dossier, all fed
 * by V1's told stories through the sim's story port (story.ts). Query: `legends=1|history`, `card=1|seas`
 * (`format=portrait`, `noframe=1`), `captions=1|quest|plea|chapter|renown|complete|long`, `chapter=1|open`,
 * `place=world|ui` (`fold=1`), `badge=1|open`, `tale=saga|seas|party|rush|solo` (the book's story).
 */
import {
  type BookView,
  Captions,
  type CaptionView,
  ChapterChip,
  ChronicleCard,
  type HeroView,
  LegendsBook,
  PlaceDossier,
  ReadmeBadge,
  StoryGlyphs,
} from "@guildhall/ui"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  captionOf,
  heroesAt,
  historyOf,
  PLACES,
  recapView,
  TALES,
  type TaleName,
  type Told,
  tell,
} from "./story.ts"

export interface StoryOptions {
  legends: BookView | null
  card: TaleName | null
  format: "landscape" | "portrait"
  noframe: boolean
  captions: string | null
  chapter: "chip" | "open" | null
  place: string | null
  fold: boolean
  badge: "chip" | "open" | null
  tale: TaleName
  still: boolean
  phone: boolean
  /** The lab's cast, for the place's heroes. */
  cast: readonly HeroView[]
}

/** The hero frame: a still of the hex island's town (`/town/1`), until the hall films its own (H1). */
const FRAME = "/lab/story/hero.jpg"

export function StoryLab(opts: StoryOptions) {
  const [told, setTold] = useState<Partial<Record<TaleName, Told>>>({})
  const [book, setBook] = useState<BookView | null>(opts.legends)
  const [card, setCard] = useState<TaleName | null>(opts.card)
  const [placeOpen, setPlaceOpen] = useState(opts.place !== null)
  const [fold, setFold] = useState(opts.fold)
  const [act, setAct] = useState(2)
  const [line, setLine] = useState<CaptionView | undefined>()
  const bookBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let live = true
    void Promise.all(TALES.map(tell)).then((all) => {
      if (live) setTold(Object.fromEntries(all.map((t) => [t.name, t])))
    })
    return () => {
      live = false
    }
  }, [])

  const tale = told[opts.tale]
  const saga = told.saga
  const history = useMemo(() => {
    const all = TALES.flatMap((n) => told[n] ?? [])
    return all.length === TALES.length ? historyOf(all) : undefined
  }, [told])

  // The strip: a still caption of a kind, or the Saga's captions told one after another.
  useEffect(() => {
    if (!saga || opts.captions === null) return
    if (opts.captions !== "1") {
      setLine(captionOf(saga, opts.captions))
      return
    }
    let i = 0
    const next = () => {
      const c = saga.captions[i++ % saga.captions.length]
      setLine(c)
      timer = setTimeout(next, (c?.hold ?? 3000) + 900)
    }
    let timer = setTimeout(next, 400)
    return () => clearTimeout(timer)
  }, [saga, opts.captions])

  const cardTale = card ? told[card] : undefined
  const place = opts.place ? PLACES[opts.place] : undefined

  return (
    <div className="lab-story" data-phone={opts.phone}>
      <nav className="lab-story-rail" aria-label="Story">
        <button
          ref={bookBtn}
          type="button"
          className="ui-icon-btn"
          data-plaque=""
          aria-label="Legends: the story so far"
          aria-haspopup="dialog"
          aria-expanded={book !== null}
          title="Legends"
          onClick={() => setBook("session")}
        >
          <StoryGlyphs.book size={18} />
        </button>
        <button
          type="button"
          className="ui-icon-btn"
          data-plaque=""
          aria-label="Chronicle card: share this session"
          aria-haspopup="dialog"
          aria-expanded={card !== null}
          title="Chronicle card"
          onClick={() => setCard(opts.tale)}
        >
          <StoryGlyphs.card size={18} />
        </button>
        <ReadmeBadge repo="Codestz/guildhall" compact open={opts.badge === "open"} />
      </nav>

      {opts.captions !== null && (
        <div className="lab-captions">
          <Captions caption={line} still={opts.still} />
        </div>
      )}

      {opts.chapter && saga && saga.chapters.length > 0 && (
        <div className="lab-chapter">
          <ChapterChip
            chapters={saga.chapters}
            current={act}
            onJump={setAct}
            compact={opts.phone}
            open={opts.chapter === "open"}
          />
        </div>
      )}

      {place && placeOpen && (
        <div className="lab-place" data-fold={fold}>
          <PlaceDossier
            {...place}
            heroes={heroesAt(place, opts.cast)}
            collapsed={fold}
            onCollapse={() => setFold(true)}
            onExpand={() => setFold(false)}
            onClose={() => setPlaceOpen(false)}
            onHero={() => undefined}
            className={fold ? undefined : "hud-sheet"}
          />
        </div>
      )}

      {book && tale && (
        <LegendsBook
          legend={tale.legend}
          markdown={tale.markdown}
          history={history}
          view={book}
          onCard={() => setCard(opts.tale)}
          onSession={() => setBook("session")}
          onClose={() => setBook(null)}
        />
      )}

      {card && cardTale?.recap && (
        <ChronicleCard
          recap={recapView(cardTale.recap)}
          image={opts.noframe ? undefined : FRAME}
          focus={{ x: 0.42, y: 0.45 }}
          format={opts.format}
          onClose={() => setCard(null)}
        />
      )}
    </div>
  )
}
