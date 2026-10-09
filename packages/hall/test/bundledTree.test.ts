import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { treeStem } from "../src/world/chronicle/bundled.ts"

describe("bundled tree names", () => {
  test("react/react (Harbour's link) finds the facebook/react fixture, in any case", () => {
    expect(treeStem("react/react")).toBe("facebook__react")
    expect(treeStem("React/React")).toBe("facebook__react")
    expect(treeStem("facebook/react")).toBe("facebook__react")
    expect(existsSync(join(import.meta.dir, "fixtures/repos", `${treeStem("react/react")}.json`))).toBe(true)
  })

  test("other repos keep their own spelling", () => {
    expect(treeStem("Codestz/mcpx")).toBe("codestz__mcpx")
  })
})
