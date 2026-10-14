/**
 * The undead's poses (undead/pose.ts): a pure function of the grave's times, so a scrub and a play draw
 * the same skeleton; it lies, claws up, keeps vigil (taunting on its own beat), reels at the blow, dies
 * and goes under, and is gone when its show ends.
 */
import { describe, expect, test } from "bun:test"
import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
} from "three"
import { boneRiders } from "../src/crowd/parts.ts"
import {
  BURIED,
  DIE_MS,
  SINK_DOWN_MS,
  STIR_MS,
  SUNK,
  type UndeadFigure,
  undeadPose,
  undeadPuffs,
} from "../src/undead/index.ts"

const f: UndeadFigure = {
  id: "g",
  slot: 0,
  kind: "warrior",
  rise: 1000,
  vigil: 3800,
  strike: 20_000,
  sink: 20_600,
}

describe("undeadPose", () => {
  test("lies still, claws up out of the earth, stands", () => {
    expect(undeadPose(f, 999)).toBeNull()
    expect(undeadPose(f, 1000)).toEqual({
      clip: "Skeletons_Inactive_Floor_Pose",
      phase: 0,
      y: BURIED,
      forward: 0,
    })
    const up = undeadPose(f, 1000 + STIR_MS + 300)!
    expect(up.clip).toBe("Skeletons_Awaken_Floor")
    expect(up.y).toBeLessThan(0)
    expect(up.y).toBeGreaterThan(BURIED)
    expect(undeadPose(f, 3700)!.y).toBe(0)
    expect(undeadPose(f, 3800)!.clip).toBe("Skeletons_Idle")
  })

  test("keeps vigil, taunting now and then on its own beat", () => {
    const clips = new Set<string>()
    for (let t = 3800; t < 19_000; t += 50) clips.add(undeadPose(f, t)!.clip)
    expect([...clips].sort()).toEqual(["Skeletons_Idle", "Skeletons_Taunt"])
    // another skeleton taunts at other times
    const other = { ...f, id: "h" }
    let differ = 0
    for (let t = 3800; t < 19_000; t += 50)
      if (undeadPose(other, t)!.clip !== undeadPose(f, t)!.clip) differ++
    expect(differ).toBeGreaterThan(0)
  })

  test("reels at the blow, dies falling back onto its grave, goes under and is gone", () => {
    expect(undeadPose(f, 20_000)!.clip).toBe("Hit_A")
    const dying = undeadPose(f, 20_600 + 800)!
    expect(dying.clip).toBe("Skeletons_Death")
    expect(dying.y).toBe(0)
    expect(dying.forward).toBeGreaterThan(0)
    const sinking = undeadPose(f, 20_600 + DIE_MS + SINK_DOWN_MS / 2)!
    expect(sinking.y).toBeLessThan(0)
    expect(sinking.y).toBeGreaterThan(SUNK)
    expect(undeadPose(f, 20_600 + 2600)).toBeNull()
  })

  test("a pure sample: the same at every t however it is reached, and its puffs as it rises and goes under", () => {
    for (let t = 900; t < 24_000; t += 333) expect(undeadPose(f, t)).toEqual(undeadPose({ ...f }, t))
    expect(undeadPuffs(f)).toEqual([1000 + STIR_MS, 20_600 + DIE_MS])
  })
})

describe("boneRiders", () => {
  test("a rigid hat on a bone becomes a skinned part bound whole to that bone", () => {
    const root = new Group()
    const hips = new Bone()
    hips.name = "hips"
    const head = new Bone()
    head.name = "head"
    head.position.set(0, 1, 0)
    hips.add(head)
    root.add(hips)
    const g = new BufferGeometry()
    g.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, 0, 1, 0, 1, 0, 0]), 3))
    g.setAttribute("skinIndex", new BufferAttribute(new Uint16Array(12), 4))
    g.setAttribute(
      "skinWeight",
      new BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4),
    )
    const body = new SkinnedMesh(g, new MeshBasicMaterial())
    root.add(body)
    root.updateMatrixWorld(true)
    body.bind(new Skeleton([hips, head]))
    const hat = new Mesh(
      new BufferGeometry().setAttribute("position", new BufferAttribute(new Float32Array([0, 0.2, 0]), 3)),
      new MeshBasicMaterial(),
    )
    hat.name = "Hat"
    head.add(hat)
    const [rider] = boneRiders(root)
    expect(rider?.name).toBe("Hat")
    expect(rider!.geometry.getAttribute("skinIndex").getX(0)).toBe(1)
    expect(rider!.geometry.getAttribute("skinWeight").getX(0)).toBe(1)
    // in the bind space: where it hangs at rest, the head's 1 m up plus its own 0.2
    expect(rider!.geometry.getAttribute("position").getY(0)).toBeCloseTo(1.2, 6)
  })
})
