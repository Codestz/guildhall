import { PALETTE } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { createStage } from "@guildhall/render"
import { holdStudioStyle } from "../browser/style.ts"
import { loadCatalog } from "../catalog.ts"
import type { Screen } from "../screens.ts"
import { biomeIds, exportJson, shadeTable } from "./colour.ts"
import { createPanel, type PanelState } from "./panel.ts"
import { palettePicks } from "./picks.ts"
import { createPreview, type Preview } from "./preview.ts"
import { addPaletteStyle } from "./style.ts"

const logger = log("studio:palette")

function el(tag: "div" | "aside" | "main", className: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  return node
}

/**
 * The palette tuner (`/palette`): every ramp as a row of three swatches, a picker for the one
 * clicked, and twelve library pieces (one per pack/category) recoloured live from their `_SWATCH` /
 * `_SHADE` attributes as the palette is edited or a biome's ramp swaps are previewed. Export shows the
 * edited palette.json to copy (the page cannot write files).
 */
export const palette: Screen = {
  id: "palette",
  title: "Palette",
  mount(host, ctx) {
    const style = holdStudioStyle()
    const removeStyle = addPaletteStyle()
    const shell = el("div", "gh gh-pal")
    const side = el("aside", "gh-panel gh-pal-side")
    const view = el("main", "gh-pal-view")
    const stageHost = el("div", "gh-pal-stage")
    const labelHost = el("div", "gh-pal-labels")
    view.append(stageHost, labelHost)
    shell.append(side, view)
    host.append(shell)

    const stage = createStage(stageHost)
    ctx.attach(stage)
    const biomes = Object.keys(PALETTE.biomes)
    const state: PanelState = {
      hexes: PALETTE.swatches.map((s) => s.hex),
      biome: biomes.includes("temperate") ? "temperate" : (biomes[0] ?? "temperate"),
      selected: null,
    }
    let preview: Preview | null = null
    let disposed = false

    const recolour = () => {
      preview?.recolour(shadeTable(state.hexes, biomeIds(PALETTE, state.biome)))
    }
    const panel = createPanel(PALETTE, side, view, {
      setHex(id, hex) {
        const hexes = [...state.hexes]
        hexes[id] = hex
        state.hexes = hexes
        panel.update(state)
        recolour()
      },
      select(id) {
        state.selected = id
        panel.update(state)
      },
      setBiome(biome) {
        state.biome = biome
        panel.update(state)
        recolour()
      },
      exportText: () => exportJson(PALETTE, state.hexes),
    })
    panel.update(state)

    const boot = async () => {
      const [catalog] = await Promise.all([loadCatalog(), style.ready])
      if (disposed || !catalog) return
      const cast = palettePicks(catalog).flatMap((e) => (e ? [e] : []))
      const built = await createPreview(stage, cast, labelHost)
      if (disposed) return built.dispose()
      preview = built
      recolour()
      logger.info("cast", { shown: cast.length, biome: state.biome, skipped: built.skipped })
    }
    ctx.load(boot()).catch((error: unknown) => logger.error("boot failed", { error: String(error) }))

    return () => {
      disposed = true
      preview?.dispose()
      panel.dispose()
      stage.dispose()
      shell.remove()
      removeStyle()
      style.release()
    }
  },
}
