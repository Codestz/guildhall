/**
 * The history's narration in the HUD (hall/historyEvents.ts): the caption the clock is on, the toasts it
 * has just passed and how far along the Chronicle it is, read from the hall's clock without a render per
 * frame (each is a small snapshot that changes only when a beat comes or goes). A repo's hall without a
 * session narrates while its history plays, or rests anywhere short of today; at today, still, it says
 * nothing (the island as it is).
 */
import { type CaptionView, type ChronicleEntry, pickToasts, type ToastItem } from "@guildhall/ui"
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import type { Clock } from "../clock.ts"
import {
  type Beat,
  beatAt,
  CAPTION_HOLD_S,
  captionOf,
  entryOf,
  feedAt,
  gapOf,
  passed,
  scheduleOf,
  TOAST_LIFE_MS,
  TOAST_WINDOW_S,
  toastsAt,
} from "../historyEvents.ts"

/** The toasts shown at once (decisions.md "HUD stays light": at most 2). */
const TOASTS_MAX = 2

const nothing = () => () => {}

export interface HistoryNarration {
  caption?: CaptionView
  toasts: ToastItem[]
  /** The Chronicle at the clock's day. */
  feed: ChronicleEntry[]
  /** Whether it is telling (the clock playing, or resting short of today). */
  telling: boolean
  /**
   * Grows when a scrub lands where no caption is the clock's (or the history goes back to today): the
   * captions' strip is drawn anew under it, so a line from elsewhere in the history does not linger.
   */
  epoch: number
}

/**
 * The narration of `beats` on `clock` (null, or `on` false: none). `placeIndex` names a unit's place (a
 * line that opens its dossier); `onPlace` hears each place-founding beat as it is told (its plate lights).
 */
export function useHistoryNarration(
  clock: Clock | null,
  beats: readonly Beat[] | null,
  on: boolean,
  placeIndex: (unit: string) => number,
  onPlace?: (index: number) => void,
): HistoryNarration {
  const live = on && clock !== null && beats !== null && beats.length > 0
  const subscribe = live ? clock.subscribe : nothing
  const rate = useSyncExternalStore(subscribe, () => (live ? clock.get().rate : 1))
  const telling = useSyncExternalStore(subscribe, () => {
    if (!live) return false
    const s = clock.get()
    return s.playing || s.t < 1
  })
  const schedule = useMemo(() => (live ? scheduleOf(beats, rate) : null), [live, beats, rate])

  // the caption the clock is on (an index into the schedule's), and a new key each time one comes
  const index = useSyncExternalStore(subscribe, () =>
    schedule && telling ? beatAt(schedule.captions, clock?.get().t ?? 1, gapOf(CAPTION_HOLD_S, rate)) : -1,
  )
  const keys = useRef(0)
  const caption = useMemo(() => {
    const beat = index >= 0 ? schedule?.captions[index] : undefined
    return beat ? captionOf(beat, ++keys.current) : undefined
  }, [index, schedule])
  // while it plays a line fades on its own; a scrub to where none is told clears it at once
  const playing = useSyncExternalStore(subscribe, () => live && clock.get().playing)
  const epochs = useRef({ epoch: 0, index: -1, telling: false })
  const e = epochs.current
  if ((index < 0 && e.index >= 0 && !playing) || (!telling && e.telling)) e.epoch++
  e.index = index
  e.telling = telling

  // the toasts it has just passed, as their ids (a string: the snapshot changes only when they do)
  const span = gapOf(TOAST_WINDOW_S, rate)
  const toastIds = useSyncExternalStore(subscribe, () =>
    schedule && telling
      ? toastsAt(schedule.toasts, clock?.get().t ?? 1, span)
          .map((b) => b.moment.id)
          .join("|")
      : "",
  )
  // a toast lives its own wall-clock life from when it was first shown; a scrub back shows them anew
  const seen = useRef(new Map<string, number>())
  const lastT = useRef(1)
  const [tick, setTick] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` re-reads the wall clock
  const toasts = useMemo(() => {
    if (!schedule || !toastIds) return []
    const t = clock?.get().t ?? 1
    if (t < lastT.current - 1e-6) seen.current.clear()
    lastT.current = t
    const ids = new Set(toastIds.split("|"))
    const entries = schedule.toasts.filter((b) => ids.has(b.moment.id)).map((b) => entryOf(b, placeIndex))
    return pickToasts(entries, performance.now(), seen.current, TOASTS_MAX, TOAST_LIFE_MS)
  }, [schedule, toastIds, tick, placeIndex])
  const fading = toasts.length > 0
  useEffect(() => {
    if (!fading) return
    const timer = setInterval(() => setTick((k) => k + 1), 250)
    return () => clearInterval(timer)
  }, [fading])

  // a place founded lights its plate as its caption or toast comes
  const lit = useRef(new Set<string>())
  useEffect(() => {
    if (!onPlace || !schedule) return
    const now = new Set<string>()
    const beat = index >= 0 ? schedule.captions[index] : undefined
    if (beat) now.add(beat.moment.id)
    for (const id of toastIds ? toastIds.split("|") : []) now.add(id)
    // the newest place that came (a jump that passes several lights only the last)
    let newest: Beat | undefined
    for (const id of now) {
      if (lit.current.has(id)) continue
      const b = schedule.beats.find((x) => x.moment.id === id)
      if (b?.moment.kind === "place" && (!newest || b.t >= newest.t)) newest = b
    }
    const k = newest?.moment.unit !== undefined ? placeIndex(newest.moment.unit) : -1
    if (k >= 0) onPlace(k)
    lit.current = now
  }, [index, toastIds, schedule, onPlace, placeIndex])

  // the Chronicle: every beat up to the clock's day (all of them at today)
  const count = useSyncExternalStore(subscribe, () =>
    live ? (telling ? passed(beats, clock.get().t) : beats.length) : 0,
  )
  const feed = useMemo(
    () => (live ? feedAt(beats.slice(0, count), 1, placeIndex) : []),
    [live, beats, count, placeIndex],
  )

  return { ...(caption ? { caption } : {}), toasts, feed, telling, epoch: e.epoch }
}
