import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { connect } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startHub } from "../src/index.ts"

/** A built hall as Vite lays it out: index.html, fingerprinted bundles, and public/ files beside them. */
const hall = mkdtempSync(join(tmpdir(), "guildhall-hall-"))
mkdirSync(join(hall, "assets", "characters"), { recursive: true })
mkdirSync(join(hall, ".vite"))
writeFileSync(join(hall, "index.html"), "<!doctype html><title>Guildhall</title>")
writeFileSync(join(hall, "assets", "index-CQvrk4PR.js"), "console.log(1)")
writeFileSync(join(hall, "assets", "index-xWqFjJ8V.css"), "body{}")
writeFileSync(join(hall, "assets", "characters", "rogue-hooded.glb"), "glTF")
writeFileSync(join(hall, ".vite", "manifest.json"), "{}")
const outside = mkdtempSync(join(tmpdir(), "guildhall-outside-"))
writeFileSync(join(outside, "secret.txt"), "secret")

const home = mkdtempSync(join(tmpdir(), "guildhall-hub-"))
const hub = startHub({ port: 0, home, hall })
const bare = startHub({ port: 0, home })
const base = `http://127.0.0.1:${hub.port}`
afterAll(() => {
  hub.stop(true)
  bare.stop(true)
})

/** A request written by hand, so the path and Host reach the hub exactly as written. */
function raw(path: string, host = `127.0.0.1:${hub.port}`): Promise<string> {
  return new Promise((done) => {
    const socket = connect(hub.port as number, "127.0.0.1")
    let reply = ""
    socket.on("data", (chunk) => {
      reply += String(chunk)
    })
    socket.on("close", () => done(reply))
    socket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`)
  })
}

describe("hub serves the hall", () => {
  test("/ is index.html, revalidated on every load", async () => {
    const response = await fetch(`${base}/`)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toStartWith("text/html")
    expect(response.headers.get("cache-control")).toBe("no-cache")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(await response.text()).toContain("<title>Guildhall</title>")
  })

  test("fingerprinted bundles carry their type and are cached for good", async () => {
    const script = await fetch(`${base}/assets/index-CQvrk4PR.js`)
    expect(script.headers.get("content-type")).toStartWith("text/javascript")
    expect(script.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")
    expect(await script.text()).toBe("console.log(1)")
    const style = await fetch(`${base}/assets/index-xWqFjJ8V.css`)
    expect(style.headers.get("content-type")).toStartWith("text/css")
  })

  test("a model keeps its name, so it is revalidated, and an unchanged one answers 304", async () => {
    const first = await fetch(`${base}/assets/characters/rogue-hooded.glb`)
    expect(first.headers.get("content-type")).toBe("model/gltf-binary")
    expect(first.headers.get("cache-control")).toBe("no-cache")
    const lastModified = first.headers.get("last-modified")
    expect(lastModified).toBeTruthy()
    const again = await fetch(`${base}/assets/characters/rogue-hooded.glb`, {
      headers: { "if-modified-since": lastModified ?? "" },
    })
    expect(again.status).toBe(304)
  })

  test("a missing file, a directory or a dotfile is a 404", async () => {
    expect((await fetch(`${base}/nope.js`)).status).toBe(404)
    expect((await fetch(`${base}/assets`)).status).toBe(404)
    expect((await fetch(`${base}/.vite/manifest.json`)).status).toBe(404)
  })

  test("nothing outside the hall's directory is served, however the path is spelled", async () => {
    const name = outside.split("/").at(-1)
    for (const path of [
      `/../${name}/secret.txt`,
      `/%2e%2e/${name}/secret.txt`,
      `/assets/..%2f..%2f${name}%2fsecret.txt`,
      "/%00",
    ]) {
      const reply = await raw(path)
      expect(reply).not.toContain("secret")
      expect(reply).toMatch(/^HTTP\/1\.1 (400|404)/)
    }
  })

  test("only GET and HEAD", async () => {
    const head = await fetch(`${base}/`, { method: "HEAD" })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe("")
    expect((await fetch(`${base}/`, { method: "PUT", body: "x" })).status).toBe(405)
  })

  test("a page under another name (DNS rebinding) gets nothing", async () => {
    expect(await raw("/", `evil.example:${hub.port}`)).toStartWith("HTTP/1.1 404")
    expect(await raw("/", `localhost:${hub.port}`)).toStartWith("HTTP/1.1 200")
  })

  test("the API still answers beside it", async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200)
  })

  test("a hub with no hall serves only its API", async () => {
    expect((await fetch(`http://127.0.0.1:${bare.port}/`)).status).toBe(404)
  })
})
