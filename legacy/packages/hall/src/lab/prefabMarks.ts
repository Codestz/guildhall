import { BoxGeometry, Mesh, MeshBasicMaterial, type MeshStandardMaterial, type Object3D } from "three"
import { DOOR_DEPTH, doorsOf, fixturesOf, type PieceInfo, type Prefab } from "../world/prefabs/index.ts"

/** The prefab lab's helpers: the `&fx=1` markers, and what each piece of the pack weighs. */

/** Little cubes where a venue's door steps, windows and chimneys are (`&fx=1`). */
export function markers(item: Prefab, at: readonly [number, number], seed: number): Mesh[] {
  const cube = (color: string, x: number, y: number, z: number, size: number): Mesh => {
    const mesh = new Mesh(new BoxGeometry(size, size, size), new MeshBasicMaterial({ color }))
    mesh.position.set(x, y, z)
    return mesh
  }
  const out: Mesh[] = []
  for (const door of doorsOf(item, at, 0, seed)) {
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

/** What each piece of the pack weighs, read off the loaded geometry (cached by name). */
export function pieceInfo(pack: Object3D): (name: string) => PieceInfo | undefined {
  const nodes = new Map<string, Object3D>()
  pack.traverse((node) => {
    if (node.name && !nodes.has(node.name)) nodes.set(node.name, node)
  })
  const known = new Map<string, PieceInfo | undefined>()
  return (name) => {
    if (known.has(name)) return known.get(name)
    const node = nodes.get(name)
    let found: PieceInfo | undefined
    if (node) {
      const piece: PieceInfo = { tris: 0, bytes: 0, meshes: 0, material: "" }
      node.traverse((child) => {
        const mesh = child as Mesh
        if (!mesh.isMesh) return
        const { geometry } = mesh
        piece.meshes++
        piece.tris += (geometry.index?.count ?? geometry.getAttribute("position").count) / 3
        piece.bytes += geometry.index?.array.byteLength ?? 0
        for (const attribute of Object.values(geometry.attributes)) piece.bytes += attribute.array.byteLength
        piece.material = (mesh.material as MeshStandardMaterial).uuid
      })
      found = piece
    }
    known.set(name, found)
    return found
  }
}
