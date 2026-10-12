import { type Camera, Vector3 } from "three"
import { blocked, type Point, type ReliefHeight } from "./sight.ts"

/**
 * The cinematic camera's clear angle (terrain v2 §5, layer 2): a shot's subject should not be hidden
 * behind a mountain, so when the camera's line of sight to it is blocked, `ClearAngle` swings the
 * camera round the subject to the nearest of the eight Q/E azimuths that sees it. Where no azimuth
 * is clear the shot stays and the see-through cut (cutaway.ts) shows the subject through the relief.
 * A manual camera is never turned: only the director calls it.
 */

const AZIMUTHS = 8
/** The swing's speed, rad/s, and how often (s) the director looks again. */
const RATE = 0.7
const LOOK_S = 0.5
const UP = new Vector3(0, 1, 0)

/**
 * The turn, radians about the vertical through `subject` (positive: anticlockwise from above), to the
 * nearest clear azimuth; 0 when the camera already sees the subject; undefined when none does.
 * `from` is the camera's offset from the subject: the height and distance it keeps.
 */
export function clearTurn(
  heightAt: ReliefHeight,
  peak: number,
  subject: Point,
  from: Point,
  scratch: Point = { x: 0, y: 0, z: 0 },
): number | undefined {
  const reach = Math.hypot(from.x, from.z)
  const azimuth = Math.atan2(from.x, from.z)
  scratch.y = subject.y + from.y
  // 0, +1, -1, +2, -2 ... +4 steps of an eighth turn: the nearest first.
  for (let k = 0; k <= AZIMUTHS / 2; k++) {
    for (const sign of k === 0 || k === AZIMUTHS / 2 ? [1] : [1, -1]) {
      const turn = (sign * k * 2 * Math.PI) / AZIMUTHS
      scratch.x = subject.x + Math.sin(azimuth + turn) * reach
      scratch.z = subject.z + Math.cos(azimuth + turn) * reach
      if (!blocked(heightAt, peak, subject, scratch)) return turn
    }
  }
  return undefined
}

/** The swing in progress: looked for twice a second, eased in over frames. */
export class ClearAngle {
  private lookIn = 0
  private left = 0
  private readonly from = new Vector3()
  private readonly offset = new Vector3()

  /** A new shot: look again at once. */
  reset(): void {
    this.lookIn = 0
    this.left = 0
  }

  /** One frame: turns `camera` about `target` towards a clear view of `subject` (if the way is blocked). */
  update(
    delta: number,
    camera: Camera,
    target: Vector3,
    subject: Vector3,
    heightAt: ReliefHeight,
    peak: number,
  ): void {
    this.lookIn -= delta
    if (this.lookIn <= 0) {
      this.lookIn = LOOK_S
      this.left = clearTurn(heightAt, peak, subject, this.from.copy(camera.position).sub(subject)) ?? 0
    }
    if (this.left === 0) return
    const step = Math.sign(this.left) * Math.min(Math.abs(this.left), RATE * delta)
    this.left -= step
    this.offset.copy(camera.position).sub(target).applyAxisAngle(UP, step)
    camera.position.copy(target).add(this.offset)
  }
}
