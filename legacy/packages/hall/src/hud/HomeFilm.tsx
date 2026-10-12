import { useEffect, useRef, useState } from "react"
import { type Beat, beatAt } from "../guild/homePace.ts"
import { homeCut, skipFilm } from "../guild/homeShow.ts"
import { dayAt } from "../world/chronicle/growth.ts"
import { growth } from "../world/chronicle/growthControl.ts"
import { contributorsAt, dateLabel, filesAt } from "../world/chronicle/growthStory.ts"
import "./home.css"

const number = (n: number): string => n.toLocaleString("en")

/**
 * The home's film, as the viewer sees it (guild/homeShow.ts): the date the island has reached with
 * its files and contributors, a caption at each beat of the cut (guild/homePace.ts), and a way out.
 * Any click or Esc skips to the archipelago. The clock moves every frame without React: one rAF
 * loop writes the date and the counters into the DOM; the caption re-renders only when its beat changes.
 */
export function HomeFilm({ phone }: { phone: boolean }) {
  const date = useRef<HTMLElement>(null)
  const count = useRef<HTMLSpanElement>(null)
  const [beat, setBeat] = useState<Beat | undefined>()

  useEffect(() => {
    let frame = 0
    let shown: Beat | undefined
    let label = ""
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const film = growth.film
      if (!film) return
      const day = dayAt(film.plan, growth.t)
      const next = dateLabel(day, film.end - film.start)
      if (next !== label) {
        label = next
        if (date.current) date.current.textContent = next
      }
      if (count.current)
        count.current.textContent = `${number(filesAt(film.chronicle, day))} files · ${number(contributorsAt(film.story, day, film.end))} contributors`
      const now = homeCut.current ? beatAt(homeCut.current, growth.t) : undefined
      if (now !== shown) {
        shown = now
        setBeat(now)
      }
    }
    draw()
    return () => cancelAnimationFrame(frame)
  }, [])

  // A click anywhere, or Esc: on to the archipelago.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") skipFilm()
    }
    window.addEventListener("pointerdown", skipFilm)
    window.addEventListener("keydown", key)
    return () => {
      window.removeEventListener("pointerdown", skipFilm)
      window.removeEventListener("keydown", key)
    }
  }, [])

  const caption = beat?.caption
  return (
    <>
      <div className="plaque home-when" data-phone={phone} role="status">
        <b ref={date} className="home-date" />
        <span ref={count} className="home-count mono" />
      </div>
      {caption && (
        <div className="story growth-story home-story" aria-hidden="true">
          <p key={caption.t} className="story-line growth-line" data-kind="chapter">
            <small>{caption.when}</small>
            <span>{caption.text}</span>
            <em>{caption.tagline}</em>
          </p>
        </div>
      )}
      <p className="visually-hidden" aria-live="polite">
        {caption ? `${caption.when}: ${caption.text}` : ""}
      </p>
      <button type="button" className="plaque home-skip" onClick={skipFilm}>
        Skip to the packages
        {!phone && <kbd>Esc</kbd>}
      </button>
    </>
  )
}
