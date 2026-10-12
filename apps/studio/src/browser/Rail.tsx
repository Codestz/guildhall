import { CATEGORIES, type Catalog, SCALE_FLAGS } from "@guildhall/assets"
import { type Filters, FLAGS, type Flag, type RailCounts } from "./filters.ts"

/** Scale flags read amber, piece flags red, as on the tiles and in the inspector. */
export const flagTone = (flag: string) =>
  (SCALE_FLAGS as readonly string[]).includes(flag) ? "var(--warn)" : "var(--fail)"

interface OptProps {
  label: string
  count: number
  pressed: boolean
  onClick(): void
  dot?: string
  title?: string
}

function Opt({ label, count, pressed, onClick, dot, title }: OptProps) {
  return (
    <button
      type="button"
      className="gh-opt"
      aria-pressed={pressed}
      data-empty={count === 0 && !pressed}
      onClick={onClick}
      title={title}
    >
      {dot && <i className="dot" style={{ background: dot }} />}
      <span className="label">{label}</span>
      <span className="count">{count.toLocaleString("en-US")}</span>
    </button>
  )
}

interface RailProps {
  catalog: Catalog
  filters: Filters
  counts: RailCounts
  onChange(next: Filters): void
}

/** The filter rail: search, misfits and flags, packs, categories; every option with its count. */
export function Rail({ catalog, filters, counts, onChange }: RailProps) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })
  const toggleFlag = (flag: Flag) =>
    set({
      flags: filters.flags.includes(flag)
        ? filters.flags.filter((f) => f !== flag)
        : [...filters.flags, flag],
    })
  const vendor = new Map(catalog.index.packs.map((p) => [p.id, p.vendor]))
  const all = catalog.facets()
  const packs = Object.keys(all.pack).sort()
  const categories = CATEGORIES.filter((c) => (all.category[c] ?? 0) > 0)

  return (
    <nav className="gh-panel gh-rail" aria-label="Filters">
      <div className="gh-rail-head">
        <h1 className="gh-brand">
          Guildhall <span>Pieces</span>
        </h1>
        <input
          className="gh-search"
          type="search"
          placeholder="search id, name, tag"
          aria-label="Search pieces"
          value={filters.text}
          onChange={(e) => set({ text: e.target.value })}
        />
      </div>
      <div className="gh-rail-body">
        <div className="gh-group">
          <p className="gh-eyebrow">Flags</p>
          <Opt
            label="any misfit"
            count={counts.misfit}
            pressed={filters.misfit}
            onClick={() => set({ misfit: !filters.misfit })}
            dot="var(--brass)"
            title="pieces with any scale or piece flag"
          />
          {FLAGS.map((flag) => (
            <Opt
              key={flag}
              label={flag}
              count={counts.flag[flag] ?? 0}
              pressed={filters.flags.includes(flag)}
              onClick={() => toggleFlag(flag)}
              dot={flagTone(flag)}
            />
          ))}
        </div>
        <div className="gh-group">
          <p className="gh-eyebrow">Pack</p>
          {packs.map((pack) => (
            <Opt
              key={pack}
              label={pack}
              count={counts.pack[pack] ?? 0}
              pressed={filters.pack === pack}
              onClick={() => set({ pack: filters.pack === pack ? null : pack })}
              title={vendor.get(pack)}
            />
          ))}
        </div>
        <div className="gh-group">
          <p className="gh-eyebrow">Category</p>
          {categories.map((category) => (
            <Opt
              key={category}
              label={category}
              count={counts.category[category] ?? 0}
              pressed={filters.category === category}
              onClick={() => set({ category: filters.category === category ? null : category })}
            />
          ))}
        </div>
      </div>
    </nav>
  )
}
