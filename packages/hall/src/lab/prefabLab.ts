import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three"
import { LANDS_URL } from "../world/cast.ts"
import { turn } from "../world/gen/tiles.ts"
import { cellToWorld } from "../world/lands.ts"
import { DOOR_DEPTH, doorsOf, fixturesOf, instantiate, PREFABS, type Prefab } from "../world/prefabs/index.ts"
import { draw } from "./islandLab.ts"
import { load } from "./stage.ts"

/**
 * The prefab lab (dev and probe only): every prefab (world/prefabs) laid out on a hex grid under its
 * name, slowly turning, so a structure can be judged and reworked without growing an island.
 *
 *   ?lab=prefabs                      the whole catalogue, a row of five hexes a line
 *   &only=castle                      one prefab alone, close
 *   &hour=11                          the sun (0–24); 18.5 is dusk, past 20 is night
 *   &kit=red                          the colour of the homes (blue, red, yellow, green)
 *   &fx=1                             mark each door's step (red) and sill (yellow), the windows that
 *                                     light (orange) and the chimneys that smoke (grey): the venues'
 *   &az=30 &el=35 &dist=…  &spin=0    the camera, and whether it turns by itself (default slowly)
 *
 * Drag turns it, the wheel zooms. `window.lab`: `view({az, el, dist, x, z})`, `only(id|"")`, `ids()`.
 */

/** World units between one prefab's anchor and the next (ring-1 prefabs need the room). */
const SPACING = 46
const PER_ROW = 5

