import type { CatalogEntry, CatalogIndex } from "@guildhall/assets"
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
  type Measure,
  measure,
  poseModel,
  type Stage,
  toScreen,
} from "@guildhall/render"
import type { Screen } from "../screens.ts"
import {
  type Baked,
  type BakeMode,
  bakedPart,
  COMPARE_DEPTH,
  INDEX_URL,
  parseBake,
  shardUrl,
} from "./bake.ts"
import { framePose, GAP, layoutSlots, parseFocus, type Span, stackLabels } from "./layout.ts"
import { LINEUP, type Slot } from "./pieces.ts"
import { SCALES } from "./scales.ts"

const logger = log("studio:lineup")

type Node = ReturnType<typeof group>
type RowKind = "raw" | "baked"

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

/** One slot built: the piece, its bounds before placement, and how it was scaled. */
interface Built {
  piece: Node
  measure: Measure
  factor: number
  baked: boolean
}

/** Raw part path → its baked piece; undefined when the importer has none for it. */
type Lookup = (pack: string, file: string) => Baked | undefined

const rawUrl = (file: string): string => `/raw/${file.split("/").map(encodeURIComponent).join("/")}`

/**
 * One slot's parts loaded and composed. Raw parts are scaled from raw units to metres by the pack
 * factor; baked parts are metres already, so only their raw-unit offsets follow the importer's
 * factor. A slot is baked only when every part has a baked piece; otherwise it stays raw.
 */
async function buildSlot(slot: Slot, anisotropy: number, lookup?: Lookup): Promise<Built> {
  const baked = slot.parts && lookup ? slot.parts.map((part) => lookup(slot.pack, part.file)) : undefined
  const useBaked = baked?.every((b) => b !== undefined) ?? false
  const factor = useBaked ? (baked?.[0]?.factor ?? 1) : SCALES[slot.pack].factor
  const parts = slot.parts
    ? await Promise.all(
        slot.parts.map(async ({ file, at, turn, pose }, i) => {
          const hit = useBaked ? baked?.[i] : undefined
          const model = await loadModel(hit ? hit.url : rawUrl(file), { anisotropy })
          if (at) model.position.set(...at).multiplyScalar(hit ? hit.factor : 1)
          model.rotation.y = ((turn ?? 0) * Math.PI) / 180
          if (pose && !poseModel(model, pose)) logger.warn("no such clip", { file, pose })
          return model
        }),
      )
    : [heroSilhouette(2.2)]
  const piece = group(`${slot.pack}:${slot.piece}`, ...parts)
  if (!useBaked) piece.scale.setScalar(factor)
  piece.traverse((node) => {
    node.castShadow = true
  })
  return { piece, measure: measure(piece), factor, baked: useBaked }
}

/**
 * The catalog shards of the lineup packs the library holds → one lookup. A pack the index does not
 * list (characters, or no import yet) stays raw.
 */
async function bakedLookup(): Promise<Lookup> {
  const res = await fetch(INDEX_URL).catch(() => undefined)
  const index = res?.ok ? ((await res.json()) as CatalogIndex) : undefined
  const imported = new Set(index?.packs.map((p) => p.id))
  const packs = [...new Set(LINEUP.map((s) => s.pack))].filter((pack) => imported.has(pack))
  const shards = new Map<string, CatalogEntry[]>()
  await Promise.all(
    packs.map(async (pack) => {
      const shard = await fetch(shardUrl(pack))
      if (shard.ok) shards.set(pack, (await shard.json()) as CatalogEntry[])
    }),
  )
  logger.info("catalog shards", { baked: [...shards.keys()] })
  return (pack, file) => bakedPart(file, shards.get(pack) ?? [])
}

async function buildRow(kind: RowKind, anisotropy: number): Promise<Built[]> {
  const lookup = kind === "baked" ? await bakedLookup() : undefined
  return Promise.all(LINEUP.map((slot) => buildSlot(slot, anisotropy, lookup)))
}

function labelText(slot: Slot, built: Built): string {
  const { name } = SCALES[slot.pack]
  const how = built.baked ? "baked" : "raw"
  return `${name}\n${slot.piece} · ×${built.factor} ${how} · ${built.measure.size[1].toFixed(1)} m`
}

