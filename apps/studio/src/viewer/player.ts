/**
 * The inspector's animation player: one character's clips driven from the stage's frame loop, with
 * play/pause, speed, loop and a scrub. Pausing and scrubbing freeze the clip through `Character.play`'s
 * `t`; resuming replays it from where it stood.
 */
import type { Character, Stage } from "@guildhall/render"

export const SPEEDS = { min: 0.25, max: 2 } as const
/** Seconds to cross-fade when switching clips while playing. */
const FADE = 0.2

export interface PlayerState {
  clip: string | null
  playing: boolean
  speed: number
  loop: boolean
  /** Where the clip stands, as a fraction of its length. */
  t: number
  /** The clip's length in seconds (0 with no clip). */
  seconds: number
}

export interface PlayOptions {
  /** Freeze at this fraction of the clip (paused). */
  t?: number
  speed?: number
  loop?: boolean
}

export interface Player {
  /** Every clip name, each once, in the character's order. */
  readonly clips: string[]
  state(): PlayerState
  /** Switches to `name` (false, nothing changed, when there is no such clip). */
  play(name: string, opts?: PlayOptions): boolean
  setPlaying(playing: boolean): void
  setSpeed(speed: number): void
  setLoop(loop: boolean): void
  /** Freezes the clip at fraction `t` (pauses). */
  scrub(t: number): void
  /** Called after every change and every frame; returns the unsubscribe. */
  subscribe(fn: (state: PlayerState) => void): () => void
  dispose(): void
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export function createPlayer(stage: Pick<Stage, "onFrame">, ch: Character): Player {
  const clips = [...new Set(ch.clips.map((c) => c.name))]
  const listeners = new Set<(state: PlayerState) => void>()
  const state: PlayerState = { clip: null, playing: false, speed: 1, loop: true, t: 0, seconds: 0 }

  const action = () => {
    const clip = ch.clips.find((c) => c.name === state.clip)
    return clip ? ch.mixer.existingAction(clip) : null
  }
  const notify = () => {
    const snapshot = { ...state }
    for (const fn of listeners) fn(snapshot)
  }
  /** Reads where the playing clip stands (a looping clip's time keeps counting past its length). */
  const read = () => {
    const a = action()
    if (!a || state.seconds <= 0) return
    state.t = state.loop ? (a.time % state.seconds) / state.seconds : clamp(a.time / state.seconds, 0, 1)
  }
  /** Plays the current clip from fraction `t`, with the current speed and loop. */
  const resume = (t: number, fade = 0) => {
    if (!state.clip || !ch.play(state.clip, { loop: state.loop, speed: state.speed, fade })) return
    const a = action()
    if (a) a.time = (t >= 1 ? 0 : t) * state.seconds
    ch.update(0)
    state.playing = true
    state.t = t >= 1 ? 0 : t
  }

  const onFinished = () => {
    state.playing = false
    state.t = 1
    notify()
  }
  ch.mixer.addEventListener("finished", onFinished)
  const unsubscribe = stage.onFrame((dt) => {
    ch.update(dt)
    if (!state.playing) return
    read()
    notify()
  })

  return {
    clips,
    state: () => ({ ...state }),
    play(name, opts = {}) {
      const clip = ch.clips.find((c) => c.name === name)
      if (!clip) return false
      const fade = state.playing && state.clip !== name ? FADE : 0
      if (opts.speed !== undefined) state.speed = clamp(opts.speed, SPEEDS.min, SPEEDS.max)
      if (opts.loop !== undefined) state.loop = opts.loop
      state.clip = name
      state.seconds = clip.duration
      if (opts.t === undefined) resume(0, fade)
      else {
        state.t = clamp(opts.t, 0, 1)
        state.playing = false
        ch.play(name, { t: state.t })
      }
      notify()
      return true
    },
    setPlaying(playing) {
      if (!state.clip || playing === state.playing) return
      if (playing) resume(state.t)
      else {
        read()
        state.playing = false
        if (state.clip) ch.play(state.clip, { t: state.t })
      }
      notify()
    },
    setSpeed(speed) {
      state.speed = clamp(speed, SPEEDS.min, SPEEDS.max)
      const a = action()
      if (a && state.playing) a.timeScale = state.speed
      notify()
    },
    setLoop(loop) {
      if (loop === state.loop) return
      read()
      state.loop = loop
      if (state.playing) resume(state.t)
      notify()
    },
    scrub(t) {
      if (!state.clip) return
      state.t = clamp(t, 0, 1)
      state.playing = false
      ch.play(state.clip, { t: state.t })
      notify()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    dispose() {
      unsubscribe()
      ch.mixer.removeEventListener("finished", onFinished)
      ch.mixer.stopAllAction()
      listeners.clear()
    },
  }
}
