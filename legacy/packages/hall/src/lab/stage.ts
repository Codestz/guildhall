import {
  AmbientLight,
  Box3,
  CircleGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"

/**
 * The labs' shared bench (dev and probe only): a plain lit scene on a ground disc, drawn from four
 * sides at once into one window — front, right side, three-quarters, and the diorama's own angle —
 * so one screenshot shows a thing from every side that matters. No island, no post: it loads as
 * fast as the asset it shows.
 */

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
const cache = new Map<string, Promise<GLTF>>()
/** A glTF, fetched once per URL. */
export function load(url: string): Promise<GLTF> {
  let hit = cache.get(url)
  if (!hit) {
    hit = loader.loadAsync(url)
    cache.set(url, hit)
  }
  return hit
}

/** The four views: the camera's way from the subject (which faces +z). */
export const VIEWS: readonly [string, Vector3][] = [
  ["front", new Vector3(0, 0.12, 1).normalize()],
  ["right side", new Vector3(-1, 0.12, 0).normalize()],
  ["3/4 right", new Vector3(-0.75, 0.2, 0.75).normalize()],
  ["diorama", new Vector3(1, 0.93, 1).normalize()],
]

export interface Stage {
  scene: Scene
  /** What the views aim at and how far they stand: set from a subject by `fit`. */
  aim: { target: Vector3; distance: number }
  /** Aims the views at an object: its bounding box's centre, far enough to hold all of it. */
  fit(subject: Object3D): void
  /** Draws the four views now (the labs call it every frame, or once for a still). */
  draw(): void
  /**
   * Calls `frame(dt)` then draws, at most 60 times a second. Probe Chrome is uncapped, and a scene
   * this small would otherwise draw thousands of frames a second and starve screenshots (8 s each).
   */
  run(frame?: (dt: number) => void): void
  /** A caption under the sheet (what is shown). */
  caption(text: string): void
}

export function createStage(root: HTMLElement): Stage {
  root.innerHTML = ""
  root.style.position = "relative"
  const renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio || 1)
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setScissorTest(true)
  root.append(renderer.domElement)
  const label = document.createElement("div")
  label.style.cssText =
    "position:absolute;left:12px;bottom:10px;font:13px ui-monospace,monospace;color:#1d1813;pointer-events:none"
  root.append(label)
  VIEWS.forEach(([name], i) => {
    const tag = document.createElement("div")
    tag.textContent = name
    tag.style.cssText = `position:absolute;left:${(i % 2) * 50}%;top:${Math.floor(i / 2) * 50}%;margin:8px;font:12px ui-monospace,monospace;color:#5a5044;pointer-events:none`
    root.append(tag)
  })

  const scene = new Scene()
  scene.background = new Color("#d9d3c6")
  scene.add(new AmbientLight("#ffffff", 1.3))
  const sun = new DirectionalLight("#fff4e0", 2.4)
  sun.position.set(2, 5, 4)
  scene.add(sun)
  const fill = new DirectionalLight("#cfe0ff", 0.9)
  fill.position.set(-3, 2, -2)
  scene.add(fill)
  const ground = new Mesh(new CircleGeometry(3, 48), new MeshStandardMaterial({ color: "#b9b09e" }))
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)
  const camera = new PerspectiveCamera(30, 1, 0.05, 2000)
  const aim = { target: new Vector3(0, 1, 0), distance: 6 }

  window.addEventListener("resize", () => renderer.setSize(window.innerWidth, window.innerHeight))

  return {
    scene,
    aim,
    fit(subject) {
      const box = new Box3().setFromObject(subject)
      if (box.isEmpty()) return
      const size = box.getSize(new Vector3()).length()
      box.getCenter(aim.target)
      aim.distance = Math.max(1, size * 1.9)
      ground.scale.setScalar(Math.max(1, size / 3))
    },
    draw() {
      const w = Math.floor(window.innerWidth / 2)
      const h = Math.floor(window.innerHeight / 2)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      VIEWS.forEach(([, way], i) => {
        const x = (i % 2) * w
        // WebGL's viewport counts from the bottom: the first row is the top half.
        const y = (1 - Math.floor(i / 2)) * h
        renderer.setViewport(x, y, w, h)
        renderer.setScissor(x, y, w, h)
        camera.position.copy(aim.target).addScaledVector(way, aim.distance)
        camera.lookAt(aim.target)
        renderer.render(scene, camera)
      })
    },
    caption(text) {
      label.textContent = text
    },
    run(frame) {
      let last = performance.now()
      const loop = (now: number) => {
        requestAnimationFrame(loop)
        if (now - last < 1000 / 60) return
        frame?.((now - last) / 1000)
        last = now
        this.draw()
      }
      requestAnimationFrame(loop)
    },
  }
}
