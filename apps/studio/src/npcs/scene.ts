/**
 * The NPC builder's 3D side: a strip of townspeople side by side (the variety check, the main stage)
 * and one of them large on a second stage. Every person is `createNpc(resolveNpc(...))`, so what the
 * builder shows is what the town will draw. The map camera looks at the strip from far and high, to
 * judge whether a role's silhouette reads at map zoom.
 */
import type { Catalog, NpcLook } from "@guildhall/assets"
import {
  createNpc,
  createStage,
  disposeObject,
  loadPiece,
  type Npc,
  type Stage,
  testBox,
  toScreen,
} from "@guildhall/render"
import { libraryUrl } from "../catalog.ts"
import type { Activity } from "./model.ts"

/** Between strip members, metres: wide enough for a sideways blade. */
const GAP = 1.5
/** The large view: a little from the right; it fits a person this big (metres, props included). */
const BIG_VIEW = { azimuth: 24, elevation: 8 }
const PERSON = { width: 1.9, height: 2.7 }
/**
 * Map zoom: the town map's distance and pitch, roughly (far and high), so a person is a few dozen
 * pixels tall, as on the map.
 */
const MAP_VIEW = { elevation: 52, distance: 62 }

const LABEL_STYLE = [
  "position:absolute",
  "left:0",
  "top:0",
  "padding:1px 7px",
  "border-radius:5px",
  "border:1px solid rgba(220,182,98,0.34)",
  "background:rgba(20,15,11,0.82)",
  "color:#f3e9d4",
  "font:11px/1.45 'JetBrains Mono',ui-monospace,Menlo,monospace",
  "white-space:pre",
  "text-align:center",
  "cursor:pointer",
].join(";")

/** How every person on a stage plays: one activity, live (t null) or frozen at t. */
export interface Playing {
  kind: Activity
  t: number | null
}

export interface NpcSceneEvents {
  /** A strip label was clicked. */
  pick(seed: number): void
  /** A person could not be drawn. */
  failed(seed: number, error: string): void
}

export interface NpcScene {
  /** The strip's stage (the shell's HUD and `guildhall.camera` drive it). */
  stage: Stage
  /** Replaces the strip; resolves once every person stands. */
  showStrip(looks: readonly NpcLook[], playing: Playing): Promise<void>
  playStrip(playing: Playing): void
  /** Marks the strip member shown large. */
  mark(seed: number | null): void
  /** Replaces the large person (null: none). */
  showBig(look: NpcLook | null, playing: Playing): Promise<void>
  playBig(playing: Playing): void
  /** The strip camera: straight on, or from far and high (map zoom). */
  setMap(on: boolean): void
  /** A body's sub-mesh names (what a recipe can hide). */
  parts(body: string): Promise<string[]>
  dispose(): void
}

const play = (npc: Npc, { kind, t }: Playing) => npc.play(kind, t === null ? {} : { t })

/** The distance at which `width` metres fill the view across, with a margin. */
const fitWidth = (width: number, fovDeg: number, aspect: number): number =>
  (width * 0.58) / (Math.tan((fovDeg * Math.PI) / 360) * aspect)

function floor(stage: Stage, size: number) {
  const ground = testBox(1, "#a39a84")
  ground.scale.set(size, 1, size)
  ground.position.y = -0.5
  stage.scene.add(ground)
  return ground
}

