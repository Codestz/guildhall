import {
  AmbientLight,
  Color,
  DirectionalLight,
  InstancedMesh,
  type Material,
  Matrix4,
  type Mesh,
  Mesh as MeshClass,
  type MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  MeshStandardMaterial as PlainMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three"
import { tameLime } from "../scene/palette.ts"
import { LANDS_URL } from "../world/cast.ts"
import type { RepoIsland } from "../world/gen/dress.ts"
import { fetchPublicTree, parseRepo } from "../world/gen/fetch.ts"
import { islandFromTree } from "../world/gen/islandFromTree.ts"
import type { RepoEntry } from "../world/gen/repo.ts"
import { HEX_SCALE, type LandPlacement } from "../world/lands.ts"
import { load } from "./stage.ts"

/**
 * The island lab (dev and probe only): a repo grown into an island by world/gen, drawn with the land
 * pack's own tiles, top-down (left, north up, districts labelled) beside the diorama's angle.
 *
 *   ?lab=island&repo=sample            this repo's public tree (test/fixtures/repos/guildhall.json)
 *   ?lab=island&repo=facebook/react    a bundled fixture if there is one (owner__name.json), else
 *                                      fetched live from the unauthenticated GitHub API
 *   &seed=3                            re-rolls the same tree
 *
 * A plain InstancedMesh per piece part, not scene/Island.tsx: that component draws lands.ts' own
 * island() through R3F and the guild store, so the lab draws the same `Island` shape itself.
 * `window.lab`: `summary()` → the districts; `island` → the generated RepoIsland.
 */
export async function start(root: HTMLElement, params: URLSearchParams): Promise<void> {
  root.innerHTML = ""
  root.style.position = "relative"
  const caption = document.createElement("div")
  caption.style.cssText =
    "position:absolute;left:12px;bottom:10px;right:12px;font:12px ui-monospace,monospace;color:#1d1813;pointer-events:none;white-space:pre-wrap"
  root.append(caption)

  const wanted = params.get("repo") ?? "sample"
  const seed = Number(params.get("seed") ?? 0) || 0
  let generated: RepoIsland
  let source: string
  try {
    const tree = await treeOf(wanted)
    source = tree.source
    generated = islandFromTree(tree.entries, seed)
  } catch (error) {
    caption.textContent = `island lab: ${(error as Error).message}`
    Object.assign(window, { lab: { error: (error as Error).message } })
    return
  }

  const renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio || 1)
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setScissorTest(true)
  root.prepend(renderer.domElement)

  const scene = new Scene()
  scene.background = new Color("#d9d3c6")
  scene.add(new AmbientLight("#ffffff", 1.4))
  const sun = new DirectionalLight("#fff4e0", 2.4)
  sun.position.set(40, 90, 60)
  scene.add(sun)
  const sea = new MeshClass(new PlaneGeometry(4000, 4000), new PlainMaterial({ color: "#5d8fa3" }))
  sea.rotation.x = -Math.PI / 2
  sea.position.y = -1.2
  scene.add(sea)

  const gltf = await load(LANDS_URL)
  scene.add(...draw(gltf.scene, [...generated.island.tiles, ...generated.island.decor]))

  // Frame the land: its extent from the hub, plus a ring of sea.
  const extent = (generated.plan.radius + 2) * 10
  const top = new PerspectiveCamera(30, 1, 1, 5000)
  const diorama = new PerspectiveCamera(30, 1, 1, 5000)

  const labels = generated.districts.map((district) => {
    const tag = document.createElement("div")
    tag.textContent = `${district.label} · ${district.biome}`
    tag.style.cssText = `position:absolute;transform:translate(-50%,-140%);font:600 11px ui-monospace,monospace;color:#fff;background:${district.accent};padding:1px 5px;border-radius:3px;pointer-events:none;white-space:nowrap`
    root.append(tag)
    return { tag, at: new Vector3(district.at[0], 2, district.at[1]) }
  })

  const total = generated.districts.reduce((sum, d) => sum + d.files, 0)
  caption.textContent =
    `${source} · ${total} files · ${generated.plan.land.size} land hexes · seed ${generated.plan.seed}\n` +
    generated.districts
      .map(
        (d) =>
          `${d.label}: ${d.biome}, ${d.files} files, ${kb(d.bytes)}, ${d.language.name}, ${d.hexes} hexes`,
      )
      .join("  ·  ")

  const projected = new Vector3()
  function frame(): void {
    const w = Math.floor(window.innerWidth / 2)
    const h = window.innerHeight
    for (const [camera, x] of [
      [top, 0],
      [diorama, w],
    ] as const) {
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      const distance = extent / Math.tan((camera.fov * Math.PI) / 360) / Math.min(1, camera.aspect)
      if (camera === top) {
        camera.position.set(0, distance, 0.001)
        camera.up.set(0, 0, -1)
      } else camera.position.copy(new Vector3(1, 0.93, 1).normalize().multiplyScalar(distance * 1.05))
      camera.lookAt(0, 0, 0)
      renderer.setViewport(x, 0, w, h)
      renderer.setScissor(x, 0, w, h)
      renderer.render(scene, camera)
    }
    for (const { tag, at } of labels) {
      projected.copy(at).project(top)
      tag.style.left = `${((projected.x + 1) / 2) * w}px`
      tag.style.top = `${((1 - projected.y) / 2) * h}px`
    }
  }
  frame()
  // A still: redraw only on resize (the probe caps nothing for a lab that never animates).
  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight)
    frame()
  })

  Object.assign(window, {
    lab: {
      island: generated,
      summary: () =>
        generated.districts.map(({ label, biome, files, bytes, hexes, language }) => ({
          label,
          biome,
          files,
          bytes,
          hexes,
          language: language.name,
        })),
    },
  })
}

