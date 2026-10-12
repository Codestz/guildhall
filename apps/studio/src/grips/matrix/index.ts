import {
  applyOverlay,
  type CatalogEntry,
  type Mount,
  type MountSlot,
  type RigEntry,
  type Vec3,
} from "@guildhall/assets"
import { log } from "@guildhall/core"
import {
  attachMount,
  type Character,
  createStage,
  group,
  loadCharacter,
  loadPiece,
  measure,
  type Stage,
  testBox,
  toScreen,
} from "@guildhall/render"
import { libraryUrl, loadCatalog } from "../../catalog.ts"
import { loadOverlay } from "../../data.ts"
import type { Screen } from "../../screens.ts"
import { defaultMount } from "./defaults.ts"
import { type Column, type MatrixParams, parseParams } from "./params.ts"

const logger = log("studio:grips")

/** Cell pitch in metres: wide enough for a sideways blade, tall enough for a staff over the head. */
const DX = 2.6
const DY = 3.3
/** Bodies turned so the right hand and its swing face the camera, which looks straight down -z. */
const YAW = Math.PI / 4
/** Room round the grid in metres: row labels left, column heads above, hanging props below the feet. */
const GUTTER = { left: 4.2, top: 1.4, bottom: 1.2 }
/** Where a row's label sits, up from the row's feet. */
const ROW_LABEL_Y = 1.3
const MARGIN = 1.03

/** The axes row: one prop-space frame per hand, so the arrows show where each slot puts axis and edge. */
const AXES_MOUNT: Mount = { slot: "hand.r", hands: 1, handle: [0, 0, 0], axis: [0, 1, 0], edge: [1, 0, 0] }
const AXIS_LENGTH = 0.7
const AXIS_THICKNESS = 0.05

/** Label anchors: column heads hang above their point, row labels end left of theirs. */
const HEAD = "translate(-50%,-100%)"
const ROW = "translate(-100%,-50%)"

const LABEL_STYLE = [
  "position:absolute",
  "padding:2px 6px",
  "border-radius:4px",
  "background:rgba(21,17,13,0.78)",
  "color:#f3e9d4",
  "font:11px/1.35 ui-monospace,Menlo,monospace",
  "white-space:pre",
  "pointer-events:none",
].join(";")

/** One row of the matrix: a prop with its mount (authored or derived), or the slot-axes witness. */
interface Row {
  label: string
  /** "authored" (data/mounts.json), "default" (derived here), "axes", or "missing" (not in the catalog). */
  mount: "authored" | "default" | "axes" | "missing"
  entry?: CatalogEntry
}

type Node = ReturnType<typeof group>

/** A frame in prop space from thin bars: red = edge (+x), green = axis (+y), blue = edge × axis (+z). */
function axesProp(): Node {
  const bar = (axis: 0 | 1 | 2, colour: string) => {
    const box = testBox(1, colour)
    box.scale.set(...([0, 1, 2].map((i) => (i === axis ? AXIS_LENGTH : AXIS_THICKNESS)) as Vec3))
    box.position.set(...([0, 1, 2].map((i) => (i === axis ? AXIS_LENGTH / 2 : 0)) as Vec3))
    return box
  }
  return group("slot-axes", bar(0, "#d23a2a"), bar(1, "#2f9e44"), bar(2, "#2a62d2"))
}

/** The prop's mount: its authored one, else the bbox default (a fresh piece is in prop space). */
function mountFor(entry: CatalogEntry, piece: Node): Mount {
  if (entry.compose.mount) return entry.compose.mount
  const { size, centre } = measure(piece)
  return defaultMount(size, centre)
}

function rowsOf(params: MatrixParams, byId: ReadonlyMap<string, CatalogEntry>): Row[] {
  const entries =
    params.props === "held"
      ? [...byId.values()].filter((e) => e.compose.attach === "held").map((e) => ({ id: e.id, entry: e }))
      : params.props.map((id) => ({ id, entry: byId.get(id) }))
  const rows: Row[] = entries.map(({ id, entry }) =>
    entry
      ? { label: id, mount: entry.compose.mount ? "authored" : "default", entry }
      : { label: id, mount: "missing" },
  )
  return params.axes ? [{ label: "slot axes\nhand.r + hand.l", mount: "axes" }, ...rows] : rows
}

/** Where cell (row r of `rows`, column c) stands: row 0 on top, column 0 on the left. */
const cellAt = (r: number, c: number, rows: number): Vec3 => [c * DX, (rows - 1 - r) * DY, 0]

/** Frames the whole grid, gutters included, straight on. */
function aim(stage: Stage, cols: number, rows: number): void {
  const canvas = stage.renderer.domElement
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight)
  const [left, right] = [-DX / 2 - GUTTER.left, (cols - 0.5) * DX]
  const [bottom, top] = [-GUTTER.bottom, rows * DY + GUTTER.top]
  const half = (stage.camera.fov / 2) * (Math.PI / 180)
  const fit = Math.max((top - bottom) / 2, (right - left) / 2 / aspect) / Math.tan(half)
  const target: Vec3 = [(left + right) / 2, (bottom + top) / 2, 0]
  stage.setCamera({ target, azimuth: 0, elevation: 0, distance: fit * MARGIN })
}

