import type { CameraPose, FrameStats } from "@guildhall/core"
import { log } from "@guildhall/core"
import { createStage, createSun, disposeObject, loadPiece, type SunStats, testBox } from "@guildhall/render"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import type { Screen } from "../screens.ts"
import { fieldPicks, fieldSlots, HALF, movePose, parseMove } from "./field.ts"

const logger = log("studio:shadows")

const POSE: CameraPose = { target: [0, 0, 0], azimuth: 35, elevation: 30, distance: 30 }
/** A low sun from the south-west, so shadows run long across the field. */
const SUN_DIR: [number, number, number] = [-0.64, 0.45, 0.62]
/** How many frames the overlay sums the shadow re-renders over. */
const WINDOW = 60

const PANEL_STYLE = [
  "position:absolute",
  "left:12px",
  "bottom:12px",
  "padding:6px 10px",
  "border-radius:4px",
  "background:rgba(21,17,13,0.78)",
  "color:#f3e9d4",
  "font:12px/1.5 ui-monospace,Menlo,monospace",
  "white-space:pre",
  "pointer-events:none",
].join(";")

/** The witness at the origin: a cube, a row of thin posts and a slab, all with crisp edges to read. */
function witness() {
  const cube = testBox(1, "#b5523b")
  cube.position.set(-3, 0.5, 2)
  const slab = testBox(1, "#4f7a8c")
  slab.scale.set(3, 2.5, 0.3)
  slab.position.set(2, 1.25, -2)
  const posts = [0, 1, 2, 3, 4].map((i) => {
    const post = testBox(1, "#c99a3c")
    post.scale.set(0.15, 3, 0.15)
    post.position.set(-1 + i * 0.6, 1.5, -0.5)
    return post
  })
  return [cube, slab, ...posts]
}

/**
 * The shadows test screen (`?screen=shadows`, R1 / ADR 009): a 200 m field of library pieces (boxes
 * when there is no library) round a witness of crisp boxes at the origin, under the stable cascaded
 * sun. `?move=pan|orbit|zoom` scripts the camera; `bun shots --camera` poses it. The panel and
 * `guildhall.ext.shadows.stats()` count the cascade maps re-rendered: none on a still camera.
 */
export const shadows: Screen = {
  id: "shadows",
  title: "Shadows",
  mount(host, ctx) {
    const stage = createStage(host)
    ctx.attach(stage)
    stage.setCamera(POSE)
    stage.sun.position.set(...SUN_DIR)
    stage.sun.target.position.set(0, 0, 0)

    const ground = testBox(1, "#8f9a6a")
    ground.scale.set(HALF * 2 + 20, 1, HALF * 2 + 20)
    ground.position.y = -0.5
    const objects = [ground, ...witness()]
    for (const object of objects) {
      object.castShadow = true
      object.receiveShadow = true
    }
    stage.scene.add(...objects)
    const sun = createSun(stage, {
      town: { min: [-HALF - 10, 0, -HALF - 10], max: [HALF + 10, 25, HALF + 10] },
    })
    const placed: ReturnType<typeof testBox>[] = []
    let disposed = false

    const build = async () => {
      const catalog = await loadCatalog()
      const picks = catalog ? fieldPicks(catalog.all()) : []
      const slots = fieldSlots(7, Math.max(1, picks.length))
      const pieces = await Promise.all(
        slots.map(async (slot) => {
          const pick = picks[slot.pick]
          const piece = pick
            ? await loadPiece(libraryUrl(pick.files.glb))
            : testBox(1 + (slot.pick % 3), "#9a8f7c")
          piece.position.set(slot.x, piece.position.y, slot.z)
          piece.rotation.y = (slot.turn * Math.PI) / 180
          return piece
        }),
      )
      if (disposed) return
      for (const piece of pieces) {
        piece.traverse((node) => {
          node.castShadow = true
          node.receiveShadow = true
        })
      }
      placed.push(...pieces)
      stage.scene.add(...pieces)
      sun.markDirty()
      logger.info("field", { pieces: pieces.length, kinds: picks.length })
    }
    ctx.load(build()).catch((error: unknown) => logger.error("build failed", { error: String(error) }))

    const panel = document.createElement("div")
    panel.style.cssText = PANEL_STYLE
    host.append(panel)
    const recent: number[] = []
    let frame = 0
    const move = parseMove(ctx.query.get("move"))
    let t = 0
    const unsubscribe = stage.onFrame((dt) => {
      if (move) {
        t += dt
        stage.setCamera(movePose(move, POSE, t))
      }
      // The sun's stats are the frame drawn before this one.
      const s = sun.stats()
      recent.push(s.renders)
      if (recent.length > WINDOW) recent.shift()
      if (frame++ % 10 === 0) panel.textContent = describe(s, stage.stats(), recent, stage.getCamera())
    })
    const ext = window.guildhall?.ext
    if (ext) ext.shadows = { stats: () => ({ ...sun.stats(), recent: recent.reduce((a, b) => a + b, 0) }) }

    return () => {
      disposed = true
      if (ext) delete ext.shadows
      unsubscribe()
      panel.remove()
      sun.dispose()
      for (const piece of placed) piece.removeFromParent()
      for (const object of objects) disposeObject(object)
      stage.dispose()
    }
  },
}

function describe(s: SunStats, f: FrameStats, recent: readonly number[], pose: CameraPose): string {
  const sum = recent.reduce((a, b) => a + b, 0)
  const [x, y, z] = pose.target.map((v) => v.toFixed(2))
  return [
    `shadow maps re-rendered: ${s.renders} last frame · ${sum} in ${recent.length} · ${s.total} in all`,
    `draws last frame: shadow ${f.shadowCalls ?? "?"} calls · ${f.shadowTris ?? "?"} tris · main ${f.mainCalls ?? "?"} calls`,
    `camera: target ${x},${y},${z} · az ${pose.azimuth.toFixed(1)} el ${pose.elevation.toFixed(1)} · ${pose.distance.toFixed(1)} m`,
  ].join("\n")
}
