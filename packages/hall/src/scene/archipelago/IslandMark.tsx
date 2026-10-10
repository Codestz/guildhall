import { useFrame } from "@react-three/fiber"
import { type CSSProperties, useEffect, useMemo, useRef } from "react"
import { CircleGeometry, RingGeometry, Vector3 } from "three"
import { islandView } from "../../guild/islandView.ts"
import { useGuild } from "../../guild/useGuild.ts"
import type { IslandInfo } from "../../world/archipelagoSource.ts"
import { HOME, type Stop } from "../../world/islandRing.ts"
import { useWorld } from "../../world/source.ts"
import { Label } from "../Label.tsx"
import { SEA_Y } from "../Ships.tsx"
import { type LabelIn, layoutLabels, type Rect, shortName } from "./labels.ts"

/** What a plate keeps off: the HUD's bars and buttons, and the adventurers' chips. */
const AVOID = ".hud .toolbar, .hud .hud-head, .hud .plaque, .hud .timeline, .hud .tape, .chip, .chip > *"
/** On a phone the map shows this many plates; the others are pips, which a tap brings back. */
const PHONE_PLATES = 7

/**
 * The map view's island plates (`M`, or a flight to "map"): each island's short name over its coast,
 * in its main language's colour, a button that flies there; a click or a tap on the island's land does
 * the same, and hovering either lights the island's shore and shows the plate in full (its language,
 * its files). Laid out so none covers another (scene/archipelago/labels.ts): the core and the biggest
 * islands first, a leader line for a plate set off from its island, and an island with no room left a
 * pip that a hover brings back. Data-agnostic: an island is what IslandInfo says, plus its file count
 * (if its world knows one) and whether work is going on there.
 */

export interface Mark {
  island: IslandInfo
  stop: Stop
  /** Files in its tree, when the world was grown from one. */
  files?: number
}

/** A plate's elements, so the layout can move them without rendering. */
interface Plate {
  button: HTMLButtonElement | null
  leader: HTMLElement | null
  /** Its full size, measured once it showed (px), and the screen class it was measured at. */
  size?: { w: number; h: number; phone: boolean }
}

