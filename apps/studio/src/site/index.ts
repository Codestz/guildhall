import type { CameraPose } from "@guildhall/core"
import { log } from "@guildhall/core"
import {
  createGround,
  createSky,
  createStage,
  createSun,
  createWater,
  disposeObject,
  type Ground,
  heroSilhouette,
  loadPiece,
  measure,
  testBox,
  type Water,
} from "@guildhall/render"
import { site, TIERS, type Vec2 } from "@guildhall/world"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import type { Screen } from "../screens.ts"
import { parseSiteQuery, type Stand, siteDraw, stands } from "./fixture.ts"

const logger = log("studio:site")

/** A few library pieces to judge the light on, by role (the first one the library has). */
const PIECES: Record<Exclude<Stand["role"], "hero">, readonly string[]> = {
  house: [
    "quaternius-rts/houses-second-age-1-level1",
    "quaternius-rts/houses-first-age-1-level1",
    "quaternius-rts/houses-second-age-2-level1",
    "quaternius-rts/houses-first-age-2-level1",
    "quaternius-rts/houses-second-age-3-level1",
  ],
  tree: [
    "kenney-town/tree-high",
    "kaykit-builder/detail-tree-a-gltf",
    "kenney-town/tree-high-round",
    "kaykit-builder/detail-tree-b-gltf",
  ],
}

/**
 * The site screen (`?screen=site`, R3): a town site from `seed` and `tier` as ground, water and sky, a
 * few library pieces stood on it, lit for `hour` (`?hour=17.5`, golden hour by default). `?harbour=`
 * turns the harbour's bay (radians, or `none`). `guildhall.ext.site.setHour(h)` moves the sun live.
 */
export const siteScreen: Screen = {
  id: "site",
  title: "Site",
  mount(host, ctx) {
    const q = parseSiteQuery(ctx.query, TIERS)
    const s = site({
      seed: q.seed,
      tier: q.tier,
      harbour: q.harbour === null ? null : { bearing: q.harbour },
    })
    const stage = createStage(host)
    ctx.attach(stage)
    const h = s.bounds[2]?.[0] ?? s.radius
    const plaza = s.plaza.reduce(
      (a, p) => [a[0] + p[0] / s.plaza.length, a[1] + p[1] / s.plaza.length],
      [0, 0],
    )
    const pose: CameraPose = {
      target: [plaza[0], 0, plaza[1]],
      azimuth: 40,
      elevation: 38,
      distance: 2.4 * s.radius,
    }
    stage.setCamera(pose)
    const sun = createSun(stage, { town: { min: [-h, 0, -h], max: [h, 25, h] } })
    const sky = createSky(stage, { hour: q.hour, sun, reach: 1.4 * s.radius })

    let ground: Ground | null = null
    let water: Water | null = null
    const placed: ReturnType<typeof testBox>[] = []
    /** Stand-ins built here (the hero, boxes) own their geometry; library copies share the cache's. */
    const owned = new Set<ReturnType<typeof testBox>>()
    let disposed = false

    const build = async () => {
      const catalog = await loadCatalog()
      const pick = (role: Stand["role"], i: number) => {
        if (role === "hero") return null
        const ids = PIECES[role].filter((id) => catalog?.get(id))
        const id = ids[i % Math.max(1, ids.length)]
        return id ? catalog?.get(id) : undefined
      }
      const footprints: Vec2[][] = []
      const objects = await Promise.all(
        stands(s, q.seed).map(async (stand, i) => {
          const entry = pick(stand.role, i)
          const object =
            stand.role === "hero"
              ? heroSilhouette()
              : entry
                ? await loadPiece(libraryUrl(entry.files.glb))
                : testBox(stand.role === "house" ? 8 : 3, stand.role === "house" ? "#b98a5a" : "#4f8a3a")
          if (!entry) owned.add(object)
          object.position.x = stand.at[0]
          object.position.z = stand.at[1]
          object.rotation.y = stand.rot
          if (stand.role === "house") {
            const m = measure(object)
            const [w, , d] = m.size
            const [cx, , cz] = m.centre
            footprints.push([
              [cx - w / 2, cz - d / 2],
              [cx + w / 2, cz - d / 2],
              [cx + w / 2, cz + d / 2],
              [cx - w / 2, cz + d / 2],
            ])
          }
          return object
        }),
      )
      if (disposed) return
      const draw = siteDraw(s, footprints)
      ground = createGround(stage, draw.ground, { seed: q.seed })
      water = createWater(stage, draw.water)
      for (const object of objects)
        object.traverse((node) => {
          node.castShadow = true
          node.receiveShadow = true
        })
      placed.push(...objects)
      stage.scene.add(...objects)
      sun.markDirty()
      logger.info("site", { seed: q.seed, tier: q.tier, radius: s.radius, pieces: objects.length })
    }
    ctx.load(build()).catch((error: unknown) => logger.error("build failed", { error: String(error) }))

    const ext = window.guildhall?.ext
    if (ext) ext.site = { setHour: (hour: number) => sky.setHour(hour), light: () => sky.light() }

    return () => {
      disposed = true
      if (ext) delete ext.site
      for (const object of placed) {
        object.removeFromParent()
        if (owned.has(object)) disposeObject(object)
      }
      ground?.dispose()
      water?.dispose()
      sky.dispose()
      sun.dispose()
      stage.dispose()
    }
  },
}
