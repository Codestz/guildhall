import { hexWorldScreen } from "../hexworld/index.ts"
import type { Screen } from "../screens.ts"

/**
 * The town (`/town/<seed>`): the hex island (decisions.md "Clean restart on hex"). The path's seed
 * becomes the hex world's `seed`; every other query key passes through to it.
 */
export const town: Screen = {
  id: "town",
  title: "Town",
  mount(host, ctx) {
    const q = new URLSearchParams(ctx.query)
    const id = q.get("town")
    if (id && /^\d+$/.test(id)) q.set("seed", id)
    q.delete("town")
    return hexWorldScreen.mount(host, { ...ctx, query: q })
  },
}
