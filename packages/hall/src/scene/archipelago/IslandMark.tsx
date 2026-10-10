import { type CSSProperties, useEffect, useMemo } from "react"
import { CircleGeometry, RingGeometry } from "three"
import { islandView } from "../../guild/islandView.ts"
import { useGuild } from "../../guild/useGuild.ts"
import type { IslandInfo } from "../../world/archipelagoSource.ts"
import { HOME, type Stop } from "../../world/islandRing.ts"
import { useWorld } from "../../world/source.ts"
import { Label } from "../Label.tsx"
import { SEA_Y } from "../Ships.tsx"

/**
 * The map view's island plates (`M`, or a flight to "map"): each island's name over its far coast with
 * its file count and an activity dot, in its main language's colour. A button that flies there; a
 * click or a tap on the island's land does the same, and hovering either lights the island's shore.
 * Data-agnostic: an island is what IslandInfo says, plus its file count (if its world knows one) and
 * whether work is going on there.
 */

export interface Mark {
  island: IslandInfo
  stop: Stop
  /** Files in its tree, when the world was grown from one. */
  files?: number
}

/** The plates for every island, with the live facts each needs (the home island's work, from the guild). */
export function MapMarks({
  marks,
  hovered,
  onHover,
}: {
  marks: readonly Mark[]
  hovered: Stop | null
  onHover: (stop: Stop | null) => void
}) {
  const store = useGuild()
  const home = useWorld()
  const working = store.views.filter((view) => view.phase === "working" || view.phase === "waiting").length
  return (
    <>
      {marks.map((mark) => (
        <IslandMark
          key={mark.island.repo}
          {...mark}
          files={mark.stop === HOME ? filesOfRepo(home.repo) : mark.files}
          // Far islands are idle: no guild there. The home one is as busy as its adventurers.
          working={mark.stop === HOME ? working : 0}
          hovered={hovered === mark.stop}
          onHover={onHover}
        />
      ))}
    </>
  )
}

/** The files a repo's tree held, summed over its districts. */
export function filesOfRepo(
  repo: { districts: readonly { files: number }[] } | undefined,
): number | undefined {
  return repo?.districts.reduce((sum, district) => sum + district.files, 0)
}

function IslandMark({
  island,
  stop,
  files,
  working,
  hovered,
  onHover,
}: Mark & { working: number; hovered: boolean; onHover: (stop: Stop | null) => void }) {
  const disc = useMemo(() => new CircleGeometry(island.reach, 24).rotateX(-Math.PI / 2), [island.reach])
  const shore = useMemo(
    () => new RingGeometry(island.reach - 2.5, island.reach, 64).rotateX(-Math.PI / 2),
    [island.reach],
  )
  useEffect(
    () => () => {
      disc.dispose()
      shore.dispose()
    },
    [disc, shore],
  )
  // The pointer is a hand while it is over an island: it is a button.
  useEffect(() => {
    if (!hovered) return
    document.body.style.cursor = "pointer"
    return () => {
      document.body.style.cursor = ""
    }
  }, [hovered])
  // The home island's keep is where the guild stands, and its chips climb up the screen from there
  // into the plate's usual spot (the far coast): that plate goes to the near coast, under them.
  const out = island.reach * (stop === HOME ? HOME_PLATE_OUT : PLATE_OUT)
  const state = working > 0 ? "busy" : "quiet"
  return (
    <group position={[island.at[0], 0, island.at[1]]}>
      <mesh
        geometry={disc}
        position-y={1}
        onClick={(event) => {
          event.stopPropagation()
          islandView.go(stop)
        }}
        onPointerOver={(event) => {
          event.stopPropagation()
          onHover(stop)
        }}
        onPointerOut={() => onHover(null)}
      >
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
      {hovered && (
        <mesh geometry={shore} position-y={SEA_Y + 0.4} renderOrder={2}>
          <meshBasicMaterial color={island.language.colour} transparent opacity={0.7} depthWrite={false} />
        </mesh>
      )}
      <Label position={[-out, 10, -out]} center zIndexRange={PLATE_Z}>
        <button
          type="button"
          className="island-mark"
          data-hover={hovered}
          style={{ "--accent": island.language.colour } as CSSProperties}
          onClick={() => islandView.go(stop)}
          onMouseEnter={() => onHover(stop)}
          onMouseLeave={() => onHover(null)}
          title={`Fly to ${island.repo}`}
        >
          <i className="island-swatch" aria-hidden="true" />
          <span className="island-mark-name">{island.name}</span>
          {files !== undefined && (
            <span className="island-mark-files">{files.toLocaleString("en")} files</span>
          )}
          <span className="island-mark-lang">{island.language.name}</span>
          <i
            className="island-dot"
            data-state={state}
            role="img"
            aria-label={working > 0 ? `${working} at work` : "quiet"}
            title={working > 0 ? `${working} at work` : "quiet"}
          />
        </button>
      </Label>
    </group>
  )
}

/** A plate's spot, as a share of its island's reach out along the far diagonal. */
const PLATE_OUT = 0.5
/** The home island's: negative, the near coast. */
const HOME_PLATE_OUT = -0.6
/**
 * Over the adventurers' chips (scene/Adventurer.tsx, 20…0): on the map an island's name is what the
 * view is for, so a chip passing under it never covers it.
 */
const PLATE_Z: readonly [number, number] = [24, 21]
