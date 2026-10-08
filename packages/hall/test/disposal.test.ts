import { describe, expect, test } from "bun:test"
import {
  BatchedMesh,
  BufferGeometry,
  type EventDispatcher,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  Texture,
} from "three"
import { shadows } from "../src/scene/atmosphere/shadows.ts"
import { meadow } from "../src/scene/nature/Grass.tsx"
import { freeMeshes, ownLayer } from "../src/scene/owned.ts"
import { fall } from "../src/scene/weather/Precipitation.tsx"

describe("scene resources", () => {
  test("snow's material is built without an undefined parameter (three warns about those)", () => {
    const warn = console.warn
    const warnings: unknown[][] = []
    console.warn = (...args: unknown[]) => warnings.push(args)
    try {
      fall("snow", 10)
      fall("rain", 10)
    } finally {
      console.warn = warn
    }
    expect(warnings).toEqual([])
  })

  test("rebuilding the meadow frees the shared flower geometry's buffers before replacing its tints", () => {
    const geometry = () => {
      const g = new BufferGeometry()
      g.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
      return g
    }
    const geometries = { tuft: geometry(), flower: geometry() }
    const material = { tuft: new ShaderMaterial(), flower: new ShaderMaterial() }
    let freed = 0
    geometries.flower.addEventListener("dispose", () => freed++)
    meadow(geometries, material, 150)
    const first = geometries.flower.getAttribute("aTint")
    expect(freed).toBe(0)
    meadow(geometries, material, 240)
    expect(geometries.flower.getAttribute("aTint")).not.toBe(first)
    // The renderer drops a geometry's GPU buffers on "dispose": without it the old tints leak.
    expect(freed).toBe(1)
  })
})

describe("owned GPU layers (scene/owned.ts)", () => {
  /** Counts "dispose" events: the renderer frees an object's GPU side on exactly that event. */
  const watch = (...targets: EventDispatcher<{ dispose: object }>[]) => {
    const freed = new Map(targets.map((t) => [t, 0]))
    for (const t of targets) t.addEventListener("dispose", () => freed.set(t, (freed.get(t) ?? 0) + 1))
    return freed
  }
  const plane = () => new PlaneGeometry(1, 1)

  test("freeing an instanced layer frees the mesh, its geometry, its material and that material's texture", () => {
    const texture = new Texture()
    const material = new MeshBasicMaterial({ map: texture })
    const geometry = plane()
    const mesh = new InstancedMesh(geometry, material, 4)
    const parent = new Group().add(mesh)
    const freed = watch(mesh, geometry, material, texture)

    freeMeshes([mesh])

    expect([...freed.values()]).toEqual([1, 1, 1, 1])
    // Out of the scene at once: nothing draws it in the frame before React removes the primitive.
    expect(parent.children).not.toContain(mesh)
  })

  test("a freed BatchedMesh drops its own textures, and borrowed materials are left alone", () => {
    const texture = new Texture()
    const shared = new MeshStandardMaterial({ map: texture })
    const batch = new BatchedMesh(1, 4, 6, shared)
    batch.addInstance(batch.addGeometry(plane()))
    const matrices = (batch as unknown as { _matricesTexture: Texture })._matricesTexture
    const freed = watch(batch.geometry, matrices, shared, texture)

    freeMeshes([batch], "materials")

    expect(freed.get(batch.geometry)).toBe(1)
    expect(freed.get(matrices)).toBe(1)
    expect(freed.get(shared)).toBe(0)
    expect(freed.get(texture)).toBe(0)
  })

  test("borrowed textures: the layer's material copy is freed, the model's texture it shares is not", () => {
    const texture = new Texture()
    const copy = new MeshStandardMaterial({ map: texture })
    const freed = watch(copy, texture)

    freeMeshes([new InstancedMesh(plane(), copy, 1)], "textures")

    expect(freed.get(copy)).toBe(1)
    expect(freed.get(texture)).toBe(0)
  })

  test("a geometry and material shared by two meshes are each freed once", () => {
    const geometry = plane()
    const material = new MeshBasicMaterial()
    const freed = watch(geometry, material)

    freeMeshes([new InstancedMesh(geometry, material, 1), new InstancedMesh(geometry, material, 1)])

    expect([...freed.values()]).toEqual([1, 1])
  })

  test("a layer that casts asks for a shadow redraw when built and when freed; one that doesn't, never", () => {
    const layer = (casts: boolean) => () => {
      const mesh = new InstancedMesh(plane(), new MeshBasicMaterial(), 1)
      mesh.castShadow = casts
      return { meshes: [mesh] }
    }
    shadows.dirty = false
    const caster = ownLayer(layer(true))
    expect(shadows.dirty).toBe(true)
    shadows.dirty = false
    caster.free()
    expect(shadows.dirty).toBe(true)

    shadows.dirty = false
    ownLayer(layer(false)).free()
    expect(shadows.dirty).toBe(false)
  })

  test("ownLayer frees exactly what its build made", () => {
    const owned = ownLayer(() => ({ meshes: [new InstancedMesh(plane(), new MeshBasicMaterial(), 1)] }))
    const mesh = owned.layer.meshes[0] as InstancedMesh
    const freed = watch(mesh.geometry, mesh.material as MeshBasicMaterial)

    owned.free()

    expect([...freed.values()]).toEqual([1, 1])
  })
})
