import {
  applyOverlay,
  type Catalog,
  createCatalog,
  type NpcLook,
  type NpcRecipe,
  resolveNpc,
  validateNpc,
} from "@guildhall/assets"
import type { CameraPose } from "@guildhall/core"
import { log } from "@guildhall/core"
import {
  type Crowd,
  createCrowd,
  createGround,
  createSky,
  createStage,
  createStaticBatch,
  createSun,
  type Ground,
  loadCharacter,
  loadPiece,
  type Sky,
  type StaticBatch,
  setGlow,
  toScreen,
} from "@guildhall/render"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import * as data from "../data.ts"
import type { Screen } from "../screens.ts"
import { CROWD_PATHS, type CrowdPath, parseCrowdQuery } from "./query.ts"
import { type Folk, planFolk, plazaRadius, sampleFolk, stationAt, stationPiece } from "./sim.ts"

const logger = log("studio:crowd")

/** Metres between people in the `line` layout, and person i's place along it. */
const LINE_GAP = 1.5
const lineX = (i: number, n: number) => (i - (n - 1) / 2) * LINE_GAP

const PANEL_STYLE = [
  "position:absolute",
  "left:12px",
  "bottom:12px",
  "padding:8px 12px",
  "border-radius:4px",
  "background:rgba(21,17,13,0.8)",
  "color:#f3e9d4",
  "font:12px/1.5 ui-monospace,Menlo,monospace",
  "white-space:pre",
  "pointer-events:none",
].join(";")

const LABEL_STYLE = [
  "position:absolute",
  "left:0",
  "top:0",
  "padding:2px 10px",
  "border-radius:5px",
  "background:rgba(20,15,11,0.82)",
  "color:#f3e9d4",
  "font:13px/1.5 ui-monospace,Menlo,monospace",
  "pointer-events:none",
].join(";")

/** The catalog with `data/mounts.json` laid over it, so props carry their authored mounts. */
async function mountedCatalog(): Promise<Catalog | null> {
  const [catalog, overlay] = await Promise.all([loadCatalog(), data.loadOverlay().catch(() => ({}))])
  return catalog && createCatalog(catalog.index, [applyOverlay(catalog.all(), overlay)])
}

/** Every saved NPC recipe that validates, by role id. */
async function recipes(): Promise<NpcRecipe[]> {
  const ids = await data.list("npcs").catch((): string[] => [])
  const all = await Promise.all(ids.map((id) => data.load("npcs", id)))
  return all.filter((json): json is NpcRecipe => json !== null && validateNpc(json).length === 0)
}

/** One group of townsfolk drawn one way, shifted along x. */
interface Group {
  path: CrowdPath
  folk: Folk[]
  looks: NpcLook[]
  dx: number
  crowd: Crowd | null
}

/** The heroes cap per path: all-crowd, all-hero (merged-skinned), or the mix. */
const heroesFor = (path: CrowdPath, n: number): number => (path === "bake" ? 0 : path === "merged" ? n : 12)

/**
 * The crowd bench (`/lab/crowd?n=60&path=crowd&cam=wide&hour=17.5&t=12`, R5): `n` townsfolk from the
 * NPC builder's recipes walking loops round a plaza and working at its stations, at golden hour.
 * `path` picks how they are drawn: `crowd` (heroes near, the baked crowd beyond: the path built),
 * `bake` (everyone baked), `merged` (everyone a merged-skinned NPC: the other spike), `both` (bake on
 * the left, merged on the right, the same people) or `none` (the empty plaza: the baseline a spike's
 * added cost is measured against). `guildhall.ext.crowd` has `stats()` and `setHeroes(ids)`.
 */