const anchor = new Vector3()
const edge = new Vector3()

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
  const base = marks.find((mark) => mark.stop === HOME)?.island.name ?? ""
  const plates = useRef(new Map<Stop, Plate>())
  const frame = useRef(0)
  const avoid = useRef<Rect[]>([])
  const plateOf = (stop: Stop): Plate => {
    const known = plates.current.get(stop)
    if (known) return known
    const plate: Plate = { button: null, leader: null }
    plates.current.set(stop, plate)
    return plate
  }
  const files = useMemo(
    () => marks.map((mark) => (mark.stop === HOME ? filesOfRepo(home.repo) : mark.files)),
    [marks, home],
  )

  useFrame(({ camera, size }) => {
    const phone = size.width < 720
    const items: LabelIn[] = []
    const stops: Stop[] = []
    for (const [i, mark] of marks.entries()) {
      const plate = plateOf(mark.stop)
      if (!plate.button) continue
      anchor.set(mark.island.at[0], 10, mark.island.at[1]).project(camera)
      edge.set(mark.island.at[0] + mark.island.reach, 10, mark.island.at[1]).project(camera)
      const x = (anchor.x * 0.5 + 0.5) * size.width
      const y = (-anchor.y * 0.5 + 0.5) * size.height
      const radius = Math.abs((edge.x - anchor.x) * 0.5 * size.width)
      const measured = plate.size?.phone === phone ? plate.size : undefined
      const name = shortName(mark.island.name, base)
      const home = mark.stop === HOME
      items.push({
        x,
        y,
        radius,
        w: measured?.w ?? 30 + name.length * (home ? 12 : phone ? 8 : 9.5),
        h: measured?.h ?? (home ? 30 : phone ? 22 : 26),
        // The core first, then by size; a package of few files last.
        priority: home ? 1e9 : (files[i] ?? 0),
        pinned: home,
      })
      stops.push(mark.stop)
    }
    // The HUD and the adventurers' chips stay uncovered; measured now and then (chips move).
    frame.current++
    if (frame.current % 8 === 1) {
      avoid.current = []
      for (const element of document.querySelectorAll(AVOID))
        for (const r of [element.getBoundingClientRect()])
          if (r.width > 0 && r.height > 0) avoid.current.push({ x: r.x, y: r.y, w: r.width, h: r.height })
    }
    const placed = layoutLabels(
      items,
      { w: size.width, h: size.height, ...(phone ? { max: PHONE_PLATES } : {}) },
      avoid.current,
    )
    for (const [k, stop] of stops.entries()) {
      const plate = plateOf(stop)
      const at = placed[k]
      if (!plate.button || !at) continue
      // Measured while it shows in full: a plate in its pip has no width to take.
      if (plate.button.dataset.shown !== "false" && plate.size?.phone !== phone) {
        const box = plate.button.getBoundingClientRect()
        if (box.width > 20) plate.size = { w: box.width, h: box.height, phone }
      }
      const shown = at.shown ? "true" : "false"
      if (plate.button.dataset.shown !== shown) plate.button.dataset.shown = shown
      plate.button.style.setProperty("--dx", `${at.dx.toFixed(1)}px`)
      plate.button.style.setProperty("--dy", `${at.dy.toFixed(1)}px`)
      const line = plate.leader
      if (line) {
        const long = Math.hypot(at.dx, at.dy)
        line.style.display = at.shown && at.leader ? "block" : "none"
        line.style.width = `${long.toFixed(1)}px`
        line.style.transform = `rotate(${Math.atan2(at.dy, at.dx)}rad)`
      }
    }
  })

  return (
    <>
      {marks.map((mark, i) => (
        <IslandMark
          key={mark.island.repo}
          {...mark}
          files={files[i]}
          name={shortName(mark.island.name, base)}
          plate={plateOf(mark.stop)}
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
  name,
  files,
  plate,
  working,
  hovered,
  onHover,
}: Mark & {
  name: string
  plate: Plate
  working: number
  hovered: boolean
  onHover: (stop: Stop | null) => void
}) {
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
  const core = stop === HOME
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
      {/* The line from a plate set off from its island back to it: under every plate. */}
      <Label position={[0, 10, 0]} center zIndexRange={LEADER_Z}>
        <i
          className="island-leader"
          ref={(element) => {
            plate.leader = element
          }}
          style={{ "--accent": island.language.colour } as CSSProperties}
        />
      </Label>
      <Label position={[0, 10, 0]} center zIndexRange={hovered ? HOVER_Z : core ? CORE_Z : PLATE_Z}>
        <button
          type="button"
          className="island-mark"
          data-hover={hovered}
          data-core={core}
          style={{ "--accent": island.language.colour } as CSSProperties}
          ref={(element) => {
            plate.button = element
          }}
          onClick={(event) => {
            // A pip first opens into its plate (a tap on a phone); the plate flies there.
            if (event.currentTarget.dataset.shown === "false" && !hovered) {
              onHover(stop)
              return
            }
            islandView.go(stop)
          }}
          onMouseEnter={() => onHover(stop)}
          onMouseLeave={() => onHover(null)}
          title={`Fly to ${island.repo}`}
        >
          <i className="island-swatch" aria-hidden="true" />
          <span className="island-mark-name">{name}</span>
          {core && <span className="island-mark-core">core</span>}
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

/**
 * Over the adventurers' chips (scene/Adventurer.tsx, 20…0): on the map an island's name is what the
 * view is for, so a chip passing under it never covers it. The core's over the rest, a hovered plate's
 * over all, and the leader lines under them.
 */
const PLATE_Z: readonly [number, number] = [24, 21]
const CORE_Z: readonly [number, number] = [27, 25]
const HOVER_Z: readonly [number, number] = [30, 28]
const LEADER_Z: readonly [number, number] = [21, 20.5]
