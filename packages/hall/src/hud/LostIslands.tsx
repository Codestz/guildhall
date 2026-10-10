import { archipelagoSource, type FailedIsland } from "../world/archipelagoSource.ts"

/**
 * The islands an archipelago couldn't have (`?repos=`, world/archipelagoSource.ts): a plate each under
 * the island chip, the repo's name, why, and a button to ask again. They are drawn nowhere else: the
 * sea is not cut for them, and the others sail on.
 */
export function LostIslands({ failed, hidden }: { failed: readonly FailedIsland[]; hidden?: boolean }) {
  if (failed.length === 0) return null
  return (
    <ul className="plaque island-lost" aria-label="Islands that didn't load" hidden={hidden}>
      {failed.map((one) => (
        <li key={one.repo} className="island-lost-row">
          <span className="island-lost-name">{one.repo}</span>
          <span className="island-lost-note" title={one.reason}>
            couldn't load
          </span>
          {one.retry && (
            <button
              type="button"
              className="island-lost-retry"
              onClick={() => archipelagoSource.retry(one.repo)}
              title={one.reason}
            >
              Retry
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
