import { useEffect, useMemo, useState } from "react"
import { groupClips } from "./clips.ts"
import { type Player, type PlayerState, SPEEDS } from "./player.ts"

/** Scrub steps across a clip. */
const STEPS = 1000

/** The live state, re-rendered once the scrub has moved a step (not every frame). */
function usePlayerState(player: Player): PlayerState {
  const [state, setState] = useState(player.state)
  useEffect(() => {
    setState(player.state())
    return player.subscribe((next) =>
      setState((prev) =>
        prev.clip === next.clip &&
        prev.playing === next.playing &&
        prev.speed === next.speed &&
        prev.loop === next.loop &&
        Math.round(prev.t * STEPS) === Math.round(next.t * STEPS)
          ? prev
          : next,
      ),
    )
  }, [player])
  return state
}

/** The inspector's animation section: transport, speed, scrub and the grouped, searchable clip list. */
export function AnimationPanel({ player }: { player: Player }) {
  const state = usePlayerState(player)
  const [search, setSearch] = useState("")
  const groups = useMemo(() => groupClips(player.clips, search), [player, search])
  const shown = groups.reduce((n, g) => n + g.names.length, 0)

  return (
    <section className="gh-sec gh-player" aria-label="Animation">
      <p className="gh-eyebrow">
        Animation · <span className="num">{player.clips.length}</span> clips
      </p>
      <div className="gh-transport">
        <button
          type="button"
          className="gh-tool"
          aria-pressed={state.playing}
          onClick={() => player.setPlaying(!state.playing)}
        >
          {state.playing ? "pause" : "play"}
        </button>
        <button
          type="button"
          className="gh-tool"
          aria-pressed={state.loop}
          onClick={() => player.setLoop(!state.loop)}
        >
          loop
        </button>
        <span className="gh-now" title={state.clip ?? ""}>
          {state.clip ?? "no clip"}
        </span>
        <span className="num gh-time">
          {(state.t * state.seconds).toFixed(2)} / {state.seconds.toFixed(2)} s
        </span>
      </div>
      <label className="gh-slider">
        <span>t</span>
        <input
          type="range"
          aria-label="timeline"
          min={0}
          max={STEPS}
          value={Math.round(state.t * STEPS)}
          onChange={(e) => player.scrub(Number(e.currentTarget.value) / STEPS)}
        />
        <span className="num">{state.t.toFixed(2)}</span>
      </label>
      <label className="gh-slider">
        <span>speed</span>
        <input
          type="range"
          aria-label="speed"
          min={SPEEDS.min}
          max={SPEEDS.max}
          step={0.05}
          value={state.speed}
          onChange={(e) => player.setSpeed(Number(e.currentTarget.value))}
        />
        <span className="num">{state.speed.toFixed(2)}×</span>
      </label>
      <input
        className="gh-search"
        type="search"
        placeholder={`search ${player.clips.length} clips`}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      <div className="gh-clips">
        {shown === 0 && <p className="gh-lead">No clip matches.</p>}
        {groups.map(({ group, names }) => (
          <div key={group} className="gh-group">
            <p className="gh-eyebrow">
              {group} <span className="num">{names.length}</span>
            </p>
            {names.map((name) => (
              <button
                key={name}
                type="button"
                className="gh-opt"
                aria-pressed={name === state.clip}
                onClick={() => player.play(name)}
              >
                <span className="label">{name}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
