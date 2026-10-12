import { expect, test } from "bun:test"
import { appUrl } from "../src/app.ts"

const ORIGIN = "http://localhost:5301"

test("the index page sits at the root", () => {
  expect(appUrl(ORIGIN)).toBe(`${ORIGIN}/`)
})

test("the thumbs page is its own html file", () => {
  expect(appUrl(ORIGIN, "thumbs")).toBe(`${ORIGIN}/thumbs.html`)
})

test("a query string and a query record give the same deep link", () => {
  expect(appUrl(ORIGIN, "index", "screen=m0&hud=perf")).toBe(`${ORIGIN}/?screen=m0&hud=perf`)
  expect(appUrl(ORIGIN, "index", { screen: "m0", hud: "perf" })).toBe(`${ORIGIN}/?screen=m0&hud=perf`)
})
