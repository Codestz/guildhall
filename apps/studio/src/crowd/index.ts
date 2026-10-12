import { applyOverlay, type Catalog, createCatalog, type NpcRecipe, validateNpc } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { type Crowd, createCrowd, createStage, loadCharacter, toScreen } from "@guildhall/render"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import * as data from "../data.ts"
import type { Screen } from "../screens.ts"
import { buildBench } from "./bench.ts"
import { type CrowdPath, parseCrowdQuery } from "./query.ts"
import type { FolkGroup, FolkScene } from "./scene.ts"
import { buildTown } from "./town.ts"

const logger = log("studio:crowd")

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

/** Every saved NPC recipe that validates. */
async function npcRecipes(): Promise<NpcRecipe[]> {
  const ids = await data.list("npcs").catch((): string[] => [])
  const all = await Promise.all(ids.map((id) => data.load("npcs", id)))
  return all.filter((json): json is NpcRecipe => json !== null && validateNpc(json).length === 0)
}

/** The heroes cap per path: all crowd, all heroes (merged-skinned), or the mix (the path built). */
const heroesFor = (path: CrowdPath, n: number): number => (path === "bake" ? 0 : path === "merged" ? n : 12)

/**
 * The crowd bench (`/lab/crowd?n=60&layout=town&path=crowd&cam=wide&hour=17.5`, R5): `n` townsfolk
 * wearing the NPC builder's looks, at golden hour.
 *   layout  `town`: a generated town's own townsfolk (world `populate`) living their day 20× fast;
 *           `plaza`: n people walking loops round a plaza and working at its stations (the spike
 *           comparison's controlled scene); `line`: everyone in a row, working, facing the camera.
 *   path    `crowd` heroes near and the baked crowd beyond (the path built), `bake` everyone baked,
 *           `merged` everyone a merged-skinned NPC, `both` (plaza, line) bake left and merged right,
 *           `none` nobody: the baseline a path's added cost is measured against.
 * `play=0` freezes the clock at `t` seconds. `guildhall.ext.crowd` has `stats()` and `setHeroes(ids)`.
 */
export const crowdLab: Screen = {
  id: "crowd",
  title: "Crowd",
  mount(host, ctx) {
    const q = parseCrowdQuery(ctx.query)
    const stage = createStage(host)
    ctx.attach(stage)

    let disposed = false
    let clock = q.t
    let scene: FolkScene | null = null
    const crowds: { group: FolkGroup; crowd: Crowd }[] = []
    let durations = new Map<string, number>()
    const duration = (clip: string) => durations.get(clip) ?? 1
    const labels: { el: HTMLElement; at: readonly [number, number, number] }[] = []

    const panel = document.createElement("div")
    panel.style.cssText = PANEL_STYLE
    host.append(panel)

    const step = (dt: number) => {
      scene?.advance(dt)
      for (const { group, crowd } of crowds) crowd.update(dt, (id) => group.sample(id))
    }

    const build = async () => {
      const [catalog, roles] = await Promise.all([mountedCatalog(), npcRecipes()])
      if (!catalog || roles.length === 0) {
        panel.textContent = "no library or no NPC recipes: nobody to draw"
        return
      }
      // Clip lengths, from the rig every body shares.
      const body = catalog.get(roles[0]?.body[0] ?? "")
      const rig = body?.character && catalog.rig(body.character.rig)
      if (body && rig)
        durations = new Map(
          (await loadCharacter(body, rig, libraryUrl)).clips.map((c) => [c.name, c.duration]),
        )
      if (disposed) return
      const built =
        q.layout === "town"
          ? await buildTown(stage, q, catalog, roles, duration)
          : await buildBench(stage, q, catalog, roles, () => clock, duration)
      if (disposed) {
        built.dispose()
        return
      }
      scene = built
      stage.setCamera(built.camera)
      for (const group of built.groups) {
        const t0 = performance.now()
        const crowd = await createCrowd(
          stage,
          group.actors,
          { catalog, url: libraryUrl },
          { heroes: heroesFor(group.path, group.actors.length), clips: group.clips },
        )
        if (disposed) {
          crowd.dispose()
          return
        }
        crowds.push({ group, crowd })
        logger.info("crowd", {
          path: group.path,
          people: group.actors.length,
          ms: Math.round(performance.now() - t0),
        })
        for (const { text, at, small } of group.labels) {
          const el = document.createElement("div")
          el.style.cssText = LABEL_STYLE + (small ? ";font-size:10px;padding:0 5px" : "")
          el.textContent = text
          host.append(el)
          labels.push({ el, at })
        }
      }
      // Heroes load as the crowd first updates: let them settle before `ready` resolves.
      step(0)
      for (let i = 0; i < 100 && crowds.some(({ crowd }) => crowd.stats().pending > 0); i++)
        await new Promise((done) => setTimeout(done, 50))
    }
    ctx
      .load(build())
      .catch((error: unknown) =>
        logger.error("build failed", { error: (error as Error).stack ?? String(error) }),
      )

    let frame = 0
    const unsubscribe = stage.onFrame((dt) => {
      const moving = q.play ? dt : 0
      clock += moving
      step(moving)
      for (const { el, at: where } of labels) {
        const at = toScreen(stage, [where[0], where[1], where[2]])
        el.style.display = at ? "block" : "none"
        if (at) el.style.transform = `translate(${at[0]}px,${at[1]}px) translate(-50%,-100%)`
      }
      if (frame++ % 15 !== 0) return
      const f = stage.stats()
      panel.textContent = [
        ...(scene?.status ? [scene.status()] : []),
        ...crowds.map(({ group, crowd }) => {
          const s = crowd.stats()
          return `${group.path}: ${s.people} people · ${s.heroes} heroes · ${s.crowd} crowd (lod ${s.lod.tiers.join("/")}) · ${s.props} props`
        }),
        `main ${f.mainCalls ?? "?"} calls · ${f.mainTris ?? "?"} tris · cost p95 ${f.costMs?.p95.toFixed(2) ?? "?"} ms · dpr ${f.dpr}`,
      ].join("\n")
    })

    const ext = window.guildhall?.ext
    if (ext)
      ext.crowd = {
        stats: () => crowds.map(({ group, crowd }) => ({ path: group.path, ...crowd.stats() })),
        setHeroes: (ids: number[]) => {
          for (const { crowd } of crowds) crowd.setHeroes(ids)
        },
      }

    return () => {
      disposed = true
      if (ext) delete ext.crowd
      unsubscribe()
      panel.remove()
      for (const { el } of labels) el.remove()
      for (const { crowd } of crowds) crowd.dispose()
      scene?.dispose()
      stage.dispose()
    }
  },
}
