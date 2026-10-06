import { describe, expect, test } from "bun:test"
import { GuildStore } from "../src/guild/store.ts"

/**
 * GuildStore.hold / release (main.tsx holds, scene/Scene.tsx releases once the world has mounted):
 * every notification restarts the world's long first render, so while held none go out.
 */
describe("store: hold and release", () => {
  test("held, listeners stay silent while the version still moves; release notifies once", () => {
    const store = new GuildStore()
    let heard = 0
    store.subscribe(() => heard++)
    store.hold()
    const before = store.snapshot()
    for (let i = 0; i < 20; i++) store.tick(50)
    store.select("someone")
    expect(heard).toBe(0)
    expect(store.snapshot()).toBeGreaterThan(before)
    store.release()
    expect(heard).toBe(1)
    // A second release (the safety timer after the world's own) is a no-op.
    store.release()
    expect(heard).toBe(1)
    // Released, every change notifies again.
    store.select(null)
    expect(heard).toBe(2)
  })

  test("release without a hold notifies nothing", () => {
    const store = new GuildStore()
    let heard = 0
    store.subscribe(() => heard++)
    store.release()
    expect(heard).toBe(0)
  })
})
