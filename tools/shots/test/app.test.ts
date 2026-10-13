import { expect, test } from "bun:test"
import { appUrl, shaderError } from "../src/app.ts"

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

test("a shader that did not compile is an error however it was logged", () => {
  const dump =
    "THREE.WebGLProgram: Shader Error 0 - VALIDATE_STATUS false\n\nMaterial Name: water\nMaterial Type: MeshStandardMaterial\n\nProgram Info Log: Fragment shader is not compiled.\n\nFRAGMENT\n\nERROR: 0:812: 'uRevealSink' : undeclared identifier\n"
  expect(shaderError(dump)).toBe("shader: ERROR: 0:812: 'uRevealSink' : undeclared identifier")
  expect(shaderError("THREE.WebGLProgram: Program Info Log: warning X3557")).toBe(
    "shader: THREE.WebGLProgram: Program Info Log: warning X3557",
  )
  expect(shaderError("[studio:hexworld] info built {...}")).toBeNull()
  expect(shaderError("GET /lab/x 404")).toBeNull()
})
