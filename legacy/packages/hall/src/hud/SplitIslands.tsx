import { useArchipelago } from "../world/archipelagoSource.ts"

/**
 * A repo split into islands (`?repo=…&split`, world/gen/split.ts): the repo legend lists them, a
 * package each (the core first), as it lists a plain island's districts. Nothing for any other
 * archipelago (its islands have no links to count) or none.
 */
export function SplitIslands() {
  const archipelago = useArchipelago()
  if (!archipelago || archipelago.links.length === 0) return null
  const islands = [archipelago.home, ...archipelago.islands]
  const linked = (id: string): number =>
    archipelago.links.filter((link) => link.a === id || link.b === id).length
  return (
    <>
      <p className="repo-meta">
        Islands · {islands.length} packages · {archipelago.links.length} crossings
      </p>
      <ul className="repo-districts" aria-label="Islands">
        {islands.map((island, i) => (
          <li key={island.id}>
            <i className="repo-swatch" style={{ background: island.language.colour }} aria-hidden="true" />
            <span className="repo-folder">{island.label}</span>
            <span className="repo-biome">
              {i === 0 ? "core · " : island.kind === "islet" ? "islet · " : ""}
              {island.files?.toLocaleString("en")} files · {linked(island.id)} links
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}
