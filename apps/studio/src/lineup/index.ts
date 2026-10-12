import { log } from "@guildhall/core"
import {
  createGrid,
  createShadows,
  createStage,
  type Disposable,
  disposeObject,
  group,
  heroSilhouette,
  loadModel,
  measure,
  poseModel,
  type Stage,
  toScreen,
} from "@guildhall/render"
import type { Screen } from "../screens.ts"
import { framePose, GAP, layoutSlots, parseFocus, type Span, stackLabels } from "./layout.ts"
import { LINEUP, type Slot } from "./pieces.ts"
import { SCALES } from "./scales.ts"

const logger = log("studio:lineup")

type Node = ReturnType<typeof group>

/** Slots already standing beside the hero silhouette: they get no extra reference. */
const BESIDE_HERO: ReadonlySet<string> = new Set(["hero", "kaykit-adventurers"])

/** The overall 3/4 view; a focus comes in a little lower, closer to eye height. */
const WIDE = { azimuth: 22, elevation: 22 }
const CLOSE = { azimuth: 24, elevation: 12 }
/** How far a label floats above its piece. */
const LABEL_LIFT = 0.5

const LABEL_STYLE = [
  "position:absolute",
  "transform:translate(-50%,-100%)",
  "padding:2px 7px",
  "border-radius:4px",
  "background:rgba(21,17,13,0.78)",
  "color:#f3e9d4",
  "font:11px/1.35 ui-monospace,Menlo,monospace",
  "white-space:pre",
  "text-align:center",
  "pointer-events:none",
].join(";")

/** One slot's parts loaded and composed, then scaled from raw units to metres. */
async function buildSlot(slot: Slot, anisotropy: number) {
  const { factor } = SCALES[slot.pack]
  const parts = slot.parts
    ? await Promise.all(
        slot.parts.map(async ({ file, at, turn, pose }) => {
          const model = await loadModel(`/raw/${file.split("/").map(encodeURIComponent).join("/")}`, {
            anisotropy,
          })
          if (at) model.position.set(...at)
          model.rotation.y = ((turn ?? 0) * Math.PI) / 180
          if (pose && !poseModel(model, pose)) logger.warn("no such clip", { file, pose })
          return model
        }),
      )
    : [heroSilhouette(2.2)]
  const piece = group(`${slot.pack}:${slot.piece}`, ...parts)
  piece.scale.setScalar(factor)
  piece.traverse((node) => {
    node.castShadow = true
  })
  return piece
}

function labelText(slot: Slot, height: number): string {
  const { name, factor } = SCALES[slot.pack]
  return `${name}\n${slot.piece} · ×${factor} · ${height.toFixed(1)} m`
}

/**
 * Real raw vendor pieces side by side on the 1 m grid, each scaled by its pack's factor and stood on
 * the ground, to calibrate scale and see the packs together before the import pipeline exists.
 * `?focus=<i>` (or `<i>-<j>`) frames one slot (or a run of them).
 */
export const lineup: Screen = {
  id: "lineup",
  title: "Raw lineup",
  mount(host, ctx) {
    const stage = createStage(host)
    ctx.attach(stage)
    const overlay = document.createElement("div")
    overlay.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none"
    host.append(overlay)
    const owned: Disposable[] = []
    const pieces: Node[] = []
    let disposed = false

    const build = async () => {
      const anisotropy = stage.renderer.capabilities.getMaxAnisotropy()
      const built = await Promise.all(LINEUP.map((slot) => buildSlot(slot, anisotropy)))
      if (disposed) {
        for (const piece of built) disposeObject(piece)
        return
      }
      pieces.push(...built, ...place(stage, built, overlay, owned, ctx.query.get("focus")))
    }
    ctx.load(build()).catch((error: unknown) => logger.error("build failed", { error: String(error) }))

    return () => {
      disposed = true
      for (const piece of pieces) disposeObject(piece)
      for (const item of owned) item.dispose()
      overlay.remove()
      stage.dispose()
    }
  },
}

/**
 * Lays the built pieces out, adds the grid, shadows and labels, and aims the camera. Returns the
 * hero references it stood beside the pieces, for the caller to dispose with them.
 */
function place(
  stage: Stage,
  pieces: Node[],
  overlay: HTMLElement,
  owned: Disposable[],
  focus: string | null,
): Node[] {
  const references: Node[] = []
  const measures = pieces.map((piece) => measure(piece))
  const slots = layoutSlots(measures.map((m) => m.size[0]))
  const labels: { el: HTMLElement; at: [number, number, number] }[] = []
  for (const [i, piece] of pieces.entries()) {
    const m = measures[i]
    const slot = slots[i]
    const spec = LINEUP[i]
    if (!m || !slot || !spec) continue
    piece.position.set(slot.centre - m.centre[0], -m.minY, -m.centre[2])
    stage.scene.add(piece)
    if (!BESIDE_HERO.has(spec.pack)) {
      // A 2.2 m reference in the gap left of the slot, at its front, so every door reads against a hero.
      const reference = heroSilhouette(2.2)
      reference.position.set(slot.start - GAP / 2, 0, m.size[2] / 2)
      reference.traverse((node) => {
        node.castShadow = true
      })
      stage.scene.add(reference)
      references.push(reference)
    }
    const el = document.createElement("div")
    el.style.cssText = LABEL_STYLE
    el.textContent = labelText(spec, m.size[1])
    overlay.append(el)
    labels.push({ el, at: [slot.centre, m.size[1] + LABEL_LIFT, 0] })
  }

  const last = slots.at(-1)
  const length = last ? last.start + last.width : 0
  const height = Math.max(...measures.map((m) => m.size[1]))
  const depth = Math.max(...measures.map((m) => m.size[2]))
  owned.push(createGrid(stage, { size: 2 * Math.ceil(length + 4), cell: 1 }))
  owned.push(
    createShadows(stage, { min: [-2, 0, -depth / 2 - 2], max: [length + 2, height + 1, depth / 2 + 2] }),
  )

  const range = parseFocus(focus, slots.length)
  const span: Span = range
    ? {
        minX: slots[range[0]]?.start ?? 0,
        maxX: (slots[range[1]]?.start ?? 0) + (slots[range[1]]?.width ?? 0),
        height: Math.max(...measures.slice(range[0], range[1] + 1).map((m) => m.size[1])),
        depth: Math.max(...measures.slice(range[0], range[1] + 1).map((m) => m.size[2])),
      }
    : { minX: 0, maxX: length, height, depth }
  const canvas = stage.renderer.domElement
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight)
  stage.setCamera(framePose(span, { aspect, fov: stage.camera.fov, ...(range ? CLOSE : WIDE) }))

  const unsubscribe = stage.onFrame(() => {
    const shown = labels.flatMap(({ el, at }) => {
      const point = toScreen(stage, at)
      el.style.display = point ? "" : "none"
      return point ? [{ el, x: point[0], y: point[1], w: el.offsetWidth, h: el.offsetHeight }] : []
    })
    const ys = stackLabels(shown)
    for (const [i, { el, x }] of shown.entries()) el.style.translate = `${x}px ${ys[i]}px`
  })
  owned.push({ dispose: unsubscribe })
  logger.info("placed", { slots: slots.length, length, focus: range })
  return references
}
