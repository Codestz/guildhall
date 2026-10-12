import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { createServer, request, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as data from "../src/data.ts"
import { copyData, dataHandler, dataRoute, formatData, MAX_DATA_BYTES } from "../vite.config.ts"

/** A dressing-only stall: the smallest prefab recipe validatePrefab accepts. */
const stall = () => ({
  version: 1,
  id: "demo",
  kind: "stall",
  tags: ["market"],
  fits: {},
  dressing: [{ piece: "kenney-town/barrel", x: 1, y: 0, z: 2, rot: 0, scale: 1 }],
  anchors: [],
})

const npc = () => ({
  version: 1,
  id: "farmer",
  role: "farmer",
  body: ["kaykit-adventurers/barbarian"],
  outfit: {},
  activity: { work: "Pickaxing", idle: ["Idle"], walk: "Walking_A" },
  vary: { height: [0.96, 1.04], speed: [0.9, 1.1] },
})

const mounts = () => ({
  version: 1,
  mounts: {
    "kaykit-weapons/axe": { slot: "hand.r", hands: 1, handle: [0, 0, 0], axis: [0, 1, 0], edge: [1, 0, 0] },
  },
})

describe("dataRoute", () => {
  test("accepts <id>.json in every known data folder, and mounts.json", () => {
    for (const path of [
      "recipes/houses/demo.json",
      "recipes/landmarks/a.json",
      "recipes/stalls/fish-stall.json",
      "recipes/docks/a.json",
      "recipes/farm/a.json",
      "npcs/farmer.json",
      "tiles/tavern-yard.json",
      "mounts.json",
    ])
      expect(dataRoute(path)).not.toBeNull()
  })

  test("refuses traversal, absolute paths, unknown folders, odd names and non-JSON", () => {
    for (const path of [
      "",
      "../secret.json",
      "/etc/passwd.json",
      "recipes/../mounts.json",
      "recipes/houses/../../x.json",
      "npcs/../npcs/a.json",
      "recipes/castles/a.json",
      "recipes/houses.json",
      "recipes/a.json",
      "npcs/sub/a.json",
      "npcs/.hidden.json",
      "npcs/Farmer.json",
      "npcs\\farmer.json",
      "npcs/farmer.txt",
      "npcs/farmer.json.bak",
      "npcs/farmer.json/",
      "npcs/far\0mer.json",
      "other/mounts.json",
    ])
      expect(dataRoute(path)).toBeNull()
  })

  test("routes each folder to its S1 validator", () => {
    expect(dataRoute("recipes/stalls/demo.json")?.(stall())).toEqual([])
    expect(dataRoute("recipes/stalls/demo.json")?.(npc()).length).toBeGreaterThan(0)
    expect(dataRoute("npcs/farmer.json")?.(npc())).toEqual([])
    expect(dataRoute("npcs/farmer.json")?.(stall()).length).toBeGreaterThan(0)
    expect(dataRoute("mounts.json")?.(mounts())).toEqual([])
    expect(dataRoute("mounts.json")?.(npc()).length).toBeGreaterThan(0)
    const tile = { id: "demo", name: "Demo", ground: "grass", pieces: [] }
    expect(dataRoute("tiles/demo.json")?.(tile)).toEqual([])
    // a tile file must be named after its id
    expect(dataRoute("tiles/other.json")?.(tile).join()).toContain("file's name")
    expect(dataRoute("tiles/demo.json")?.(npc()).length).toBeGreaterThan(0)
  })
})

describe("formatData", () => {
  test("sorts keys at every depth, keeps array order, indents 2 and ends with a newline", () => {
    expect(formatData({ b: 1, a: { d: [2, 1], c: null } })).toBe(
      '{\n  "a": {\n    "c": null,\n    "d": [\n      2,\n      1\n    ]\n  },\n  "b": 1\n}\n',
    )
  })

  test("is byte-stable whatever order the keys arrive in", () => {
    expect(formatData({ y: { q: 1, p: 2 }, x: [] })).toBe(formatData({ x: [], y: { p: 2, q: 1 } }))
  })
})

let root = ""
let servers: Server[] = []

/** Serves the handler over `root` on a loopback port and returns its `/data` base url. */
async function serve(write = true): Promise<string> {
  const handler = dataHandler(root, { write })
  const server = createServer((req, res) =>
    handler(req, res, () => {
      res.statusCode = 418
      res.end()
    }),
  )
  servers.push(server)
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/data`
}

const put = (url: string, body: string, headers: Record<string, string> = {}) =>
  fetch(url, { method: "PUT", headers: { "Content-Type": "application/json", ...headers }, body })

/** A PUT with the path sent as given (fetch resolves dot segments first; bun's server still folds `%2e%2e`). */
function rawPut(base: string, path: string): Promise<number> {
  const { port } = new URL(base)
  return new Promise((done, fail) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: `/data/${path}`,
        method: "PUT",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        res.resume()
        done(res.statusCode ?? 0)
      },
    )
    req.on("error", fail)
    req.end("{}")
  })
}

beforeEach(async () => {
  for (const s of servers) s.close()
  servers = []
  if (root) await rm(root, { recursive: true, force: true })
  root = await mkdtemp(join(tmpdir(), "guildhall-data-"))
  await mkdir(join(root, "data"))
  root = join(root, "data")
})

afterAll(async () => {
  for (const s of servers) s.close()
  await rm(join(root, ".."), { recursive: true, force: true })
})

describe("PUT /data/", () => {
  test("a bad recipe gets 422 with the validator's problems, and nothing is written", async () => {
    const base = await serve()
    const response = await put(
      `${base}/recipes/stalls/demo.json`,
      JSON.stringify({ ...stall(), kind: "castle" }),
    )
    expect(response.status).toBe(422)
    expect(((await response.json()) as { problems: string[] }).problems).toEqual(['kind: unknown "castle"'])
    expect(await readdir(root)).toEqual([])
  })

  test("a good recipe is written sorted and byte-stable, with no temporary file left", async () => {
    const base = await serve()
    const first = await put(`${base}/recipes/stalls/demo.json`, JSON.stringify(stall()))
    expect(first.status).toBe(200)
    const file = join(root, "recipes/stalls/demo.json")
    const written = await readFile(file, "utf8")
    expect(written).toBe(formatData(stall()))

    const reordered = Object.fromEntries(Object.entries(stall()).reverse())
    await put(`${base}/recipes/stalls/demo.json`, JSON.stringify(reordered))
    expect(await readFile(file, "utf8")).toBe(written)
    expect(await readdir(join(root, "recipes/stalls"))).toEqual(["demo.json"])
  })

  test("encoded traversal and unknown folders are 404 and write nothing", async () => {
    const base = await serve()
    for (const path of [
      "recipes%2f..%2f..%2fescape.json",
      "%2Fetc%2Fescape.json",
      "npcs/..%5c..%5cescape.json",
      "x/a.json",
    ])
      expect(await rawPut(base, path)).toBe(404)
    expect(await rawPut(base, "%E0%A4%A.json")).toBe(400)
    expect(await readdir(join(root, ".."))).toEqual(["data"])
  })

  test("a symlinked folder or file under data/ is refused, for writes and reads", async () => {
    const outside = await mkdtemp(join(tmpdir(), "guildhall-outside-"))
    await writeFile(join(outside, "farmer.json"), "{}")
    await symlink(outside, join(root, "npcs"))
    await mkdir(join(root, "recipes/farm"), { recursive: true })
    await symlink(join(outside, "farmer.json"), join(root, "recipes/farm/a.json"))
    const base = await serve()
    expect((await put(`${base}/npcs/farmer.json`, JSON.stringify(npc()))).status).toBe(403)
    expect((await put(`${base}/recipes/farm/a.json`, "{}")).status).toBe(403)
    expect((await fetch(`${base}/npcs/farmer.json`)).status).toBe(403)
    expect((await fetch(`${base}/npcs/`)).status).toBe(403)
    expect(await readFile(join(outside, "farmer.json"), "utf8")).toBe("{}")
    await rm(outside, { recursive: true, force: true })
  })

  test("bodies over the size cap are 413", async () => {
    const base = await serve()
    const big = JSON.stringify({ ...stall(), tags: ["x".repeat(MAX_DATA_BYTES)] })
    expect((await put(`${base}/recipes/stalls/demo.json`, big)).status).toBe(413)
  })

  test("only JSON: another content type is 415, an unparsable body 400", async () => {
    const base = await serve()
    const url = `${base}/recipes/stalls/demo.json`
    expect((await put(url, JSON.stringify(stall()), { "Content-Type": "text/plain" })).status).toBe(415)
    expect((await put(url, "{ nope")).status).toBe(400)
  })

  test("a write from a page on another origin is 403", async () => {
    const base = await serve()
    const url = `${base}/recipes/stalls/demo.json`
    expect((await put(url, JSON.stringify(stall()), { Origin: "https://evil.example" })).status).toBe(403)
    expect((await put(url, JSON.stringify(stall()), { Origin: "http://localhost:5300" })).status).toBe(200)
  })

  test("the preview server reads but never writes", async () => {
    const base = await serve(false)
    expect((await put(`${base}/recipes/stalls/demo.json`, JSON.stringify(stall()))).status).toBe(405)
    expect(await readdir(root)).toEqual([])
  })
})

describe("data client", () => {
  test("save, list and load round-trip through the endpoint", async () => {
    const base = await serve()
    expect(await data.list("recipes/stalls", fetch, base)).toEqual([])
    expect(await data.save("recipes/stalls", "demo", stall(), fetch, base)).toEqual({ ok: true })
    expect(await data.list("recipes/stalls", fetch, base)).toEqual(["demo"])
    expect(await data.load("recipes/stalls", "demo", fetch, base)).toEqual(stall())
  })

  test("a refused save returns the status and problems; a missing file loads as null", async () => {
    const base = await serve()
    const result = await data.save("npcs", "farmer", { ...npc(), body: [] }, fetch, base)
    expect(result).toEqual({ ok: false, status: 422, problems: ["body: expected at least one character id"] })
    expect(await data.load("npcs", "farmer", fetch, base)).toBeNull()
  })

  test("mounts: no file is an empty overlay; a saved file comes back as the overlay", async () => {
    const base = await serve()
    expect(await data.loadOverlay(fetch, base)).toEqual({})
    expect(await data.saveMounts(mounts() as never, fetch, base)).toEqual({ ok: true })
    expect(await data.loadOverlay(fetch, base)).toEqual({ mounts: mounts().mounts } as never)
  })
})

describe("showcase data", () => {
  test("copyData ships mounts and every valid id, and an index of each folder's ids", async () => {
    const from = await mkdtemp(join(tmpdir(), "gh-showcase-from-"))
    const out = await mkdtemp(join(tmpdir(), "gh-showcase-out-"))
    await mkdir(join(from, "recipes/houses"), { recursive: true })
    await writeFile(join(from, "mounts.json"), "{}\n")
    await writeFile(join(from, "recipes/houses/cottage.json"), "{}\n")
    await writeFile(join(from, "recipes/houses/Not An Id.json"), "{}\n")
    await writeFile(join(from, "recipes/houses/notes.txt"), "x")
    expect(await copyData(from, out)).toEqual({ "recipes/houses": ["cottage"] })
    expect(JSON.parse(await readFile(join(out, "index.json"), "utf8"))).toEqual({
      "recipes/houses": ["cottage"],
    })
    expect((await readdir(join(out, "recipes/houses"))).sort()).toEqual(["cottage.json"])
    expect(await readFile(join(out, "mounts.json"), "utf8")).toBe("{}\n")
    await rm(from, { recursive: true })
    await rm(out, { recursive: true })
  })

  test("a static build lists a folder from the index; a folder it does not name is empty", async () => {
    const index = { "recipes/houses": ["cottage", "tavern"] }
    const asked: string[] = []
    const fetcher = async (url: string) => {
      asked.push(url)
      return { ok: true, status: 200, json: async () => index } as never
    }
    expect(await data.list("recipes/houses", fetcher, "/data", true)).toEqual(["cottage", "tavern"])
    expect(await data.list("npcs", fetcher, "/data", true)).toEqual([])
    expect(asked).toEqual(["/data/index.json", "/data/index.json"])
  })
})
