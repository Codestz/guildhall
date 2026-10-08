import { describe, expect, test } from "bun:test"
import { Object3D, PerspectiveCamera } from "three"
import { MARGIN, type Placed, place, placed, setContent } from "../src/scene/ChipLayer.tsx"

// Looking down -z from z = 10 on an 800 × 600 canvas: the origin projects to its centre.
const camera = new PerspectiveCamera(50, 800 / 600, 1, 101)
camera.position.set(0, 0, 10)
camera.updateMatrixWorld()
camera.updateProjectionMatrix()

/** A label at (x, y, z) with a stand-in for its outer box that counts style writes. */
function labelAt(x: number, y: number, z: number, zIndexRange: readonly [number, number] = [20, 0]) {
  const anchor = new Object3D()
  anchor.position.set(x, y, z)
  anchor.updateMatrixWorld()
  let writes = 0
  const values: Record<string, string> = {}
  const style = new Proxy(values, {
    set(target, key: string, value: string) {
      writes++
      target[key] = value
      return true
    },
  })
  const label: Placed = placed()
  label.attach({ style } as unknown as HTMLElement)
  label.anchor = anchor
  setContent(label, { children: null, style: undefined, className: undefined, center: true }, zIndexRange)
  return { label, style: values, writes: () => writes }
}

describe("label layer", () => {
  test("hidden until placed, then shown at the anchor's screen point", () => {
    const at = labelAt(0, 0, 0)
    expect(at.style.display).toBe("none")
    place([at.label], camera, 800, 600)
    expect(at.style.display).toBe("block")
    expect(at.style.transform).toBe("translate3d(400px,300px,0)")
  })

  test("a label behind the camera is not shown", () => {
    const behind = labelAt(0, 0, 20)
    place([behind.label], camera, 800, 600)
    expect(behind.style.display).toBe("none")
  })

  test("a label far off screen is not shown; one just past the edge still is", () => {
    // At z = 0 (10 from the camera) the 600 px height spans 2·10·tan(25°) ≈ 9.33 units: ~64 px a unit.
    const far = labelAt(30, 0, 0)
    const edge = labelAt(7, 0, 0)
    place([far.label, edge.label], camera, 800, 600)
    expect(far.style.display).toBe("none")
    expect(edge.style.display).toBe("block")
    expect(Number.parseFloat(edge.style.transform?.slice(12) ?? "")).toBeLessThan(800 + MARGIN)
  })

  test("nearer labels stack over farther ones (z-index by distance)", () => {
    const near = labelAt(0, 0, 5)
    const far = labelAt(0, 0, -50)
    place([near.label, far.label], camera, 800, 600)
    expect(Number(near.style.zIndex)).toBeGreaterThan(Number(far.style.zIndex))
  })

  test("nothing is written when nothing moved", () => {
    const still = labelAt(1, 1, 0)
    place([still.label], camera, 800, 600)
    const after = still.writes()
    place([still.label], camera, 800, 600)
    expect(still.writes()).toBe(after)
  })

  test("a label that leaves the view and comes back is shown again where it now stands", () => {
    const walker = labelAt(0, 0, 0)
    place([walker.label], camera, 800, 600)
    walker.label.anchor?.position.set(0, 0, 20)
    walker.label.anchor?.updateMatrixWorld()
    place([walker.label], camera, 800, 600)
    expect(walker.style.display).toBe("none")
    walker.label.anchor?.position.set(0, 0, 0)
    walker.label.anchor?.updateMatrixWorld()
    place([walker.label], camera, 800, 600)
    expect(walker.style.display).toBe("block")
    expect(walker.style.transform).toBe("translate3d(400px,300px,0)")
  })
})
