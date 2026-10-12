/**
 * The grip editor's 3D side: the live character holding the prop (the main stage), the prop alone on
 * a bench with its handle marker, axis arrows and the handle gizmo (a second stage), and the strip of
 * key clips drawn offscreen on the main renderer. A mount edit re-hangs the prop (detachMount, then
 * attachMount); a clip-only edit re-poses it in place (mountClip).
 */
import type { CatalogEntry, Mount, RigEntry, Vec3 } from "@guildhall/assets"
import {
  attachMount,
  boundingSphere,
  type Character,
  createGizmo,
  createStage,
  detachMount,
  disposeObject,
  fitSphere,
  type Gizmo,
  loadCharacter,
  loadPiece,
  type Mounted,
  mountClip,
  renderThumbnail,
  type Stage,
  testBox,
} from "@guildhall/render"
import { libraryUrl } from "../../catalog.ts"
import { KEY_CLIPS } from "./state.ts"

type Piece = Awaited<ReturnType<typeof loadPiece>>

/** Prop axes on the bench: the working axis, the strike edge, the upright `up`. */
const COLOURS = { axis: "#58c46a", edge: "#e0503c", up: "#4f8fe8", handle: "#f1d590" }
/** The strip tiles, pixels a side (about 150 CSS px at DPR 1.5). */
const TILE = 224
/** The main view looks at the right hand from the character's right front. */
const MAIN_VIEW = { azimuth: -40, elevation: 14 }
const BENCH_VIEW = { azimuth: 30, elevation: 22 }

export interface StripTile {
  label: string
  clip: string
  /** Object URL of the last draw, or null before the first. */
  url: string | null
}

export interface GripView {
  /** The main stage (the shell's HUD and `guildhall` read it). */
  stage: Stage
  /** Loads `piece` into `body`'s hand (and the bench and strip) with `mount`, replacing what was there. */
  load(piece: CatalogEntry, body: CatalogEntry, rig: RigEntry, mount: Mount): Promise<void>
  /** A new mount: re-hangs the prop everywhere and redraws the strip. */
  setMount(mount: Mount, opts?: { clipOnly?: boolean }): void
  /** Freezes the main character at `t` (0…1) of `clip`; false when the rig has no such clip. */
  play(clip: string, t: number): boolean
  /** Points the main camera at the hand again. */
  frame(): void
  dispose(): void
}

export interface GripViewOpts {
  /** The handle marker was dragged to this prop-space point (already on the 1 cm grid). */
  onHandle(handle: Vec3): void
  /** The strip has new pictures. */
  onStrip(tiles: readonly StripTile[]): void
  /** Tracks async work for `guildhall.ready()`. */
  track<T>(work: Promise<T>): Promise<T>
}

interface Held {
  ch: Character
  piece: Piece
  mounted: Mounted
}

/** Hangs a fresh copy of the prop on `ch`; returns the handle. */
function hold(ch: Character, piece: Piece, mount: Mount): Held {
  const mounted = attachMount(ch, piece, mount)
  ch.update(0)
  return { ch, piece, mounted }
}

/** Re-hangs (or, for a clip-only change, re-poses) a held prop for `mount`. */
function rehang(held: Held, mount: Mount, clipOnly: boolean): void {
  if (clipOnly && held.mounted.slot === mount.slot) {
    held.mounted.mount = mount
    mountClip(held.mounted, held.ch.clip)
  } else {
    detachMount(held.ch, held.mounted)
    held.mounted = attachMount(held.ch, held.piece, mount)
  }
  held.ch.update(0)
}

/** A thin bar from `from` along the unit `dir`, `length` long. */
function arrow(colour: string, from: Vec3, dir: Vec3, length: number, thickness: number) {
  const bar = testBox(1, colour)
  bar.scale.set(thickness, thickness, length)
  const along = (k: number): Vec3 => [from[0] + dir[0] * k, from[1] + dir[1] * k, from[2] + dir[2] * k]
  bar.position.set(...along(length / 2))
  bar.lookAt(...along(length))
  return bar
}