/**
 * The grip matrix (`?screen=grips`, AC2.4): one small character per prop (rows) and key clip
 * (columns), each holding its prop by its mount. Props with no authored mount use a bbox default and
 * are labelled "default": the authoring queue. `?t=0.3,0.7` freezes each clip at those fractions (two
 * columns per clip) for deterministic shots; without it the clips play live. `?axes=1` adds a row of
 * bare slot frames on both hands, re-verifying SLOT_FRAMES: red is the edge, green the axis.
 */
export const grips: Screen = {
  id: "grips",
  title: "Grip matrix",
  mount(host, ctx) {
    const params = parseParams(ctx.query)
    const stage = createStage(host)
    ctx.attach(stage)
    const overlay = document.createElement("div")
    overlay.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none"
    host.append(overlay)
    const characters: Character[] = []
    const labels: { el: HTMLElement; at: Vec3 }[] = []
    let disposed = false

    /** A DOM label pinned to `at`; `anchor` is the CSS translate that hangs it off the point. */
    const label = (text: string, at: Vec3, anchor: string, data: Record<string, string>) => {
      const el = document.createElement("div")
      el.style.cssText = `${LABEL_STYLE};transform:${anchor}`
      el.textContent = text
      Object.assign(el.dataset, data)
      overlay.append(el)
      labels.push({ el, at })
    }

    const cell = async (body: CatalogEntry, rig: RigEntry, row: Row, column: Column, at: Vec3) => {
      if (row.mount === "missing") return
      const ch = await loadCharacter(body, rig, libraryUrl)
      ch.root.position.set(...at)
      ch.root.rotation.y = YAW
      if (!ch.play(column.clip, column.t === null ? {} : { t: column.t })) return
      if (row.mount === "axes") {
        for (const slot of ["hand.r", "hand.l"] as MountSlot[]) attachMount(ch, axesProp(), AXES_MOUNT, slot)
      } else if (row.entry) {
        const piece = await loadPiece(libraryUrl(row.entry.files.glb))
        attachMount(ch, piece, mountFor(row.entry, piece))
      }
      ch.update(0)
      if (disposed) return
      stage.scene.add(ch.root)
      characters.push(ch)
    }

    const build = async () => {
      const [catalog, data] = await Promise.all([loadCatalog(), loadOverlay()])
      if (disposed) return
      if (!catalog) {
        label("No library yet: run `bun import` first.", [0, 0, 0], "none", {})
        return
      }
      const byId = new Map(applyOverlay(catalog.all(), data).map((e) => [e.id, e]))
      const body = byId.get(params.body)
      const rig = body?.character ? catalog.rig(body.character.rig) : undefined
      const clips = new Set(rig?.clips.map((c) => c.name))
      const rows = rowsOf(params, byId)
      const top = rows.length * DY
      for (const [c, column] of params.columns.entries()) {
        const missing = !clips.has(column.clip)
        const time = column.t === null ? "live" : String(column.t)
        label(missing ? `${column.key}\nNO CLIP` : `${column.key}\n${time}`, [c * DX, top, 0], HEAD, {
          column: column.key,
          clip: column.clip,
          ...(missing ? { missing: "true" } : {}),
        })
      }
      for (const [r, row] of rows.entries()) {
        const y = cellAt(r, 0, rows.length)[1] + ROW_LABEL_Y
        label(`${row.label}\n${row.mount}`, [-DX / 2, y, 0], ROW, {
          prop: row.entry?.id ?? row.label,
          mount: row.mount,
        })
      }
      aim(stage, params.columns.length, rows.length)
      if (!body || !rig) {
        logger.error("no body", { body: params.body })
        return
      }
      await Promise.all(
        rows.flatMap((row, r) =>
          params.columns.map((column, c) => cell(body, rig, row, column, cellAt(r, c, rows.length))),
        ),
      )
      logger.info("matrix", {
        rows: rows.length,
        columns: params.columns.length,
        defaults: rows.filter((row) => row.mount === "default").map((row) => row.entry?.id),
        missing: rows.filter((row) => row.mount === "missing").map((row) => row.label),
      })
    }
    ctx.load(build()).catch((error: unknown) => logger.error("build failed", { error: String(error) }))

    const unsubscribe = stage.onFrame((dt) => {
      for (const ch of characters) ch.update(dt)
      for (const { el, at } of labels) {
        const point = toScreen(stage, at)
        el.style.display = point ? "" : "none"
        if (point) el.style.translate = `${point[0]}px ${point[1]}px`
      }
    })

    return () => {
      disposed = true
      unsubscribe()
      // Bodies and props are copies over the piece cache's geometry: take them out, never dispose it.
      for (const ch of characters) {
        ch.mixer.stopAllAction()
        ch.root.removeFromParent()
      }
      overlay.remove()
      stage.dispose()
    }
  },
}
