/** The recipe panel: every NpcRecipe option as a control (bodies, parts, outfit, headwear, hands, clips, ranges). */
import { type Catalog, type MountSlot, type NpcRecipe, PALETTE } from "@guildhall/assets"
import { type ReactNode, useMemo } from "react"
import { short } from "../composer/controls.tsx"
import { linkTo } from "../shell/directory.ts"
import {
  bodyChoices,
  clothRamps,
  gripLink,
  HAND_SLOT,
  type Hand,
  hideable,
  outfitTargets,
  propChoices,
  RIG,
  setActivity,
  setBodies,
  setHand,
  setHead,
  setHide,
  setOutfit,
  setVary,
  toggle,
} from "./model.ts"

type Edit = (next: NpcRecipe) => void

/** A ramp's base swatch colour. */
const rampHex = (name: string): string => {
  const ramp = PALETTE.ramps.find((r) => r.name === name)
  return ramp ? (PALETTE.swatches[ramp.tones.base]?.hex ?? "#000") : "#000"
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="gh-sec">
      <div className="gh-sec-head">
        <p className="gh-eyebrow">{title}</p>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="gh-field">
      <span className="gh-field-label">{label}</span>
      <div className="gh-field-body">{children}</div>
    </div>
  )
}

function Toggles({
  options,
  chosen,
  onToggle,
  label = short,
}: {
  options: readonly string[]
  chosen: readonly string[]
  onToggle: (option: string) => void
  label?: (option: string) => string
}) {
  return (
    <div className="gh-chips">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className="gh-toggle"
          title={o}
          aria-pressed={chosen.includes(o)}
          onClick={() => onToggle(o)}
        >
          {label(o)}
        </button>
      ))}
    </div>
  )
}

/** Props that would fit the slot but have no mount for it yet, each linked to the grip editor. */
function NeedsMount({ pieces, slot }: { pieces: readonly string[]; slot: MountSlot }) {
  if (pieces.length === 0) return null
  return (
    <details className="gh-needs">
      <summary>
        {pieces.length} more need a mount for {slot}
      </summary>
      <ul>
        {pieces.map((id) => (
          <li key={id}>
            <span>{short(id)}</span>
            <a href={gripLink(id)}>needs mount →</a>
          </li>
        ))}
      </ul>
    </details>
  )
}

