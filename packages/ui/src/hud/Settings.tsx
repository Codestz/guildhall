/**
 * Settings (V1's hud/Settings.tsx), fed by props: names, pace, the director, quality and the HUD itself,
 * plus the camera's keys. A side drawer on desktop, a bottom sheet on a phone. Non-modal: the world stays
 * live behind it; it takes focus on open and Esc inside it closes it. Dev controls (`dev`) only show
 * where the caller allows them (`?dev=1`).
 */
import { type ReactNode, useEffect, useRef } from "react"
import { Kbd, Segmented, Toggle } from "../components/controls.tsx"
import { Glyphs } from "./glyphs.tsx"
import type { HudMode, Names, Quality, SettingsValues } from "./types.ts"

const NAMES: readonly { value: Names; label: string; hint: string }[] = [
  { value: "world", label: "World", hint: "The guild's names, the source's under them: Warden · verifier" },
  { value: "source", label: "Source", hint: "The source's own names: Verifier" },
]
const PACES = [0.5, 1, 2, 4] as const
const QUALITIES: readonly { value: Quality; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "ultra", label: "Ultra" },
]
const HUD_MODES: readonly { value: HudMode; label: string }[] = [
  { value: "detailed", label: "Detailed" },
  { value: "minimal", label: "Minimal" },
  { value: "hidden", label: "Hidden" },
]

/** The camera's keys, as the Settings sheet lists them. */
export const SETTINGS_KEYS: readonly (readonly [string, string])[] = [
  ["Drag", "Pan"],
  ["Right-drag", "Turn"],
  ["Wheel", "Zoom"],
  ["W A S D", "Move"],
  ["Click", "Follow someone"],
  ["H", "Detailed / Minimal / Hidden"],
  ["Esc", "Back to the director"],
]

const pace = (p: number) => (p === 0.5 ? "½×" : `${p}×`)

export interface SettingsPanelProps {
  values: SettingsValues
  onChange: (patch: Partial<SettingsValues>) => void
  onClose: () => void
  /** Dev-only controls, drawn last under "Developer"; leave out unless `?dev=1`. */
  dev?: ReactNode
  /** Keys to list (default: the camera's). */
  keys?: readonly (readonly [string, string])[]
  className?: string
}

function Section({ title, value, children }: { title: string; value?: string; children: ReactNode }) {
  return (
    <section className="hud-set-section">
      <h3 className="ui-section-head">
        {title}
        {value && <span className="meta">{value}</span>}
      </h3>
      {children}
    </section>
  )
}

export function SettingsPanel({
  values,
  onChange,
  onClose,
  dev,
  keys = SETTINGS_KEYS,
  className,
}: SettingsPanelProps) {
  const head = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    head.current?.focus()
  }, [])
  const auto = values.quality === "auto"
  const qualityNow = values.qualityNow && QUALITIES.find((q) => q.value === values.qualityNow)?.label

  return (
    <aside
      className={`ui-panel hud-settings${className ? ` ${className}` : ""}`}
      role="dialog"
      aria-labelledby="hud-settings-h"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return
        e.stopPropagation()
        onClose()
      }}
    >
      <header className="hud-settings-head">
        <h2 id="hud-settings-h" ref={head} tabIndex={-1}>
          Settings
        </h2>
        <button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close settings (Esc)">
          <Glyphs.close />
        </button>
      </header>
      <div className="hud-settings-body">
        <Section title="Story">
          <Segmented
            label="Pace"
            value={String(values.pace)}
            options={PACES.map((p) => ({ value: String(p), label: pace(p) }))}
            onChange={(v) => onChange({ pace: Number(v) })}
          />
          <Toggle
            label="Director"
            hint="The camera follows the story: pleas first, then failures, quests, loot"
            checked={values.director}
            onChange={(director) => onChange({ director })}
          />
        </Section>

        <Section title="Quality" value={auto && qualityNow ? `Auto · now ${qualityNow}` : undefined}>
          <Segmented
            label="Tier"
            value={values.quality}
            options={QUALITIES}
            onChange={(v) => onChange({ quality: v as Quality })}
          />
          <p className="ui-hint">
            {auto
              ? "Steps between Low and High to keep the frame rate smooth. Ultra is never picked for you."
              : "Pinned. Ultra is heavier; for a strong GPU."}
          </p>
        </Section>

        <Section title="Display">
          <Segmented
            label="HUD (press H)"
            value={values.hud}
            options={HUD_MODES}
            onChange={(v) => onChange({ hud: v as HudMode })}
          />
          <Segmented
            label="Names"
            value={values.names}
            options={NAMES}
            onChange={(v) => onChange({ names: v as Names })}
          />
          <p className="ui-hint">{NAMES.find((n) => n.value === values.names)?.hint}</p>
          <Toggle
            label="Story captions"
            hint="A narrated line for each beat, like subtitles"
            checked={values.captions}
            onChange={(captions) => onChange({ captions })}
          />
        </Section>

        <Section title="Camera">
          <details className="hud-keys">
            <summary>
              <Glyphs.chevron size={12} />
              Controls
            </summary>
            <dl>
              {keys.map(([key, what]) => (
                <div key={key}>
                  <dt>
                    <Kbd>{key}</Kbd>
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </details>
        </Section>

        {dev && (
          <Section title="Developer" value="?dev=1">
            {dev}
          </Section>
        )}
      </div>
    </aside>
  )
}
