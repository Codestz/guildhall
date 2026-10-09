import {
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three"
import { CIVIC_URL } from "../scene/civic.ts"
import { LANDS_URL } from "../world/cast.ts"
import { turn } from "../world/gen/tiles.ts"
import { cellToWorld, HEX_SCALE } from "../world/lands.ts"
import { instantiate, PREFABS, type Prefab, resolve, statsOf } from "../world/prefabs/index.ts"
import { draw } from "./islandLab.ts"
import { createInspector } from "./prefabInspector.ts"
import { markers, pieceInfo } from "./prefabMarks.ts"
import { load } from "./stage.ts"

/**
 * The prefab lab (dev and probe only): every prefab (world/prefabs) laid out on a hex grid under its
 * name, slowly turning, so a structure can be judged and reworked without growing an island.
 *
 *   ?lab=prefabs                      the whole catalogue, a row of five hexes a line
 *   &only=castle                      one prefab alone, close (and its inspector open)
 *   &show=house-row,bakery,inn        just those, side by side (to judge one kit against another)
 *   &seed=3                           the seeded variant (prefabs/variants.ts) of every prefab that has one
 *   &hour=11                          the sun (0–24); 18.5 is dusk, past 20 is night
 *   &kit=red                          the colour of the homes (blue, red, yellow, green)
 *   &fx=1                             mark each door's step (red) and sill (yellow), the windows that
 *                                     light (orange) and the chimneys that smoke (grey): the venues'
 *   &town2=town2-raw                  the second town kit's bundle (assets/<name>.glb): the unbaked one to compare
 *   &az=30 &el=35 &dist=…  &spin=0    the camera, and whether it turns by itself (default slowly)
 *
 * Click a prefab (or `&only=`) for its inspector: ← → browse, ↑ ↓ step its variants, enter isolates it,
 * esc closes. Drag turns the view, the wheel zooms.
 * `window.lab`: `view({az, el, dist, x, z})`, `only(id|"")`, `select(id|"")`, `seed(n)`, `ids()`.
 */

/** World units between one prefab's anchor and the next (ring-1 prefabs need the room). */
const SPACING = 46
const PER_ROW = 5
/** The inspector's width, so the view is shifted clear of it. */
const PANEL = 328
/** A hex's corner reach: its outline. */
const HEX = (HEX_SCALE * 2) / Math.sqrt(3)

export async function start(root: HTMLElement, params: URLSearchParams): Promise<void> {
  root.innerHTML = ""
  root.style.position = "relative"
  const kit = (["red", "yellow", "green"] as const).find((name) => name === params.get("kit")) ?? "blue"
  const hour = Number(params.get("hour") ?? 12)
  const marked = params.get("fx") === "1"
  const town2 = `${import.meta.env.BASE_URL}assets/${params.get("town2") ?? "town2"}.glb`

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

  // The land pack, its civic pieces and the second town kit, as one pack of named pieces.
  const [lands, civic, extra] = await Promise.all([load(LANDS_URL), load(CIVIC_URL), load(town2)])
  const pack = new Group().add(lands.scene, civic.scene, extra.scene)
  const info = pieceInfo(pack)

  const camera = new PerspectiveCamera(30, 1, 1, 4000)
  const aim = new Vector3()
  const rig = { az: Number(params.get("az") ?? 20), el: Number(params.get("el") ?? 38), dist: 100 }
  let spin = params.get("spin") !== "0"
  let shown: readonly Prefab[] = []
  let anchors = new Map<string, [number, number]>()
  /** The prefab the inspector holds, whether it alone is drawn, and each one's chosen seed. */
  let selected = PREFABS.find((item) => item.id === params.get("only"))
  let isolated = selected !== undefined
  const seeds = new Map<string, number>()
  const listed = PREFABS.filter((item) => (params.get("show") ?? "").split(",").includes(item.id))
  const defaultSeed = Math.max(0, Math.floor(Number(params.get("seed") ?? 0)) || 0)
  const seedOf = (item: Prefab): number => (item.variation ? (seeds.get(item.id) ?? defaultSeed) : 0)
  const labels = new Map<string, HTMLDivElement>()
  const outline = new Mesh(
    new RingGeometry(HEX - 0.35, HEX, 6),
    new MeshBasicMaterial({ color: "#dcb662", transparent: true, opacity: 0.9, depthTest: false }),
  )
  outline.rotation.x = -Math.PI / 2
  outline.renderOrder = 10
  outline.visible = false
  scene.add(outline)

  const actions = {
    prev: () => browse(-1),
    next: () => browse(1),
    vary: (delta: number) => {
      if (selected?.variation) seeds.set(selected.id, Math.max(0, seedOf(selected) + delta))
      refresh(true)
    },
    isolate: () => {
      isolated = selected !== undefined && !isolated
      refresh(true)
    },
    close: () => {
      selected = undefined
      isolated = false
      refresh(true)
    },
  }
  const inspector = createInspector(root, actions)

  let drawn: Mesh[] = []
  /** Lays out what is shown (the whole catalogue, or the selection alone) and aims at it. */
  const build = (): void => {
    for (const mesh of drawn) scene.remove(mesh)
    for (const element of labels.values()) element.remove()
    labels.clear()
    shown = isolated && selected ? [selected] : listed.length > 0 ? listed : PREFABS
    anchors = new Map(
      shown.map((item, n) => [item.id, [(n % PER_ROW) * SPACING, Math.floor(n / PER_ROW) * SPACING]]),
    )
    const tiles = []
    const placements = []
    for (const item of shown) {
      const [x, z] = anchors.get(item.id) ?? [0, 0]
      // A hex patch under it wide enough for its rings, and a cell or two round.
      const radius = item.rings + 1
      for (let dq = -radius; dq <= radius; dq++)
        for (let dl = -2 * radius; dl <= 2 * radius; dl++) {
          if ((dq - dl) % 2 !== 0) continue
          const [tx, tz] = cellToWorld([dq, dl])
          if (Math.hypot(tx, tz) > radius * 10 + 6) continue
          tiles.push({ piece: "hex_grass" as const, x: x + tx, z: z + tz, rot: turn(0) })
        }
      placements.push(...instantiate(item, [x, z], 0, kit, 0, seedOf(item)))
      const element = inspector.label(item.id)
      labels.set(item.id, element)
      element.dataset.at = `${x},${z + (item.rings + 0.6) * 10}`
    }
    drawn = draw(pack, [...tiles, ...placements])
    for (const mesh of drawn) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
    if (marked)
      for (const item of shown) drawn.push(...markers(item, anchors.get(item.id) ?? [0, 0], seedOf(item)))
    scene.add(...drawn)
    const xs = [...anchors.values()].map(([x]) => x)
    const zs = [...anchors.values()].map(([, z]) => z)
    aim.set(
      (Math.min(...xs) + Math.max(...xs)) / 2,
      isolated ? 3 : 0,
      (Math.min(...zs) + Math.max(...zs)) / 2,
    )
    const width = Math.max(...xs) - Math.min(...xs) + 40
    const depth = Math.max(...zs) - Math.min(...zs) + 40
    rig.dist = Number(params.get("dist") ?? (isolated ? 62 : Math.max(width, depth * 1.4) * 1.5))
    light()
  }

  /** The inspector, the selection's outline and the labels' emphasis: what a selection changes. */
  const refresh = (rebuild = false): void => {
    if (rebuild) build()
    for (const [id, element] of labels) {
      if (id === selected?.id) element.dataset.on = ""
      else delete element.dataset.on
    }
    const at = selected && anchors.get(selected.id)
    outline.visible = at !== undefined
    if (!selected || !at) {
      inspector.hide()
      return
    }
    outline.position.set(at[0], 0.12, at[1])
    const seed = seedOf(selected)
    const variant = selected.variation ? resolve(selected, seed, kit) : undefined
    inspector.show({
      stats: statsOf(selected, seed, kit, info),
      at: PREFABS.indexOf(selected) + 1,
      of: PREFABS.length,
      seed,
      ...(variant ? { variant } : {}),
      props: variant ? variant.parts.length - selected.parts.length : 0,
      isolated,
    })
  }

  const browse = (delta: number): void => {
    const here = selected ? PREFABS.indexOf(selected) : delta > 0 ? -1 : 0
    selected = PREFABS[(here + delta + PREFABS.length) % PREFABS.length]
    refresh(isolated)
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
    // The inspector covers the right of the window: the view is shifted so the subject stays clear.
    if (selected)
      camera.setViewOffset(
        window.innerWidth,
        window.innerHeight,
        PANEL / 2,
        0,
        window.innerWidth,
        window.innerHeight,
      )
    else camera.clearViewOffset()
    camera.updateProjectionMatrix()
    camera.position.set(
      aim.x + Math.sin(az) * Math.cos(el) * rig.dist,
      aim.y + Math.sin(el) * rig.dist,
      aim.z + Math.cos(az) * Math.cos(el) * rig.dist,
    )
    camera.lookAt(aim)
    camera.updateMatrixWorld()
    for (const [id, element] of labels) {
      const [x = 0, z = 0] = (element.dataset.at ?? "0,0").split(",").map(Number)
      const p = new Vector3(x, 0, z).project(camera)
      const item = anchors.get(id)
      element.style.left = `${((p.x + 1) / 2) * window.innerWidth}px`
      element.style.top = `${((1 - p.y) / 2) * window.innerHeight}px`
      element.style.display = item && p.z < 1 ? "block" : "none"
    }
  }

  /** The prefab under a click: the ground point it lands on, the nearest anchor within its hexes. */
  const pick = (event: PointerEvent): Prefab | undefined => {
    const at = new Vector2(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1,
    )
    const ray = new Raycaster()
    ray.setFromCamera(at, camera)
    const ground = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3())
    if (!ground) return undefined
    let best: Prefab | undefined
    let bestD = Number.POSITIVE_INFINITY
    for (const item of shown) {
      const [x = 0, z = 0] = anchors.get(item.id) ?? []
      const d = Math.hypot(ground.x - x, ground.z - z)
      if (d <= HEX * (1 + item.rings * 1.6) && d < bestD) {
        best = item
        bestD = d
      }
    }
    return best
  }

  let dragging: { x: number; moved: boolean } | undefined
  renderer.domElement.addEventListener("pointerdown", (event) => {
    dragging = { x: event.clientX, moved: false }
    spin = false
  })
  window.addEventListener("pointerup", (event) => {
    const click = dragging && !dragging.moved && event.target === renderer.domElement
    dragging = undefined
    if (!click) return
    const hit = pick(event)
    if (hit) selected = hit
    else if (!isolated) selected = undefined
    refresh()
  })
  window.addEventListener("pointermove", (event) => {
    if (!dragging) return
    if (Math.abs(event.clientX - dragging.x) > 3) dragging.moved = true
    if (!dragging.moved) return
    rig.az -= (event.clientX - dragging.x) * 0.3
    dragging.x = event.clientX
  })
  renderer.domElement.addEventListener("wheel", (event) => {
    rig.dist *= 1 + Math.sign(event.deltaY) * 0.1
  })
  window.addEventListener("keydown", (event) => {
    const keys: Record<string, () => void> = {
      ArrowLeft: actions.prev,
      ArrowRight: actions.next,
      ArrowUp: () => actions.vary(1),
      ArrowDown: () => actions.vary(-1),
      Enter: actions.isolate,
      Escape: actions.close,
    }
    const run = keys[event.key]
    if (!run) return
    event.preventDefault()
    run()
  })

  build()
  refresh()
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
      only: (id: string) => {
        selected = PREFABS.find((item) => item.id === id)
        isolated = selected !== undefined
        refresh(true)
      },
      select: (id: string) => {
        selected = PREFABS.find((item) => item.id === id)
        refresh(isolated)
      },
      seed: (n: number) => {
        if (selected?.variation) seeds.set(selected.id, n)
        else for (const item of PREFABS) if (item.variation) seeds.set(item.id, n)
        refresh(true)
      },
      ids: () => PREFABS.map((item) => item.id),
    },
  })
}
