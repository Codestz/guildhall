/**
 * Animal size comparison boards: each animal scaled on its own to a believable height against a KayKit
 * adventurer (hero = 1.0 = the hero's height) and a KayKit house tile. A standalone three.js page on its own
 * port (default 5690) rendered by headless Chrome; one small, focused picture per set.
 *   bun tools/shots/animals.ts [outDir] [set ...]      (sets: cubepets-farm, cubepets-wild, quaternius-farm, quaternius-wild)
 * Needs the library/ and assets/ checkouts next to the repo. Evaluation only; it touches no game file.
 */
import { mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { launchChrome } from "./src/chrome.ts"

const ROOT = resolve(import.meta.dir, "../..")
const PORT = Number(process.env.ANIMALS_PORT ?? 5690)
const THREE = join(ROOT, "packages/render/node_modules/three")
const CUBE = "/src/kenney_cube-pets_1.0/Models/GLB format/animal-"
const QA = "/lib/quaternius-animals/"
const QF = "/lib/quaternius-farm-animals/"

type Animal = { name: string; url: string; height: number }
const cube = (name: string, height: number): Animal => ({ name, url: `${CUBE}${name}.glb`, height })

const SETS: Record<string, { title: string; animals: Animal[] }> = {
  "cubepets-farm": {
    title: "Kenney Cube Pets, each to its own size",
    animals: [cube("cow", 0.8), cube("pig", 0.45), cube("chick", 0.15), cube("dog", 0.35), cube("cat", 0.25)],
  },
  "cubepets-wild": {
    title: "Kenney Cube Pets, wild",
    animals: [cube("bunny", 0.2), cube("fox", 0.35), cube("deer", 0.9), cube("hog", 0.5), cube("crab", 0.12)],
  },
  "quaternius-farm": {
    title: "Quaternius farm animals, same targets",
    animals: [
      { name: "cow", url: `${QF}cow.glb`, height: 0.8 },
      { name: "horse", url: `${QF}horse.glb`, height: 1.1 },
      { name: "sheep", url: `${QF}sheep.glb`, height: 0.55 },
      { name: "pig", url: `${QF}pig.glb`, height: 0.45 },
      { name: "pug", url: `${QF}pug.glb`, height: 0.3 },
    ],
  },
  "quaternius-wild": {
    title: "Quaternius wild animals, same targets",
    animals: [
      { name: "fox", url: `${QA}fox.glb`, height: 0.35 },
      { name: "deer", url: `${QA}deer.glb`, height: 0.75 },
      { name: "wolf", url: `${QA}wolf.glb`, height: 0.5 },
      { name: "alpaca", url: `${QA}alpaca.glb`, height: 1.0 },
      { name: "bull", url: `${QA}bull.glb`, height: 0.85 },
    ],
  },
}

const HTML = `<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:#3a4150;overflow:hidden;font:13px system-ui,sans-serif}
canvas{display:block}.l{position:absolute;color:#fff;text-shadow:0 1px 2px #000;transform:translateX(-50%);white-space:nowrap;font-size:12px}
#t{position:absolute;left:10px;top:8px;color:#fff;font-size:14px;font-weight:600}</style>
<div id=t></div>
<script type=importmap>{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type=module>
import * as T from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js"
const q = new URLSearchParams(location.search)
const set = await (await fetch("/set?name=" + q.get("set"))).json()
const W = innerWidth, H = innerHeight
const r = new T.WebGLRenderer({ antialias: true })
r.setSize(W, H); r.shadowMap.enabled = true; r.shadowMap.type = T.PCFShadowMap
r.toneMapping = T.ACESFilmicToneMapping; r.outputColorSpace = T.SRGBColorSpace
document.body.appendChild(r.domElement)
const scene = new T.Scene()
scene.background = new T.Color(0x3a4150)
scene.add(new T.HemisphereLight(0xcfe3ff, 0x5b6a48, 1.6))
const sun = new T.DirectionalLight(0xfff0d8, 3.2)
sun.position.set(-6, 9, 7); sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 6, bottom: -6, near: 1, far: 30 })
scene.add(sun)
const ground = new T.Mesh(new T.CircleGeometry(40, 64), new T.MeshStandardMaterial({ color: 0x59664f, roughness: 1 }))
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground)
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder)
const load = (u) => loader.loadAsync(encodeURI(u))
const mixers = []
const info = []
function prep(g, height, rotY) {
  const o = g.scene
  o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false } })
  const b0 = new T.Box3().setFromObject(o)
  const s = height / (b0.max.y - b0.min.y)
  const holder = new T.Group(); holder.add(o); o.scale.setScalar(s)
  o.updateMatrixWorld(true)
  const b = new T.Box3().setFromObject(o)
  o.position.y -= b.min.y
  holder.rotation.y = rotY
  holder.updateMatrixWorld(true)
  const bb = new T.Box3().setFromObject(holder)
  if (g.animations.length) {
    const mx = new T.AnimationMixer(o)
    const clip = g.animations.find((c) => /idle/i.test(c.name)) ?? g.animations[0]
    mx.clipAction(clip).play(); mx.setTime(0.35)
    mixers.push(mx)
  }
  return { holder, w: bb.max.x - bb.min.x, scale: s, native: b0.max.y - b0.min.y }
}
const hero = await load("/lib/kaykit-adventurers/ranger.glb")
const hh = prep(hero, 1.0, 0.35)
info.push({ name: "hero", native: hh.native })
const house = await load("/lib/kaykit-hexagon/building-home-a-red.glb")
const hs = prep(house, 2.7, -0.2)
info.push({ name: "house", native: hs.native })
let x = 0
hh.holder.position.set(x, 0, 0); scene.add(hh.holder)
const labels = [{ n: "hero 1.0", p: new T.Vector3(x, 0, 0.3) }]
x += hh.w / 2 + 0.35
for (const a of set.animals) {
  const g = await load(a.url)
  const p = prep(g, a.height, 0.55)
  x += p.w / 2
  p.holder.position.set(x, 0, 0.1); scene.add(p.holder)
  labels.push({ n: a.name + " " + a.height, p: new T.Vector3(x, 0, 0.5) })
  info.push({ name: a.name, native: p.native, scale: p.scale })
  x += p.w / 2 + 0.3
}
hs.holder.position.set(x + hs.w / 2 - 0.3, 0, -1.6); scene.add(hs.holder)
const cx = (x + hs.w) / 2
const cam = new T.PerspectiveCamera(19, W / H, 0.1, 100)
const dist = Math.max(10, (x + hs.w) * 0.95)
cam.position.set(cx - 0.3, 2.6, dist * 0.9 * 0.85 + 1)
cam.lookAt(cx - 0.3, 1.05, 0)
cam.updateMatrixWorld()
for (const m of mixers) m.update(0)
r.render(scene, cam)
for (const l of labels) {
  const v = l.p.clone().project(cam)
  const d = document.createElement("div"); d.className = "l"; d.textContent = l.n
  d.style.left = ((v.x + 1) / 2) * W + "px"; d.style.top = ((1 - v.y) / 2) * H + 4 + "px"
  document.body.appendChild(d)
}
document.getElementById("t").textContent = set.title + " (hero = 1.0 tall)"
window.__info = info; window.__ready = true
</script>`

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = decodeURIComponent(url.pathname)
    if (path === "/") return new Response(HTML, { headers: { "content-type": "text/html" } })
    if (path === "/set") return Response.json(SETS[url.searchParams.get("name") ?? ""])
    const roots: [string, string][] = [
      ["/three/", THREE],
      ["/lib/", join(ROOT, "library/pieces")],
      ["/src/", join(ROOT, "assets/src")],
    ]
    for (const [prefix, dir] of roots) {
      if (!path.startsWith(prefix)) continue
      const file = resolve(dir, path.slice(prefix.length))
      if (!file.startsWith(dir)) break
      const f = Bun.file(file)
      if (await f.exists()) return new Response(f)
    }
    return new Response("not found", { status: 404 })
  },
})

const out = resolve(process.argv[2] ?? ".probe/animals2")
mkdirSync(out, { recursive: true })
const wanted = process.argv.slice(3)
const names = wanted.length ? wanted : Object.keys(SETS)
const browser = await launchChrome("animals")
try {
  for (const name of names) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 420 } })
    page.on("response", (r) => r.status() >= 400 && console.log("[404]", r.url()))
    page.on("pageerror", (e) => console.log("[pageerror]", e.message))
    await page.goto(`http://localhost:${PORT}/?set=${name}`)
    await page.waitForFunction("window.__ready === true", undefined, { timeout: 30000 })
    console.log(name, JSON.stringify(await page.evaluate("window.__info")))
    await page.screenshot({ path: join(out, `${name}.png`) })
    await page.close()
  }
} finally {
  await browser.close()
  server.stop(true)
}
