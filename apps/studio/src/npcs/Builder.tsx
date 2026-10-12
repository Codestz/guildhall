/**
 * The builder's layout and state: the recipe being edited, the strip (seed, length, clip, frozen t,
 * map zoom), the member shown large and its own clip. Each change re-resolves the strip
 * (`resolveNpc`) and redraws; problems show under the strip.
 */
import { type Catalog, type NpcLook, type NpcRecipe, PALETTE, resolveNpc } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Segments, Stepper } from "../composer/Blueprint.tsx"
import * as data from "../data.ts"
import { SHOWCASE } from "../env.ts"
import type { ScreenCtx } from "../screens.ts"
import { ExportButtons } from "../shell/Export.tsx"
import { currentQuery, replaceQuery } from "../shell/router.ts"
import {
  ACTIVITIES,
  type Activity,
  blank,
  problems as check,
  distinctLooks,
  type NpcQuery,
  rename,
  stripSeeds,
  TEMPLATES,
} from "./model.ts"
import { Recipe } from "./Recipe.tsx"
import { createNpcScene, type NpcScene, type Playing } from "./scene.ts"

const logger = log("studio:npc")

/** What `guildhall.ext.npc` reads: the document and the looks on screen. */
export interface NpcState {
  recipe: NpcRecipe
  query: NpcQuery
  problems: string[]
  looks: NpcLook[]
  selected: number
}

export interface Initial {
  recipe: NpcRecipe
  source: "saved" | "new"
  query: NpcQuery
}

type Status = { tone: "ok" | "warn" | "fail"; text: string }

/** The strip's looks, and every problem the recipe (or one of its seeds) has. */
function resolveStrip(recipe: NpcRecipe, seeds: readonly number[], catalog: Catalog) {
  const problems = check(recipe, catalog, PALETTE)
  if (problems.length > 0) return { looks: [], problems }
  const looks: NpcLook[] = []
  for (const seed of seeds)
    try {
      looks.push(resolveNpc(recipe, seed, catalog))
    } catch (error) {
      problems.push(`seed ${seed}: ${(error as Error).message}`)
    }
  return { looks, problems }
}

/** The deep link for what is on screen, so a reload (or a shot) opens it again. */
function syncUrl(q: NpcQuery): void {
  const p = currentQuery()
  p.set("recipe", q.role)
  p.set("seed", String(q.seed))
  p.set("strip", String(q.strip))
  p.set("clip", q.clip)
  if (q.t === null) p.delete("t")
  else p.set("t", String(q.t))
  if (q.map) p.set("cam", "map")
  else p.delete("cam")
  replaceQuery(p)
}

function TimeControl({ t, onT }: { t: number | null; onT: (t: number | null) => void }) {
  return (
    <span className="gh-time-ctl">
      <button
        type="button"
        className="gh-tool"
        aria-pressed={t === null}
        onClick={() => onT(t === null ? 0.25 : null)}
      >
        {t === null ? "live" : "frozen"}
      </button>
      {t !== null && (
        <>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={t}
            onChange={(e) => onT(Number(e.target.value))}
          />
          <span className="num">t {t.toFixed(2)}</span>
        </>
      )}
    </span>
  )
}

