/** The dressing panel: a catalog search to place pieces from, the placed list and the gizmo's mode. */
import type { Catalog, CatalogEntry, PrefabRecipe } from "@guildhall/assets"
import type { GizmoMode } from "@guildhall/render"
import { useMemo, useState } from "react"
import { libraryUrl } from "../catalog.ts"
import { Segments, short } from "./Blueprint.tsx"

/** Search hits listed at once; the search narrows, it does not page. */
const HITS = 40

/** Static pieces matching the search (characters are not dressing). */
function searchable(catalog: Catalog, text: string): CatalogEntry[] {
  return catalog.query({ text, kind: "static" }).slice(0, HITS)
}

const RAD = 180 / Math.PI

export function Dressing({
  catalog,
  recipe,
  selected,
  mode,
  onPlace,
  onSelect,
  onRemove,
  onMode,
}: {
  catalog: Catalog
  recipe: PrefabRecipe
  selected: number | null
  mode: GizmoMode
  onPlace: (piece: string) => void
  onSelect: (i: number | null) => void
  onRemove: (i: number) => void
  onMode: (mode: GizmoMode) => void
}) {
  const [text, setText] = useState("kenney-town ")
  const hits = useMemo(() => searchable(catalog, text.trim()), [catalog, text])
  const current = selected === null ? undefined : recipe.dressing[selected]
  return (
    <div className="gh-panel gh-col">
      <div className="gh-col-head">
        <p className="gh-eyebrow">Dressing</p>
        <input
          className="gh-search"
          placeholder="search the catalog…"
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="gh-hits" data-testid="hits">
        {hits.map((e) => (
          <button key={e.id} type="button" className="gh-hit" title={e.id} onClick={() => onPlace(e.id)}>
            {e.files.thumb ? <img src={libraryUrl(e.files.thumb)} alt="" loading="lazy" /> : <i />}
            <span className="name">{e.name}</span>
            <span className="h num">{e.size[1].toFixed(1)}m</span>
          </button>
        ))}
        {hits.length === 0 && <p className="gh-lead pad">No piece matches.</p>}
      </div>
      <div className="gh-col-foot">
        <div className="gh-sec-head">
          <p className="gh-eyebrow">Placed</p>
          <span className="gh-aside num">{recipe.dressing.length}</span>
        </div>
        <ul className="gh-list placed">
          {recipe.dressing.map((d, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a piece may be placed twice; the list is positional
            <li key={`${d.piece}-${i}`} data-selected={i === selected}>
              <button type="button" className="pick" onClick={() => onSelect(i === selected ? null : i)}>
                <span className="what">{short(d.piece)}</span>
                <span className="num">
                  {d.x},{d.z} · {Math.round(d.rot * RAD)}°
                </span>
              </button>
              <button type="button" className="gh-x" aria-label="remove piece" onClick={() => onRemove(i)}>
                ×
              </button>
            </li>
          ))}
        </ul>
        {current && (
          <div className="gh-gizmo">
            <Segments
              options={["translate", "rotate"] as const}
              value={mode}
              label={(m) => (m === "translate" ? "move · 1 m" : "turn · 90°")}
              onPick={onMode}
            />
            <p className="gh-hint-line">Hold alt for 0.25 m / 15°. Delete removes it.</p>
          </div>
        )}
      </div>
    </div>
  )
}
