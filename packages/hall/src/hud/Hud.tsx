import { useEffect, useState, useSyncExternalStore } from "react"
import { useGuild } from "../guild/useGuild.ts"
import { Brand } from "./Brand.tsx"
import { Chronicle } from "./Chronicle.tsx"
import { Console } from "./Console.tsx"
import { Dossier } from "./Dossier.tsx"
import { Roster } from "./Roster.tsx"
import { Stats } from "./Stats.tsx"

type Sheet = "roster" | "chronicle" | "stage"
const SHEETS: { id: Sheet; label: string }[] = [
  { id: "roster", label: "Guild" },
  { id: "chronicle", label: "Chronicle" },
  { id: "stage", label: "Stage" },
]

const PHONE = "(max-width: 720px)"

/**
 * The overlay. Desktop: brand + roster down the left, chronicle (or a dossier) down the right, the
 * console along the bottom — the middle stays clear for the hall. Phones: one sheet at a time,
 * chosen from tabs on the console.
 */
export function Hud() {
  const store = useGuild()
  const phone = useMedia(PHONE)
  const [rosterOpen, setRosterOpen] = useState(true)
  const [chronOpen, setChronOpen] = useState(true)
  const [statsOpen, setStatsOpen] = useState(false)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const view = store.selected ? store.views.find((v) => v.id === store.selected) : undefined
  const dossier = Boolean(store.selected && store.sessionOf(store.selected))

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      if (store.selected) store.select(null)
      else setSheet(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [store])

  // On a phone the dossier takes the sheet slot; picking someone closes the list you picked from.
  useEffect(() => {
    if (store.selected && phone) setSheet(null)
  }, [store.selected, phone])

  const toggle = (id: Sheet) => setSheet((s) => (s === id ? null : id))

  return (
    <div className="hud" data-phone={phone} data-sheet={sheet ?? "none"} data-dossier={dossier}>
      <div className="col col-left">
        <Brand />
        <Roster
          store={store}
          open={phone ? sheet === "roster" : rosterOpen}
          onToggle={() => (phone ? setSheet(null) : setRosterOpen((o) => !o))}
          className={sheet === "roster" ? "is-sheet" : ""}
        />
      </div>

      <div className="col col-right">
        {dossier ? (
          <Dossier store={store} view={view} className="is-sheet" />
        ) : (
          <Chronicle
            store={store}
            open={phone ? sheet === "chronicle" : chronOpen}
            onToggle={() => (phone ? setSheet(null) : setChronOpen((o) => !o))}
            className={sheet === "chronicle" ? "is-sheet" : ""}
          />
        )}
        {!phone && <Stats store={store} open={statsOpen} onToggle={() => setStatsOpen((o) => !o)} />}
      </div>

      <div className="dock">
        <Console store={store} stageOpen={!phone || sheet === "stage"} />
        {phone && (
          <nav className="plaque tabs" aria-label="Panels">
            {SHEETS.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-expanded={sheet === s.id}
                aria-controls={s.id === "stage" ? "stage-levers" : undefined}
                onClick={() => {
                  if (store.selected) store.select(null)
                  toggle(s.id)
                }}
              >
                {s.label}
                {s.id === "roster" && store.views.some((v) => v.phase === "waiting") && (
                  <>
                    <i className="tab-dot" aria-hidden="true" />
                    <span className="visually-hidden">, a plea is waiting</span>
                  </>
                )}
              </button>
            ))}
          </nav>
        )}
      </div>
    </div>
  )
}

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query)
      list.addEventListener("change", notify)
      return () => list.removeEventListener("change", notify)
    },
    () => window.matchMedia(query).matches,
  )
}
