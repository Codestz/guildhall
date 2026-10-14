/**
 * The contact shadows (props/contactShadow.ts): one shared draw for everything that asks, hidden while
 * every disc is at strength 0, grown by replacing the mesh (never a second draw), gone when the last
 * range is let go.
 */
import { describe, expect, test } from "bun:test"
import { InstancedMesh, Scene } from "three"
import { contactShadows } from "../src/props/contactShadow.ts"
import type { Stage } from "../src/stage.ts"

const stage = () => ({ scene: new Scene() }) as unknown as Stage
const meshes = (s: Stage) => s.scene.children.filter((c) => c instanceof InstancedMesh) as InstancedMesh[]

describe("contact shadows", () => {
  test("every range shares one draw, shown only while some disc has strength", () => {
    const s = stage()
    const a = contactShadows(s).range(3)
    const b = contactShadows(s).range(100)
    expect(contactShadows(s)).toBe(contactShadows(s))
    expect(meshes(s)).toHaveLength(1)
    expect(contactShadows(s).stats()).toMatchObject({ slots: 103, showing: 0, draws: 0 })
    a.set(0, 1, 2, 3, 0.5, 0.8)
    b.set(99, 4, 5, 6, 1, 1)
    expect(contactShadows(s).stats()).toMatchObject({ showing: 2, draws: 1 })
    const m = meshes(s)[0] as InstancedMesh
    expect(m.count).toBe(103)
    // its place and size: a disc of diameter 2r at the point, a little over the ground
    const e = m.instanceMatrix.array
    expect([e[0], e[10], e[12], e[14]]).toEqual([1, 1, 1, 3])
    expect(e[13] as number).toBeGreaterThan(2)
    // fading to nothing hides it, and the batch grows without a second draw
    b.set(99, 4, 5, 6, 1, 0)
    a.set(0, 1, 2, 3, 0.5, 0)
    expect(contactShadows(s).stats()).toMatchObject({ showing: 0, draws: 0 })
    const c = contactShadows(s).range(500)
    c.set(499, 0, 0, 0, 1, 1)
    expect(meshes(s)).toHaveLength(1)
    expect(contactShadows(s).stats()).toMatchObject({ slots: 603, showing: 1, draws: 1 })
    a.release()
    b.release()
    expect(meshes(s)).toHaveLength(1)
    c.release()
    expect(meshes(s)).toHaveLength(0)
  })

  test("a disc too small or too faint shows nothing, and a released range is inert", () => {
    const s = stage()
    const a = contactShadows(s).range(2)
    const keep = contactShadows(s).range(1)
    a.set(0, 0, 0, 0, 0.005, 1)
    a.set(1, 0, 0, 0, 1, 0.001)
    expect(contactShadows(s).stats().showing).toBe(0)
    a.set(0, 0, 0, 0, 1, 1)
    a.release()
    a.set(1, 0, 0, 0, 1, 1)
    expect(contactShadows(s).stats().showing).toBe(0)
    keep.release()
  })
})
