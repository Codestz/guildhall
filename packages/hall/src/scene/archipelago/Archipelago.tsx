import { lazy, Suspense } from "react"
import { useArchipelago } from "../../world/archipelagoSource.ts"

/** The far islands' code loads on first need: a hall without `?archipelago` pays nothing. */
const ArchipelagoLayer = lazy(() => import("./ArchipelagoLayer.tsx"))

/**
 * The archipelago (`?archipelago`, `?repos=`; world/archipelagoSource.ts): the far islands round
 * the home one, the ships between them, their names on the map. Nothing without one.
 */
export function Archipelago() {
  const archipelago = useArchipelago()
  if (!archipelago) return null
  return (
    <Suspense fallback={null}>
      <ArchipelagoLayer archipelago={archipelago} />
    </Suspense>
  )
}