export function createNpcScene(
  stripHost: HTMLElement,
  bigHost: HTMLElement,
  catalog: Catalog,
  events: NpcSceneEvents,
): NpcScene {
  const stage = createStage(stripHost)
  const big = createStage(bigHost)
  const grounds = [floor(stage, 200), floor(big, 12)]

  let strip: Npc[] = []
  let bigNpc: Npc | null = null
  let stripGen = 0
  let bigGen = 0
  let map = false
  let marked: number | null = null
  let labels: HTMLElement[] = []

  /** Every look drawn, in order; a person that fails is reported and left out. */
  const draw = async (looks: readonly NpcLook[]) =>
    Promise.all(
      looks.map((look) =>
        createNpc(look, catalog, libraryUrl).catch((error: unknown) => {
          events.failed(look.seed, String((error as Error).message ?? error))
          return null
        }),
      ),
    )

  const frame = () => {
    const width = Math.max(1, strip.length - 1) * GAP + 1.4
    const aspect = stage.camera.aspect
    stage.setCamera(
      map
        ? { target: [0, 0.8, 0], azimuth: 0, ...MAP_VIEW }
        : {
            target: [0, 1.0, 0],
            azimuth: 0,
            elevation: 7,
            distance: Math.max(5, fitWidth(width, stage.camera.fov, aspect)),
          },
    )
  }

  const relabel = () => {
    for (const [i, label] of labels.entries()) {
      label.style.borderColor =
        strip[i]?.look.seed === marked ? "rgba(241,213,144,0.9)" : "rgba(220,182,98,0.34)"
    }
  }

  const unsubStrip = stage.onFrame((dt) => {
    for (const npc of strip) npc.update(dt)
    for (const [i, label] of labels.entries()) {
      const npc = strip[i]
      const at = npc && toScreen(stage, [npc.root.position.x, -0.08, 0])
      label.style.display = at && !map ? "block" : "none"
      if (at) label.style.transform = `translate(${at[0]}px,${at[1]}px) translate(-50%,0)`
    }
  })
  const unsubBig = big.onFrame((dt) => bigNpc?.update(dt))

  return {
    stage,
    async showStrip(looks, playing) {
      const mine = ++stripGen
      const drawn = await draw(looks)
      if (mine !== stripGen) {
        for (const npc of drawn) npc?.dispose()
        return
      }
      for (const npc of strip) npc.dispose()
      for (const label of labels) label.remove()
      strip = drawn.filter((npc): npc is Npc => npc !== null)
      const left = (-(looks.length - 1) * GAP) / 2
      labels = []
      for (const [i, look] of looks.entries()) {
        const npc = drawn[i]
        if (!npc) continue
        npc.root.position.set(left + i * GAP, 0, 0)
        stage.scene.add(npc.root)
        play(npc, playing)
        const label = document.createElement("button")
        label.type = "button"
        label.style.cssText = LABEL_STYLE
        label.textContent = `${look.seed}\n${look.body.slice(look.body.indexOf("/") + 1)}`
        label.dataset.seed = String(look.seed)
        label.addEventListener("click", () => events.pick(look.seed))
        stripHost.append(label)
        labels.push(label)
      }
      relabel()
      frame()
    },
    playStrip(playing) {
      for (const npc of strip) play(npc, playing)
    },
    mark(seed) {
      marked = seed
      relabel()
    },
    async showBig(look, playing) {
      const mine = ++bigGen
      const [npc] = look ? await draw([look]) : [null]
      if (mine !== bigGen) {
        npc?.dispose()
        return
      }
      bigNpc?.dispose()
      bigNpc = npc ?? null
      if (!bigNpc) return
      big.scene.add(bigNpc.root)
      play(bigNpc, playing)
      const k = bigNpc.look.scale
      const tan = Math.tan((big.camera.fov * Math.PI) / 360)
      const distance =
        Math.max(PERSON.height / 2 / tan, PERSON.width / 2 / (tan * big.camera.aspect)) * k * 1.05
      big.setCamera({ ...BIG_VIEW, target: [0, 1.15 * k, 0], distance })
    },
    playBig(playing) {
      if (bigNpc) play(bigNpc, playing)
    },
    setMap(on) {
      map = on
      frame()
    },
    async parts(body) {
      const entry = catalog.get(body)
      if (entry?.character?.parts) return entry.character.parts
      if (!entry) return []
      const root = await loadPiece(libraryUrl(entry.files.glb))
      const names: string[] = []
      root.traverse((node) => {
        if ((node as { isMesh?: boolean }).isMesh && node.name) names.push(node.name)
      })
      return names
    },
    dispose() {
      stripGen++
      bigGen++
      unsubStrip()
      unsubBig()
      for (const npc of strip) npc.dispose()
      bigNpc?.dispose()
      for (const label of labels) label.remove()
      for (const g of grounds) disposeObject(g)
      big.dispose()
      stage.dispose()
    },
  }
}