/**
 * Real vendor pieces side by side on the 1 m grid, each scaled by its pack's factor and stood on
 * the ground, to calibrate scale and see the packs together. `?focus=<i>` (or `<i>-<j>`) frames one
 * slot (or a run of them). `?bake=1` shows the importer's baked pieces from `/library/` instead of
 * the raw files, `?bake=compare` both (baked one row behind), and the B key swaps raw and baked.
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
    const anisotropy = stage.renderer.capabilities.getMaxAnisotropy()
    const focus = ctx.query.get("focus")
    const rows = new Map<RowKind, Promise<Built[]>>()
    const row = (kind: RowKind): Promise<Built[]> => {
      let built = rows.get(kind)
      if (!built) {
        built = buildRow(kind, anisotropy)
        rows.set(kind, built)
      }
      return built
    }
    let mode = parseBake(ctx.query.get("bake"))
    let placed: Disposable | undefined
    let framed = false
    let disposed = false

    const show = async (next: BakeMode) => {
      const front = await row(next === "baked" ? "baked" : "raw")
      const back = next === "compare" ? await row("baked") : undefined
      if (disposed) return
      placed?.dispose()
      placed = place(stage, overlay, { front, back, focus, frame: !framed })
      framed = true
      mode = next
    }
    const run = (next: BakeMode) =>
      ctx.load(show(next)).catch((error: unknown) => logger.error("build failed", { error: String(error) }))
    run(mode)

    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b" || event.repeat || event.metaKey || event.ctrlKey) return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      run(mode === "baked" ? "raw" : "baked")
    }
    addEventListener("keydown", onKey)

    return () => {
      disposed = true
      removeEventListener("keydown", onKey)
      placed?.dispose()
      for (const built of rows.values())
        built.then(
          (all) => {
            for (const { piece } of all) disposeObject(piece)
          },
          () => {},
        )
      overlay.remove()
      stage.dispose()
    }
  },
}

interface Placement {
  /** The row on the front line, z = 0: it sets the slots. */
  front: Built[]
  /** Compare mode: a second row `COMPARE_DEPTH` behind, in the same slots. */
  back?: Built[]
  focus: string | null
  /** Aim the camera (first placement only, so a live swap keeps the user's view). */
  frame: boolean
}

/**
 * Lays the built rows out, adds the grid, shadows, hero references and labels, and (when asked)
 * aims the camera. The returned disposable takes all of it back out of the scene, leaving the built
 * pieces loaded for the next placement.
 */
function place(stage: Stage, overlay: HTMLElement, { front, back, focus, frame }: Placement): Disposable {
  const owned: Disposable[] = []
  const slots = layoutSlots(front.map((b) => b.measure.size[0]))
  const labels: { el: HTMLElement; at: [number, number, number] }[] = []
  const addLabel = (text: string, at: [number, number, number]) => {
    const el = document.createElement("div")
    el.style.cssText = LABEL_STYLE
    el.textContent = text
    overlay.append(el)
    labels.push({ el, at })
    owned.push({ dispose: () => el.remove() })
  }
  const lay = (row: Built[], z: number, label: (spec: Slot, built: Built) => string) => {
    for (const [i, built] of row.entries()) {
      const slot = slots[i]
      const spec = LINEUP[i]
      if (!slot || !spec) continue
      const m = built.measure
      built.piece.position.set(slot.centre - m.centre[0], -m.minY, z - m.centre[2])
      stage.scene.add(built.piece)
      owned.push({ dispose: () => built.piece.removeFromParent() })
      if (!BESIDE_HERO.has(spec.pack)) {
        // A 2.2 m reference in the gap left of the slot, at its front, so every door reads against a hero.
        const reference = heroSilhouette(2.2)
        reference.position.set(slot.start - GAP / 2, 0, z + m.size[2] / 2)
        reference.traverse((node) => {
          node.castShadow = true
        })
        stage.scene.add(reference)
        owned.push({ dispose: () => disposeObject(reference) })
      }
      addLabel(label(spec, built), [slot.centre, m.size[1] + LABEL_LIFT, z])
    }
  }
  lay(front, 0, labelText)
  if (back)
    lay(
      back,
      -COMPARE_DEPTH,
      (_, built) => `${built.baked ? "baked" : "raw"} · ${built.measure.size[1].toFixed(1)} m`,
    )

  const all = [...front, ...(back ?? [])].map((b) => b.measure)
  const last = slots.at(-1)
  const length = last ? last.start + last.width : 0
  const height = Math.max(...all.map((m) => m.size[1]))
  const depth = Math.max(...all.map((m) => m.size[2]))
  const behind = back ? COMPARE_DEPTH : 0
  owned.push(createGrid(stage, { size: 2 * Math.ceil(length + 4), cell: 1 }))
  owned.push(
    createShadows(stage, {
      min: [-2, 0, -behind - depth / 2 - 2],
      max: [length + 2, height + 1, depth / 2 + 2],
    }),
  )

  if (frame) {
    const range = parseFocus(focus, slots.length)
    const inRange = range
      ? all.filter((_, i) => i % front.length >= range[0] && i % front.length <= range[1])
      : all
    const span: Span = range
      ? {
          minX: slots[range[0]]?.start ?? 0,
          maxX: (slots[range[1]]?.start ?? 0) + (slots[range[1]]?.width ?? 0),
          height: Math.max(...inRange.map((m) => m.size[1])),
          depth: Math.max(...inRange.map((m) => m.size[2])) + 2 * behind,
        }
      : { minX: 0, maxX: length, height, depth: depth + 2 * behind }
    const canvas = stage.renderer.domElement
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight)
    stage.setCamera(framePose(span, { aspect, fov: stage.camera.fov, ...(range ? CLOSE : WIDE) }))
  }

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
  logger.info("placed", { slots: slots.length, length, back: Boolean(back) })
  return {
    dispose() {
      for (const item of owned.reverse()) item.dispose()
    },
  }
}
