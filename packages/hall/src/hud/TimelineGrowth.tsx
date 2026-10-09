import { type CSSProperties, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { dayAt } from "../world/chronicle/growth.ts"
import { type GrowthFilm, growth, SPEEDS } from "../world/chronicle/growthControl.ts"
import {
  captionAt,
  contributorsAt,
  dateLabel,
  filesAt,
  type GrowthCaption,
} from "../world/chronicle/growthStory.ts"
import { Icon } from "./icons.tsx"
import "./TimelineGrowth.css"

/** The film's transport changed (phase, speed, a seek): re-render. The clock itself is read per frame. */
export function useGrowthPhase(): typeof growth.phase {
  useSyncExternalStore(growth.subscribe, growth.snapshot)
  return growth.phase
}

const number = (n: number): string => n.toLocaleString("en")

/**
 * The growth timelapse's HUD (`?grow`, ADR 0010): the date the island has reached, its contributors
 * ticking up, and a tape to play, pause, change speed, scrub (drag, or keys: Space plays and
 * pauses, the arrows and Page keys step, Home and End jump) and close; above it, the milestone being
 * told, in the story strip's title-card look. The clock moves every frame without React: one rAF
 * loop writes the fill, the date and the counters straight into the DOM.
 */
export function TimelineGrowth({ hidden }: { hidden: boolean }) {
  const phase = useGrowthPhase()
  const film = growth.film
  if (phase === "off") return null
  if (phase === "waiting" || phase === "failed" || !film)
    return hidden ? null : (
      <div className="plaque growth-tape growth-note" role="status">
        <span>
          {phase === "failed"
            ? `Couldn't play ${growth.repo ?? "this repo"}'s history: ${growth.failure}. Here it is today.`
            : `Raising ${growth.repo}'s island from the sea…`}
        </span>
        <button type="button" className="icon-btn" aria-label="Close" onClick={() => growth.stop()}>
          <Icon.close />
        </button>
      </div>
    )
  return <Tape film={film} playing={phase === "playing"} hidden={hidden} />
}

function Tape({ film, playing, hidden }: { film: GrowthFilm; playing: boolean; hidden: boolean }) {
  const root = useRef<HTMLElement>(null)
  const date = useRef<HTMLElement>(null)
  const people = useRef<HTMLSpanElement>(null)
  const range = useRef<HTMLInputElement>(null)
  const dragging = useRef<{ resume: boolean } | null>(null)
  const [caption, setCaption] = useState<GrowthCaption | undefined>()
  const { plan, story, chronicle, start, end } = film
  const span = end - start

  // The clock, every frame, straight into the DOM; the caption only when it changes.
  useEffect(() => {
    let frame = 0
    let shown: GrowthCaption | undefined
    let label = ""
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const t = growth.t
      const day = dayAt(plan, t)
      root.current?.style.setProperty("--p", String(t / plan.duration))
      const next = dateLabel(day, span)
      if (next !== label) {
        label = next
        if (date.current) date.current.textContent = next
        range.current?.setAttribute("aria-valuetext", next)
      }
      if (people.current)
        people.current.textContent = `${number(contributorsAt(story, day, end))} contributors · ${number(filesAt(chronicle, day))} files`
      if (range.current && !dragging.current) range.current.value = String(t)
      const now = captionAt(story, t)
      if (now !== shown) {
        shown = now
        setCaption(now)
      }
    }
    draw()
    return () => cancelAnimationFrame(frame)
  }, [plan, story, chronicle, span, end])

  // Space plays and pauses, anywhere but in a field or on a button (they have their own Space).
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== " " || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && /input|textarea|select|button/i.test(target.tagName) && target !== range.current) return
      event.preventDefault()
      growth.toggle()
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [])

  const speed = growth.speed
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1
  const grab = () => {
    if (dragging.current) return
    dragging.current = { resume: growth.phase === "playing" }
    growth.pause()
  }
  const letGo = () => {
    const was = dragging.current
    dragging.current = null
    if (was?.resume) growth.play()
  }

  return (
    <>
      {caption && (
        <div className="story growth-story" aria-hidden="true">
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
      {!hidden && (
        <section
          ref={root}
          className="plaque growth-tape"
          aria-label={`${film.repo} growing, first commit to today`}
          style={{ "--p": growth.t / plan.duration } as CSSProperties}
        >
          <button
            type="button"
            className="play"
            onClick={() => growth.toggle()}
            aria-label={playing ? "Pause the growth (Space)" : "Play the growth (Space)"}
            title={playing ? "Pause · Space" : "Play · Space"}
          >
            {playing ? <Icon.pause /> : <Icon.play />}
          </button>
          <div className="growth-when">
            <b ref={date} className="growth-date">
              {dateLabel(dayAt(plan, growth.t), span)}
            </b>
            <span ref={people} className="growth-count mono" />
          </div>
          <div className="track growth-track">
            <div className="track-rail" aria-hidden="true">
              <div className="track-fill" />
              {story.festivals.map((t) => (
                <i
                  key={t}
                  className="beat"
                  data-kind="chapter"
                  style={{ left: `${(t / plan.duration) * 100}%` }}
                />
              ))}
            </div>
            <input
              ref={range}
              type="range"
              min={0}
              max={plan.duration}
              step={0.5}
              defaultValue={growth.t}
              aria-label="Time in the repo's history"
              onPointerDown={grab}
              onPointerUp={letGo}
              onPointerCancel={letGo}
              onBlur={letGo}
              onInput={(event) => growth.seek(Number(event.currentTarget.value))}
              onKeyDown={(event) => {
                if (event.key === "PageUp" || event.key === "PageDown") {
                  event.preventDefault()
                  growth.seek(growth.t + (event.key === "PageUp" ? 5 : -5))
                }
              }}
            />
          </div>
          <button
            type="button"
            className="growth-speed mono"
            onClick={() => growth.setSpeed(nextSpeed)}
            aria-label={`Speed ${speed}×. Switch to ${nextSpeed}×`}
            title="Speed"
          >
            {speed}×
          </button>
          <button
            type="button"
            className="icon-btn growth-close"
            onClick={() => growth.stop()}
            aria-label="Skip to today"
            title="Skip to today"
          >
            <Icon.close />
          </button>
        </section>
      )}
    </>
  )
}
