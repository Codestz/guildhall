/**
 * The lab's portraits (avatar variant A): each fixture hero's own figure, dressed as the island dresses
 * it (hexworld/life.ts `heroLook`: its body's recipe, resolved with a seed from its id, on its body), drawn
 * by render's `createPortraits` off the frame's path. One store for the lab; a hero's sprite URL once
 * drawn, null (the face stands in) until then. No library: no portraits, the faces stay.
 */
import {
  applyOverlay,
  type Catalog,
  createCatalog,
  type NpcLook,
  type NpcRecipe,
  resolveNpc,
  validateNpc,
} from "@guildhall/assets"
import { hash } from "@guildhall/core"
import { createPortraits, type PortraitSpec, type Portraits } from "@guildhall/render"
import type { HeroView } from "@guildhall/ui"
import { useSyncExternalStore } from "react"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import * as data from "../data.ts"
import { recipeOf } from "../hexworld/lifeAgents.ts"

interface Kit {
  portraits: Portraits
  catalog: Catalog
  recipes: Map<string, NpcRecipe>
  looks: Map<string, PortraitSpec | null>
}

let kit: Promise<Kit | null> | null = null
let ready: Kit | null = null
let version = 0
const listeners = new Set<() => void>()
const changed = () => {
  version++
  for (const fn of listeners) fn()
}

async function open(): Promise<Kit | null> {
  const [base, overlay] = await Promise.all([loadCatalog(), data.loadOverlay().catch(() => ({}))])
  if (!base) return null
  const catalog = createCatalog(base.index, [applyOverlay(base.all(), overlay)])
  const ids = await data.list("npcs").catch((): string[] => [])
  const all = await Promise.all(ids.map((id) => data.load("npcs", id)))
  const recipes = new Map(
    all
      .filter((json): json is NpcRecipe => json !== null && validateNpc(json).length === 0)
      .map((r) => [r.id, r]),
  )
  const portraits = createPortraits({ catalog, url: (path) => libraryUrl(path) })
  portraits.subscribe(changed)
  return { portraits, catalog, recipes, looks: new Map() }
}

/** A hero's portrait spec: its body's recipe (props only this library has), its banner as the tint. */
function specOf(k: Kit, hero: HeroView): PortraitSpec | null {
  if (k.looks.has(hero.id)) return k.looks.get(hero.id) ?? null
  const body = `kaykit-adventurers/${hero.family}`
  const recipe = k.recipes.get(recipeOf(hero.family))
  let spec: PortraitSpec | null = null
  if (recipe && k.catalog.get(body)) {
    const known = (list: readonly string[] | undefined) =>
      list?.filter((id) => id === "" || k.catalog.get(id)?.compose.mount)
    const r = known(recipe.hands?.r)
    const l = known(recipe.hands?.l)
    const usable: NpcRecipe = {
      ...recipe,
      hands: { ...(r?.length ? { r } : {}), ...(l?.length ? { l } : {}) },
      head: undefined,
    }
    const look = resolveNpc(usable, hash(`agent:${hero.id}`), k.catalog)
    const parts = k.catalog.get(body)?.character?.parts
    const hide = (recipe.hide ?? []).filter((p) => !parts || parts.includes(p))
    spec = { look: { ...look, body, hide, scale: 1 } satisfies NpcLook, tint: hero.banner }
  }
  k.looks.set(hero.id, spec)
  return spec
}

/** The lab's portraits: `portraitOf(hero)` is its sprite URL once drawn; the hook re-renders as they land. */
export function usePortraits(on = true): {
  portraitOf: (hero: HeroView) => string | null
  stats: () => Portraits["stats"] | null
} {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => version,
  )
  if (on && !kit) {
    kit = open().catch(() => null)
    void kit.then((k) => {
      ready = k
      changed()
    })
  }
  return {
    portraitOf: (hero) => {
      if (!on || !ready) return null
      const spec = specOf(ready, hero)
      return spec ? ready.portraits.get(spec) : null
    },
    stats: () => ready?.portraits.stats ?? null,
  }
}
