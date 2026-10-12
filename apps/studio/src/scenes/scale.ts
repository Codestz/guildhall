import { DOOR_TOP, HERO_HEIGHT } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { createStage, createViewer, type Stage } from "@guildhall/render"
import { holdStudioStyle } from "../browser/style.ts"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import type { Screen } from "../screens.ts"
import { rowPose } from "./frame.ts"
import { type Pick, scalePicks } from "./picks.ts"

const logger = log("studio:scale")

/** Lower and more frontal than the viewer's default, so heights compare across the row. */
const VIEW = { azimuth: 12, elevation: 14, margin: 1.15 }
/** The viewer stands its hero just left of the origin; the row starts here. */
const ROW_START = -1.5
/** CSS pixels the legend takes from the left of the view (its width and both gutters). */
const LEGEND_PX = 344

/** Fits the row into the view right of the legend. */
function aim(stage: Stage, size: [number, number, number]): void {
  const canvas = stage.renderer.domElement
  const width = Math.max(1, canvas.clientWidth)
  const aspect = width / Math.max(1, canvas.clientHeight)
  const free = Math.max(0.3, 1 - LEGEND_PX / width)
  const row = { minX: ROW_START, maxX: size[0], height: size[1], depth: size[2] }
  const pose = rowPose(row, { ...VIEW, fov: stage.camera.fov, aspect: aspect * free })
  // Slide the target left by half the legend's share of the view, so the row centres in the free part.
  const halfH = Math.atan(Math.tan((stage.camera.fov / 2) * (Math.PI / 180)) * aspect)
  const viewWidth = 2 * Math.tan(halfH) * pose.distance
  pose.target[0] -= ((1 - free) / 2) * viewWidth
  stage.setCamera(pose)
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** The legend: the cast left to right with each height, and the door band's key. */
function legend(picks: readonly Pick[]): HTMLElement {
  const panel = el("aside", "gh gh-panel gh-legend")
  panel.append(el("p", "gh-eyebrow", "AC1.5 · scale"), el("h1", "", "One hero, three vendors"))
  const list = el("ol", "")
  list.append(row("·", "hero silhouette", `${HERO_HEIGHT.toFixed(2)} m`))
  let n = 0
  for (const pick of picks) {
    const item = pick.entry
      ? row(String(++n), pick.label, `${pick.entry.size[1].toFixed(2)} m`, pick.entry.name)
      : row("–", `${pick.label}: not in the library`, "")
    if (!pick.entry) item.dataset.missing = "true"
    if (pick.entry) item.title = pick.entry.id
    list.append(item)
  }
  const [low, high] = DOOR_TOP
  const key = el("div", "key")
  key.append(el("i", ""), document.createTextNode(`door tops ${low}–${high} m · 1 m grid`))
  panel.append(list, key)
  return panel
}

function row(n: string, label: string, value: string, detail?: string): HTMLLIElement {
  const item = el("li", "")
  const text = el("span", "", label)
  if (detail) text.append(el("small", "", detail))
  item.append(el("span", "n", n), text, el("span", "v", value))
  return item
}

/**
 * The scale scene (`?screen=scale`, AC1.5): the hero silhouette, a door, one house and one tree per
 * vendor, in a row on the 1 m grid with the door-top band behind them. The cast comes from the
 * catalog by rule (`picks.ts`); the legend lists it left to right.
 */
export const scale: Screen = {
  id: "scale",
  title: "Scale",
  mount(host, ctx) {
    const style = holdStudioStyle()
    const stage = createStage(host)
    ctx.attach(stage)
    const viewer = createViewer(stage, { gridSize: 120, overlay: { doorBand: true } })
    let panel: HTMLElement | null = null
    let disposed = false

    const build = async () => {
      const [catalog] = await Promise.all([loadCatalog(), style.ready])
      if (disposed) return
      if (!catalog) {
        panel = el("aside", "gh gh-panel gh-legend")
        panel.append(el("h1", "", "No library yet"), el("p", "", "Run `bun import` first."))
        host.append(panel)
        return
      }
      const picks = scalePicks(catalog)
      const cast = picks.flatMap((p) =>
        p.entry ? [{ url: libraryUrl(p.entry.files.glb), entry: p.entry }] : [],
      )
      await viewer.showMany(cast)
      if (disposed) return
      const shown = viewer.stats()
      if (shown) aim(stage, shown.size)
      panel = legend(picks)
      host.append(panel)
      logger.info("cast", { shown: cast.length, missing: picks.filter((p) => !p.entry).map((p) => p.label) })
    }
    ctx.load(build()).catch((error: unknown) => logger.error("build failed", { error: String(error) }))

    return () => {
      disposed = true
      panel?.remove()
      viewer.dispose()
      stage.dispose()
      style.release()
    }
  },
}
