import { useEffect, useRef, useSyncExternalStore } from "react"
import type { Names } from "../guild/casting.ts"
import { type QualityChoice, quality, TIERS, type Tier } from "../guild/quality.ts"
import type { GuildStore } from "../guild/store.ts"
import { active, BACKEND_NAME, type Backend, backendUrl, webgpuAvailable } from "../render/backend.ts"
import { DoorLink } from "./Brand.tsx"
import { DirectorControls, DirectorsElsewhere } from "./DirectorControls.tsx"
import { DIRECTING } from "./directing.ts"
import { Icon } from "./icons.tsx"
import { Lever, Section, Switch } from "./levers.tsx"
import { HUD_MODES, type HudMode, hudPrefs, useHudPrefs } from "./prefs.ts"
import { SoundLevers } from "./Sound.tsx"

const QUALITY: QualityChoice[] = ["auto", 0, 1, 2, 3]
const BACKENDS: Backend[] = ["webgl", "webgpu"]
const KEYS: [string, string][] = [
  ["Drag", "Pan"],
  ["Right-drag", "Turn"],
  ["Wheel", "Zoom"],
  ["W A S D", "Move"],
  ["Q E · R F", "Turn · tilt"],
  ["+ −", "Zoom"],
  ["Click", "Follow someone"],
  ["V", "Diorama / Explore"],
  ["B", "Bard on / off"],
  ["H", "Minimal / Detailed / Hidden"],
  ["Esc", "Back to the Bard"],
]

/**
 * Everything the viewer can tune, in one place: quality, the camera, sound and the HUD itself; and,
 * for a demo or the local app, the Director's controls (hud/DirectorControls.tsx: story, hour,
 * weather, mood, the Bard). A plain showcase visit gets a row to /demos in their place.
 *
 * A side drawer on desktop, a bottom sheet on phones. Non-modal: the hall stays live behind it, Esc
 * closes it and focus returns to the gear.
 *
 * `onLegends` (phones): the toolbar there keeps only HUD mode and Settings, so the Legends book and
 * Sound lead the sheet instead of sitting in the bar.
 */
/** Settings → Names (guild/casting.ts): the world's archetypes, or the source's own names. */
const NAMES: readonly [Names, string, string][] = [
  ["world", "World", "The guild's names, with the source's under them: Warden · verifier"],
  ["source", "Source", "The source's own names: Verifier, general"],
]