export async function start(root: HTMLElement, params: URLSearchParams): Promise<void> {
  root.innerHTML = ""
  root.style.position = "relative"
  const kit = (["red", "yellow", "green"] as const).find((name) => name === params.get("kit")) ?? "blue"
  const hour = Number(params.get("hour") ?? 12)
  const marked = params.get("fx") === "1"

  const renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio || 1)
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFSoftShadowMap
  root.append(renderer.domElement)

  const scene = new Scene()
  const ambient = new AmbientLight("#ffffff", 0.5)
  const sky = new HemisphereLight("#cfe6ff", "#8a7a5a", 0.9)
  const sun = new DirectionalLight("#fff4e0", 2.4)
  sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.04
  scene.add(ambient, sky, sun, sun.target)
  const sea = new Mesh(new PlaneGeometry(4000, 4000), new MeshStandardMaterial({ color: "#5d8fa3" }))
  sea.rotation.x = -Math.PI / 2
  sea.position.y = -0.4
  sea.receiveShadow = true
  scene.add(sea)

  const gltf = await load(LANDS_URL)
  const camera = new PerspectiveCamera(30, 1, 1, 4000)
  const aim = new Vector3()
  const rig = { az: Number(params.get("az") ?? 20), el: Number(params.get("el") ?? 38), dist: 100 }
  let spin = params.get("spin") !== "0"
  let shown: readonly Prefab[] = []
  const labels = new Map<string, { element: HTMLDivElement; at: Vector3 }>()

  const stands = (list: readonly Prefab[]): Map<string, [number, number]> => {
    const where = new Map<string, [number, number]>()
    list.forEach((item, n) => {
      const col = n % PER_ROW
      const row = Math.floor(n / PER_ROW)
      const x = col * SPACING
      const z = row * SPACING
      where.set(item.id, [x, z])
    })
    return where
  }

  /** Little cubes where a venue's door steps, windows and chimneys are (`&fx=1`). */
  const markers = (item: Prefab, at: readonly [number, number]): Mesh[] => {
    const cube = (color: string, x: number, y: number, z: number, size: number): Mesh => {
      const mesh = new Mesh(new BoxGeometry(size, size, size), new MeshBasicMaterial({ color }))
      mesh.position.set(x, y, z)
      return mesh
    }
    const out: Mesh[] = []
    for (const door of doorsOf(item, at, 0)) {
      const depth = door.depth ?? DOOR_DEPTH
      out.push(cube("#e02020", door.x, 0.4, door.z, 0.6))
      out.push(
        cube("#f0d020", door.x - Math.sin(door.rot) * depth, 0.4, door.z - Math.cos(door.rot) * depth, 0.6),
      )
    }
    for (const w of fixturesOf(item.windows, at, 0)) out.push(cube("#ff9a3c", w.x, w.y, w.z, 0.5))
    for (const c of fixturesOf(item.chimneys, at, 0)) out.push(cube("#444444", c.x, c.y, c.z, 0.5))
    return out
  }

  let drawn: Mesh[] = []
  const build = (only: string): void => {
    for (const mesh of drawn) scene.remove(mesh)
    for (const { element } of labels.values()) element.remove()
    labels.clear()
    shown = only ? PREFABS.filter((item) => item.id === only) : PREFABS
    const where = stands(shown)
    const tiles = []
    const placements = []
    for (const item of shown) {
      const [x, z] = where.get(item.id) ?? [0, 0]
      // A hex patch under it wide enough for its rings, and a cell or two round.
      const radius = item.rings + 1
      for (let dq = -radius; dq <= radius; dq++)
        for (let dl = -2 * radius; dl <= 2 * radius; dl++) {
          if ((dq - dl) % 2 !== 0) continue
          const [tx, tz] = cellToWorld([dq, dl])
          if (Math.hypot(tx, tz) > radius * 10 + 6) continue
          tiles.push({ piece: "hex_grass" as const, x: x + tx, z: z + tz, rot: turn(0) })
        }
      placements.push(...instantiate(item, [x, z], 0, kit))
      const element = document.createElement("div")
      element.textContent = `${item.id}${item.houses ? ` · ${item.houses} home${item.houses > 1 ? "s" : ""}` : ""}`
      element.style.cssText =
        "position:absolute;transform:translate(-50%,0);font:12px ui-monospace,monospace;color:#1d1813;background:#fff8;padding:1px 6px;border-radius:3px;pointer-events:none;white-space:nowrap"
      root.append(element)
      labels.set(item.id, { element, at: new Vector3(x, 0, z + (item.rings + 0.6) * 10) })
    }
    drawn = draw(gltf.scene, [...tiles, ...placements])
    for (const mesh of drawn) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
    if (marked) for (const item of shown) drawn.push(...markers(item, where.get(item.id) ?? [0, 0]))
    scene.add(...drawn)
    const xs = [...where.values()].map(([x]) => x)
    const zs = [...where.values()].map(([, z]) => z)
    aim.set((Math.min(...xs) + Math.max(...xs)) / 2, only ? 3 : 0, (Math.min(...zs) + Math.max(...zs)) / 2)
    const width = Math.max(...xs) - Math.min(...xs) + 40
    const depth = Math.max(...zs) - Math.min(...zs) + 40
    rig.dist = Number(params.get("dist") ?? (only ? 62 : Math.max(width, depth * 1.4) * 1.5))
    light()
  }

  const light = (): void => {
    const day = Math.sin(((hour - 6) / 12) * Math.PI)
    const elevation = Math.max(0.1, day)
    const from = new Vector3(Math.cos(((hour - 6) / 12) * Math.PI) * -0.9, elevation * 1.1, 0.55).normalize()
    sun.position.copy(aim).addScaledVector(from, 500)
    sun.target.position.copy(aim)
    const night = hour < 5 || hour > 20
    const low = elevation < 0.45
    sun.color.set(low ? "#ffb070" : "#fff4e0")
    sun.intensity = night ? 0.3 : low ? 2.6 : 2.4
    ambient.intensity = night ? 0.25 : 0.5
    sky.intensity = night ? 0.3 : 0.9
    scene.background = new Color(night ? "#16202c" : low ? "#e0b18b" : "#cfe2ea")
    const half = 260
    const cam = sun.shadow.camera
    cam.left = -half
    cam.right = half
    cam.top = half
    cam.bottom = -half
    cam.near = 1
    cam.far = 1200
    cam.updateProjectionMatrix()
  }

  const place = (): void => {
    const az = (rig.az * Math.PI) / 180
    const el = (rig.el * Math.PI) / 180
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    camera.position.set(
      aim.x + Math.sin(az) * Math.cos(el) * rig.dist,
      aim.y + Math.sin(el) * rig.dist,
      aim.z + Math.cos(az) * Math.cos(el) * rig.dist,
    )
    camera.lookAt(aim)
    camera.updateMatrixWorld()
    for (const { element, at } of labels.values()) {
      const p = at.clone().project(camera)
      element.style.left = `${((p.x + 1) / 2) * window.innerWidth}px`
      element.style.top = `${((1 - p.y) / 2) * window.innerHeight}px`
      element.style.display = p.z < 1 ? "block" : "none"
    }
  }

  let dragging: number | undefined
  renderer.domElement.addEventListener("pointerdown", (event) => {
    dragging = event.clientX
    spin = false
  })
  window.addEventListener("pointerup", () => {
    dragging = undefined
  })
  window.addEventListener("pointermove", (event) => {
    if (dragging === undefined) return
    rig.az -= (event.clientX - dragging) * 0.3
    dragging = event.clientX
  })
  renderer.domElement.addEventListener("wheel", (event) => {
    rig.dist *= 1 + Math.sign(event.deltaY) * 0.1
  })

  build(params.get("only") ?? "")
  let last = performance.now()
  const frame = (now: number): void => {
    // Probe Chrome is uncapped: a scene this small would draw thousands of frames a second.
    if (now - last >= 16) {
      if (spin) rig.az += ((now - last) / 1000) * 6
      last = now
      place()
      renderer.render(scene, camera)
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  Object.assign(window, {
    lab: {
      view: (to: { az?: number; el?: number; dist?: number; x?: number; z?: number }) => {
        spin = false
        rig.az = to.az ?? rig.az
        rig.el = to.el ?? rig.el
        rig.dist = to.dist ?? rig.dist
        aim.x = to.x ?? aim.x
        aim.z = to.z ?? aim.z
      },
      only: (id: string) => build(id),
      ids: () => PREFABS.map((item) => item.id),
    },
  })
}
