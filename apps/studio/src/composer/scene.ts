/**
 * The composer's 3D side: the compiled prefab (or a strip of seed variants) on the 1 m grid beside the
 * hero, under the stable cascaded sun (ADR 009), with panel clicks and the dressing gizmo. Every three
 * object comes from @guildhall/render; picking is screen-space (pick.ts).
 */
import { type Catalog, type HouseBlueprint, type PrefabMeta, type Recipe, SNAP } from "@guildhall/assets"
import { type CameraPose, log } from "@guildhall/core"
import {
  createGizmo,
  createGrid,
  createStage,
  createSun,
  disposeObject,
  type GizmoMode,
  type GizmoPose,
  group,
  heroSilhouette,
  loadPiece,
  measure,
  poseToCamera,
  recipeObject,
  type Stage,
  testBox,
  toScreen,
} from "@guildhall/render"
import { libraryUrl } from "../catalog.ts"
import type { Slot } from "./model.ts"
import { boxCorners, panelFaces, pickDressing, pickPanel, type Vec3 } from "./pick.ts"

const logger = log("studio:composer")

/** One prefab on the stage: its compiled recipe and meta, and the label a strip shows over it. */
export interface View {
  recipe: Recipe
  meta: PrefabMeta
  label: string
}

/** What a click on the single view can hit: its blueprint's panels and the dressing after the house parts. */
export interface Pickable {
  house?: HouseBlueprint
  /** The recipe index of the first dressing instance (house parts come first). */
  dressingStart: number
}

export interface SceneEvents {
  /** A panel was clicked; `back` with shift held. */
  panel(slot: Slot, back: boolean): void
  /** A dressing piece was clicked (its dressing index), or empty ground (null). */
  pick(dressing: number | null): void
  /** A gizmo drag ended with the piece here (snapped). */
  moved(dressing: number, pose: GizmoPose): void
}

export interface ComposerScene {
  stage: Stage
  /** Replaces what stands on the stage; resolves once drawn. `pick` is for a single view only. */
  show(views: View[], pick: Pickable | null): Promise<void>
  /** Aims the camera at everything shown. */
  frame(): void
  /** Puts the gizmo on a dressing piece of the single view (null: none). */
  select(dressing: number | null): void
  setMode(mode: GizmoMode): void
  dispose(): void
}

/** Between strip variants, metres. */
const GAP = 3
/** The hero stands this far off the house's front-left corner. */
const HERO_AT = { x: -1, z: 0.8 }
/** A low golden sun from the front-left, so fronts are lit and shadows fall back and right. */
const SUN_DIR: Vec3 = [-0.5, 0.55, 0.67]
/** Shadow span: the composer never shows more than a strip of six large houses. */
const TOWN = { min: [-60, 0, -20] as Vec3, max: [60, 16, 20] as Vec3 }
/** A press that moves further than this (CSS px) is an orbit, not a click. */
const CLICK_SLOP = 4
const SNAPS: Record<GizmoMode, { coarse: number; fine: number }> = {
  translate: { coarse: SNAP.grid, fine: SNAP.fine },
  rotate: { coarse: (SNAP.turn * 180) / Math.PI, fine: (SNAP.fineTurn * 180) / Math.PI },
}

const LABEL_STYLE = [
  "position:absolute",
  "transform:translate(-50%,-100%)",
  "padding:2px 8px",
  "border-radius:5px",
  "border:1px solid rgba(220,182,98,0.34)",
  "background:rgba(20,15,11,0.82)",
  "color:#f3e9d4",
  "font:11px/1.45 'JetBrains Mono',ui-monospace,Menlo,monospace",
  "white-space:pre",
  "text-align:center",
  "pointer-events:none",
].join(";")

type Node = ReturnType<typeof group>

/** The distance at which `width` metres fill the view across, with a margin. */
const fitWidth = (width: number, fovDeg: number, aspect: number): number =>
  (width * 0.55) / (Math.tan((fovDeg * Math.PI) / 360) * aspect)

