/** The blueprint panel: every HouseBlueprint field as a control, plus the recipe's id and kind. */
import {
  type HouseBlueprint,
  KIT_PROFILES,
  PALETTE,
  PREFAB_KINDS,
  type PrefabKind,
  type PrefabRecipe,
} from "@guildhall/assets"
import type { ReactNode } from "react"
import {
  patchHouse,
  removeEdit,
  setOpeningStyles,
  setRampSwap,
  setSize,
  setStorey,
  setStoreyCount,
} from "./model.ts"

const FAMILIES = ["stone", "plaster", "wood"] as const
const OPENINGS = ["home", "shop", "blind"] as const
const ROOFS = ["gable", "high-gable", "flat", "point"] as const
const DOORS = ["round", "square", "wide"] as const
/** The largest footprint the steppers offer, in modules (the town's lots stop well short of it). */
const MAX_CELLS = 6

type Edit = (next: PrefabRecipe) => void

export const short = (piece: string | null): string =>
  piece === null ? "empty" : piece.slice(piece.indexOf("/") + 1)

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="gh-field">
      <span className="gh-field-label">{label}</span>
      <div className="gh-field-body">{children}</div>
    </div>
  )
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

export function Segments<T extends string>({
  options,
  value,
  onPick,
  label = (o) => o,
}: {
  options: readonly T[]
  value: T | null
  onPick: (option: T) => void
  label?: (option: T) => string
}) {
  return (
    <div className="gh-seg">
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={o === value} onClick={() => onPick(o)}>
          {label(o)}
        </button>
      ))}
    </div>
  )
}

export function Stepper({
  value,
  min,
  max,
  onStep,
  unit,
}: {
  value: number
  min: number
  max: number
  onStep: (next: number) => void
  unit?: string
}) {
  return (
    <div className="gh-step">
      <button type="button" disabled={value <= min} onClick={() => onStep(value - 1)} aria-label="less">
        −
      </button>
      <span className="num">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      <button type="button" disabled={value >= max} onClick={() => onStep(value + 1)} aria-label="more">
        +
      </button>
    </div>
  )
}

