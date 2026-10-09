import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import type { Legend } from "../guild/legends.ts"
import { fileNameOf, type Recap as RecapData, recapOf, recapQuery, STORY_NAME } from "../guild/recap.ts"
import type { GuildStore } from "../guild/store.ts"
import { activeWorld } from "../world/active.ts"
import { FOCUSABLE, tabStops, wrapOf } from "./focus.ts"
import { Icon } from "./icons.tsx"
import { type Filmed, filmHero } from "./RecapCapture.ts"
import { drawCard, type Format, loadFaces, SIZES } from "./RecapDraw.ts"

/**
 * The Chronicle card (guild/recap.ts): the session as one shareable picture. Opened from the
 * Legends book (its header, and its last page once a quest is done). It films the hero moment from
 * the hall (hud/RecapCapture.ts: the story jumps there and back, unseen behind this dialog), draws
 * the card in both shapes (hud/RecapDraw.ts) and offers the PNG, a link that opens the hall on the
 * same moment, and — where the browser can share files, as phones do — the share sheet.
 *
 * A modal over the book: focus starts on the title and stays inside, Esc closes this dialog only
 * (the book stays open), and focus goes back to the button that opened it (`onClose`'s job).
 */

type Stage =
  | { state: "filming" }
  | { state: "ready"; filmed: Filmed | undefined; note?: string }
  | { state: "failed"; reason: string }

const FORMATS: { id: Format; label: string; size: string }[] = [
  { id: "landscape", label: "Landscape", size: "1200 × 630" },
  { id: "portrait", label: "Portrait", size: "1080 × 1350" },
]

