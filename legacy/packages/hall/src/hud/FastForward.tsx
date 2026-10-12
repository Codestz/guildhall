import type { GuildStore } from "../guild/store.ts"
import { Icon } from "./icons.tsx"

/** Shown from this multiple up; hidden again below it. */
const SHOWN_AT = 1.05

/**
 * The replay fast-forward mark (guild/director.ts, roadmap S4): a small ⏩ with the speed while a
 * quiet stretch of a replay is skipped. Top centre, where the plea banner goes, which never shows
 * at the same time (a plea stops the fast-forward). It stays in the Hidden HUD: it explains why the
 * film suddenly runs fast. Screen readers hear it once per stretch, not every speed step.
 */
export function FastForward({ store }: { store: GuildStore }) {
  const on = store.fastForward > SHOWN_AT
  const rate = store.speed * store.fastForward
  return (
    <>
      <div className="ffwd" data-on={on} aria-hidden="true">
        <Icon.fast />
        <span className="ffwd-rate">{rate.toFixed(1)}×</span>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {on ? "Fast-forwarding a quiet stretch" : ""}
      </p>
    </>
  )
}