function Ramps({ h, recipe, onEdit }: { h: HouseBlueprint; recipe: PrefabRecipe; onEdit: Edit }) {
  const ramps = PALETTE.ramps.map((r) => r.name)
  const swaps = h.vary.rampSwaps ?? {}
  const unused = ramps.filter((r) => !(r in swaps))
  return (
    <>
      {Object.entries(swaps).map(([from, to]) => (
        <div className="gh-ramp" key={from}>
          <span className="from num">{from}</span>
          <div className="gh-chips">
            {to.map((ramp, i) => (
              <button
                key={ramp}
                type="button"
                className="gh-chip"
                onClick={() =>
                  onEdit(
                    setRampSwap(
                      recipe,
                      from,
                      to.filter((_, j) => j !== i),
                    ),
                  )
                }
              >
                {ramp}
              </button>
            ))}
            <select
              className="gh-select mini"
              value=""
              onChange={(e) => e.target.value && onEdit(setRampSwap(recipe, from, [...to, e.target.value]))}
            >
              <option value="">+ ramp</option>
              {ramps
                .filter((r) => !to.includes(r))
                .map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
            </select>
          </div>
        </div>
      ))}
      <select
        className="gh-select"
        value=""
        onChange={(e) => e.target.value && onEdit(setRampSwap(recipe, e.target.value, [e.target.value]))}
      >
        <option value="">swap a ramp by seed…</option>
        {unused.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </>
  )
}

/** The left panel. Edits go straight to `onEdit`; the problems they cause show under the stage. */
export function Blueprint({ recipe, onEdit }: { recipe: PrefabRecipe; onEdit: Edit }) {
  const h = recipe.house
  return (
    <div className="gh-panel gh-col">
      <div className="gh-col-head">
        <p className="gh-brand">
          Guild<span>hall</span> · composer
        </p>
        <Field label="id">
          <input
            className="gh-search"
            value={recipe.id}
            spellCheck={false}
            onChange={(e) => onEdit({ ...recipe, id: e.target.value.trim() })}
          />
        </Field>
        <Field label="kind">
          <select
            className="gh-select"
            value={recipe.kind}
            onChange={(e) => onEdit({ ...recipe, kind: e.target.value as PrefabKind })}
          >
            {PREFAB_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {h ? (
        <HouseControls h={h} recipe={recipe} onEdit={onEdit} />
      ) : (
        <p className="gh-lead pad">Dressing only.</p>
      )}
    </div>
  )
}

function HouseControls({ h, recipe, onEdit }: { h: HouseBlueprint; recipe: PrefabRecipe; onEdit: Edit }) {
  const kit = KIT_PROFILES[h.kit]
  const windowStyles = Object.keys(kit.walls.stone.windows)
  const doorIndex = h.door.index
  const chosen = h.vary.openings ?? []
  return (
    <div className="gh-col-body">
      <Section title="Footprint" aside={<span className="gh-aside num">{kit.module} m modules</span>}>
        <Field label="frontage">
          <Stepper
            value={h.size.w}
            min={1}
            max={MAX_CELLS}
            onStep={(w) => onEdit(setSize(recipe, w, h.size.d))}
            unit={` · ${h.size.w * kit.module} m`}
          />
        </Field>
        <Field label="depth">
          <Stepper
            value={h.size.d}
            min={1}
            max={MAX_CELLS}
            onStep={(d) => onEdit(setSize(recipe, h.size.w, d))}
            unit={` · ${h.size.d * kit.module} m`}
          />
        </Field>
      </Section>

      <Section title="Storeys">
        <Field label="count">
          <Stepper
            value={h.storeys.length}
            min={1}
            max={3}
            onStep={(n) => onEdit(setStoreyCount(recipe, n))}
          />
        </Field>
        {h.storeys
          .map((s, k) => ({ s, k }))
          .reverse()
          .map(({ s, k }) => (
            <div className="gh-storey" key={k}>
              <span className="gh-storey-n num">{k === 0 ? "G" : k}</span>
              <div className="gh-storey-body">
                <Segments
                  options={FAMILIES}
                  value={s.family}
                  onPick={(family) => onEdit(setStorey(recipe, k, { family }))}
                />
                <Segments
                  options={OPENINGS}
                  value={s.openings}
                  onPick={(openings) => onEdit(setStorey(recipe, k, { openings }))}
                />
              </div>
            </div>
          ))}
      </Section>

      <Section title="Roof">
        <Field label="style">
          <Segments
            options={ROOFS}
            value={h.roof.style}
            onPick={(style) => onEdit(patchHouse(recipe, { roof: { ...h.roof, style } }))}
          />
        </Field>
        <Field label="ridge">
          <Segments
            options={["x", "z"] as const}
            value={h.roof.ridge}
            label={(r) => (r === "x" ? "along front" : "front to back")}
            onPick={(ridge) => onEdit(patchHouse(recipe, { roof: { ...h.roof, ridge } }))}
          />
        </Field>
        <Field label="chimney">
          <div className="gh-range">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={h.chimney ?? 0}
              onChange={(e) => {
                const chance = Number(e.target.value)
                const { chimney: _, ...rest } = h
                onEdit({ ...recipe, house: chance > 0 ? { ...rest, chimney: chance } : rest })
              }}
            />
            <span className="num">{Math.round((h.chimney ?? 0) * 100)}%</span>
          </div>
        </Field>
      </Section>

      <Section title="Door">
        <Field label="cell">
          <Segments
            options={["centre", ...Array.from({ length: h.size.w }, (_, i) => String(i))]}
            value={String(doorIndex)}
            onPick={(cell) =>
              onEdit(
                patchHouse(recipe, {
                  door: { ...h.door, index: cell === "centre" ? "centre" : Number(cell) },
                }),
              )
            }
          />
        </Field>
        <Field label="style">
          <Segments
            options={DOORS}
            value={h.door.style ?? "round"}
            onPick={(style) => onEdit(patchHouse(recipe, { door: { ...h.door, style } }))}
          />
        </Field>
      </Section>

      <Section
        title="Windows"
        aside={<span className="gh-aside">{chosen.length ? "by seed" : "family default"}</span>}
      >
        <div className="gh-chips">
          {windowStyles.map((style) => (
            <button
              key={style}
              type="button"
              className="gh-toggle"
              aria-pressed={chosen.includes(style)}
              onClick={() =>
                onEdit(
                  setOpeningStyles(
                    recipe,
                    chosen.includes(style) ? chosen.filter((s) => s !== style) : [...chosen, style],
                  ),
                )
              }
            >
              {style}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Ramps" aside={<span className="gh-aside">re-tint by seed</span>}>
        <Ramps h={h} recipe={recipe} onEdit={onEdit} />
      </Section>

      <Section title="Panel edits" aside={<span className="gh-aside num">{h.edits.length}</span>}>
        <p className="gh-hint-line">Click a wall to cycle its panel, shift-click to go back.</p>
        <ul className="gh-list">
          {h.edits.map((e) => (
            <li key={`${e.storey}${e.side}${e.index}`}>
              <span className="num">
                {e.storey === 0 ? "G" : e.storey} {e.side} {e.index}
              </span>
              <span className="what">{short(e.piece)}</span>
              <button
                type="button"
                className="gh-x"
                aria-label="remove edit"
                onClick={() => onEdit(removeEdit(recipe, e))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}