export function createGripView(mainHost: HTMLElement, benchHost: HTMLElement, opts: GripViewOpts): GripView {
  const stage = createStage(mainHost)
  const bench = createStage(benchHost)
  const floor = testBox(1, "#6f6656")
  floor.scale.set(6, 0.02, 6)
  floor.position.y = -0.01
  stage.scene.add(floor)

  const gizmo: Gizmo = createGizmo(bench, {
    mode: "translate",
    snap: 0.01,
    onChange: (pose) => opts.onHandle(pose.position),
  })

  let main: Held | null = null
  let strip: Held[] = []
  let benchPiece: Piece | null = null
  let marker: Piece | null = null
  let arrows: Piece[] = []
  let reach = 0.5
  let mount: Mount | null = null
  let tiles: StripTile[] = KEY_CLIPS.map((k) => ({ label: k.label, clip: k.clip, url: null }))
  let generation = 0
  let drawing: Promise<void> | null = null
  let stale = false
  let disposed = false

  const drawArrows = () => {
    for (const a of arrows) disposeObject(a)
    arrows = []
    if (!mount) return
    const thick = Math.max(0.008, reach * 0.02)
    arrows.push(arrow(COLOURS.axis, mount.handle, mount.axis, reach * 0.9, thick))
    arrows.push(arrow(COLOURS.edge, mount.handle, mount.edge, reach * 0.5, thick))
    if (mount.upright)
      arrows.push(arrow(COLOURS.up, mount.handle, mount.upright.up, reach * 0.7, thick * 0.8))
    bench.scene.add(...arrows)
    if (marker) marker.position.set(...mount.handle)
  }

  /** Draws each strip character, one at a time; edits made meanwhile trigger one more pass. */
  const drawStrip = () => {
    if (drawing) {
      stale = true
      return
    }
    const pass = async () => {
      do {
        stale = false
        const next: StripTile[] = []
        for (const [i, held] of strip.entries()) {
          const blob = await renderThumbnail(stage.renderer, held.ch.root, {
            size: TILE,
            azimuth: -30,
            elevation: 10,
          })
          if (disposed) return
          const old = tiles[i]?.url
          if (old) URL.revokeObjectURL(old)
          next.push({ ...(tiles[i] as StripTile), url: URL.createObjectURL(blob) })
        }
        tiles = next
        opts.onStrip(tiles)
      } while (stale && !disposed)
    }
    drawing = opts.track(pass()).finally(() => {
      drawing = null
    })
  }

  const clear = () => {
    for (const held of [main, ...strip]) {
      if (!held) continue
      detachMount(held.ch, held.mounted)
      held.ch.root.removeFromParent()
    }
    main = null
    strip = []
    gizmo.detach()
    benchPiece?.removeFromParent()
    if (marker) disposeObject(marker)
    benchPiece = null
    marker = null
  }

  const frame = () => {
    if (!main) return
    const { centre, radius } = boundingSphere(main.piece)
    const pose = fitSphere(centre, Math.max(radius, 0.9), {
      fov: stage.camera.fov,
      aspect: stage.camera.aspect,
      ...MAIN_VIEW,
      margin: 1.7,
    })
    stage.setCamera(pose)
  }

  const unsubscribe = stage.onFrame((dt) => main?.ch.update(dt))

  return {
    stage,
    async load(piece, body, rig, next) {
      const ticket = ++generation
      const url = libraryUrl(piece.files.glb)
      const [ch, held, benchCopy, ...rest] = await Promise.all([
        loadCharacter(body, rig, libraryUrl),
        loadPiece(url),
        loadPiece(url),
        ...KEY_CLIPS.flatMap(() => [loadCharacter(body, rig, libraryUrl), loadPiece(url)]),
      ])
      if (disposed || ticket !== generation) return
      clear()
      mount = next
      stage.scene.add(ch.root)
      main = hold(ch as Character, held as Piece, next)
      strip = KEY_CLIPS.map((k, i) => {
        const c = rest[i * 2] as Character
        c.play(k.clip, { t: k.t })
        return hold(c, rest[i * 2 + 1] as Piece, next)
      })

      benchPiece = benchCopy as Piece
      bench.scene.add(benchPiece)
      const sphere = boundingSphere(benchPiece)
      reach = Math.max(sphere.radius, 0.1)
      bench.setCamera(
        fitSphere(sphere.centre, reach, {
          fov: bench.camera.fov,
          aspect: bench.camera.aspect,
          ...BENCH_VIEW,
          margin: 1.15,
        }),
      )
      marker = testBox(Math.max(0.02, reach * 0.06), COLOURS.handle)
      bench.scene.add(marker)
      gizmo.attach(marker)
      drawArrows()
      drawStrip()
    },
    setMount(next, { clipOnly = false } = {}) {
      mount = next
      if (main) rehang(main, next, clipOnly)
      for (const held of strip) rehang(held, next, clipOnly)
      drawArrows()
      if (strip.length > 0) drawStrip()
    },
    play(clip, t) {
      return main?.ch.play(clip, { t }) ?? false
    },
    frame,
    dispose() {
      disposed = true
      unsubscribe()
      clear()
      for (const a of arrows) disposeObject(a)
      for (const t of tiles) if (t.url) URL.revokeObjectURL(t.url)
      gizmo.dispose()
      disposeObject(floor)
      bench.dispose()
      stage.dispose()
    },
  }
}
