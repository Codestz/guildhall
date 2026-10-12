import type { Catalog } from "@guildhall/assets"
import type { Stage } from "@guildhall/render"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ScreenCtx } from "../screens.ts"
import { clipNames, isCharacter } from "../viewer/clips.ts"
import { Inspector } from "../viewer/Inspector.tsx"
import type { Player } from "../viewer/player.ts"
import { createPreviews, type Previews } from "../viewer/previews.ts"
import { applyFilters, type Filters, NO_FILTERS, railCounts, toSearch } from "./filters.ts"
import { Grid } from "./Grid.tsx"
import { Rail } from "./Rail.tsx"

/** How the outside world (`guildhall.ext.studio`) steers a mounted browser. */
export interface BrowserHandle {
  filters(): Filters
  setFilters(next: Filters): void
  select(id: string | null): void
  /** The shown character's player, or null when the selection is not one (or is still loading). */
  player(): Player | null
}

interface Props {
  catalog: Catalog
  ctx: ScreenCtx
  initial: { filters: Filters; id: string | null }
  bind(handle: BrowserHandle): void
}

function ActiveChips({ filters, onChange }: { filters: Filters; onChange(next: Filters): void }) {
  const chips: { label: string; clear: Partial<Filters> }[] = []
  if (filters.text.trim()) chips.push({ label: `“${filters.text.trim()}”`, clear: { text: "" } })
  if (filters.pack) chips.push({ label: filters.pack, clear: { pack: null } })
  if (filters.category) chips.push({ label: filters.category, clear: { category: null } })
  if (filters.misfit) chips.push({ label: "any misfit", clear: { misfit: false } })
  for (const flag of filters.flags)
    chips.push({ label: flag, clear: { flags: filters.flags.filter((f) => f !== flag) } })
  return (
    <>
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          className="gh-chip"
          onClick={() => onChange({ ...filters, ...chip.clear })}
        >
          {chip.label}
        </button>
      ))}
      {chips.length > 1 && (
        <button type="button" className="gh-chip" onClick={() => onChange(NO_FILTERS)}>
          clear all
        </button>
      )}
    </>
  )
}

/** The piece browser: the filter rail, the thumbnail grid and the piece inspector, side by side. */
export function Browser({ catalog, ctx, initial, bind }: Props) {
  const [filters, setFilters] = useState(initial.filters)
  const [selected, setSelected] = useState(initial.id && catalog.get(initial.id) ? initial.id : null)

  const entries = useMemo(() => applyFilters(catalog, filters), [catalog, filters])
  const counts = useMemo(() => railCounts(catalog, filters), [catalog, filters])
  const entry = selected ? (catalog.get(selected) ?? null) : null

  const player = useRef<Player | null>(null)
  const onPlayer = useCallback((next: Player | null) => {
    player.current = next
  }, [])
  useEffect(
    () => bind({ filters: () => filters, setFilters, select: setSelected, player: () => player.current }),
    [bind, filters],
  )

  // Character tiles carry an "animated" badge with their clip count.
  const clipCount = useCallback(
    (e: (typeof entries)[number]) =>
      isCharacter(e) ? clipNames(e, e.character ? catalog.rig(e.character.rig) : undefined).length : 0,
    [catalog],
  )

  // The deep link follows the state (replaceState: no history entry and no remount), so it can be shared.
  useEffect(() => {
    const search = toSearch(new URLSearchParams(location.search), filters, selected)
    if (search !== location.search) history.replaceState(null, "", search)
  }, [filters, selected])

  // Tiles without a baked thumbnail get a live preview, drawn on the inspector's renderer.
  const [previews, setPreviews] = useState<Previews | null>(null)
  const onStage = useCallback((stage: Stage | null) => setPreviews(stage ? createPreviews(stage) : null), [])
  useEffect(() => () => previews?.dispose(), [previews])

  const select = useCallback((id: string) => setSelected((current) => (current === id ? current : id)), [])

  return (
    <div className="gh gh-browser" data-testid="browser">
      <Rail catalog={catalog} filters={filters} counts={counts} onChange={setFilters} />
      <main className="gh-panel gh-main">
        <div className="gh-bar">
          <span className="total">{entries.length.toLocaleString("en-US")}</span>
          <span className="of">of {catalog.all().length.toLocaleString("en-US")} pieces</span>
          <ActiveChips filters={filters} onChange={setFilters} />
        </div>
        <Grid
          entries={entries}
          selected={selected}
          onSelect={select}
          previews={previews}
          track={ctx.load}
          clipCount={clipCount}
        />
      </main>
      <Inspector
        entry={entry}
        ctx={ctx}
        packs={catalog.index.packs}
        rig={catalog.rig}
        onStage={onStage}
        onPlayer={onPlayer}
      />
    </div>
  )
}