export const crowdLab: Screen = {
  id: "crowd",
  title: "Crowd",
  mount(host, ctx) {
    const q = parseCrowdQuery(ctx.query)
    const stage = createStage(host)
    ctx.attach(stage)
    const r = plazaRadius(q.n)
    const span = q.path === "both" ? r * 2.6 + 8 : 0
    const wide: CameraPose = {
      target: [0, 0, 0],
      azimuth: 30,
      elevation: 32,
      distance: q.path === "both" ? r * 4.6 + 10 : r * 2.6 + 8,
    }
    const close: CameraPose = { target: [-span / 2, 0.9, r], azimuth: 18, elevation: 12, distance: 9 }
    const across = (q.path === "both" ? 2 : 1) * q.n * LINE_GAP
    const line: CameraPose = { target: [0, 0.9, 0], azimuth: 0, elevation: 6, distance: 2 + across * 0.92 }
    stage.setCamera(q.layout === "line" ? line : q.cam === "close" ? close : wide)

    let disposed = false
    let clock = q.t
    const groups: Group[] = []
    let ground: Ground | null = null
    let stations: StaticBatch | null = null
    let sky: Sky | null = null
    let sun: ReturnType<typeof createSun> | null = null
    let durations = new Map<string, number>()
    const labels: { el: HTMLElement; at: [number, number, number] }[] = []
    const label = (text: string, at: [number, number, number], small = false) => {
      const el = document.createElement("div")
      el.style.cssText = LABEL_STYLE + (small ? ";font-size:10px;padding:0 5px" : "")
      el.textContent = text
      host.append(el)
      labels.push({ el, at })
    }

    const panel = document.createElement("div")
    panel.style.cssText = PANEL_STYLE
    host.append(panel)

    const build = async () => {
      const [catalog, roles] = await Promise.all([mountedCatalog(), recipes()])
      if (!catalog || roles.length === 0) {
        panel.textContent = "no library or no NPC recipes: nobody to draw"
        return
      }
      if (disposed) return
      const half = r * 1.9 + span / 2 + 20
      sun = createSun(stage, { town: { min: [-half, 0, -half], max: [half, 12, half] }, radii: [24, 90] })
      sky = createSky(stage, { sun, hour: q.hour, reach: half })
      setGlow(sky.light().lamps)
      ground = createGround(
        stage,
        {
          land: [
            [-half, -half],
            [half, -half],
            [half, half],
            [-half, half],
          ],
          holes: [],
          overlays: (q.path === "both" ? [-span / 2, span / 2] : [0]).map((dx) => ({
            kind: "plaza" as const,
            poly: Array.from({ length: 40 }, (_, i): [number, number] => {
              const a = (i / 40) * Math.PI * 2
              return [dx + Math.sin(a) * r * 1.12, Math.cos(a) * r * 1.12]
            }),
          })),
          footprints: [],
        },
        { seed: q.seed },
      )

      const byRole = new Map(roles.map((recipe) => [recipe.id, recipe]))
      const roleIds = [...byRole.keys()].sort()
      const paths: CrowdPath[] = q.path === "both" ? ["bake", "merged"] : q.path === "none" ? [] : [q.path]
      for (const [k, path] of paths.entries()) {
        const folk = planFolk(q.n, roleIds, q.seed)
        const looks = folk.map((f) => resolveNpc(byRole.get(f.role) as NpcRecipe, f.seed, catalog))
        const shift = q.layout === "line" ? (q.n * LINE_GAP) / 2 + 1 : span / 2
        const dx = paths.length > 1 ? (k === 0 ? -shift : shift) : 0
        groups.push({ path, folk, looks, dx, crowd: null })
      }
      // Stations for the workers (the same for every path, and for `none`).
      const plan = planFolk(q.n, roleIds, q.seed)
      const workLooks = plan.map((f) => resolveNpc(byRole.get(f.role) as NpcRecipe, f.seed, catalog))
      const pieces = (q.layout === "line" ? [] : q.path === "both" ? [-span / 2, span / 2] : [0]).flatMap((dx) =>
        plan.flatMap((f, i) => {
          if (f.task.kind !== "work") return []
          const [x, z] = stationAt(f.task)
          return [{ piece: stationPiece(workLooks[i]?.clips.work ?? ""), x: x + dx, y: 0, z, rot: f.task.heading, scale: 1 }]
        }),
      )
      const batch = await createStaticBatch(stage, pieces, async (id) => {
        const entry = catalog.get(id)
        if (!entry) throw new Error(`crowd: unknown piece "${id}"`)
        return loadPiece(libraryUrl(entry.files.glb))
      })
      if (disposed) {
        batch.dispose()
        return
      }
      stations = batch

      const first = groups[0]?.looks[0]
      const entry = first && catalog.get(first.body)
      const rig = entry?.character && catalog.rig(entry.character.rig)
      if (entry && rig) {
        const ch = await loadCharacter(entry, rig, libraryUrl)
        durations = new Map(ch.clips.map((c) => [c.name, c.duration]))
      }
      for (const group of groups) {
        const t0 = performance.now()
        const crowd = await createCrowd(
          stage,
          group.folk.map((f, i) => ({ id: f.id, look: group.looks[i] as NpcLook })),
          { catalog, url: libraryUrl },
          { heroes: heroesFor(group.path, q.n) },
        )
        if (disposed) {
          crowd.dispose()
          return
        }
        group.crowd = crowd
        logger.info("group", { path: group.path, n: q.n, ms: Math.round(performance.now() - t0) })
        const name = group.path === "bake" ? "A · baked bone texture" : "B · merged skinned"
        if (paths.length > 1) label(name, q.layout === "line" ? [group.dx, 2.6, 0] : [group.dx, 0, -r * 1.4])
        if (q.layout === "line")
          group.folk.forEach((f, i) => label(f.role, [group.dx + lineX(i, q.n), -0.05, 0.6], true))
      }
      // Heroes load as the crowd first updates: settle them before `ready` resolves.
      step(0)
      await new Promise((done) => setTimeout(done, 50))
      for (let i = 0; i < 100 && groups.some((g) => (g.crowd?.stats().pending ?? 0) > 0); i++)
        await new Promise((done) => setTimeout(done, 50))
      sun.markDirty()
    }
    ctx.load(build()).catch((error: unknown) => logger.error("build failed", { error: String(error) }))

    const duration = (clip: string) => durations.get(clip) ?? 1
    const step = (dt: number) => {
      for (const group of groups) {
        const { crowd, folk, looks, dx } = group
        crowd?.update(dt, (id) => {
          const look = looks[id] as NpcLook
          if (q.layout === "line") {
            const clip = look.clips.work
            const phase = look.phase + clock / duration(clip)
            return { position: [dx + lineX(id, folk.length), 0, 0], heading: 0, clip, phase: phase - Math.floor(phase) }
          }
          const s = sampleFolk(folk[id] as Folk, look, clock, duration)
          s.position[0] += dx
          return s
        })
      }
    }

    let frame = 0
    const unsubscribe = stage.onFrame((dt) => {
      if (q.play) clock += dt
      step(q.play ? dt : 0)
      for (const { el, at: where } of labels) {
        const at = toScreen(stage, where)
        el.style.display = at ? "block" : "none"
        if (at) el.style.transform = `translate(${at[0]}px,${at[1]}px) translate(-50%,-100%)`
      }
      if (frame++ % 15 !== 0) return
      const f = stage.stats()
      panel.textContent = [
        ...groups.map((g) => {
          const s = g.crowd?.stats()
          return s
            ? `${g.path}: ${s.people} people · ${s.heroes} heroes · ${s.crowd} crowd (lod ${s.lod.tiers.join("/")}) · ${s.props} props`
            : `${g.path}: loading`
        }),
        `main ${f.mainCalls ?? "?"} calls · ${f.mainTris ?? "?"} tris · cost p95 ${f.costMs?.p95.toFixed(2) ?? "?"} ms · dpr ${f.dpr}`,
      ].join("\n")
    })

    const ext = window.guildhall?.ext
    if (ext)
      ext.crowd = {
        stats: () => groups.map((g) => ({ path: g.path, ...g.crowd?.stats() })),
        setHeroes: (ids: number[]) => {
          for (const g of groups) g.crowd?.setHeroes(ids)
        },
        paths: CROWD_PATHS,
        debugScene: () => stage.scene,
      }

    return () => {
      disposed = true
      if (ext) delete ext.crowd
      unsubscribe()
      panel.remove()
      for (const { el } of labels) el.remove()
      for (const g of groups) g.crowd?.dispose()
      stations?.dispose()
      ground?.dispose()
      sky?.dispose()
      sun?.dispose()
      stage.dispose()
    }
  },
}