function Outfit({ recipe, catalog, onEdit }: { recipe: NpcRecipe; catalog: Catalog; onEdit: Edit }) {
  const cloth = clothRamps(recipe, catalog, PALETTE)
  const targets = outfitTargets(PALETTE)
  const unused = cloth.filter((r) => !(r in recipe.outfit))
  return (
    <>
      {Object.entries(recipe.outfit).map(([from, to]) => (
        <div className="gh-outfit-row" key={from} data-ramp={from}>
          <span className="from">
            <i style={{ background: rampHex(from) }} />
            {from}
          </span>
          <div className="gh-chips">
            {targets.map((ramp) => (
              <button
                key={ramp}
                type="button"
                className={`gh-sw-chip${ramp === from ? " keep" : ""}`}
                title={ramp === from ? `${ramp} (keep)` : ramp}
                aria-pressed={to.includes(ramp)}
                style={{ background: rampHex(ramp) }}
                onClick={() => onEdit(setOutfit(recipe, from, toggle(to, ramp)))}
              />
            ))}
          </div>
          <button
            type="button"
            className="gh-x"
            title={`stop re-tinting ${from}`}
            onClick={() => onEdit(setOutfit(recipe, from, null))}
          >
            ×
          </button>
        </div>
      ))}
      {unused.length > 0 && (
        <div className="gh-chips">
          <span className="gh-aside">re-tint</span>
          {unused.map((ramp) => (
            <button
              key={ramp}
              type="button"
              className="gh-toggle"
              onClick={() => onEdit(setOutfit(recipe, ramp, [ramp]))}
            >
              <span style={{ color: rampHex(ramp) }}>■</span> {ramp}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function Hands({ recipe, catalog, onEdit }: { recipe: NpcRecipe; catalog: Catalog; onEdit: Edit }) {
  return (
    <>
      {(["r", "l"] as Hand[]).map((hand) => {
        const slot = HAND_SLOT[hand]
        const { mounted, needs } = propChoices(catalog.all(), slot)
        const chosen = recipe.hands?.[hand] ?? []
        // A listed prop with no mount stays visible (and shows as a problem) so it can be removed.
        const options = ["", ...mounted, ...chosen.filter((c) => c !== "" && !mounted.includes(c))]
        return (
          <div key={hand}>
            <Field label={hand === "r" ? "right" : "left"}>
              <Toggles
                options={options}
                chosen={chosen}
                label={(o) => (o === "" ? "empty" : short(o))}
                onToggle={(o) => onEdit(setHand(recipe, hand, toggle(chosen, o)))}
              />
            </Field>
            <NeedsMount pieces={needs} slot={slot} />
          </div>
        )
      })}
    </>
  )
}

function Headwear({ recipe, catalog, onEdit }: { recipe: NpcRecipe; catalog: Catalog; onEdit: Edit }) {
  const { mounted, needs } = propChoices(catalog.all(), "head")
  const pieces = recipe.head?.pieces ?? []
  const chance = recipe.head?.chance ?? 0.5
  const options = [...mounted, ...pieces.filter((p) => !mounted.includes(p))]
  return (
    <>
      {options.length > 0 ? (
        <Toggles
          options={options}
          chosen={pieces}
          onToggle={(o) => onEdit(setHead(recipe, toggle(pieces, o), chance))}
        />
      ) : (
        <p className="gh-hint-line">
          No piece has a head mount yet: author one in the <a href={linkTo("grip")}>grip editor</a> (slot
          head).
        </p>
      )}
      {pieces.length > 0 && (
        <Field label="chance">
          <div className="gh-range">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={chance}
              onChange={(e) => onEdit(setHead(recipe, pieces, Number(e.target.value)))}
            />
            <span className="num">{Math.round(chance * 100)}%</span>
          </div>
        </Field>
      )}
      <NeedsMount pieces={needs} slot="head" />
    </>
  )
}

function ClipSelect({
  value,
  clips,
  onPick,
}: {
  value: string
  clips: readonly string[]
  onPick: (clip: string) => void
}) {
  return (
    <select className="gh-select" value={value} onChange={(e) => onPick(e.target.value)}>
      {!clips.includes(value) && <option value={value}>{value} (not on the rig)</option>}
      {clips.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  )
}

function Activity({ recipe, clips, onEdit }: { recipe: NpcRecipe; clips: readonly string[]; onEdit: Edit }) {
  const { activity } = recipe
  return (
    <>
      <Field label="work">
        <ClipSelect
          value={activity.work}
          clips={clips}
          onPick={(work) => onEdit(setActivity(recipe, { work }))}
        />
      </Field>
      <Field label="walk">
        <ClipSelect
          value={activity.walk}
          clips={clips}
          onPick={(walk) => onEdit(setActivity(recipe, { walk }))}
        />
      </Field>
      <Field label="idle">
        <div className="gh-chips">
          {activity.idle.map((clip) => (
            <button
              key={clip}
              type="button"
              className="gh-chip"
              title="remove"
              onClick={() => onEdit(setActivity(recipe, { idle: activity.idle.filter((c) => c !== clip) }))}
            >
              {clip}
            </button>
          ))}
          <select
            className="gh-select mini"
            value=""
            onChange={(e) =>
              e.target.value && onEdit(setActivity(recipe, { idle: [...activity.idle, e.target.value] }))
            }
          >
            <option value="">+ idle</option>
            {clips
              .filter((c) => !activity.idle.includes(c))
              .map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
          </select>
        </div>
      </Field>
    </>
  )
}

const RANGES = {
  height: { lo: [0.85, 1], hi: [1, 1.15] },
  speed: { lo: [0.6, 1], hi: [1, 1.4] },
} as const

function Vary({ recipe, onEdit }: { recipe: NpcRecipe; onEdit: Edit }) {
  return (
    <>
      {(["height", "speed"] as const).map((key) =>
        ([0, 1] as const).map((end) => {
          const [min, max] = end === 0 ? RANGES[key].lo : RANGES[key].hi
          const value = recipe.vary[key][end]
          return (
            <Field key={`${key}${end}`} label={`${key} ${end === 0 ? "min" : "max"}`}>
              <div className="gh-range">
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={0.01}
                  value={value}
                  onChange={(e) => onEdit(setVary(recipe, key, end, Number(e.target.value)))}
                />
                <span className="num">×{value.toFixed(2)}</span>
              </div>
            </Field>
          )
        }),
      )}
    </>
  )
}

export function Recipe({
  recipe,
  catalog,
  parts,
  onEdit,
}: {
  recipe: NpcRecipe
  catalog: Catalog
  /** Sub-mesh names of the recipe's bodies. */
  parts: readonly string[]
  onEdit: Edit
}) {
  const bodies = useMemo(() => bodyChoices(catalog.all()).map((e) => e.id), [catalog])
  const clips = useMemo(() => catalog.rig(RIG)?.clips.map((c) => c.name) ?? [], [catalog])
  const hide = recipe.hide ?? []
  const partOptions = hideable([...parts, ...hide])
  return (
    <>
      <Section title="Bodies" aside={<span className="gh-aside">{recipe.body.length} by seed</span>}>
        <Toggles
          options={bodies}
          chosen={recipe.body}
          onToggle={(id) => onEdit(setBodies(recipe, toggle(recipe.body, id)))}
        />
      </Section>
      <Section title="Hide parts" aside={<span className="gh-aside">{hide.length} hidden</span>}>
        <Toggles
          options={partOptions}
          chosen={hide}
          label={(p) => p}
          onToggle={(p) => onEdit(setHide(recipe, toggle(hide, p)))}
        />
      </Section>
      <Section title="Outfit" aside={<span className="gh-aside">ramp → options, by seed</span>}>
        <Outfit recipe={recipe} catalog={catalog} onEdit={onEdit} />
      </Section>
      <Section title="Headwear">
        <Headwear recipe={recipe} catalog={catalog} onEdit={onEdit} />
      </Section>
      <Section title="Hands" aside={<span className="gh-aside">mounted props only</span>}>
        <Hands recipe={recipe} catalog={catalog} onEdit={onEdit} />
      </Section>
      <Section title="Activity" aside={<span className="gh-aside">{RIG}</span>}>
        <Activity recipe={recipe} clips={clips} onEdit={onEdit} />
      </Section>
      <Section title="Variation">
        <Vary recipe={recipe} onEdit={onEdit} />
      </Section>
    </>
  )
}
