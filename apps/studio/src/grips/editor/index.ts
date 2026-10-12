import { type Catalog, type Mount, validateMount, validateMounts } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { holdStudioStyle } from "../../browser/style.ts"
import { loadCatalog } from "../../catalog.ts"
import { loadOverlay, saveMounts } from "../../data.ts"
import type { Screen } from "../../screens.ts"
import { createPanel, type PanelState } from "./panel.ts"
import * as edit from "./state.ts"
import { addGripStyle } from "./style.ts"
import { createGripView, type StripTile } from "./view.ts"

const logger = log("studio:grip")

function el(
  tag: "div" | "aside" | "main" | "section" | "p" | "img" | "span" | "i",
  className = "",
  text?: string,
) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * The grip editor (`?screen=grip&piece=<id>&body=<id>&clip=<name>&t=<0..1>`, ADR 010): pick a prop and
 * a body and freeze a clip, then edit the prop's mount (slot, handle, working axis and strike edge,
 * upright, scale, the current clip's override) and watch it on the character, on the prop's bench
 * and in a strip of key clips. Save merges the mount into `data/mounts.json`.
 * `guildhall.ext.grip` reads and sets the mount and saves, for scripted authoring.
 */
export const grip: Screen = {
  id: "grip",
  title: "Grip editor",
  mount(host, ctx) {
    const style = holdStudioStyle()
    const removeStyle = addGripStyle()
    const shell = el("div", "gh gh-grip")
    const side = el("aside", "gh-panel gh-grip-side")
    const view = el("main", "gh-grip-view")
    const mainHost = el("div", "gh-grip-main")
    const benchPanel = el("section", "gh-panel gh-grip-bench")
    const benchHost = el("div", "gh-grip-bench-host")
    const legend = el("div", "gh-grip-legend")
    for (const [name, colour] of [
      ["axis", "#58c46a"],
      ["edge", "#e0503c"],
      ["up", "#4f8fe8"],
      ["handle", "#f1d590"],
    ]) {
      const item = el("span", "", name)
      const swatch = el("i")
      swatch.style.background = colour as string
      item.prepend(swatch)
      legend.append(item)
    }
    benchPanel.append(el("p", "gh-eyebrow", "Prop space"), benchHost, legend)
    mainHost.append(benchPanel)
    const stripHost = el("div", "gh-grip-strip")
    view.append(mainHost, stripHost)
    shell.append(side, view)
    host.append(shell)

    const query = edit.parseQuery(ctx.query)
    let catalog: Catalog | null = null
    let saved: Record<string, Mount> | undefined
    let search = ""
    const state: PanelState = {
      piece: null,
      props: [],
      holdable: true,
      bodies: [],
      body: query.body,
      clips: [],
      clip: query.clip,
      t: query.t,
      mount: edit.defaultMount(),
      problems: [],
      status: "",
      saving: false,
    }
    let disposed = false

    const tiles = new Map<string, HTMLImageElement>()
    const drawStrip = (next: readonly StripTile[]) => {
      for (const tile of next) {
        let img = tiles.get(tile.clip)
        if (!img) {
          const box = el("section", "gh-panel gh-grip-tile")
          img = el("img") as HTMLImageElement
          img.alt = tile.label
          box.append(el("p", "gh-eyebrow", `${tile.label} · ${tile.clip}`), img)
          stripHost.append(box)
          tiles.set(tile.clip, img)
        }
        if (tile.url) img.src = tile.url
      }
    }

    const gripView = createGripView(mainHost, benchHost, {
      onHandle: (handle) => change(edit.setHandle(state.mount, handle)),
      onStrip: drawStrip,
      track: (work) => ctx.load(work),
    })
    ctx.attach(gripView.stage)

    const render = () => panel.update(state)

    /** A new mount: validated live, then shown everywhere. */
    function change(next: Mount, clipOnly = false) {
      state.mount = next
      state.problems = validateMount(next)
      state.status = ""
      gripView.setMount(next, { clipOnly })
      render()
    }

    const listProps = () => {
      state.props = catalog ? edit.propChoices(catalog.all(), search, state.holdable) : []
    }

    /** (Re)loads the prop into the body's hand, from the saved mount if there is one. */
    const open = async (pieceId: string, bodyId: string) => {
      if (!catalog) return
      const piece = catalog.get(pieceId)
      const body = catalog.get(bodyId)
      const rig = catalog.rig(body?.character?.rig ?? edit.RIG)
      if (!piece || !body || !rig) {
        state.problems = [
          `not in the catalog: ${[!piece && pieceId, !body && bodyId, !rig && edit.RIG].filter(Boolean).join(", ")}`,
        ]
        render()
        return
      }
      state.piece = piece
      state.body = body.id
      state.clips = rig.clips.map((c) => c.name)
      state.mount = edit.startMount(piece.id, saved, piece)
      state.problems = validateMount(state.mount)
      state.status = ""
      render()
      await gripView.load(piece, body, rig, state.mount)
      if (disposed) return
      if (!gripView.play(state.clip, state.t)) {
        state.clip = state.clips.includes("Idle_A") ? "Idle_A" : (state.clips[0] ?? "")
        gripView.play(state.clip, state.t)
      }
      gripView.frame()
      render()
      logger.info("opened", { piece: piece.id, body: body.id, clip: state.clip, t: state.t })
    }

    const save = async () => {
      if (!state.piece) return
      state.saving = true
      state.status = "saving…"
      render()
      try {
        // saveMounts replaces the whole file: re-read it so edits saved elsewhere are kept.
        saved = (await loadOverlay()).mounts
        const file = edit.mergeMount(saved, state.piece.id, state.mount)
        const problems = validateMounts(file)
        const result =
          problems.length > 0 ? { ok: false as const, status: 0, problems } : await saveMounts(file)
        if (result.ok) {
          saved = file.mounts
          state.problems = []
          state.status = `Saved ${state.piece.id} (${Object.keys(file.mounts).length} mounts).`
        } else {
          state.problems = result.problems
          state.status = result.status ? `Not saved (HTTP ${result.status}).` : "Not saved."
        }
      } catch (error) {
        state.problems = [String(error)]
        state.status = "Not saved."
      } finally {
        state.saving = false
        render()
      }
    }

    const panel = createPanel(side, {
      search(text, holdable) {
        search = text
        state.holdable = holdable
        listProps()
        render()
      },
      pickProp: (id) => void ctx.load(open(id, state.body)),
      pickBody: (id) => void ctx.load(open(state.piece?.id ?? query.piece, id)),
      pickClip(clip) {
        state.clip = clip
        gripView.play(clip, state.t)
        gripView.frame()
        render()
      },
      scrub(t) {
        state.t = t
        gripView.play(state.clip, t)
        render()
      },
      slot: (choice) => change(edit.setSlot(state.mount, choice)),
      handle: (handle) => change(edit.setHandle(state.mount, handle)),
      axis: (name) => change(edit.setAxis(state.mount, name)),
      edge: (name) => change(edit.setEdge(state.mount, name)),
      twist: (deg) => change(edit.twist(state.mount, deg)),
      tilt: (deg) => change(edit.tilt(state.mount, deg)),
      upright: (up) => change(edit.setUpright(state.mount, up)),
      scale: (k) => change(edit.setScale(state.mount, k)),
      clip: (c) => change(edit.setClip(state.mount, state.clip, c), true),
      save: () => void ctx.load(save()),
    })
    render()

    const boot = async () => {
      const [loaded, overlay] = await Promise.all([
        loadCatalog(),
        loadOverlay().catch(() => ({})),
        style.ready,
      ])
      if (disposed) return
      if (!loaded) {
        state.problems = ["no library: run bun import"]
        render()
        return
      }
      catalog = loaded
      saved = (overlay as { mounts?: Record<string, Mount> }).mounts
      state.bodies = edit.bodyChoices(loaded.all())
      // A prop the link names stays findable even when it is not tagged held or worn.
      const named = loaded.get(query.piece)
      if (named && named.compose.attach !== "held" && named.compose.attach !== "worn") state.holdable = false
      listProps()
      await open(query.piece, query.body)
    }
    ctx.load(boot()).catch((error: unknown) => logger.error("boot failed", { error: String(error) }))

    const ext = window.guildhall?.ext
    if (ext)
      ext.grip = {
        mount: () => structuredClone(state.mount),
        set: (m: Mount) => change(structuredClone(m)),
        save: () => ctx.load(save()).then(() => ({ status: state.status, problems: [...state.problems] })),
      }

    return () => {
      disposed = true
      if (ext) delete ext.grip
      panel.dispose()
      gripView.dispose()
      shell.remove()
      removeStyle()
      style.release()
    }
  },
}
