/**
 * The docket on an island (V1's DocketChips and petitioners, PROTOCOL.md §7): the repo's open issues
 * as small plates over the harbour's quay ("#133 · awaiting", the oldest four and a "+N" for the rest),
 * and a petitioner for each queueing on the quay (world `petitionerPoses`, drawn on life's figures): the
 * first come is served when an issue closes, cheers, a coin glints, and walks off while the rest move up.
 *
 * A hall's session drives it: the world at the session's clock (sim `harbourOf`: its open issues and the
 * petitioners' counts and times), so a seek, a scrub or a replay shows the quay as it was then. For a
 * look without a session, `?docket=` plays a queue on its own clock from when the island is ready:
 *
 *   ?docket=3        three issues long open (the default for `?docket=1`... `?docket=12`)
 *
 * `window.guildhall.ext.docket`: `open(title?)` (an issue opened now), `close()` (one closed now: the
 * first come is served), `lane()` (where the queue stands), `poses()`, `plates()` (what the plates
 * read), `queue()`, `at()` (the queue's clock, ms), `hold(ms | null)`, `mute(on)` (all of it off, to weigh it).
 *
 * The plates are DOM in the Viewer's labels layer, in the place plates' language (ui `.ui-plate`, small),
 * moved each frame; they keep clear of the HUD's keep-outs (`[data-keepout]`), go compact on a phone
 * (the oldest two, numbers only) and hide with the HUD's chips (its "hidden" mode).
 */
import { type Stage, toScreen, type WorkFx } from "@guildhall/render"
import { harbourOf, type Issue, type Petitioners } from "@guildhall/sim"
import { PHONE_MAX } from "@guildhall/ui"
import { type LifePose, PETITION_CAP, type PetitionLane, petitionerPoses } from "@guildhall/world"
import type { HallSession } from "../hall/feeds/session.ts"
import { param } from "../params.ts"
import type { Life } from "./life.ts"

/** Plates shown at most (the oldest open issues), and on a phone. */
export const DOCKET_PLATES = 4
export const DOCKET_PLATES_PHONE = 2
/** The plates hang this far over the queue's middle, metres. */
const UP = 1.9
/** Plates further than this from the camera are not drawn (metres). */
const FAR = 140
/** A seek: a clock jump bigger than this (ms) fires no coin for the servings it skips. */
const SEEK_MS = 1500

/** What the plates read: the oldest open issues' numbers and words, and how many more. */
export interface DocketPlates {
  rows: { n: number; title: string; word: string }[]
  more: number
}

/** The plates for a set of open issues (oldest first): up to `max` rows, the rest counted. Pure. */
export function docketPlates(
  issues: readonly Pick<Issue, "n" | "title">[],
  max = DOCKET_PLATES,
): DocketPlates {
  // with one more than fits, the last row is the count rather than a "+1"
  const shown = issues.length > max ? max - 1 : issues.length
  return {
    rows: issues.slice(0, Math.max(0, shown)).map((i) => ({ n: i.n, title: i.title, word: "awaiting" })),
    more: issues.length - Math.max(0, shown),
  }
}

/** `?docket=`: how many issues the look opens with, or null. */
export function docketOf(query: Pick<URLSearchParams, "get">): number | null {
  const v = param(query, "docket")
  if (v === null || v === "0") return null
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= 1 ? Math.min(30, n) : 3
}

/** The look's issues: a repo's backlog as the seas story has it. */
const TITLES = [
  "Settings page flickers on Safari",
  "Export orders as CSV",
  "Cart total is off by one cent",
  "Support Apple Pay",
  "Search ignores accents",
  "Dark mode for the emails",
  "Wishlist sharing link",
  "Order page 500s with no items",
  "Document the webhook retries",
  "Allow gift messages",
]

/** A queue of its own (the look): issues opened and closed on the look's clock. */
class LookQueue {
  issues: Issue[] = []
  petitioners: Petitioners = { waiting: [], served: 0, lately: [] }
  private next = 131
  open(at: number, title?: string) {
    const n = this.next++
    this.issues = [
      ...this.issues,
      { repo: "acme/shop", n, title: title ?? TITLES[(n - 131) % TITLES.length]!, author: "lou", opened: at },
    ]
    this.petitioners = { ...this.petitioners, waiting: [...this.petitioners.waiting, at] }
  }
  close(at: number) {
    if (!this.issues.length) return
    // the newest issue closes: still the first come is served
    this.issues = this.issues.slice(0, -1)
    const p = this.petitioners
    this.petitioners = {
      waiting: p.waiting.slice(1),
      served: p.served + 1,
      lately: [...p.lately, at].slice(-8),
    }
  }
}

