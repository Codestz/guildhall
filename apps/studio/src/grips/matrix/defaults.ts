/**
 * A stand-in mount for a prop nobody has authored yet, read off its bounding box in prop space. The
 * matrix marks every such row "default": that list is the authoring queue for the grip editor.
 */
import type { Mount, Vec3 } from "@guildhall/assets"

/** Below this longest : second-longest ratio no axis dominates: the prop is carried, hanging, kept upright. */
export const COMPACT_RATIO = 1.5
/** How far up the handle axis the fist closes, as a fraction of the prop's length. */
export const GRIP_FRACTION = 0.12

const unit = (axis: number): Vec3 => [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0]

/**
 * The default for a prop whose box has `size` about `centre` (prop space, metres), right hand, one-handed:
 * - elongated (a tool, a blade): the longest axis is the handle axis, gripped near its low end, the
 *   working end beyond; the second-longest axis is the edge.
 * - compact (a lantern, a mug): it hangs from the fist by the top centre of its box, kept upright.
 */
export function defaultMount(size: Vec3, centre: Vec3): Mount {
  const [long = 1, second = 0] = ([0, 1, 2] as const).toSorted((a, b) => size[b] - size[a] || a - b)
  if (size[long] < COMPACT_RATIO * size[second])
    return {
      slot: "hand.r",
      hands: 1,
      handle: [centre[0], centre[1] + size[1] / 2, centre[2]],
      axis: [0, -1, 0],
      edge: [1, 0, 0],
      upright: { up: [0, 1, 0] },
    }
  const handle: Vec3 = [...centre]
  handle[long] = centre[long] + (GRIP_FRACTION - 0.5) * size[long]
  return { slot: "hand.r", hands: 1, handle, axis: unit(long), edge: unit(second) }
}
