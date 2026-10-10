import type { Change } from "@guildhall/core"
import { Script } from "./script.ts"

/**
 * A party that works across a monorepo's packages (`?story=crossing`, ~5 min): its deeds name files
 * under `packages/…`, so on an archipelago of the repo (`?repo=facebook/react`, each package an
 * island) each agent goes to the island of the package it works on, by ferry or bridge, and works
 * in its hall. The deeds are slow, as a crossing is: the ferries take a minute or two a link.
 * Written for React's packages; on a repo without them nobody has a package, and all stay home.
 */
export function crossing(seed = 1): Change[] {
  const script = new Script(seed)
  const master = script.guildmaster("Teach the native renderer the reconciler's new lanes", 0)
  master.think("Three packages move: shared, the reconciler and the native renderer. Split them.", 2800)
  master.deed("todowrite", { todos: ["map", "build", "verify"] }, 800)

  const mapper = master.quest(
    "guild-explorer",
    "Map the lane constants the packages share",
    (explorer) => {
      explorer.deed("glob", { pattern: "packages/shared/**" }, 20_000, { summary: "42 files" })
      explorer.deed("read", { filePath: "packages/shared/ReactFeatureFlags.js" }, 30_000)
      explorer.deed("read", { filePath: "packages/shared/ReactSymbols.js" }, 25_000)
      explorer.deed("search", { pattern: "enableLanes", path: "packages/shared" }, 20_000)
      explorer.deed("read", { filePath: "packages/shared/ReactTypes.js" }, 40_000)
      explorer.finish("Lane flags live in shared; the reconciler and the renderers read them.")
    },
    { wait: false },
  )
  const smith = master.quest(
    "guild-implementer",
    "Reconciler: yield between lanes of different priority",
    (worker) => {
      worker.deed("read", { filePath: "packages/react-reconciler/src/ReactFiberWorkLoop.js" }, 30_000)
      worker.deed("edit", { filePath: "packages/react-reconciler/src/ReactFiberWorkLoop.js" }, 45_000)
      worker.deed("edit", { filePath: "packages/react-reconciler/src/ReactFiberLane.js" }, 40_000)
      worker.deed("bash", { command: "yarn test reconciler" }, 30_000, { summary: "ok" })
      worker.deed("edit", { filePath: "packages/react-reconciler/src/ReactFiberLane.js" }, 35_000)
      worker.finish("The work loop yields between lanes.")
    },
    { wait: false },
  )
  const native = master.quest(
    "guild-architect",
    "Native renderer: keep its lanes in step",
    (architect) => {
      architect.deed("read", { filePath: "packages/react-native-renderer/src/ReactFabric.js" }, 25_000)
      architect.think("Fabric has its own scheduler hook; mirror the work loop's yield points.", 20_000)
      architect.deed("write", { filePath: "packages/react-native-renderer/src/ReactFabricLanes.js" }, 40_000)
      architect.deed("read", { filePath: "packages/react-native-renderer/src/ReactNativeTypes.js" }, 30_000)
      architect.deed(
        "write",
        { filePath: "packages/react-native-renderer/src/ReactFabricHostConfig.js" },
        40_000,
      )
      architect.finish("Fabric yields where the client does.")
    },
    { wait: false },
  )
  // react-dom and its bindings are joined by a bridge: the librarian goes over it on foot, from one to the other.
  const bound = master.quest(
    "guild-librarian",
    "Check what react-dom hands its bindings",
    (librarian) => {
      for (const file of [
        "ReactDOMRoot.js",
        "ReactDOMComponent.js",
        "ReactDOMInput.js",
        "ReactDOMEventListener.js",
      ])
        librarian.deed("read", { filePath: `packages/react-dom/src/client/${file}` }, 55_000)
      librarian.deed(
        "read",
        { filePath: "packages/react-dom-bindings/src/client/ReactDOMHostConfig.js" },
        40_000,
      )
      librarian.deed(
        "read",
        { filePath: "packages/react-dom-bindings/src/events/DOMPluginEventSystem.js" },
        40_000,
      )
      librarian.finish("react-dom hands its bindings the host config and the event system.")
    },
    { wait: false },
  )
  master.waitFor(mapper, smith, native, bound)
  master.finish("The reconciler yields between lanes; the native renderer follows.")
  return script.done()
}
