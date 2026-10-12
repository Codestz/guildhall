/** Framing for a row of pieces: the viewer fits a bounding sphere, which leaves a long row tiny. */
import type { CameraPose } from "@guildhall/core"

export interface Row {
  /** World x of the row's ends. */
  minX: number
  maxX: number
  height: number
  depth: number
}

export interface View {
  /** Vertical field of view, degrees. */
  fov: number
  aspect: number
  azimuth: number
  elevation: number
  /** Room left at the frame's sides: 1 touches them. */
  margin: number
}

const RAD = Math.PI / 180

/**
 * A pose that fits the row's length across the view (or its height, if that is the tighter fit),
 * aimed at its middle a little below half height so the ground in front shows.
 */
export function rowPose(row: Row, view: View): CameraPose {
  const halfV = (view.fov / 2) * RAD
  const halfH = Math.atan(Math.tan(halfV) * view.aspect)
  const length = Math.max(1, row.maxX - row.minX)
  const across = ((length / 2) * view.margin) / Math.tan(halfH)
  const up = ((row.height / 2) * view.margin) / Math.tan(halfV)
  return {
    target: [(row.minX + row.maxX) / 2, row.height * 0.4, 0],
    azimuth: view.azimuth,
    elevation: view.elevation,
    distance: Math.max(across, up) + row.depth / 2,
  }
}
