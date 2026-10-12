/**
 * The composer's layout and state: the recipe being edited, the seed, single or strip view, the
 * selection. Each change recompiles (`compilePrefab`) and redraws; problems show under the stage.
 */
import {
  type Catalog,
  compilePrefab,
  PALETTE,
  type PrefabMeta,
  type PrefabRecipe,
  recipeHash,
  validatePrefab,
} from "@guildhall/assets"
import { log } from "@guildhall/core"
import type { GizmoMode } from "@guildhall/render"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import * as data from "../data.ts"
import type { ScreenCtx } from "../screens.ts"
import { Blueprint, Stepper } from "./Blueprint.tsx"
import { Dressing } from "./Dressing.tsx"
import {
  addDressing,
  blank,
  cyclePanel,
  moveDressing,
  type RecipeRef,
  refText,
  removeDressing,
  stripSeeds,
  TEMPLATES,
} from "./model.ts"
import { type ComposerScene, createComposerScene, type View } from "./scene.ts"

const logger = log("studio:composer")

/** What `guildhall.ext.composer` reads: the document as the screen holds it. */
export interface ComposerState {
  ref: RecipeRef
  recipe: PrefabRecipe
  seed: number
  strip: boolean
  problems: string[]
  meta: PrefabMeta | null
  selected: number | null
}

export interface Initial {
  ref: RecipeRef
  recipe: PrefabRecipe
  /** Where the recipe came from: a saved file, or a template (not saved yet). */
  source: "saved" | "new"
  seed: number
  strip: boolean
}

type Status = { tone: "ok" | "warn" | "fail"; text: string }

/** The compiled views for the seed (or the strip), and every problem the recipe has. */
function compile(recipe: PrefabRecipe, seed: number, strip: boolean, catalog: Catalog) {
  const problems = validatePrefab(recipe, PALETTE)
  if (problems.length > 0) return { views: null, problems }
  try {
    const views: View[] = (strip ? stripSeeds(seed) : [seed]).map((s) => {
      const { recipe: compiled, meta } = compilePrefab(recipe, s, catalog)
      return { recipe: compiled, meta, label: `seed ${s}\n${recipeHash(compiled)}` }
    })
    return { views, problems }
  } catch (error) {
    return { views: null, problems: [(error as Error).message] }
  }
}

/** The deep link for the current document, so a reload (or a shot) opens what is on screen. */
function syncUrl(ref: RecipeRef, seed: number, strip: boolean): void {
  const q = new URLSearchParams(location.search)
  q.set("recipe", refText(ref))
  q.set("seed", String(seed))
  if (strip) q.set("strip", "1")
  else q.delete("strip")
  const search = `?${q.toString().replaceAll("%2F", "/")}`
  if (search !== location.search) history.replaceState(null, "", search)
}