const kb = (bytes: number): string =>
  bytes > 1 << 20 ? `${(bytes / (1 << 20)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`

/** A bundled fixture when there is one ("sample" is this repo), else the live API. */
async function treeOf(wanted: string): Promise<{ entries: RepoEntry[]; source: string }> {
  const name = wanted === "sample" ? "guildhall" : parseRepo(wanted).replace("/", "__")
  const response = await fetch(`${import.meta.env.BASE_URL}test/fixtures/repos/${name}.json`)
  if (response.ok && response.headers.get("content-type")?.includes("json")) {
    const fixture = (await response.json()) as { repo: string; entries: RepoEntry[] }
    return { entries: fixture.entries, source: `${fixture.repo} (fixture)` }
  }
  const tree = await fetchPublicTree(wanted)
  return {
    entries: tree.entries,
    source: `${tree.repo}@${tree.branch}${tree.truncated ? " (truncated)" : ""}`,
  }
}

/** Every placement as instances: one InstancedMesh per part of each piece. */
function draw(pack: Object3D, placements: readonly LandPlacement[]): InstancedMesh[] {
  const pieces = new Map<string, Object3D>()
  pack.traverse((node) => {
    if (node.name && !pieces.has(node.name)) pieces.set(node.name, node)
  })
  const byPiece = new Map<string, LandPlacement[]>()
  for (const placement of placements)
    byPiece.set(placement.piece, [...(byPiece.get(placement.piece) ?? []), placement])

  const out: InstancedMesh[] = []
  const tamed = new Set<Material>()
  const place = new Matrix4()
  const up = new Vector3(0, 1, 0)
  for (const [name, list] of byPiece) {
    const source = pieces.get(name)
    if (!source) continue
    source.updateMatrixWorld(true)
    const inverse = source.matrixWorld.clone().invert()
    source.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh) return
      const material = mesh.material as MeshStandardMaterial
      if (!tamed.has(material)) {
        tameLime(material.map)
        tamed.add(material)
      }
      const local = inverse.clone().multiply(mesh.matrixWorld)
      const instances = new InstancedMesh(mesh.geometry, material, list.length)
      list.forEach((placement, i) => {
        place.compose(
          new Vector3(placement.x, placement.y ?? 0, placement.z),
          new Quaternion().setFromAxisAngle(up, placement.rot ?? 0),
          new Vector3().setScalar(HEX_SCALE * (placement.scale ?? 1)),
        )
        instances.setMatrixAt(i, place.clone().multiply(local))
      })
      instances.computeBoundingSphere()
      out.push(instances)
    })
  }
  return out
}
