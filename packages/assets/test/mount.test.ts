import { describe, expect, test } from "bun:test"
import {
  MOUNT_SLOTS,
  type Mount,
  type MountSlot,
  mountBasis,
  SLOT_FRAMES,
  type Vec3,
  validateMount,
  validateMounts,
} from "../src/mount.ts"
import data from "../src/palette.json"
import { loadPalette } from "../src/palette.ts"
import { validateEntry } from "../src/validate.ts"
import { entry } from "./entry.ts"

type Quat = [number, number, number, number]

/** q · v · q⁻¹ for a unit quaternion [x, y, z, w]. */
function rotate([x, y, z, w]: Quat, [vx, vy, vz]: Vec3): Vec3 {
  const tx = 2 * (y * vz - z * vy)
  const ty = 2 * (z * vx - x * vz)
  const tz = 2 * (x * vy - y * vx)
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)]
}
/** Where a prop-space point lands in slot space. */
const place = (b: ReturnType<typeof mountBasis>, p: Vec3, scale = 1): Vec3 => {
  const r = rotate(b.rotation, [p[0] * scale, p[1] * scale, p[2] * scale])
  return [r[0] + b.translation[0], r[1] + b.translation[1], r[2] + b.translation[2]]
}
const near = (a: Vec3, b: Vec3, eps = 1e-9): void => {
  for (let i = 0; i < 3; i++) expect(Math.abs((a[i] as number) - (b[i] as number))).toBeLessThan(eps)
}

/** An axe: handle near the butt, head up the -z axis of its model, strike edge toward +x. */
const axe = (over: Partial<Mount> = {}): Mount => ({
  slot: "hand.r",
  hands: 1,
  handle: [0.02, 0.1, -0.05],
  axis: [0, 0, -1],
  edge: [1, 0, 0],
  ...over,
})

describe("mountBasis", () => {
  test("hand.r: axis → +y, edge → +x, and the handle lands on the slot origin", () => {
    const b = mountBasis(axe(), "hand.r")
    near(rotate(b.rotation, [0, 0, -1]), [0, 1, 0])
    near(rotate(b.rotation, [1, 0, 0]), [1, 0, 0])
    near(place(b, axe().handle), [0, 0, 0])
  })

  test("hand.l mirrors the edge: axis → +y, edge → −x", () => {
    const b = mountBasis(axe(), "hand.l")
    near(rotate(b.rotation, [0, 0, -1]), [0, 1, 0])
    near(rotate(b.rotation, [1, 0, 0]), [-1, 0, 0])
    near(place(b, axe().handle), [0, 0, 0])
  })

  test("every slot maps axis → along and edge → edge, for oblique axes too", () => {
    const s = Math.SQRT1_2
    const m = axe({ axis: [s, s, 0], edge: [s, -s, 0], handle: [0.3, -0.2, 0.1] })
    for (const slot of MOUNT_SLOTS) {
      const b = mountBasis(m, slot)
      near(rotate(b.rotation, m.axis), SLOT_FRAMES[slot].along)
      near(rotate(b.rotation, m.edge), SLOT_FRAMES[slot].edge)
      near(place(b, m.handle), [0, 0, 0])
      expect(Math.hypot(...b.rotation)).toBeCloseTo(1, 12)
      expect(b.rotation[3]).toBeGreaterThanOrEqual(0)
    }
  })

  test("scale scales the handle offset, so the scaled handle still lands on the origin", () => {
    const m = axe({ scale: 1.5 })
    const b = mountBasis(m, "hand.r")
    near(place(b, m.handle, 1.5), [0, 0, 0])
    near(b.translation, mountBasis(axe(), "hand.r").translation.map((v) => v * 1.5) as Vec3)
  })

  test("a prop already in the slot frame needs no rotation", () => {
    const b = mountBasis(axe({ axis: [0, 1, 0], edge: [1, 0, 0], handle: [0, 0, 0] }), "hand.r")
    near(b.rotation as unknown as Vec3, [0, 0, 0])
    expect(b.rotation[3]).toBeCloseTo(1, 12)
  })
})