export function createComposerScene(host: HTMLElement, catalog: Catalog, events: SceneEvents): ComposerScene {
  const stage = createStage(host)
  stage.sun.position.set(...SUN_DIR)
  stage.sun.target.position.set(0, 0, 0)
  const ground = testBox(1, "#a39a84")
  ground.scale.set(400, 1, 400)
  ground.position.y = -0.505
  ground.receiveShadow = true
  stage.scene.add(ground)
  const grid = createGrid(stage, { size: 120, cell: 1 })
  const hero = heroSilhouette(2.2)
  hero.traverse((node) => {
    node.castShadow = true
  })
  stage.scene.add(hero)
  const sun = createSun(stage, { town: TOWN, radii: [24, 80], mapSize: 2048 })

  const pieces = (id: string) => {
    const entry = catalog.get(id)
    if (!entry) return Promise.reject(new Error(`no catalog piece "${id}"`))
    return loadPiece(libraryUrl(entry.files.glb))
  }

  let root: Node | null = null
  let shown: { views: View[]; offsets: number[]; pick: Pickable | null } = {
    views: [],
    offsets: [],
    pick: null,
  }
  let generation = 0
  let labels: HTMLElement[] = []

  // ── gizmo: a drag lands in `pending` and is committed on release, so a rebuild never cuts it short.
  let selected: number | null = null
  let mode: GizmoMode = "translate"
  let fine = false
  let pending: GizmoPose | null = null
  let dragged = false
  const gizmo = createGizmo(stage, {
    mode,
    snap: SNAPS[mode].coarse,
    onChange(pose) {
      pending = pose
      dragged = true
    },
  })
  const applySnap = () => gizmo.setSnap(fine ? SNAPS[mode].fine : SNAPS[mode].coarse)

  const dressingNode = (i: number | null) => {
    if (i === null || !root || !shown.pick) return null
    return root.children[0]?.children[shown.pick.dressingStart + i] ?? null
  }
  const attach = () => {
    const node = dressingNode(selected)
    if (node) gizmo.attach(node)
    else gizmo.detach()
  }

  // ── clicks: recorded on the host in the capture phase, before the gizmo or the orbit see the press.
  const canvas = stage.renderer.domElement
  let press: { x: number; y: number } | null = null
  const down = (e: PointerEvent) => {
    press = { x: e.clientX, y: e.clientY }
    dragged = false
  }
  const up = () => {
    if (!pending || selected === null) return
    const pose = pending
    const i = selected
    pending = null
    // After the gizmo's own pointerup has run.
    setTimeout(() => events.moved(i, pose), 0)
  }
  const click = (e: MouseEvent) => {
    const moved = press ? Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP : false
    // A gizmo drag ends in a click on the canvas too: it must not re-pick what is under the handle.
    if (dragged || moved || !shown.pick) {
      dragged = false
      return
    }
    const rect = canvas.getBoundingClientRect()
    const at: [number, number] = [e.clientX - rect.left, e.clientY - rect.top]
    const eye = poseToCamera(stage.getCamera())
    const project = (p: Vec3) => toScreen(stage, p)
    const dressing = shownDressingBoxes()
    const hit = pickDressing(dressing, eye, project, at)
    if (hit !== null) return events.pick(hit)
    const slot = shown.pick.house ? pickPanel(panelFaces(shown.pick.house), eye, project, at) : null
    if (slot) return events.panel(slot, e.shiftKey)
    events.pick(null)
  }
  const shownDressingBoxes = () => {
    const pick = shown.pick
    const house = root?.children[0]
    if (!pick || !house) return []
    return house.children.slice(pick.dressingStart).map((node) => {
      const m = measure(node)
      return { corners: boxCorners(m.centre, m.size), at: m.centre }
    })
  }
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Alt") {
      fine = e.type === "keydown"
      applySnap()
    }
  }
  host.addEventListener("pointerdown", down, { capture: true })
  host.addEventListener("pointerup", up, { capture: true })
  canvas.addEventListener("click", click)
  addEventListener("keydown", keys)
  addEventListener("keyup", keys)

  const unsubscribe = stage.onFrame(() => {
    shown.views.forEach((view, i) => {
      const label = labels[i]
      if (!label) return
      const x = shown.offsets[i] ?? 0
      const p = toScreen(stage, [x, view.meta.height + 0.6, 0])
      label.style.display = p ? "block" : "none"
      if (p) label.style.transform = `translate(${p[0]}px,${p[1]}px) translate(-50%,-100%)`
    })
  })

  const scene: ComposerScene = {
    stage,
    async show(views, pick) {
      const mine = ++generation
      const built = await Promise.all(views.map((v) => recipeObject(v.recipe, pieces)))
      if (mine !== generation) return
      const offsets: number[] = []
      const total = views.reduce((sum, v) => sum + v.meta.frontage, 0) + GAP * Math.max(0, views.length - 1)
      let cursor = -total / 2
      for (const [i, node] of built.entries()) {
        const view = views[i] as View
        offsets.push(cursor + view.meta.frontage / 2)
        cursor += view.meta.frontage + GAP
        node.position.x = offsets[i] as number
        node.traverse((child) => {
          child.castShadow = true
          child.receiveShadow = true
        })
      }
      gizmo.detach()
      root?.removeFromParent()
      root = group("composer", ...built)
      stage.scene.add(root)
      shown = { views, offsets, pick: views.length === 1 ? pick : null }
      const first = views[0]
      if (first) hero.position.set(-total / 2 + HERO_AT.x, 0, first.meta.depth / 2 + HERO_AT.z)
      for (const label of labels) label.remove()
      labels =
        views.length > 1
          ? views.map((v) => {
              const label = document.createElement("div")
              label.style.cssText = LABEL_STYLE
              label.style.left = "0"
              label.style.top = "0"
              label.textContent = v.label
              host.append(label)
              return label
            })
          : []
      attach()
      sun.markDirty()
      logger.debug("shown", { views: views.length, instances: views.map((v) => v.recipe.instances.length) })
    },
    frame() {
      const { views } = shown
      if (views.length === 0) return
      const width = views.reduce((sum, v) => sum + v.meta.frontage, 0) + GAP * (views.length - 1) + 2
      const height = Math.max(...views.map((v) => v.meta.height))
      const depth = Math.max(...views.map((v) => v.meta.depth))
      const single = views.length === 1
      const pose: CameraPose = {
        target: [single ? -0.6 : 0, height * 0.42, 0],
        azimuth: single ? 28 : 0,
        elevation: single ? 16 : 12,
        distance: single
          ? Math.max(9, Math.max(width * 1.15, height * 2.1) + depth * 0.6)
          : fitWidth(width, stage.camera.fov, stage.camera.aspect) + depth,
      }
      stage.setCamera(pose)
    },
    select(i) {
      selected = i
      pending = null
      attach()
    },
    setMode(next) {
      mode = next
      gizmo.setMode(next)
      applySnap()
    },
    dispose() {
      generation++
      unsubscribe()
      host.removeEventListener("pointerdown", down, { capture: true })
      host.removeEventListener("pointerup", up, { capture: true })
      canvas.removeEventListener("click", click)
      removeEventListener("keydown", keys)
      removeEventListener("keyup", keys)
      for (const label of labels) label.remove()
      gizmo.dispose()
      sun.dispose()
      root?.removeFromParent()
      grid.dispose()
      disposeObject(hero)
      disposeObject(ground)
      stage.dispose()
    },
  }
  return scene
}