export function Settings({
  store,
  onClose,
  onLegends,
}: {
  store: GuildStore
  onClose: () => void
  onLegends?: () => void
}) {
  const tier = useSyncExternalStore(quality.subscribe, quality.snapshot)
  const prefs = useHudPrefs()
  const head = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    head.current?.focus()
  }, [])

  return (
    <aside className="plaque settings" role="dialog" aria-labelledby="settings-h">
      <header className="settings-head">
        <h2 id="settings-h" ref={head} tabIndex={-1}>
          Settings
        </h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings (Esc)">
          <Icon.close />
        </button>
      </header>

      <div className="settings-body">
        <Section title="Your repo">
          <DoorLink />
        </Section>
        {onLegends && (
          <Section title="Legends">
            <button type="button" className="set-link" aria-haspopup="dialog" onClick={onLegends}>
              <Icon.book />
              <span className="toggle-text">
                <b>Open the Legends</b>
                <span>The story so far, chapter by chapter</span>
              </span>
              <Icon.chevron />
            </button>
          </Section>
        )}
        {onLegends && (
          <Section title="Sound">
            <SoundLevers />
          </Section>
        )}

        <Section title="Quality" value={quality.auto ? `Auto · now ${TIERS[tier].name}` : TIERS[tier].name}>
          <Lever label="Quality" quiet>
            <div className="seg seg-fill">
              {QUALITY.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={quality.choice === choice}
                  onClick={() => quality.choose(choice)}
                >
                  {choice === "auto" ? "Auto" : TIERS[choice as Tier].name}
                </button>
              ))}
            </div>
          </Lever>
          <p className="hint">
            {quality.choice === 3
              ? "Ultra: tilt-shift miniature look and full Retina sharpness. Heavier; for a strong GPU."
              : quality.auto
                ? "Steps between Low and High to keep the frame rate smooth. Ultra is never picked for you."
                : "Pinned. Ultra adds the tilt-shift miniature look, and is heavier."}
          </p>
          {webgpuAvailable() && <RendererLever />}
        </Section>

        {DIRECTING ? <DirectorControls store={store} /> : <DirectorsElsewhere />}

        <Section title="Camera">
          <Lever label="View">
            <div className="seg seg-fill">
              <button
                type="button"
                aria-pressed={store.view === "diorama"}
                onClick={() => store.setView("diorama")}
              >
                Diorama
              </button>
              <button
                type="button"
                aria-pressed={store.view === "explore"}
                onClick={() => store.setView("explore")}
              >
                Explore
              </button>
            </div>
          </Lever>
          <details className="keys">
            <summary>Controls</summary>
            <dl>
              {KEYS.map(([key, what]) => (
                <div key={key}>
                  <dt>
                    <kbd>{key}</kbd>
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </details>
        </Section>

        {!onLegends && (
          <Section title="Sound">
            <SoundLevers />
          </Section>
        )}

        <Section title="Display">
          <Lever label="HUD" value="press H">
            <div className="seg seg-fill">
              {(Object.keys(HUD_MODES) as HudMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={prefs.mode === mode}
                  title={HUD_MODES[mode].hint}
                  onClick={() => hudPrefs.set({ mode })}
                >
                  {HUD_MODES[mode].label}
                </button>
              ))}
            </div>
          </Lever>
          <Lever label="Names" value={prefs.names === "world" ? "Warden · verifier" : "Verifier"}>
            <div className="seg seg-fill">
              {NAMES.map(([names, label, hint]) => (
                <button
                  key={names}
                  type="button"
                  aria-pressed={prefs.names === names}
                  title={hint}
                  onClick={() => hudPrefs.set({ names })}
                >
                  {label}
                </button>
              ))}
            </div>
          </Lever>
          <Switch
            label="Sigils over agents"
            hint="An icon for each deed in progress, readable with the HUD hidden"
            checked={prefs.sigils}
            onChange={(sigils) => hudPrefs.set({ sigils })}
          />
          <Switch
            label="Story captions"
            hint="A narrated line for each beat, like subtitles. Shown in Minimal and Hidden"
            checked={prefs.captions}
            onChange={(captions) => hudPrefs.set({ captions })}
          />
          <Switch
            label="Stats for nerds"
            hint="Frame rate, draw calls, triangles"
            checked={prefs.stats}
            onChange={(stats) => hudPrefs.set({ stats })}
          />
        </Section>
      </div>
    </aside>
  )
}

/**
 * WebGL or WebGPU (experimental): the renderer is chosen once, at load (`?renderer=`,
 * render/backend.ts), so a choice reloads the page with every other parameter kept. Only offered
 * where the browser has WebGPU. Two tabs side by side, Stats for nerds open in each, compare them.
 */
function RendererLever() {
  const live = active.backend
  return (
    <>
      <Lever label="Renderer" value={BACKEND_NAME[live]}>
        <div className="seg seg-fill">
          {BACKENDS.map((backend) => (
            <button
              key={backend}
              type="button"
              aria-pressed={live === backend}
              onClick={() => {
                if (backend !== live) location.assign(backendUrl(location.href, backend))
              }}
            >
              {backend === "webgpu" ? "WebGPU (experimental)" : BACKEND_NAME[backend]}
            </button>
          ))}
        </div>
      </Lever>
      <p className="hint">
        Reloads the page. WebGPU is a preview: ambient occlusion isn't drawn there yet, and the event shows
        (dragon, festival, comet, ghost ship, rainbow) only partly.
      </p>
    </>
  )
}
