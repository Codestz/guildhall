import { describe, expect, test } from "bun:test"
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from "three"
import { poseToCamera } from "../src/camera.ts"
import { boundingSphere, canvasPixels, fitSphere } from "../src/thumbnail.ts"

const RAD = Math.PI / 180

describe("fitSphere", () => {
  const square = { fov: 30, aspect: 1, azimuth: 35, elevation: 28, margin: 1 }

  test("stands where the sphere just touches the frame: r / sin(fov / 2)", () => {
    const pose = fitSphere([0, 1, 0], 2, square)
    expect(pose.distance).toBeCloseTo(2 / Math.sin(15 * RAD), 9)
  })

  test("the margin pushes the camera back in proportion", () => {
    const tight = fitSphere([0, 0, 0], 2, square).distance
    expect(fitSphere([0, 0, 0], 2, { ...square, margin: 1.2 }).distance).toBeCloseTo(tight * 1.2, 9)
  })

  test("distance grows linearly with the radius", () => {
    expect(fitSphere([0, 0, 0], 6, square).distance).toBeCloseTo(
      3 * fitSphere([0, 0, 0], 2, square).distance,
      9,
    )
  })

  test("a portrait view fits the narrower horizontal field", () => {
    const pose = fitSphere([0, 0, 0], 1, { ...square, aspect: 0.5 })
    const halfH = Math.atan(Math.tan(15 * RAD) * 0.5)
    expect(pose.distance).toBeCloseTo(1 / Math.sin(halfH), 9)
  })

  test("a landscape view still fits the vertical field", () => {
    expect(fitSphere([0, 0, 0], 1, { ...square, aspect: 2 }).distance).toBeCloseTo(1 / Math.sin(15 * RAD), 9)
  })

  test("aims at the centre from the asked angles", () => {
    const pose = fitSphere([3, 1, -2], 1, square)
    expect(pose).toMatchObject({ target: [3, 1, -2], azimuth: 35, elevation: 28 })
  })

  test("the sphere is inside the frustum from where the camera stands", () => {
    const pose = fitSphere([0, 1.5, 0], 1.5, square)
    const [x, y, z] = poseToCamera(pose)
    const away = Math.hypot(x, y - 1.5, z)
    expect(Math.asin(1.5 / away)).toBeLessThanOrEqual(15 * RAD + 1e-9)
  })

  test("an empty object (radius 0) frames a 1 m sphere, not a zero distance", () => {
    expect(fitSphere([0, 0, 0], 0, square).distance).toBeCloseTo(1 / Math.sin(15 * RAD), 9)
  })

  test("is deterministic: the same input gives the same pose", () => {
    expect(fitSphere([1, 2, 3], 4, square)).toEqual(fitSphere([1, 2, 3], 4, square))
  })
})

describe("boundingSphere", () => {
  test("encloses a moved box: centre at the box centre, radius half its diagonal", () => {
    const root = new Group()
    root.add(new Mesh(new BoxGeometry(2, 2, 2).translate(0, 1, 0), new MeshBasicMaterial()))
    root.position.set(5, 0, -1)
    const sphere = boundingSphere(root)
    expect(sphere.centre).toEqual([5, 1, -1])
    expect(sphere.radius).toBeCloseTo(Math.sqrt(3), 9)
  })

  test("an empty object has radius 0", () => {
    expect(boundingSphere(new Group()).radius).toBe(0)
  })
})

describe("canvasPixels", () => {
  test("flips GL's bottom-first rows to top-first", () => {
    // 2x2: bottom row red, top row blue, all opaque.
    const gl = new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255])
    expect([...canvasPixels(gl, 2).slice(0, 4)]).toEqual([0, 0, 255, 255])
    expect([...canvasPixels(gl, 2).slice(8, 12)]).toEqual([255, 0, 0, 255])
  })

  test("un-premultiplies an antialiased edge, so it keeps its colour instead of going dark", () => {
    const gl = new Uint8Array([100, 50, 0, 128])
    const [r, g, b, a] = canvasPixels(gl, 1)
    expect([r, g, b, a]).toEqual([199, 100, 0, 128])
  })

  test("leaves the transparent background transparent black", () => {
    expect([...canvasPixels(new Uint8Array(4), 1)]).toEqual([0, 0, 0, 0])
  })
})
