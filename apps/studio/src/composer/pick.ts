/**
 * Picking without a raycaster (apps never import three): the clicked point is tested against shapes
 * projected to the screen. Panels are the outer faces of the house box, so the faces turned toward the
 * camera never overlap on screen; dressing is a projected bounding box, nearest first.
 */
import { type HouseBlueprint, KIT_PROFILES } from "@guildhall/assets"
import { cellsOn, type Side, type Slot } from "./model.ts"

export type Vec3 = [number, number, number]
type Vec2 = [number, number]
/** World point → canvas pixels, or null behind the camera (render's `toScreen`). */
export type Project = (p: Vec3) => Vec2 | null

export interface PanelFace {
  slot: Slot
  /** Corners in order round the face, world metres. */
  corners: [Vec3, Vec3, Vec3, Vec3]
  centre: Vec3
  normal: Vec3
}

const SIDES: readonly Side[] = ["+z", "-z", "+x", "-x"]
const NORMALS: Record<Side, Vec3> = { "+z": [0, 0, 1], "-z": [0, 0, -1], "+x": [1, 0, 0], "-x": [-1, 0, 0] }

/** Every panel slot's outer face, for a house standing centred on `offset`. */
export function panelFaces(h: HouseBlueprint, offset: Vec3 = [0, 0, 0]): PanelFace[] {
  const kit = KIT_PROFILES[h.kit]
  const M = kit.module
  const hw = (h.size.w * M) / 2
  const hd = (h.size.d * M) / 2
  const [ox, oy, oz] = offset
  const out: PanelFace[] = []
  for (let storey = 0; storey < h.storeys.length; storey++) {
    const y0 = oy + storey * kit.storey
    const y1 = y0 + kit.storey
    for (const side of SIDES) {
      for (let index = 0; index < cellsOn(h, side); index++) {
        const a = index * M
        let p: Vec2
        let q: Vec2
        if (side === "+z" || side === "-z") {
          const z = side === "+z" ? hd : -hd
          p = [-hw + a, z]
          q = [-hw + a + M, z]
        } else {
          const x = side === "+x" ? hw : -hw
          p = [x, -hd + a]
          q = [x, -hd + a + M]
        }
        const corners: PanelFace["corners"] = [
          [ox + p[0], y0, oz + p[1]],
          [ox + q[0], y0, oz + q[1]],
          [ox + q[0], y1, oz + q[1]],
          [ox + p[0], y1, oz + p[1]],
        ]
        const centre: Vec3 = [ox + (p[0] + q[0]) / 2, (y0 + y1) / 2, oz + (p[1] + q[1]) / 2]
        out.push({ slot: { storey, side, index }, corners, centre, normal: NORMALS[side] })
      }
    }
  }
  return out
}

/** Inside a convex polygon given in either winding (on an edge counts). */
export function inConvex(pt: Vec2, poly: readonly Vec2[]): boolean {
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i] as Vec2
    const [bx, by] = poly[(i + 1) % poly.length] as Vec2
    const cross = (bx - ax) * (pt[1] - ay) - (by - ay) * (pt[0] - ax)
    if (cross === 0) continue
    const s = Math.sign(cross)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/** The panel under `click`: only faces turned toward `eye` count (they cannot overlap on screen). */
export function pickPanel(
  faces: readonly PanelFace[],
  eye: Vec3,
  project: Project,
  click: Vec2,
): Slot | null {
  for (const face of faces) {
    const toEye = [eye[0] - face.centre[0], eye[1] - face.centre[1], eye[2] - face.centre[2]]
    const facing = face.normal[0] * (toEye[0] as number) + face.normal[2] * (toEye[2] as number)
    if (facing <= 0) continue
    const screen = face.corners.map(project)
    if (screen.some((p) => p === null)) continue
    if (inConvex(click, screen as Vec2[])) return face.slot
  }
  return null
}

/** The 8 corners of an axis-aligned box (render's `measure`: centre and size, metres). */
export function boxCorners(centre: Vec3, size: Vec3): Vec3[] {
  const out: Vec3[] = []
  for (const sx of [-0.5, 0.5])
    for (const sy of [-0.5, 0.5])
      for (const sz of [-0.5, 0.5])
        out.push([centre[0] + sx * size[0], centre[1] + sy * size[1], centre[2] + sz * size[2]])
  return out
}

/**
 * The dressing piece under `click` (its index), by projected bounds: the nearest to `eye` wins where
 * boxes overlap. `boxes` pairs each piece's corners with its position.
 */
export function pickDressing(
  boxes: readonly { corners: Vec3[]; at: Vec3 }[],
  eye: Vec3,
  project: Project,
  click: Vec2,
): number | null {
  let best: number | null = null
  let bestDist = Infinity
  boxes.forEach((box, i) => {
    const screen = box.corners.map(project)
    if (screen.some((p) => p === null)) return
    const xs = (screen as Vec2[]).map((p) => p[0])
    const ys = (screen as Vec2[]).map((p) => p[1])
    const inside =
      click[0] >= Math.min(...xs) &&
      click[0] <= Math.max(...xs) &&
      click[1] >= Math.min(...ys) &&
      click[1] <= Math.max(...ys)
    if (!inside) return
    const dist = Math.hypot(eye[0] - box.at[0], eye[1] - box.at[1], eye[2] - box.at[2])
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  })
  return best
}
