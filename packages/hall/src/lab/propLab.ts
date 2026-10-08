import { Group, Mesh, MeshStandardMaterial, type Object3D } from "three"
import { PROP_GRIPS } from "../scene/grips.ts"
import type { Held, Tool } from "../world/behaviours.ts"
import { KIT_URL } from "../world/cast.ts"
import { createStage, load } from "./stage.ts"

/**
 * The prop lab (dev only, `?lab=prop&piece=lantern`): one thing alone from four sides, in its own
 * model axes. `piece` is a kit.glb node (`pickaxe`, `lantern`, `mug_full`…) or a prop the hall
 * draws itself (`log`, `fish`, `bow`… scene/grips.ts PROP_GRIPS; its open form beside it, if it
 * opens). `window.lab.show(piece)` swaps it in place; `lab.pieces()` lists every name.
 */
export async function start(root: HTMLElement, params: URLSearchParams): Promise<void> {
  const stage = createStage(root)
  const kit = await load(KIT_URL)
  const nodes = new Map<string, Object3D>()
  kit.scene.traverse((node) => {
    if (node !== kit.scene && node.name) nodes.set(node.name, node)
  })
  const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 })
  let shown: Object3D | undefined

  function made(kind: Held | Tool): Object3D {
    const grip = PROP_GRIPS[kind]
    const closed = new Mesh(grip.make(), material)
    if (!grip.open) return closed
    const both = new Group()
    const open = new Mesh(grip.open.make(), material)
    open.position.x = 0.8
    both.add(closed, open)
    return both
  }

  function show(name: string): string {
    const source = nodes.get(name)
    const thing = source
      ? source.clone(true)
      : Object.hasOwn(PROP_GRIPS, name)
        ? made(name as Held | Tool)
        : undefined
    if (!thing) {
      stage.caption(`no piece "${name}": lab.pieces() lists them`)
      return "missing"
    }
    if (shown) stage.scene.remove(shown)
    thing.position.set(0, 0, 0)
    thing.rotation.set(0, 0, 0)
    stage.scene.add(thing)
    stage.fit(thing)
    shown = thing
    stage.caption(`${name} · ${source ? "kit.glb" : "drawn (PROP_GRIPS)"}`)
    return "ok"
  }

  show(params.get("piece") ?? "lantern")
  stage.run()

  Object.assign(window, {
    lab: { show, pieces: () => [...nodes.keys(), ...Object.keys(PROP_GRIPS)] },
  })
}