describe("validateMount", () => {
  test("a minimal and a full mount are valid", () => {
    expect(validateMount(axe())).toEqual([])
    const full: Mount = axe({
      alt: ["hand.l", "back"],
      hands: 2,
      upright: { up: [0, 0, -1] },
      scale: 0.8,
      clips: { Chopping: { roll: 0.2, offset: [0, 0.01, 0] }, Sit_Chair_Idle: { hide: true } },
    })
    expect(validateMount(full)).toEqual([])
  })

  test("rejects unknown slots, in slot and alt", () => {
    expect(validateMount(axe({ slot: "hand.x" as MountSlot }))).toEqual(['mount.slot: unknown "hand.x"'])
    expect(validateMount(axe({ alt: ["tail" as MountSlot] }))).toEqual(['mount.alt: unknown "tail"'])
    expect(validateMount(axe({ alt: ["hand.r"] }))).toEqual(["mount.alt: duplicates"])
  })

  test("rejects non-unit axes", () => {
    expect(validateMount(axe({ axis: [0, 0, -2] }))).toEqual(["mount.axis: expected a unit vector"])
    expect(validateMount(axe({ edge: [0.5, 0, 0] }))).toEqual(["mount.edge: expected a unit vector"])
    expect(validateMount(axe({ upright: { up: [0, 0, 0] } }))).toEqual([
      "mount.upright.up: expected a unit vector",
    ])
  })

  test("accepts near-unit axes within 1e-3 and rejects beyond", () => {
    expect(validateMount(axe({ axis: [0, 0, -1.0009] }))).toEqual([])
    expect(validateMount(axe({ axis: [0, 0, -1.002] }))).toEqual(["mount.axis: expected a unit vector"])
  })

  test("rejects an edge that is not perpendicular to the axis", () => {
    const s = Math.SQRT1_2
    expect(validateMount(axe({ edge: [s, 0, -s] }))).toEqual(["mount.edge: expected perpendicular to axis"])
  })

  test("rejects malformed fields", () => {
    const bad = {
      slot: "hand.r",
      hands: 3,
      handle: [0, 0],
      axis: "up",
      edge: [1, 0, 0],
      scale: 0,
      clips: { Walk: { roll: "x", offset: [0], hide: false }, Idle: 4 },
    }
    expect(validateMount(bad)).toEqual([
      "mount.hands: expected 1 or 2",
      "mount.handle: expected [x, y, z]",
      "mount.axis: expected [x, y, z]",
      "mount.scale: expected a positive number",
      "mount.clips.Walk.roll: expected a number",
      "mount.clips.Walk.offset: expected [x, y, z]",
      "mount.clips.Walk.hide: expected true",
      "mount.clips.Idle: expected an object",
    ])
    expect(validateMount(null)).toEqual(["mount: expected an object"])
  })
})

describe("validateMounts (data/mounts.json)", () => {
  test("a valid file has no problems; problems carry the catalog id", () => {
    expect(validateMounts({ version: 1, mounts: { "kaykit-weapons/axe": axe() } })).toEqual([])
    expect(validateMounts({ version: 2, mounts: { "kaykit-weapons/axe": axe({ hands: 0 as 1 }) } })).toEqual([
      "version: expected 1, got 2",
      "mounts.kaykit-weapons/axe.hands: expected 1 or 2",
    ])
    expect(validateMounts({ version: 1 })).toEqual(["mounts: expected an object"])
  })
})

describe("catalog entries with a mount", () => {
  const palette = loadPalette(data)

  test("a worn piece with a valid compose.mount is a valid entry", () => {
    const hat = entry({
      id: "kaykit-adventurers/hat",
      compose: { front: null, streetEdge: null, attach: "worn", anchors: [], source: "manual", mount: axe() },
    })
    expect(validateEntry(hat, palette)).toEqual([])
  })

  test("a bad compose.mount is reported under compose.mount", () => {
    const sword = entry({
      id: "kaykit-weapons/sword",
      compose: {
        front: null,
        streetEdge: null,
        attach: "held",
        anchors: [],
        source: "manual",
        mount: axe({ slot: "foot" as MountSlot }),
      },
    })
    expect(validateEntry(sword, palette)).toEqual([
      'kaykit-weapons/sword: compose.mount.slot: unknown "foot"',
    ])
  })
})