export interface DocketMount {
  dispose(): void
}

export function mountDocket(parts: {
  stage: Stage
  life: Life
  /** The Viewer's labels layer (the plates). */
  layer: HTMLElement
  workfx: WorkFx | null
  query: Pick<URLSearchParams, "get">
  /** A hall (or a session) may play on the island: its world drives the docket. */
  hall: boolean
  /** The session playing on the island, when it is not the hall HUD's own (the site's home). */
  session?: () => HallSession | null
}): DocketMount | null {
  const { stage, life } = parts
  const lane = life.petitionLane()
  const look = docketOf(parts.query)
  if (!lane && look === null && !parts.hall) return null
  let sessionOf: (() => HallSession | null) | null = parts.session ?? null
  if (parts.hall && !sessionOf)
    void import("../hall/hud/mount.tsx").then((m) => {
      sessionOf ??= m.hallSession
    })
  // the look's own queue and clock (from when the island is ready)
  const own = look !== null ? new LookQueue() : null
  let start = performance.now()
  let held: number | null = null
  const ownAt = () => held ?? performance.now() - start
  if (own) {
    for (let k = 0; k < look!; k++) own.open(-600_000 + k * 1000)
    void (window.guildhall?.ready() ?? Promise.resolve()).then(() => {
      start = performance.now()
    })
  }

  // ---- the plates ----
  const box = document.createElement("div")
  box.className = "hex-docket"
  box.setAttribute("aria-hidden", "true")
  Object.assign(box.style, {
    position: "absolute",
    left: "0",
    top: "0",
    display: "none",
    flexDirection: "column",
    alignItems: "center",
    gap: "3px",
    transform: "translate(-50%, -100%)",
    pointerEvents: "none",
    zIndex: "1",
  } satisfies Partial<CSSStyleDeclaration>)
  parts.layer.append(box)
  const row = (): HTMLDivElement => {
    const el = document.createElement("div")
    el.className = "ui-plate"
    el.dataset.size = "sm"
    el.style.position = "static"
    el.style.transform = "none"
    // the number in the mono face, as an issue is written; the word after it muted
    const b = document.createElement("b")
    b.style.font = "600 var(--t-sm)/1.2 var(--mono)"
    b.style.letterSpacing = "0"
    const small = document.createElement("small")
    small.style.display = "inline"
    small.style.marginLeft = "5px"
    el.append(b, small)
    return el
  }
  let rows: HTMLDivElement[] = []
  let drawn = ""
  /** The plates' box as last measured (after its rows changed), CSS px. */
  let size: [number, number] | null = null
  const drawPlates = (plates: DocketPlates, phone: boolean) => {
    const key = `${phone}|${plates.more}|${plates.rows.map((r) => `${r.n}:${r.word}`).join()}`
    if (key === drawn) return
    drawn = key
    size = null
    const want = plates.rows.length + (plates.more > 0 ? 1 : 0)
    while (rows.length < want) rows.push(row())
    rows = rows.slice(0, want)
    box.replaceChildren(...rows)
    plates.rows.forEach((r, k) => {
      const el = rows[k]!
      el.dataset.size = phone ? "xs" : "sm"
      el.querySelector("b")!.textContent = `#${r.n}`
      const small = el.querySelector("small")!
      small.textContent = `· ${r.word}`
      small.style.display = phone ? "none" : "inline"
      el.title = `#${r.n} ${r.title} · ${r.word}`
    })
    if (plates.more > 0) {
      const el = rows[plates.rows.length]!
      el.dataset.size = phone ? "xs" : "sm"
      el.querySelector("b")!.textContent = `+${plates.more}`
      const small = el.querySelector("small")!
      small.textContent = plates.more === 1 ? "· issue" : "· issues"
      small.style.display = phone ? "none" : "inline"
      el.title = `${plates.more} more open ${plates.more === 1 ? "issue" : "issues"}`
    }
  }

  // the HUD's keep-outs, re-read every half second (as the place plates do)
  let keep: [number, number, number, number][] = []
  let view: [number, number] = [0, 0]
  const readKeep = () => {
    const at = parts.layer.getBoundingClientRect()
    view = [at.width, at.height]
    keep = [...document.querySelectorAll("[data-keepout]")].map((el) => {
      const r = el.getBoundingClientRect()
      return [r.left - at.left - 6, r.top - at.top - 6, r.right - at.left + 6, r.bottom - at.top + 6]
    })
  }
  readKeep()
  addEventListener("resize", readKeep)
  let frame = 0
  const hudHidden = () => {
    const root = parts.layer.closest<HTMLElement>(".ui-viewer")
    return root?.dataset.hud === "on" && root.dataset.hudMode === "hidden"
  }
  const phoneNow = () => {
    const root = parts.layer.closest<HTMLElement>(".ui-viewer")
    return root?.dataset.phone !== undefined || view[0] <= PHONE_MAX
  }

  // ---- each frame: the queue at the clock, the figures, the plates ----
  const anchor: [number, number, number] | null = lane
    ? (() => {
        const mid = lane.places[Math.floor((Math.min(lane.places.length, 3) - 1) / 2)]!.at
        return [mid[0], mid[1] + UP, mid[2]]
      })()
    : null
  let issues: readonly Issue[] = []
  let queue: Petitioners = { waiting: [], served: 0, lately: [] }
  let poses: readonly (LifePose | null)[] = []
  let lastT = Number.NaN
  let readWorld: unknown = null
  let shown = false
  /** The issues (and the size) the plates were last drawn for. */
  let platesOf: readonly Issue[] | null = null
  let platesPhone = false
  /** Probes: the docket off (no figures, no plates), to weigh what it costs. */
  let muted = false
  const source = () => poses
  life.setPetitioners(source)
  const off = stage.onFrame(() => {
    if (++frame % 30 === 0) readKeep()
    let t: number | null = null
    if (own) {
      t = ownAt()
      issues = own.issues
      queue = own.petitioners
    } else {
      const session = sessionOf?.() ?? null
      if (session) {
        const snap = session.snapshot()
        t = session.clock.get().at
        if (snap.world !== readWorld) {
          readWorld = snap.world
          const h = harbourOf(snap.world)
          issues = h.issues
          queue = h.petitioners
        }
      }
    }
    if (t === null || muted) {
      poses = []
      if (shown) box.style.display = "none"
      shown = false
      return
    }
    // the figures: the queue at the clock
    poses = lane ? petitionerPoses(lane, queue, t, PETITION_CAP) : []
    // a serving the clock just passed (played, not sought): the coin glints at the front
    if (lane && Number.isFinite(lastT) && t > lastT && t - lastT < SEEK_MS)
      for (const at of queue.lately)
        if (at > lastT && at <= t) {
          const front = lane.places[0]!.at
          parts.workfx?.beat("coin", [front[0], front[1] + 1.15, front[2]])
        }
    lastT = t
    // the plates
    const want = anchor !== null && issues.length > 0 && !hudHidden()
    let at: [number, number] | null = null
    if (want) {
      const cam = stage.camera.position
      const far = Math.hypot(anchor[0] - cam.x, anchor[1] - cam.y, anchor[2] - cam.z) > FAR
      at = far ? null : toScreen(stage, anchor)
    }
    if (!at || at[0] < 0 || at[1] < 0 || at[0] > view[0] || at[1] > view[1]) {
      if (shown) box.style.display = "none"
      shown = false
      return
    }
    const phone = phoneNow()
    if (issues !== platesOf || phone !== platesPhone) {
      platesOf = issues
      platesPhone = phone
      drawPlates(docketPlates(issues, phone ? DOCKET_PLATES_PHONE : DOCKET_PLATES), phone)
    }
    if (!shown) {
      box.style.display = "flex"
      shown = true
    }
    const x = Math.round(at[0])
    const y = Math.round(at[1])
    box.style.translate = `${x}px ${y}px`
    // a keep-out (the HUD's crest, its panels) over the plates hides them rather than draw under it
    size ??= [box.offsetWidth, box.offsetHeight]
    const [w, h] = size
    const l = x - w / 2
    const top = y - h
    const covered = keep.some(([L, T, R, B]) => l < R && l + w > L && top < B && y > T)
    box.style.visibility = covered ? "hidden" : ""
  })
  const ext = window.guildhall?.ext
  if (ext)
    ext.docket = {
      open: (title?: string) => own?.open(ownAt(), title),
      close: () => own?.close(ownAt()),
      lane: () => (lane ? { ...lane, front: lane.places[0]!.at } : null),
      poses: () => poses,
      plates: () => docketPlates(issues, phoneNow() ? DOCKET_PLATES_PHONE : DOCKET_PLATES),
      queue: () => queue,
      at: () => (own ? ownAt() : null),
      mute: (on: boolean) => {
        muted = on
      },
      hold: (ms: number | null) => {
        held = ms
      },
    }
  return {
    dispose() {
      off()
      life.setPetitioners(null)
      removeEventListener("resize", readKeep)
      box.remove()
      if (ext) delete ext.docket
    },
  }
}
