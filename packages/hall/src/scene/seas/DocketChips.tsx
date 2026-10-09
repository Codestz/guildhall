import { type ReactNode, useMemo } from "react"
import { CAPS, docketAt } from "../../guild/docket.ts"
import { queueSpot, TINTS } from "../../guild/petitions.ts"
import { quality } from "../../guild/quality.ts"
import { useGuild } from "../../guild/useGuild.ts"
import { useWorld } from "../../world/source.ts"
import { Label } from "../Label.tsx"
import { watersOf } from "../Ships.tsx"
import { harbourOf, toWorld } from "./fleet.ts"
import { ANCHORAGE, ANCHORAGE_ROW_LENGTH, ANCHORAGE_STEP } from "./passage.ts"

/** Height of a pile's plate over the sea, world units. */
const PILE_Y = 5
/** The queue's plate stands over its third row. */
const QUEUE_ROW = 1

/**
 * The docket's piles, as chips (scene/Label.tsx, the same layer as the figures' name plates): when
 * more issues are open than the queue seats, "12 petitioners" stands over the queue; when more pull
 * requests are open than the anchorage has berths, "+3 more pull requests" over the anchorage. Nothing
 * while everything open has a place of its own.
 */
export function DocketChips() {
  const store = useGuild()
  const world = useWorld()
  const harbour = useMemo(() => harbourOf(watersOf(world).quay), [world])
  if (store.sea.length === 0) return null
  const caps = CAPS[quality.tier]
  const docket = docketAt(store.sea, store.time, caps)
  const queue = queueSpot(world, QUEUE_ROW)
  const anchorage = toWorld(
    harbour,
    ANCHORAGE.side + ((ANCHORAGE_ROW_LENGTH - 1) / 2) * ANCHORAGE_STEP,
    ANCHORAGE.out - 8,
  )
  return (
    <>
      {docket.open > caps.places && (
        <Pile at={[queue[0], PILE_Y, queue[1]]} color={TINTS.other}>
          {docket.open} petitioners
        </Pile>
      )}
      {docket.waitingPulls > 0 && (
        <Pile at={[anchorage.x, PILE_Y + 3, anchorage.z]} color="#f1ecdf">
          +{docket.waitingPulls} more pull {docket.waitingPulls === 1 ? "request" : "requests"}
        </Pile>
      )}
    </>
  )
}

function Pile({ at, color, children }: { at: [number, number, number]; color: string; children: ReactNode }) {
  return (
    <Label position={at} center zIndexRange={[19, 0]} style={{ pointerEvents: "none" }}>
      <div aria-hidden="true" className="chip">
        <div className="name" style={{ borderBottomColor: color }}>
          <b>{children}</b>
        </div>
      </div>
    </Label>
  )
}