export function Composer({
  catalog,
  ctx,
  initial,
  bind,
}: {
  catalog: Catalog
  ctx: ScreenCtx
  initial: Initial
  bind: (read: () => ComposerState) => void
}) {
  const [ref, setRef] = useState(initial.ref)
  const [recipe, setRecipe] = useState(initial.recipe)
  const [seed, setSeed] = useState(initial.seed)
  const [strip, setStrip] = useState(initial.strip)
  const [selected, setSelected] = useState<number | null>(null)
  const [mode, setMode] = useState<GizmoMode>("translate")
  const [status, setStatus] = useState<Status>(
    initial.source === "saved"
      ? { tone: "ok", text: `loaded ${refText(initial.ref)}` }
      : { tone: "warn", text: "new · not saved" },
  )
  const [saved, setSaved] = useState<string[]>([])
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<ComposerScene | null>(null)
  const framedFor = useRef("")

  const { views, problems } = useMemo(
    () => compile(recipe, seed, strip, catalog),
    [recipe, seed, strip, catalog],
  )
  const meta = views?.[0]?.meta ?? null

  const latest = useRef({ ref, recipe, seed, strip, problems, meta, selected })
  latest.current = { ref, recipe, seed, strip, problems, meta, selected }
  useEffect(() => bind(() => latest.current), [bind])

  const edit = useCallback((next: PrefabRecipe) => {
    setRecipe(next)
    setStatus((s) => (s.text.startsWith("unsaved") ? s : { tone: "warn", text: "unsaved changes" }))
  }, [])

  // The stage lives as long as the screen; its events read the latest state through the ref.
  useEffect(() => {
    if (!host.current) return
    const s = createComposerScene(host.current, catalog, {
      panel(slot, back) {
        const { recipe: r, seed: k } = latest.current
        edit(cyclePanel(r, k, slot, back ? -1 : 1))
      },
      pick: setSelected,
      moved(i, pose) {
        const [x, y, z] = pose.position
        edit(moveDressing(latest.current.recipe, i, { x, y, z, rot: pose.rot }))
      },
    })
    scene.current = s
    ctx.attach(s.stage)
    return () => {
      scene.current = null
      s.dispose()
    }
  }, [catalog, ctx, edit])

  useEffect(() => {
    syncUrl(ref, seed, strip)
  }, [ref, seed, strip])

  useEffect(() => {
    const s = scene.current
    if (!s || !views) return
    const house = strip ? undefined : recipe.house
    const dressingStart = (views[0]?.recipe.instances.length ?? 0) - recipe.dressing.length
    const work = s.show(views, { ...(house ? { house } : {}), dressingStart }).then(() => {
      // Re-aim only when the shape of what is shown changes, never under the user's orbit.
      const key = `${strip}|${views.map((v) => `${v.meta.frontage}x${v.meta.depth}x${v.meta.height}`).join(",")}`
      if (key !== framedFor.current) {
        framedFor.current = key
        s.frame()
      }
    })
    ctx.load(work).catch((error: unknown) => {
      logger.error("draw failed", { error: String(error) })
      setStatus({ tone: "fail", text: `draw failed: ${String(error)}` })
    })
  }, [views, recipe, strip, ctx])

  useEffect(() => {
    scene.current?.select(strip ? null : selected)
  }, [selected, strip])

  useEffect(() => {
    scene.current?.setMode(mode)
  }, [mode])

  useEffect(() => {
    data.list(ref.kind).then(setSaved, () => setSaved([]))
  }, [ref.kind])

  // Delete removes the selected dressing piece (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement
      if (typing || selected === null || (e.key !== "Delete" && e.key !== "Backspace")) return
      edit(removeDressing(latest.current.recipe, selected))
      setSelected(null)
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [selected, edit])

  const place = (piece: string) => {
    // In front of the door, a step to its right, on the 1 m grid.
    const x = Math.round((meta?.door[0] ?? 0) + 2)
    const z = Math.round((meta?.depth ?? 0) / 2 + 1)
    const [next, i] = addDressing(recipe, piece, x, z)
    edit(next)
    setSelected(i)
  }

  const save = async () => {
    const target = { ...ref, id: recipe.id }
    const result = await data.save(target.kind, target.id, recipe)
    if (result.ok) {
      setRef(target)
      setStatus({ tone: "ok", text: `saved data/${target.kind}/${target.id}.json` })
      data.list(target.kind).then(setSaved, () => undefined)
    } else
      setStatus({
        tone: "fail",
        text: `save refused (${result.status}): ${result.problems.slice(0, 3).join("; ")}`,
      })
  }

  const open = async (choice: string) => {
    const [from, id] = choice.split(":") as [string, string]
    if (from === "new") {
      setRecipe(blank(id))
      setRef({ ...ref, id })
      setStatus({ tone: "warn", text: `new from ${id} · not saved` })
    } else {
      const json = await data.load(ref.kind, id)
      const bad = validatePrefab(json)
      if (json === null || bad.length > 0) {
        setStatus({ tone: "fail", text: `cannot open ${id}: ${bad[0] ?? "missing"}` })
        return
      }
      setRecipe(json as PrefabRecipe)
      setRef({ ...ref, id })
      setStatus({ tone: "ok", text: `loaded ${refText({ ...ref, id })}` })
    }
    setSelected(null)
  }

  return (
    <div className="gh gh-composer">
      <Blueprint recipe={recipe} onEdit={edit} />
      <div className="gh-panel gh-main">
        <div className="gh-bar">
          <span className="total">{refText({ ...ref, id: recipe.id || ref.id })}</span>
          <span className="gh-bar-gap" />
          <span className="of">seed</span>
          <Stepper value={seed} min={0} max={Number.MAX_SAFE_INTEGER} onStep={setSeed} />
          <button type="button" className="gh-tool" aria-pressed={strip} onClick={() => setStrip(!strip)}>
            strip ×6
          </button>
          <select className="gh-select" value="" onChange={(e) => e.target.value && open(e.target.value)}>
            <option value="">open…</option>
            <optgroup label={`saved in data/${ref.kind}`}>
              {saved.map((id) => (
                <option key={id} value={`saved:${id}`}>
                  {id}
                </option>
              ))}
            </optgroup>
            <optgroup label="new from template">
              {Object.keys(TEMPLATES).map((id) => (
                <option key={id} value={`new:${id}`}>
                  {id}
                </option>
              ))}
            </optgroup>
          </select>
          <button type="button" className="gh-tool gh-save" disabled={problems.length > 0} onClick={save}>
            save
          </button>
        </div>
        <div className="gh-view">
          <div ref={host} className="gh-stage-host" />
          <div className="gh-readout" data-tone={problems.length > 0 ? "fail" : "ok"}>
            {problems.length > 0 ? (
              <ul className="gh-problems">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : (
              meta && (
                <dl className="gh-kv">
                  <div>
                    <dt>frontage</dt>
                    <dd>
                      {meta.frontage}
                      <small>m</small>
                    </dd>
                  </div>
                  <div>
                    <dt>depth</dt>
                    <dd>
                      {meta.depth}
                      <small>m</small>
                    </dd>
                  </div>
                  <div>
                    <dt>height</dt>
                    <dd>
                      {meta.height}
                      <small>m</small>
                    </dd>
                  </div>
                  <div>
                    <dt>pieces</dt>
                    <dd>{views?.[0]?.recipe.instances.length}</dd>
                  </div>
                  <div>
                    <dt>hash</dt>
                    <dd>{views?.[0] ? recipeHash(views[0].recipe) : ""}</dd>
                  </div>
                </dl>
              )
            )}
            <p className="gh-status" data-tone={status.tone}>
              {status.text}
            </p>
          </div>
        </div>
      </div>
      <Dressing
        catalog={catalog}
        recipe={recipe}
        selected={selected}
        mode={mode}
        onPlace={place}
        onSelect={setSelected}
        onRemove={(i) => {
          edit(removeDressing(recipe, i))
          setSelected(null)
        }}
        onMode={setMode}
      />
    </div>
  )
}
