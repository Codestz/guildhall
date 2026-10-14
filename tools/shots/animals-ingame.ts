import { join, resolve } from "node:path"
import { openPage, waitReady } from "./src/app.ts"
import { launchChrome } from "./src/chrome.ts"
import { serveStudio } from "./src/server.ts"

const ROOT = resolve(import.meta.dir, "../..")
const THREE = join(ROOT, "packages/render/node_modules/three")
const PX = Number(process.env.PX ?? 650)
const PY = Number(process.env.PY ?? 236)
const HERO = Number(process.env.HERO ?? 1.0)
const DIST = Number(process.env.DIST ?? 6)
const CUBE = join(ROOT, "assets/src/kenney_cube-pets_1.0/Models/GLB format")
// [name, target height, dx, dz]. Debug-only: injects the animals into the live /town/1 scene via ext.stage; edits no game file.
const HERD = [
  ["cow", 0.8, 0, 0],
  ["cow", 0.8, 1.4, 0.6],
  ["pig", 0.45, -1.2, 0.9],
  ["pig", 0.45, 0.5, 1.4],
  ["pig", 0.45, 2.2, -0.3],
  ["chick", 0.15, -0.5, 1.9],
  ["chick", 0.15, 0.9, 2.2],
  ["chick", 0.15, 1.6, 1.7],
]

const server = await serveStudio(5691)
const browser = await launchChrome("animals-ingame")
try {
  const o = await openPage(browser, { size: { width: 1100, height: 620 } })
  await o.page.route("**/__cp/**", async (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname.replace("/__cp/", ""))
    const file = p.startsWith("hero")
      ? join(ROOT, "library/pieces/kaykit-adventurers/ranger.glb")
      : join(CUBE, p)
    await route.fulfill({
      body: Buffer.from(await Bun.file(file).arrayBuffer()),
      contentType: "model/gltf-binary",
    })
  })
  await o.page.goto(`${server.origin}/town/1`)
  await waitReady(o.page)
  await o.page.waitForTimeout(6000)
  const out = await o.page.evaluate(
    async ({ px, py, herd, hero, dist, three }) => {
      const g: any = (window as any).guildhall
      const st: any = g.ext.stage
      const cam = st.camera
      const rect = st.renderer.domElement.getBoundingClientRect()
      const ndc = [((px - rect.left) / rect.width) * 2 - 1, -((py - rect.top) / rect.height) * 2 + 1]
      const unproject = (z: number) => {
        const v = { x: ndc[0], y: ndc[1], z }
        const e = cam.projectionMatrixInverse.elements
        const w = e[3] * v.x + e[7] * v.y + e[11] * v.z + e[15]
        const vx = (e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12]) / w
        const vy = (e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13]) / w
        const vz = (e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14]) / w
        const m = cam.matrixWorld.elements
        return [
          m[0] * vx + m[4] * vy + m[8] * vz + m[12],
          m[1] * vx + m[5] * vy + m[9] * vz + m[13],
          m[2] * vx + m[6] * vy + m[10] * vz + m[14],
        ]
      }
      const a = unproject(-1)
      const b = unproject(1)
      const T3: any = await import(/* @vite-ignore */ `/@fs${three}/build/three.module.js`)
      const dir = new T3.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize()
      const rc = new T3.Raycaster(new T3.Vector3(a[0], a[1], a[2]), dir, 0, 500)
      const targets: any[] = []
      for (const c of st.scene.children)
        if (c.isMesh && !/sky|cloud|water|window|lamp|workfx|crowd|doorways/.test(c.name)) targets.push(c)
      const hits = rc.intersectObjects(targets, false)
      const planeY = hits.length ? hits[0].point.y : g.camera.get().target[1]
      const hit = hits.length
        ? [hits[0].point.x, hits[0].point.y, hits[0].point.z]
        : [a[0] + dir.x * ((planeY - a[1]) / dir.y), planeY, a[2] + dir.z * ((planeY - a[1]) / dir.y)]
      const { GLTFLoader } = await import(
        /* @vite-ignore */ `/@fs${three}/examples/jsm/loaders/GLTFLoader.js`
      )
      const { MeshoptDecoder } = await import(
        /* @vite-ignore */ `/@fs${three}/examples/jsm/libs/meshopt_decoder.module.js`
      )
      const loader = new GLTFLoader()
      loader.setMeshoptDecoder(MeshoptDecoder)
      const mixers: any[] = []
      const place = async (url: string, height: number, x: number, z: number, rot: number) => {
        const gl = await loader.loadAsync(url)
        const o = gl.scene
        o.traverse((m: any) => {
          if (m.isMesh) {
            m.castShadow = true
            m.frustumCulled = false
          }
        })
        // measure height from geometry boxes (bind pose)
        let minY = Infinity
        let maxY = -Infinity
        o.updateMatrixWorld(true)
        o.traverse((m: any) => {
          if (!m.isMesh) return
          m.geometry.computeBoundingBox()
          const bx = m.geometry.boundingBox
          const el = m.matrixWorld.elements
          for (const yy of [bx.min.y, bx.max.y])
            for (const xx of [bx.min.x, bx.max.x])
              for (const zz of [bx.min.z, bx.max.z]) {
                const wy = el[1] * xx + el[5] * yy + el[9] * zz + el[13]
                minY = Math.min(minY, wy)
                maxY = Math.max(maxY, wy)
              }
        })
        const s = height / (maxY - minY)
        o.scale.setScalar(s)
        o.position.set(hit[0] + x, hit[1] - minY * s, hit[2] + z)
        o.rotation.y = rot
        st.scene.add(o)
        return { s, h: maxY - minY }
      }
      const rep: any[] = []
      rep.push(await place("/__cp/hero.glb", hero, -2.2, 0.6, 0.6))
      let i = 0
      for (const [name, h, dx, dz] of herd)
        rep.push(
          await place(
            `/__cp/animal-${name}.glb`,
            h as number,
            dx as number,
            dz as number,
            0.5 + (i++ % 3) * 0.9,
          ),
        )
      await g.camera.set({
        target: [hit[0] + 0.3, hit[1] + 0.4, hit[2] + 0.8],
        azimuth: g.camera.get().azimuth,
        elevation: 32,
        distance: dist,
      })
      await new Promise((r) => setTimeout(r, 1500))
      return {
        hit,
        planeY,
        rep,
        n: hits.length,
        tn: targets.map((t: any) => t.name + ":" + t.geometry?.attributes?.position?.count).join(","),
        names: hits.slice(0, 3).map((h: any) => h.object.name),
      }
    },
    { px: PX, py: PY, herd: HERD, hero: HERO, dist: DIST, three: THREE },
  )
  console.log(JSON.stringify(out))
  await o.page.screenshot({ path: ".probe/animals2/farm-ingame.png" })
  console.log(o.errors.slice(0, 5))
} finally {
  await browser.close()
  await server.stop()
}
