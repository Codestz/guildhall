/**
 * The Chronicle card (V1's hud/Recap.tsx), fed by props: the session as one shareable picture, the
 * recap (sim `recapOf`) set over a hero frame in the ink wash with brass corner ticks. Two shapes,
 * Open Graph's 1200 × 630 and a feed's 1080 × 1350, drawn to a canvas (cardDraw.ts); download the PNG,
 * copy the picture, or hand it to the share sheet where the browser can (phones).
 *
 * The frame is the caller's: the hall films the hero moment from the island (H1); any image URL or
 * canvas works, and without one the card stands on ink alone. A modal over whatever opened it: focus
 * starts on the title and stays inside, Esc closes this dialog only, and focus goes back to the opener.
 */
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react"
import { Glyphs } from "../glyphs.tsx"
import { cardBlob, cardFileName, drawCard, type Format, loadCardFaces, SIZES } from "./cardDraw.ts"
import { canCopyImage, copyImage, copyText } from "./clipboard.ts"
import { trapTab, useModalFocus } from "./focus.ts"
import { StoryGlyphs } from "./glyphs.tsx"
import type { RecapView } from "./types.ts"
import { clockOf } from "./words.ts"

type Frame = CanvasImageSource & { width: number; height: number }

export interface ChronicleCardProps {
  recap: RecapView
  /** The hero frame: an image URL, or anything a canvas can draw. */
  image?: string | Frame
  /** Where the subject sits in the frame, as shares of its size. */
  focus?: { x: number; y: number }
  /** The shape it opens on. */
  format?: Format
  /** A link that opens the hall on this moment: a "Copy link" button when given. */
  link?: string
  onClose: () => void
}

const FORMATS: { id: Format; label: string; size: string }[] = [
  { id: "landscape", label: "Landscape", size: "1200 × 630" },
  { id: "portrait", label: "Portrait", size: "1080 × 1350" },
]

type Said = "idle" | "image" | "image-failed" | "link" | "link-failed"

