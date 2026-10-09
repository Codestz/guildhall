import {
  AmbientLight,
  type BatchedMesh,
  Color,
  DirectionalLight,
  HemisphereLight,
  type Material,
  Matrix4,
  type Mesh,
  Mesh as MeshClass,
  type MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  MeshStandardMaterial as PlainMaterial,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three"
import { tameLime } from "../scene/palette.ts"
import { reliefMeshes } from "../scene/terrain/reliefMeshes.ts"
import { newSnowline, snowMaterial } from "../scene/terrain/snow.ts"
import { LANDS_URL } from "../world/cast.ts"
import { key, step } from "../world/gen/hex.ts"
import { islandFromTree } from "../world/gen/islandFromTree.ts"
import { RES, reliefStyleOf, snowlineOf } from "../world/gen/relief/index.ts"
import { cellToWorld } from "../world/lands.ts"
import { repoWorld, type World } from "../world/world.ts"
import { draw, treeOf } from "./islandLab.ts"
import { load } from "./stage.ts"

/**
 * The relief lab (dev and probe only): a repo's gen 2 island with its massifs, drawn the way the hall
 * draws them (the real `repoWorld`: hex tiles where there is no mountain, the relief meshes on the
 * land palette with the snow line), under a noon or a dusk sun. One view per load, steered from the URL
 * or, without a reload, from `window.lab` (a probe `steps` file batches those).
 *
 *   ?lab=relief&repo=facebook/react     a City (3k+ files): the main range and a second massif
 *   &repo=codestz/opencode-cockpit      a Town; &repo=sample (this repo) or codestz/mcpx: a Village
 *   &light=noon|dusk   &winter=0..1 (the snow line lowers)   &rise=0..1 (the growth film's rise hook)
 *   &relief=a|b|c      the relief's art direction (world/gen/relief/style.ts); default the current one
 *   &massif=0         which massif to frame (default the main range)
 *   &az=45 &el=33 &dist=…   the camera (45°, 33° is the hall's diorama); &x=&z=&y=  re-aims it
 *   &view=top          straight down
 *
 * `window.lab`: `world`, `view({az, el, dist, x, y, z})`, `light("noon"|"dusk")`, `winter(0..1)`,
 * `rise(0..1)`, `bench(frames)` → ms a frame, `stats()` → triangles and draw calls of the last frame, `massifs()` → the peaks.
 */
export async function start(root: HTMLElement, params: URLSearchParams): Promise<void> {
  root.innerHTML = ""
  const caption = document.createElement("div")
  caption.style.cssText =
    "position:absolute;left:12px;bottom:10px;right:12px;font:12px ui-monospace,monospace;color:#1d1813;pointer-events:none;white-space:pre-wrap"
  root.style.position = "relative"

  const wanted = params.get("repo") ?? "facebook/react"
  const tree = await treeOf(wanted)
  const made = islandFromTree(tree.entries, 0, 2)
  const world: World = repoWorld(made, {
    repo: wanted,
    source: "fixture",
    gen: 2,
    relief: reliefStyleOf(`?relief=${params.get("relief") ?? ""}`),
  })
  const relief = world.relief
  if (!relief) {
    caption.textContent = `${tree.source}: no massifs (${made.plan.land.size} land hexes)`
    root.append(caption)
    Object.assign(window, { lab: { world } })
    return
  }

  const renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio || 1)
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFSoftShadowMap
  root.prepend(renderer.domElement)
  root.append(caption)

  const scene = new Scene()
  const ambient = new AmbientLight("#ffffff", 0.5)
  const sky = new HemisphereLight("#cfe6ff", "#8a7a5a", 0.9)
  const sun = new DirectionalLight("#fff4e0", 2.4)
  sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.04
  scene.add(ambient, sky, sun, sun.target)
  const sea = new MeshClass(new PlaneGeometry(6000, 6000), new PlainMaterial({ color: "#5d8fa3" }))
  sea.rotation.x = -Math.PI / 2
  sea.position.y = -1.2
  sea.receiveShadow = true
  scene.add(sea)

  const gltf = await load(LANDS_URL)
  const pieces = draw(gltf.scene, [...world.island.tiles, ...world.island.decor])
  for (const mesh of pieces) {
    mesh.castShadow = true
    mesh.receiveShadow = true
  }
  scene.add(...pieces)
  let base: Material | undefined
  gltf.scene.traverse((node) => {
    if (node.name !== "hex_grass") return
    node.traverse((child) => {
      const mesh = child as Mesh
      if (!base && mesh.isMesh) base = mesh.material as Material
    })
  })
  if (!base) throw new Error("relief lab: no land material")
  tameLime((base as MeshStandardMaterial).map)
  const snowline = newSnowline()
  const meshes = reliefMeshes(relief, snowMaterial(base, snowline), false)
  scene.add(...meshes)

  const main = relief.massifs[Number(params.get("massif") ?? 0)] ?? relief.massifs[0]
  if (!main) return
  const [cx, cz] = cellToWorld(main.peaks[0]?.cell ?? main.cells[0] ?? [0, 0])
  const reach =
    Math.max(...main.cells.map((c) => Math.hypot(cellToWorld(c)[0] - cx, cellToWorld(c)[1] - cz))) + 12

  const camera = new PerspectiveCamera(30, 1, 1, 6000)
  const aim = new Vector3(
    Number(params.get("x") ?? cx),
    Number(params.get("y") ?? main.height * 0.3),
    Number(params.get("z") ?? cz),
  )
  const rig = {
    az: Number(params.get("az") ?? 45),
    el: params.get("view") === "top" ? 89.5 : Number(params.get("el") ?? 33),
    dist: Number(params.get("dist") ?? reach * 3.6 + main.height),
  }
  let winter = Number(params.get("winter") ?? 0)
  let riseNow = Number(params.get("rise") ?? 1)
  let mood: "noon" | "dusk" = params.get("light") === "dusk" ? "dusk" : "noon"
  const matrix = new Matrix4()

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
    camera.up.set(0, 1, 0)
    if (params.get("view") === "top") camera.up.set(0, 0, -1)
    camera.lookAt(aim)
  }
  const light = (): void => {
    const dusk = mood === "dusk"
    const from = dusk ? new Vector3(-1, 0.22, 0.35) : new Vector3(0.45, 1, 0.55)
    sun.position.copy(aim).addScaledVector(from.normalize(), 700)
    sun.target.position.copy(aim)
    sun.color.set(dusk ? "#ff9a4d" : "#fff4e0")
    sun.intensity = dusk ? 3.2 : 2.4
    ambient.color.set(dusk ? "#8d88c8" : "#ffffff")
    ambient.intensity = dusk ? 1.1 : 0.5
    sky.color.set(dusk ? "#a79fd8" : "#cfe6ff")
    sky.intensity = dusk ? 1.2 : 0.9
    scene.background = new Color(dusk ? "#d99a74" : "#cfe2ea")
    ;(sea.material as PlainMaterial).color.set(dusk ? "#3d5f78" : "#5d8fa3")
    const half = reach * 1.6 + main.height
    const cam = sun.shadow.camera
    cam.left = -half
    cam.right = half
    cam.top = half
    cam.bottom = -half
    cam.near = 1
    cam.far = 1600
    cam.updateProjectionMatrix()
    renderer.shadowMap.needsUpdate = true
  }
  const snow = (): void => {
    snowline.value = params.has("snow") ? Number(params.get("snow")) : snowlineOf(relief, winter)
  }
  // The growth film's rise: each massif is one instance, lifted by its matrix like a land tile.
  const rise = (t: number): void => {
    riseNow = t
    for (const mesh of meshes) {
      const batch = mesh as BatchedMesh
      if (!batch.isBatchedMesh) continue
      for (let id = 0; id < relief.massifs.length; id++) {
        const lift = Math.ceil(relief.massifs[id]?.height ?? 0) + 1
        matrix.makeTranslation(0, lift - (1 - t) * (lift + 6), 0)
        batch.setMatrixAt(id, matrix)
      }
    }
    renderer.shadowMap.needsUpdate = true
  }

  const frame = (): void => {
    renderer.render(scene, camera)
  }
  const reliefTriangles = meshes.reduce(
    (sum, mesh) => sum + mesh.geometry.getAttribute("position").count / 3,
    0,
  )
  const refresh = (): void => {
    caption.textContent =
      `${tree.source} · ${relief.tier} · ${relief.massifs.length} massifs · main ${main.height.toFixed(0)} units, ` +
      `${main.cells.length} hexes · relief ${Math.round(reliefTriangles)} tris (lattice ${RES}) · ${mood} · winter ${winter}`
    place()
    light()
    snow()
    rise(riseNow)
    frame()
  }
  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight)
    refresh()
  })
  refresh()

  const info = (): { triangles: number; calls: number } => ({
    triangles: renderer.info.render.triangles,
    calls: renderer.info.render.calls,
  })
  Object.assign(window, {
    lab: {
      world,
      view(next: Partial<typeof rig> & { x?: number; y?: number; z?: number }) {
        Object.assign(rig, { az: next.az ?? rig.az, el: next.el ?? rig.el, dist: next.dist ?? rig.dist })
        aim.set(next.x ?? aim.x, next.y ?? aim.y, next.z ?? aim.z)
        refresh()
      },
      light(next: "noon" | "dusk") {
        mood = next
        refresh()
      },
      winter(next: number) {
        winter = next
        refresh()
      },
      rise(next: number) {
        rise(next)
        frame()
      },
      /** Draws `frames` frames back to back (shadow map redrawn each: a worst case) and reports ms per frame. */
      bench(frames = 120) {
        const gl = renderer.getContext()
        const times: number[] = []
        const pixel = new Uint8Array(4)
        for (let n = 0; n < frames; n++) {
          renderer.shadowMap.needsUpdate = true
          const start = performance.now()
          renderer.render(scene, camera)
          // A one-pixel read waits for the GPU (finish() does not, through ANGLE).
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
          times.push(performance.now() - start)
        }
        times.sort((a, b) => a - b)
        const median = times[Math.floor(times.length / 2)] ?? 0
        return {
          frames,
          medianMs: median,
          p95Ms: times[Math.floor(times.length * 0.95)] ?? 0,
          fps: 1000 / median,
        }
      },
      /** The middle of an edge where a massif meets a land hex ("land") or the sea ("sea"): where to look at a rim. */
      rim(kind: "land" | "sea") {
        for (const massif of relief.massifs)
          for (const cell of massif.cells)
            for (let d = 0; d < 6; d++) {
              const next = step(cell, d)
              if (massif.keys.has(key(next))) continue
              if ((world.terrain.at(next) === "~") !== (kind === "sea")) continue
              const [ax, az] = cellToWorld(cell)
              const [bx, bz] = cellToWorld(next)
              return {
                x: (ax + bx) / 2,
                z: (az + bz) / 2,
                ground: relief.heightAt((ax + bx) / 2, (az + bz) / 2),
              }
            }
        return null
      },
      stats: () => {
        frame()
        return { ...info(), relief: reliefTriangles }
      },
      massifs: () =>
        relief.massifs.map((m) => ({
          id: m.id,
          cells: m.cells.length,
          height: m.height,
          peaks: m.peaks.map((p) => ({ at: p.at, height: p.height })),
          saddles: m.saddles,
        })),
    },
  })
}