export function Recap({
  store,
  legend,
  party,
  onClose,
}: {
  store: GuildStore
  legend: Legend
  /** The book's party (its guildmaster's id). */
  party: string | undefined
  onClose: () => void
}) {
  const head = useRef<HTMLHeadingElement>(null)
  const panel = useRef<HTMLElement>(null)
  const [format, setFormat] = useState<Format>("landscape")
  const [stage, setStage] = useState<Stage>({ state: "filming" })
  const [said, setSaid] = useState("")
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle")
  const [attempt, setAttempt] = useState(0)

  // The recap is written once, as the dialog opens: filming moves the story, the card must not.
  // biome-ignore lint/correctness/useExhaustiveDependencies: frozen at open on purpose
  const recap = useMemo<RecapData>(() => {
    const sessions = store.party(party)
    const book = store.parties.find((p) => p.id === party) ?? store.focalParty
    const world = activeWorld()
    const seaRepo = store.sea[0]?.event.repo
    const guild =
      world?.repo?.repo ??
      (store.mode === "live" && store.guild
        ? store.guild.split(/[\\/]/).filter(Boolean).at(-1)
        : undefined) ??
      seaRepo ??
      (book?.name ? `The ${book.name} party` : "The guild")
    const chapter = store.chapter
    const story =
      store.mode === "live"
        ? "Live"
        : `${STORY_NAME[store.scenario] ?? "A story"}${chapter ? ` · Act ${chapter.numeral}` : ""}`
    return recapOf({
      legend,
      history: store.moments.history,
      sessions,
      lookup: { session: (id) => store.sessionOf(id) },
      guild: guild ?? "The guild",
      story,
    })
  }, [])

  // Film the hero (once per attempt), then draw.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one film per attempt
  useEffect(() => {
    let gone = false
    setStage({ state: "filming" })
    setSaid("Filming the moment")
    void (async () => {
      const faces = loadFaces()
      try {
        const filmed = recap.hero ? await filmHero(store, recap.hero) : undefined
        await faces
        if (gone) return
        setStage({ state: "ready", filmed })
        setSaid("The card is ready")
      } catch (error) {
        await faces
        if (gone) return
        // The card still stands on ink alone: the words are the recap, the picture its garnish.
        setStage({
          state: "ready",
          filmed: undefined,
          note: `The hall couldn't be filmed (${messageOf(error)}).`,
        })
        setSaid("The card is ready, without its picture")
      }
    })()
    return () => {
      gone = true
    }
  }, [attempt])

  const cards = useMemo(() => {
    if (stage.state !== "ready") return undefined
    const out = {} as Record<Format, HTMLCanvasElement>
    for (const { id } of FORMATS) out[id] = drawCard(recap, id, stage.filmed?.frame, stage.filmed?.focus)
    return out
  }, [stage, recap])

  const [urls, setUrls] = useState<Partial<Record<Format, string>>>({})
  useEffect(() => {
    if (!cards) return
    let live = true
    const made: string[] = []
    for (const { id } of FORMATS)
      cards[id].toBlob((blob) => {
        if (!blob || !live) return
        const url = URL.createObjectURL(blob)
        made.push(url)
        setUrls((u) => ({ ...u, [id]: url }))
      }, "image/png")
    return () => {
      live = false
      for (const url of made) URL.revokeObjectURL(url)
      setUrls({})
    }
  }, [cards])

  const link = useMemo(() => {
    if (stage.state !== "ready" || !stage.filmed) return undefined
    return `${location.origin}${location.pathname}?${recapQuery(stage.filmed.link)}`
  }, [stage])

  useEffect(() => {
    head.current?.focus()
  }, [])

  useEffect(() => {
    if (copied === "idle") return
    const timer = setTimeout(() => setCopied("idle"), 2400)
    return () => clearTimeout(timer)
  }, [copied])

  const url = urls[format]
  const fileName = fileNameOf(recap, format)
  const shareable = useShareable()

  async function copyLink() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied("done")
    } catch {
      setCopied(fallbackCopy(link) ? "done" : "failed")
    }
  }

  async function share() {
    const card = cards?.[format]
    if (!card) return
    const blob = await new Promise<Blob | null>((resolve) => card.toBlob(resolve, "image/png"))
    if (!blob) return
    const file = new File([blob], fileName, { type: "image/png" })
    try {
      await navigator.share({
        files: [file],
        title: `The Chronicle of ${recap.title}`,
        ...(link ? { url: link } : {}),
      })
    } catch {
      // Dismissed: nothing to say.
    }
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") {
      // This dialog only: the book (and the HUD's own Esc) never hear it.
      event.stopPropagation()
      event.nativeEvent.stopImmediatePropagation()
      onClose()
      return
    }
    if (event.key !== "Tab" || !panel.current) return
    const stops = tabStops(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    const to = wrapOf(stops, document.activeElement, event.shiftKey, head.current ?? undefined)
    if (!to) return
    event.preventDefault()
    to.focus()
  }

  const hero = recap.hero
  const at = hero ? clockOf(hero.at) : undefined
  const busy = stage.state === "filming"
  const size = SIZES[format]

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim's click is a mouse shortcut; Esc and the close button are the keyboard's
    <div
      className="recap-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onKeyDown={onKey}
    >
      <section
        ref={panel}
        className="recap"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recap-h"
        aria-describedby="recap-d"
        aria-busy={busy}
      >
        <header className="recap-head">
          <div>
            <p className="recap-eyebrow">Chronicle card</p>
            <h2 id="recap-h" ref={head} tabIndex={-1}>
              Share this session
            </h2>
            <p id="recap-d" className="recap-sub">
              {hero ? (
                <>
                  The session as one picture, filmed at <span className="recap-at">{at}</span>:{" "}
                  {hero.label.charAt(0).toLowerCase() + hero.label.slice(1)}.
                </>
              ) : (
                "The session as one picture."
              )}
            </p>
          </div>
          <button type="button" className="recap-close" onClick={onClose} aria-label="Close the card (Esc)">
            <Icon.close />
          </button>
        </header>

        <fieldset className="recap-formats">
          <legend className="visually-hidden">Card shape</legend>
          {FORMATS.map((f) => (
            <label key={f.id} className="recap-format" data-checked={format === f.id}>
              <input
                type="radio"
                name="recap-format"
                value={f.id}
                checked={format === f.id}
                onChange={() => setFormat(f.id)}
              />
              <Shape format={f.id} />
              <span>
                {f.label} <small>{f.size}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <figure
          className="recap-preview"
          data-format={format}
          style={{ aspectRatio: `${size.width} / ${size.height}` }}
        >
          {stage.state === "ready" && url ? (
            <img src={url} width={size.width} height={size.height} alt={altOf(recap, format)} />
          ) : (
            <div className="recap-filming" role="status">
              <span className="recap-spinner" aria-hidden="true" />
              <span>{busy ? (hero ? `Filming ${at}…` : "Drawing the card…") : "Drawing the card…"}</span>
            </div>
          )}
        </figure>
        {stage.state === "ready" && stage.note && (
          <p className="recap-note" data-tone="warn">
            {stage.note}{" "}
            <button type="button" className="recap-text-btn" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </p>
        )}

        <div className="recap-actions">
          <Action
            primary
            disabled={!url}
            href={url}
            download={fileName}
            icon={<DownloadGlyph />}
            label="Download PNG"
          />
          <Action
            disabled={!link}
            onClick={copyLink}
            icon={copied === "done" ? <Icon.check /> : <Icon.link />}
            label={
              copied === "done"
                ? "Link copied"
                : copied === "failed"
                  ? "Copy failed"
                  : "Copy link to this moment"
            }
          />
          {shareable && <Action disabled={!url} onClick={share} icon={<ShareGlyph />} label="Share…" />}
        </div>
        {link && (
          <p className="recap-note">
            The link opens the hall paused on this moment, the camera on the same spot.
          </p>
        )}
        <span className="visually-hidden" aria-live="polite">
          {copied === "done" ? "Link copied" : copied === "failed" ? "Could not copy the link" : said}
        </span>
      </section>
    </div>
  )
}

function Action({
  primary,
  disabled,
  href,
  download,
  onClick,
  icon,
  label,
}: {
  primary?: boolean
  disabled?: boolean
  href?: string | undefined
  download?: string
  onClick?: () => void
  icon: ReactNode
  label: string
}) {
  const className = primary ? "recap-btn recap-btn-primary" : "recap-btn"
  if (href !== undefined || download !== undefined) {
    // A download is a link; while the card is drawn it is a disabled button instead.
    return disabled || !href ? (
      <button type="button" className={className} disabled>
        {icon}
        <span>{label}</span>
      </button>
    ) : (
      <a className={className} href={href} download={download}>
        {icon}
        <span>{label}</span>
      </a>
    )
  }
  return (
    <button type="button" className={className} disabled={disabled} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

/** The shape's little outline, beside its name. */
function Shape({ format }: { format: Format }) {
  const [w, h] = format === "landscape" ? [16, 8.4] : [10, 12.5]
  return (
    <svg
      className="glyph recap-shape"
      width={18}
      height={16}
      viewBox="0 0 18 16"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x={(18 - w) / 2}
        y={(16 - h) / 2}
        width={w}
        height={h}
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  )
}

function DownloadGlyph() {
  return (
    <svg
      className="glyph"
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 2.5v7.5M4.8 7 8 10.2 11.2 7M3 13.5h10" />
    </svg>
  )
}

function ShareGlyph() {
  return (
    <svg
      className="glyph"
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 10V2.5M5 5.2 8 2.3l3 2.9M5.5 7.5H4a1 1 0 0 0-1 1v4.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8.5a1 1 0 0 0-1-1h-1.5" />
    </svg>
  )
}

/** Can this browser hand a PNG to the share sheet (phones, mostly)? */
function useShareable(): boolean {
  return useMemo(() => {
    if (typeof navigator === "undefined" || !navigator.canShare || typeof File === "undefined") return false
    try {
      return navigator.canShare({ files: [new File([new Uint8Array(1)], "card.png", { type: "image/png" })] })
    } catch {
      return false
    }
  }, [])
}

/** What the card shows, in words, for the preview's alt text. */
function altOf(recap: RecapData, format: Format): string {
  const numbers = recap.numbers.map((n) => `${n.value} ${n.label}`).join(", ")
  const lines = recap.lines.map((l) => l.text).join(" ")
  return `${format === "landscape" ? "Landscape" : "Portrait"} Chronicle card: “${recap.title}”, ${recap.guild}, ${recap.story}. ${
    recap.hero ? `Pictured: ${recap.hero.label}. ` : ""
  }${numbers}. ${lines}`
}

function clockOf(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/\.$/, "").toLowerCase()
}

/** For browsers that refuse the async clipboard (an insecure origin, an old WebView). */
function fallbackCopy(text: string): boolean {
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.append(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand("copy")
  } catch {
    ok = false
  }
  area.remove()
  return ok
}