export function Builder({
  catalog,
  ctx,
  initial,
  bind,
}: {
  catalog: Catalog
  ctx: ScreenCtx
  initial: Initial
  bind: (read: () => NpcState) => void
}) {
  const [recipe, setRecipe] = useState(initial.recipe)
  const [query, setQuery] = useState(initial.query)
  const [selected, setSelected] = useState(initial.query.seed)
  const [big, setBig] = useState<Playing>({ kind: initial.query.clip, t: initial.query.t })
  const [parts, setParts] = useState<string[]>([])
  const [drawErrors, setDrawErrors] = useState<string[]>([])
  const [saved, setSaved] = useState<string[]>([])
  const [status, setStatus] = useState<Status>(
    initial.source === "saved"
      ? { tone: "ok", text: `loaded data/npcs/${initial.recipe.id}.json` }
      : { tone: "warn", text: "new · not saved" },
  )
  const stripHost = useRef<HTMLDivElement>(null)
  const bigHost = useRef<HTMLDivElement>(null)
  const scene = useRef<NpcScene | null>(null)

  const seeds = useMemo(() => stripSeeds(query.seed, query.strip), [query.seed, query.strip])
  const { looks, problems } = useMemo(() => resolveStrip(recipe, seeds, catalog), [recipe, seeds, catalog])
  const allProblems = [...problems, ...drawErrors]
  const bigLook = useMemo(() => {
    if (problems.length > 0) return null
    try {
      return resolveNpc(recipe, selected, catalog)
    } catch {
      return null
    }
  }, [recipe, selected, catalog, problems])

  const latest = useRef({ recipe, query, problems: allProblems, looks, selected, big })
  latest.current = { recipe, query, problems: allProblems, looks, selected, big }
  useEffect(() => bind(() => latest.current), [bind])

  const edit = useCallback((next: NpcRecipe) => {
    setRecipe(next)
    setStatus((s) => (s.text === "unsaved changes" ? s : { tone: "warn", text: "unsaved changes" }))
  }, [])
  const patch = (next: Partial<NpcQuery>) => setQuery((q) => ({ ...q, ...next }))

  // The stages live as long as the screen; their events read the latest state through the ref.
  useEffect(() => {
    if (!stripHost.current || !bigHost.current) return
    const s = createNpcScene(stripHost.current, bigHost.current, catalog, {
      pick: setSelected,
      failed: (seed, error) => setDrawErrors((e) => [...e, `seed ${seed}: ${error}`]),
    })
    scene.current = s
    ctx.attach(s.stage)
    return () => {
      scene.current = null
      s.dispose()
    }
  }, [catalog, ctx])

  useEffect(() => syncUrl(query), [query])

  // A new set of looks redraws the strip; a new clip or t only replays it.
  useEffect(() => {
    const s = scene.current
    if (!s) return
    setDrawErrors([])
    const { query: q } = latest.current
    ctx.load(s.showStrip(looks, { kind: q.clip, t: q.t })).catch((error: unknown) => {
      logger.error("strip failed", { error: String(error) })
      setStatus({ tone: "fail", text: `draw failed: ${String(error)}` })
    })
  }, [looks, ctx])

  useEffect(() => {
    scene.current?.playStrip({ kind: query.clip, t: query.t })
  }, [query.clip, query.t])

  useEffect(() => {
    scene.current?.setMap(query.map)
  }, [query.map])

  useEffect(() => {
    const s = scene.current
    if (!s) return
    s.mark(selected)
    ctx.load(s.showBig(bigLook, latest.current.big)).catch((error: unknown) => {
      logger.error("big view failed", { error: String(error) })
    })
  }, [bigLook, selected, ctx])

  useEffect(() => {
    scene.current?.playBig(big)
  }, [big])

  const bodyKey = recipe.body.join(",")
  useEffect(() => {
    const s = scene.current
    if (!s) return
    let live = true
    Promise.all(
      bodyKey
        .split(",")
        .filter(Boolean)
        .map((b) => s.parts(b)),
    )
      .then((lists) => live && setParts(lists.flat()))
      .catch(() => live && setParts([]))
    return () => {
      live = false
    }
  }, [bodyKey])

  useEffect(() => {
    data.list("npcs").then(setSaved, () => setSaved([]))
  }, [])

  const save = async () => {
    const result = await data.save("npcs", recipe.id, recipe)
    if (result.ok) {
      setStatus({ tone: "ok", text: `saved data/npcs/${recipe.id}.json` })
      patch({ role: recipe.id })
      data.list("npcs").then(setSaved, () => undefined)
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
      setStatus({ tone: "warn", text: `new from ${id} · not saved` })
    } else {
      const json = await data.load("npcs", id)
      if (json === null) {
        setStatus({ tone: "fail", text: `cannot open ${id}: missing` })
        return
      }
      // Opened even when invalid: its problems show inline and can be fixed here.
      setRecipe(json as NpcRecipe)
      setStatus({ tone: "ok", text: `loaded data/npcs/${id}.json` })
    }
    patch({ role: id })
  }

  const look = bigLook
  return (
    <div className="gh gh-npc">
      <aside className="gh-panel gh-col">
        <div className="gh-col-head">
          <p className="gh-brand">
            NPC <span>builder</span>
          </p>
          <label className="gh-field">
            <span className="gh-field-label">role id</span>
            <input
              className="gh-npc-id"
              value={recipe.id}
              spellCheck={false}
              onChange={(e) => edit(rename(recipe, e.target.value.trim().toLowerCase()))}
            />
          </label>
        </div>
        <div className="gh-col-body">
          <Recipe recipe={recipe} catalog={catalog} parts={parts} onEdit={edit} />
        </div>
      </aside>

      <div className="gh-panel gh-main">
        <div className="gh-bar">
          <span className="total">npcs/{recipe.id}</span>
          <span className="gh-bar-gap" />
          <span className="of">seed</span>
          <Stepper
            value={query.seed}
            min={0}
            max={Number.MAX_SAFE_INTEGER}
            onStep={(seed) => patch({ seed })}
          />
          <span className="of">×{query.strip}</span>
          <Segments<Activity> options={ACTIVITIES} value={query.clip} onPick={(clip) => patch({ clip })} />
          <TimeControl t={query.t} onT={(t) => patch({ t })} />
          <button
            type="button"
            className="gh-tool"
            aria-pressed={query.map}
            onClick={() => patch({ map: !query.map })}
          >
            map zoom
          </button>
          <select className="gh-select" value="" onChange={(e) => e.target.value && open(e.target.value)}>
            <option value="">open…</option>
            <optgroup label="saved in data/npcs">
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
          {SHOWCASE ? (
            <ExportButtons
              file={`${recipe.id}.json`}
              json={recipe}
              disabled={problems.length > 0}
              onDone={(ok, text) => setStatus({ tone: ok ? "ok" : "fail", text })}
            />
          ) : (
            <button type="button" className="gh-tool gh-save" disabled={problems.length > 0} onClick={save}>
              save
            </button>
          )}
        </div>
        <div className="gh-view">
          <div ref={stripHost} className="gh-stage-host" />
          <div className="gh-readout" data-tone={allProblems.length > 0 ? "fail" : "ok"}>
            {allProblems.length > 0 && (
              <ul className="gh-problems">
                {allProblems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <p className="gh-status" data-tone={status.tone}>
              {status.text}
              {allProblems.length === 0 && ` · ${distinctLooks(looks)} distinct looks in ${looks.length}`}
            </p>
          </div>
        </div>
      </div>

      <aside className="gh-panel gh-big">
        <div className="gh-col-head">
          <p className="gh-eyebrow">seed {selected}</p>
          <div className="gh-chips">
            <Stepper value={selected} min={0} max={Number.MAX_SAFE_INTEGER} onStep={setSelected} />
            <Segments<Activity>
              options={ACTIVITIES}
              value={big.kind}
              onPick={(kind) => setBig({ ...big, kind })}
            />
          </div>
          <TimeControl t={big.t} onT={(t) => setBig({ ...big, t })} />
        </div>
        <div ref={bigHost} className="gh-big-view" />
        <div className="pad">
          {look ? (
            <ul className="gh-look">
              <li>
                <b>body</b>
                {look.body}
              </li>
              <li>
                <b>clip</b>
                {look.clips[big.kind]}
              </li>
              <li>
                <b>height</b>×{look.scale.toFixed(3)} <b>speed</b>×{look.speed.toFixed(3)} <b>phase</b>
                {look.phase.toFixed(2)}
              </li>
              {Object.entries(look.rampMap).map(([from, to]) => (
                <li key={from}>
                  <b>outfit</b>
                  {from} → {to}
                </li>
              ))}
              {look.mounts.map((m) => (
                <li key={m.slot}>
                  <b>{m.slot}</b>
                  {m.piece}
                </li>
              ))}
              {look.hide.length > 0 && (
                <li title={look.hide.join(", ")}>
                  <b>hidden</b>
                  {look.hide.join(", ")}
                </li>
              )}
            </ul>
          ) : (
            <p className="gh-hint-line">Fix the problems to see this seed.</p>
          )}
        </div>
      </aside>
    </div>
  )
}