export function ChronicleCard({
  recap,
  image,
  focus,
  format: initial = "landscape",
  link,
  onClose,
}: ChronicleCardProps) {
  const id = useId()
  const head = useRef<HTMLHeadingElement>(null)
  const panel = useRef<HTMLElement>(null)
  const [format, setFormat] = useState<Format>(initial)
  const [frame, setFrame] = useState<{ frame: Frame | undefined; note?: string } | undefined>()
  const [urls, setUrls] = useState<Partial<Record<Format, string>>>({})
  const [said, setSaid] = useState<Said>("idle")
  useModalFocus(head)

  // The faces and the frame first: a card drawn before them would use the fallback faces.
  useEffect(() => {
    let live = true
    setFrame(undefined)
    void (async () => {
      const faces = loadCardFaces()
      let got: { frame: Frame | undefined; note?: string } = { frame: undefined }
      if (typeof image === "string") {
        const img = new Image()
        img.decoding = "async"
        img.src = image
        try {
          await img.decode()
          got = { frame: img }
        } catch {
          got = { frame: undefined, note: "The picture couldn't be loaded: the card stands on ink alone." }
        }
      } else if (image) got = { frame: image }
      await faces
      if (live) setFrame(got)
    })()
    return () => {
      live = false
    }
  }, [image])

  const cards = useMemo(() => {
    if (!frame) return undefined
    const out = {} as Record<Format, HTMLCanvasElement>
    for (const { id: f } of FORMATS) out[f] = drawCard(recap, f, frame.frame, focus)
    return out
  }, [frame, recap, focus])

  useEffect(() => {
    if (!cards) return
    let live = true
    const made: string[] = []
    for (const { id: f } of FORMATS)
      void cardBlob(cards[f]).then((blob) => {
        if (!live) return
        const url = URL.createObjectURL(blob)
        made.push(url)
        setUrls((u) => ({ ...u, [f]: url }))
      })
    return () => {
      live = false
      for (const url of made) URL.revokeObjectURL(url)
      setUrls({})
    }
  }, [cards])

  useEffect(() => {
    if (said === "idle") return
    const timer = setTimeout(() => setSaid("idle"), 2400)
    return () => clearTimeout(timer)
  }, [said])

  const url = urls[format]
  const fileName = cardFileName(recap, format)
  const size = SIZES[format]
  const shareable = useShareable()
  const copyable = useMemo(canCopyImage, [])
  const hero = recap.hero

  async function onCopyImage() {
    const card = cards?.[format]
    if (!card) return
    setSaid((await copyImage(cardBlob(card))) ? "image" : "image-failed")
  }

  async function onCopyLink() {
    if (link) setSaid((await copyText(link)) ? "link" : "link-failed")
  }

  async function onShare() {
    const card = cards?.[format]
    if (!card) return
    const file = new File([await cardBlob(card)], fileName, { type: "image/png" })
    try {
      await navigator.share({
        files: [file],
        title: `The Chronicle of ${recap.title}`,
        ...(link ? { url: link } : {}),
      })
    } catch {
      // dismissed: nothing to say
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim's click is a mouse shortcut; Esc and the close button are the keyboard's
    // biome-ignore lint/a11y/useKeyWithClickEvents: as above
    <div
      className="st-scrim st-scrim-card"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={panel}
        className="st-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-h`}
        aria-describedby={`${id}-d`}
        aria-busy={!url}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            // this dialog only: whatever is under it (the book) never hears it
            event.stopPropagation()
            onClose()
            return
          }
          if (panel.current) trapTab(event, panel.current)
        }}
      >
        <header className="st-card-head">
          <div>
            <p className="ui-eyebrow">Chronicle card</p>
            <h2 id={`${id}-h`} ref={head} tabIndex={-1}>
              Share this session
            </h2>
            <p id={`${id}-d`} className="st-card-sub">
              {hero ? (
                <>
                  The session as one picture, at <span className="st-card-at num">{clockOf(hero.at)}</span>:{" "}
                  {hero.label.charAt(0).toLowerCase() + hero.label.slice(1)}.
                </>
              ) : (
                "The session as one picture."
              )}
            </p>
          </div>
          <button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close the card (Esc)">
            <Glyphs.close />
          </button>
        </header>

        <fieldset className="st-card-formats">
          <legend className="ui-visually-hidden">Card shape</legend>
          {FORMATS.map((f) => (
            <label key={f.id} className="st-card-format" data-checked={format === f.id}>
              <input
                type="radio"
                name={`${id}-format`}
                value={f.id}
                checked={format === f.id}
                onChange={() => setFormat(f.id)}
              />
              <Shape format={f.id} />
              <span>
                {f.label} <small className="num">{f.size}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <figure
          className="st-card-preview"
          data-format={format}
          style={{ aspectRatio: `${size.width} / ${size.height}` }}
        >
          {url ? (
            <img src={url} width={size.width} height={size.height} alt={altOf(recap, format)} />
          ) : (
            <div className="st-card-drawing" role="status">
              <span className="st-spinner" aria-hidden="true" />
              <span>Drawing the card…</span>
            </div>
          )}
        </figure>
        {frame?.note && (
          <p className="st-card-note" data-tone="warn">
            {frame.note}
          </p>
        )}

        <div className="st-card-actions">
          {url ? (
            <a className="ui-btn" data-variant="primary" href={url} download={fileName}>
              <StoryGlyphs.download />
              <span>Download PNG</span>
            </a>
          ) : (
            <button type="button" className="ui-btn" data-variant="primary" disabled>
              <StoryGlyphs.download />
              <span>Download PNG</span>
            </button>
          )}
          {copyable && (
            <Action
              disabled={!url}
              onClick={onCopyImage}
              icon={said === "image" ? <StoryGlyphs.check /> : <StoryGlyphs.image />}
            >
              {said === "image" ? "Image copied" : said === "image-failed" ? "Copy failed" : "Copy image"}
            </Action>
          )}
          {link && (
            <Action
              onClick={onCopyLink}
              icon={said === "link" ? <StoryGlyphs.check /> : <StoryGlyphs.link />}
            >
              {said === "link" ? "Link copied" : said === "link-failed" ? "Copy failed" : "Copy link"}
            </Action>
          )}
          {shareable && (
            <Action disabled={!url} onClick={onShare} icon={<StoryGlyphs.share />}>
              Share…
            </Action>
          )}
        </div>
        <p className="st-card-note st-card-file" title={fileName}>
          <span className="num">{fileName}</span>
        </p>
        <span className="ui-visually-hidden" aria-live="polite">
          {said === "image"
            ? "Card copied as an image"
            : said === "image-failed"
              ? "Could not copy the image"
              : said === "link"
                ? "Link copied"
                : said === "link-failed"
                  ? "Could not copy the link"
                  : url
                    ? "The card is ready"
                    : ""}
        </span>
      </section>
    </div>
  )
}

function Action({
  disabled,
  onClick,
  icon,
  children,
}: {
  disabled?: boolean
  onClick: () => void
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <button type="button" className="ui-btn" disabled={disabled} onClick={onClick}>
      {icon}
      <span>{children}</span>
    </button>
  )
}

/** The shape's little outline, beside its name. */
function Shape({ format }: { format: Format }) {
  const [w, h] = format === "landscape" ? [16, 8.4] : [10, 12.5]
  return (
    <svg
      className="hud-glyph st-shape"
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

/** What the card shows, in words: the preview's alt text. */
export function altOf(recap: RecapView, format: Format): string {
  const numbers = recap.numbers.map((n) => `${n.value} ${n.label}`).join(", ")
  const lines = recap.lines.map((l) => l.text).join(" ")
  return `${format === "landscape" ? "Landscape" : "Portrait"} Chronicle card: “${recap.title}”, ${recap.guild}, ${recap.story}. ${
    recap.hero ? `Pictured: ${recap.hero.label}. ` : ""
  }${numbers}. ${lines}`
}
