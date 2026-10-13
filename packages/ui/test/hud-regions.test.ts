import { describe, expect, test } from "bun:test"
import {
  HUD_INITIAL,
  type HudState,
  type HudStorage,
  hudReduce,
  loadHud,
  nextMode,
  saveHud,
} from "../src/viewer/hud.ts"

const memory = (): HudStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

describe("the HUD's regions", () => {
  test("opens minimal with every panel folded", () => {
    expect(HUD_INITIAL).toEqual({ mode: "minimal", open: null, back: null })
  })

  test("one panel at a time: opening one folds the one before", () => {
    let s: HudState = HUD_INITIAL
    s = hudReduce(s, { type: "toggle", id: "places" })
    expect(s.open).toBe("places")
    s = hudReduce(s, { type: "toggle", id: "chronicle" })
    expect(s.open).toBe("chronicle")
    s = hudReduce(s, { type: "open", id: "settings" })
    expect(s.open).toBe("settings")
    s = hudReduce(s, { type: "toggle", id: "settings" })
    expect(s.open).toBeNull()
  })

  test("a panel opened from another goes back to it on close", () => {
    let s = hudReduce(HUD_INITIAL, { type: "toggle", id: "places" })
    s = hudReduce(s, { type: "open", id: "dossier", from: "places" })
    expect(s).toMatchObject({ open: "dossier", back: "places" })
    s = hudReduce(s, { type: "close" })
    expect(s).toMatchObject({ open: "places", back: null })
    s = hudReduce(s, { type: "close" })
    expect(s.open).toBeNull()
  })

  test("H cycles Detailed → Minimal → Hidden → Detailed", () => {
    expect(nextMode("minimal")).toBe("hidden")
    expect(nextMode("hidden")).toBe("detailed")
    expect(nextMode("detailed")).toBe("minimal")
    let s = HUD_INITIAL
    const seen = [s.mode]
    for (let i = 0; i < 3; i++) {
      s = hudReduce(s, { type: "cycle" })
      seen.push(s.mode)
    }
    expect(seen).toEqual(["minimal", "hidden", "detailed", "minimal"])
  })

  test("collapse is remembered: a remembered panel left open or folded opens that way again", () => {
    const store = memory()
    const keep = ["places", "chronicle"]
    let s = hudReduce(HUD_INITIAL, { type: "toggle", id: "chronicle" })
    saveHud(store, "hall", s, keep)
    expect(loadHud(store, "hall", keep)).toEqual({ mode: "minimal", open: "chronicle", back: null })
    s = hudReduce(s, { type: "toggle", id: "chronicle" })
    s = hudReduce(s, { type: "mode", mode: "detailed" })
    saveHud(store, "hall", s, keep)
    expect(loadHud(store, "hall", keep)).toEqual({ mode: "detailed", open: null, back: null })
  })

  test("a dossier or a dialog is never remembered open, but the list it came from is", () => {
    const store = memory()
    const keep = ["places"]
    let s = hudReduce(HUD_INITIAL, { type: "toggle", id: "places" })
    s = hudReduce(s, { type: "open", id: "dossier", from: "places" })
    saveHud(store, "hall", s, keep)
    expect(loadHud(store, "hall", keep).open).toBe("places")
    saveHud(store, "hall", hudReduce(HUD_INITIAL, { type: "open", id: "settings" }), keep)
    expect(loadHud(store, "hall", keep).open).toBeNull()
  })

  test("each screen remembers its own, and broken or blocked storage falls back to the default", () => {
    const store = memory()
    saveHud(store, "a", { mode: "hidden", open: null, back: null }, [])
    expect(loadHud(store, "b", []).mode).toBe("minimal")
    store.data.set("gh.hud.a", "{not json")
    expect(loadHud(store, "a", [])).toEqual(HUD_INITIAL)
    store.data.set("gh.hud.a", JSON.stringify({ mode: "huge", open: "gone" }))
    expect(loadHud(store, "a", ["places"])).toEqual(HUD_INITIAL)
    const blocked: HudStorage = {
      getItem: () => {
        throw new Error("SecurityError")
      },
      setItem: () => {
        throw new Error("QuotaExceeded")
      },
    }
    expect(loadHud(blocked, "a", [])).toEqual(HUD_INITIAL)
    expect(() => saveHud(blocked, "a", HUD_INITIAL, [])).not.toThrow()
    expect(loadHud(null, "a", [])).toEqual(HUD_INITIAL)
  })
})
