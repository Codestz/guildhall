/**
 * The tile composer's layout and state: the tile list (search, groups) on the left, the hex stage in
 * the middle with its bar (ground, roads, neighbours, try, undo, save), and the layers on the right:
 * the pieces (with the catalog search to add more), the activity spots and the blockers, each with an
 * inspector for the one selected. Every change goes through an undo history.
 */
import type { Catalog, CatalogEntry } from "@guildhall/assets"
import { log } from "@guildhall/core"
import type { GizmoMode } from "@guildhall/render"
import {
  SPOT_KINDS,
  spotWindows,
  TILE_GROUNDS,
  type TileGround,
  type TilePrefab,
  validateTilePrefab,
} from "@guildhall/world"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { libraryUrl } from "../catalog.ts"
import * as data from "../data.ts"
import { SHOWCASE } from "../env.ts"
import type { ScreenCtx } from "../screens.ts"
import { ExportButtons } from "../shell/Export.tsx"
import { currentQuery, replaceQuery } from "../shell/router.ts"
import { Field, NumberField, Segments, short } from "./controls.tsx"
import {
  addBlocker,
  addPiece,
  addSpot,
  back,
  blockerFor,
  copyAs,
  duplicate,
  forward,
  type History,
  history,
  KIND_CLIP,
  KIND_COLOUR,
  type Layer,
  lint,
  moveTo,
  patchBlocker,
  patchPiece,
  patchSpot,
  push,
  remove,
  type Selection,
  type SpotKind,
  snapToEdge,
  tidy,
} from "./model.ts"
import { AROUND, type Around, createTileScene, type TileScene } from "./scene.ts"

const logger = log("studio:composer")
const DEG = 180 / Math.PI
const HITS = 48
const GROUP_ORDER = ["town", "landmark", "country", "road", "ground"]

export interface ComposerData {
  catalog: Catalog
  tiles: TilePrefab[]
  /** NPC recipes by role id, for the spots' roles and the people in try mode. */
  roles: ReadonlyMap<string, import("@guildhall/assets").NpcRecipe>
  /** rig-medium's clip names. */
  clips: string[]
}

/** What `guildhall.ext.composer` reads. */
export interface ComposerState {
  id: string
  tile: TilePrefab
  selected: Selection | null
  dirty: boolean
  warnings: string[]
}

type Status = { tone: "ok" | "warn" | "fail"; text: string }

export function TileComposer({
  ctx,
  input,
  initial,
  bind,
}: {
  ctx: ScreenCtx
  input: ComposerData
  initial: string
  bind: (read: () => ComposerState) => void
}) {
  const { catalog, roles, clips } = input
  const [tiles, setTiles] = useState(() => new Map(input.tiles.map((t) => [t.id, t])))
  const [id, setId] = useState(tiles.has(initial) ? initial : (input.tiles[0]?.id ?? ""))
  const [doc, setDoc] = useState<History>(() => history(tiles.get(id)!))
  const [saved, setSaved] = useState<TilePrefab>(doc.now)
  // `?sel=spots:2` opens with that item selected (shots, shared links)
  const [sel, setSel] = useState<Selection | null>(() => parseSel(ctx.query.get("sel")))
  const [tab, setTab] = useState<Layer>(sel?.layer ?? "pieces")
  const [mode, setMode] = useState<GizmoMode>("translate")
  const [around, setAround] = useState<Around>((ctx.query.get("around") as Around | null) ?? "same")
  const [tryOn, setTryOn] = useState(ctx.query.get("try") === "1")
  const [markers, setMarkers] = useState(ctx.query.get("markers") !== "0")
  const [tone, setTone] = useState(0)
  const [filter, setFilter] = useState("")
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<Status>({ tone: "ok", text: `data/tiles/${id}.json` })
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<TileScene | null>(null)
  const t = doc.now
  const dirty = t !== saved

  const warnings = useMemo(
    () =>
      lint(t, {
        piece: (p) => catalog.get(p) !== undefined,
        clip: (c) => clips.includes(c),
        prop: (p) => !!catalog.get(p)?.compose.mount,
      }),
    [t, catalog, clips],
  )
  const problems = useMemo(() => validateTilePrefab(t, id), [t, id])

  const latest = useRef({ id, tile: t, selected: sel, dirty, warnings })
  latest.current = { id, tile: t, selected: sel, dirty, warnings }
  useEffect(() => bind(() => latest.current), [bind])

  const change = useCallback((next: TilePrefab) => setDoc((h) => push(h, next)), [])
  const pick = useCallback((next: Selection | null) => {
    setSel(next)
    if (next) setTab(next.layer)
  }, [])

  // the stage lives as long as the screen; its events read the latest document through the ref
  useEffect(() => {
    if (!host.current) return
    const s = createTileScene(host.current, catalog, roles, {
      pick,
      moved(at, x, y, z, rot) {
        const cur = latest.current.tile
        let next = moveTo(cur, at, x, z, rot)
        if (at.layer === "pieces")
          next = patchPiece(next, at.i, { y: Math.abs(y) < 0.02 ? undefined : Math.round(y * 1000) / 1000 })
        if (at.layer === "spots")
          next = patchSpot(next, at.i, { y: Math.abs(y) < 0.02 ? undefined : Math.round(y * 1000) / 1000 })
        change(next)
      },
    })
    scene.current = s
    ctx.attach(s.stage)
    s.frame(ctx.query.get("view") !== "wide")
    return () => {
      scene.current = null
      s.dispose()
    }
  }, [catalog, roles, ctx, change, pick])

  useEffect(() => {
    const s = scene.current
    if (!s) return
    ctx.load(s.show(t, { around, tryOn, markers, tone })).catch((error: unknown) => {
      logger.error("draw failed", { error: String(error) })
      setStatus({ tone: "fail", text: `draw failed: ${String(error)}` })
    })
  }, [t, around, tryOn, markers, tone, ctx])
  useEffect(() => scene.current?.select(sel), [sel])
  useEffect(() => scene.current?.setMode(mode), [mode])
  useEffect(() => {
    const q = currentQuery()
    q.set("tile", id)
    if (tryOn) q.set("try", "1")
    else q.delete("try")
    if (around !== "same") q.set("around", around)
    else q.delete("around")
    replaceQuery(q)
  }, [id, tryOn, around])

  const open = (next: string) => {
    if (next === id) return
    if (dirty && !confirm(`Leave ${id} without saving?`)) return
    const tile = tiles.get(next)
    if (!tile) return
    setId(next)
    setDoc(history(tile))
    setSaved(tile)
    setSel(null)
    setTone(0)
    setStatus({ tone: "ok", text: `data/tiles/${next}.json` })
  }

  const save = async () => {
    const clean = tidy(t)
    const result = await data.save("tiles", id, clean)
    if (result.ok) {
      setTiles((m) => new Map(m).set(id, clean))
      setDoc((h) => ({ ...h, now: clean }))
      setSaved(clean)
      setStatus({ tone: "ok", text: `saved data/tiles/${id}.json` })
    } else
      setStatus({
        tone: "fail",
        text: `save refused (${result.status}): ${result.problems.slice(0, 3).join("; ")}`,
      })
  }

  const copyPrefab = async () => {
    const want = prompt("New tile id (kebab-case):", `${id}-b`)
    if (!want) return
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(want) || tiles.has(want)) {
      setStatus({ tone: "fail", text: `"${want}" is taken or not a kebab id` })
      return
    }
    const copy = tidy(copyAs(t, want))
    setTiles((m) => new Map(m).set(want, copy))
    setId(want)
    setDoc(history(copy))
    // never saved: the copy is dirty until it is
    setSaved({ ...copy, name: "" })
    setSel(null)
    setStatus({ tone: "warn", text: `new ${want} · not saved` })
  }

  const select = (layer: Layer, i: number) => pick(sel?.layer === layer && sel.i === i ? null : { layer, i })
  const run = (next: [TilePrefab, number], layer: Layer) => {
    change(next[0])
    if (next[1] >= 0) pick({ layer, i: next[1] })
  }

  // keys: undo/redo, delete, duplicate, move/turn, scale, deselect (never while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA")) return
      const cmd = e.metaKey || e.ctrlKey
      const cur = latest.current
      if (cmd && e.key.toLowerCase() === "z") {
        e.preventDefault()
        setDoc((h) => (e.shiftKey ? forward(h) : back(h)))
        return
      }
      if (cmd && e.key.toLowerCase() === "y") {
        e.preventDefault()
        setDoc(forward)
        return
      }
      if (cmd && e.key.toLowerCase() === "s") {
        e.preventDefault()
        void save()
        return
      }
      const s = cur.selected
      if (e.key === "Escape") pick(null)
      if (e.key === "g" || e.key === "t") setMode("translate")
      if (e.key === "r") setMode("rotate")
      if (!s) return
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault()
        change(remove(cur.tile, s))
        pick(null)
      }
      if (cmd && e.key.toLowerCase() === "d") {
        e.preventDefault()
        run(duplicate(cur.tile, s), s.layer)
      }
      if ((e.key === "[" || e.key === "]") && s.layer === "pieces") {
        const q = cur.tile.pieces[s.i]
        if (q)
          change(
            patchPiece(cur.tile, s.i, {
              scale: Math.round(q.scale * (e.key === "]" ? 1.05 : 1 / 1.05) * 1000) / 1000,
            }),
          )
      }
      if ((e.key === "[" || e.key === "]") && s.layer === "blockers") {
        const b = cur.tile.blockers?.[s.i]
        if (b)
          change(
            patchBlocker(cur.tile, s.i, {
              r: Math.max(0.1, Math.round((b.r + (e.key === "]" ? 0.05 : -0.05)) * 100) / 100),
            }),
          )
      }
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  })

  const hits = useMemo(
    () => (search.trim() ? catalog.query({ text: search.trim(), kind: "static" }).slice(0, HITS) : []),
    [catalog, search],
  )
  const props = useMemo(() => catalog.all().filter((e) => e.compose.mount && e.kind === "static"), [catalog])

  const list = [...tiles.values()].filter((x) => {
    const f = filter.trim().toLowerCase()
    return !f || x.id.includes(f) || x.name.toLowerCase().includes(f)
  })
  const groups = GROUP_ORDER.map((g) => [g, list.filter((x) => (x.group ?? "ground") === g)] as const).filter(
    ([, l]) => l.length,
  )

  return (
    <div className="gh gh-composer gh-tiles">
      <nav className="gh-panel gh-col" aria-label="Tile prefabs">
        <div className="gh-col-head">
          <p className="gh-brand">
            Tile <span>composer</span>
          </p>
          <input
            className="gh-search"
            placeholder="find a tile…"
            aria-label="find a tile"
            value={filter}
            spellCheck={false}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="gh-col-body">
          {groups.map(([g, l]) => (
            <section key={g} className="gh-group">
              <p className="gh-eyebrow">
                {g} <span className="num">{l.length}</span>
              </p>
              <ul className="gh-list">
                {l.map((x) => (
                  <li key={x.id} data-selected={x.id === id}>
                    <button
                      type="button"
                      className="pick"
                      aria-current={x.id === id}
                      onClick={() => open(x.id)}
                    >
                      <span className="what">{x.name}</span>
                      <span className="num" title="spots · blockers">
                        {x.footprint?.length ? `${x.footprint.length + 1}⬡ ` : ""}
                        {x.spots?.length ?? 0}·{x.blockers?.length ?? 0}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="gh-col-foot gh-row">
          <button type="button" className="gh-tool" onClick={copyPrefab}>
            duplicate prefab
          </button>
          <a className="gh-tool" href={`/lab/hextiles?group=${t.group ?? ""}`}>
            gallery
          </a>
        </div>
      </nav>

      <main className="gh-panel gh-main">
        <div className="gh-bar">
          <input
            className="gh-title"
            aria-label="tile name"
            value={t.name}
            onChange={(e) => change({ ...t, name: e.target.value })}
          />
          <span className="of num">{id}</span>
          <span className="gh-bar-gap" />
          <button
            type="button"
            className="gh-tool"
            aria-pressed={markers}
            onClick={() => setMarkers(!markers)}
          >
            markers
          </button>
          <button
            type="button"
            className="gh-tool gh-try"
            aria-pressed={tryOn}
            title="stand townsfolk on every spot"
            onClick={() => setTryOn(!tryOn)}
          >
            try
          </button>
          <span className="gh-sep" aria-hidden="true" />
          <button
            type="button"
            className="gh-tool"
            disabled={!doc.past.length}
            onClick={() => setDoc(back)}
            title="undo (⌘Z)"
          >
            undo
          </button>
          <button
            type="button"
            className="gh-tool"
            disabled={!doc.future.length}
            onClick={() => setDoc(forward)}
            title="redo (⇧⌘Z)"
          >
            redo
          </button>
          {SHOWCASE ? (
            <ExportButtons
              file={`${id}.json`}
              json={tidy(t)}
              disabled={problems.length > 0}
              onDone={(ok, text) => setStatus({ tone: ok ? "ok" : "fail", text })}
            />
          ) : (
            <button
              type="button"
              className="gh-tool gh-save"
              disabled={problems.length > 0 || !dirty}
              onClick={save}
              title="save (⌘S)"
            >
              {dirty ? "save" : "saved"}
            </button>
          )}
        </div>
        <div className="gh-bar gh-bar-2">
          <label className="gh-inline">
            <span>ground</span>
            <select
              className="gh-select mini"
              value={t.ground}
              onChange={(e) => change({ ...t, ground: e.target.value as TileGround })}
            >
              {TILE_GROUNDS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <span className="gh-inline">
            <span>road</span>
            <fieldset className="gh-chips" aria-label="road sides">
              {[0, 1, 2, 3, 4, 5].map((d) => (
                <button
                  key={d}
                  type="button"
                  className="gh-toggle"
                  aria-pressed={t.path?.includes(d) ?? false}
                  title={`a road out through side ${d}${d === 4 ? " (the front)" : ""}`}
                  onClick={() => {
                    const path = t.path?.includes(d)
                      ? t.path.filter((x) => x !== d)
                      : [...(t.path ?? []), d].sort()
                    const { path: _p, ...rest } = t
                    change(path.length ? { ...rest, path } : rest)
                  }}
                >
                  {d}
                </button>
              ))}
            </fieldset>
          </span>
          <span className="gh-inline">
            <span title="neighbouring tiles this scene also covers (not yet placed by the world)">
              covers
            </span>
            <fieldset className="gh-chips" aria-label="covered neighbours">
              {[0, 1, 2, 3, 4, 5].map((k) => (
                <button
                  key={k}
                  type="button"
                  className="gh-toggle"
                  aria-pressed={t.footprint?.includes(k) ?? false}
                  title={`the neighbour across side ${k}${k === 4 ? " (the front)" : ""}`}
                  onClick={() => {
                    const next = t.footprint?.includes(k)
                      ? t.footprint.filter((x) => x !== k)
                      : [...(t.footprint ?? []), k].sort()
                    const { footprint: _f, ...rest } = t
                    change(next.length ? { ...rest, footprint: next } : rest)
                  }}
                >
                  {k}
                </button>
              ))}
            </fieldset>
          </span>
          <span className="gh-inline">
            <span>around</span>
            <Segments name="neighbours" options={AROUND} value={around} onPick={setAround} />
          </span>
          {(t.tones?.length ?? 0) > 1 && (
            <button
              type="button"
              className="gh-tool"
              onClick={() => setTone((k) => (k + 1) % t.tones!.length)}
            >
              tone {tone + 1}/{t.tones!.length}
            </button>
          )}
        </div>
        <div className="gh-view">
          <div ref={host} className="gh-stage-host" />
          <div className="gh-legend" aria-hidden="true">
            {SPOT_KINDS.map((k) => (
              <span key={k}>
                <i style={{ background: KIND_COLOUR[k] }} />
                {k}
              </span>
            ))}
            <span>
              <i className="ring" />
              blocker
            </span>
          </div>
          <div className="gh-readout" data-tone={problems.length ? "fail" : warnings.length ? "warn" : "ok"}>
            {problems.length > 0 && (
              <ul className="gh-problems">
                {problems.slice(0, 5).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {warnings.length > 0 && (
              <ul className="gh-warnings">
                {warnings.slice(0, 5).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <p className="gh-status" data-tone={dirty ? "warn" : status.tone}>
              {dirty && status.tone === "ok" ? "unsaved changes" : status.text}
              <span className="num">
                {" "}
                · {t.pieces.length} pieces · {t.spots?.length ?? 0} spots · {t.blockers?.length ?? 0} blockers
              </span>
            </p>
          </div>
        </div>
      </main>

      <aside className="gh-panel gh-col" aria-label="Layers">
        <div className="gh-tabs" role="tablist">
          {(["pieces", "spots", "blockers"] as const).map((l) => (
            <button key={l} type="button" role="tab" aria-selected={tab === l} onClick={() => setTab(l)}>
              {l} <span className="num">{(t[l] ?? []).length}</span>
            </button>
          ))}
        </div>
        <div className="gh-col-body gh-layer">
          {tab === "pieces" && (
            <ul className="gh-list placed">
              {t.pieces.map((q, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a piece may be placed twice; the list is positional
                <li key={`${q.piece}-${i}`} data-selected={sel?.layer === "pieces" && sel.i === i}>
                  <button type="button" className="pick" onClick={() => select("pieces", i)}>
                    <span className="what">{short(q.piece)}</span>
                    <span className="num">
                      {q.scale.toFixed(2)}×{q.odds !== undefined ? ` ${Math.round(q.odds * 100)}%` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {tab === "spots" && (
            <>
              <fieldset className="gh-chips gh-add" aria-label="add a spot">
                {SPOT_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className="gh-toggle"
                    onClick={() => run(addSpot(t, k as SpotKind), "spots")}
                  >
                    <i className="dot" style={{ background: KIND_COLOUR[k] }} />+ {k}
                  </button>
                ))}
              </fieldset>
              <ul className="gh-list placed">
                {(t.spots ?? []).map((s, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: spots are positional
                  <li key={i} data-selected={sel?.layer === "spots" && sel.i === i}>
                    <button type="button" className="pick" onClick={() => select("spots", i)}>
                      <i className="dot" style={{ background: KIND_COLOUR[s.kind] }} />
                      <span className="what">
                        {s.kind} · {s.clip ?? KIND_CLIP[s.kind]}
                      </span>
                      <span className="num">{s.prop ? short(s.prop) : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {tab === "blockers" && (
            <>
              <div className="gh-chips gh-add">
                <button type="button" className="gh-toggle" onClick={() => run(addBlocker(t), "blockers")}>
                  + blocker
                </button>
              </div>
              <ul className="gh-list placed">
                {(t.blockers ?? []).map((b, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: blockers are positional
                  <li key={i} data-selected={sel?.layer === "blockers" && sel.i === i}>
                    <button type="button" className="pick" onClick={() => select("blockers", i)}>
                      <span className="what">disc {i + 1}</span>
                      <span className="num">
                        r {b.r.toFixed(2)} · {b.x.toFixed(1)},{b.z.toFixed(1)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="gh-col-foot">
          {sel ? (
            <Inspector
              t={t}
              sel={sel}
              mode={mode}
              clips={clips}
              props={props}
              roles={[...roles.keys()]}
              catalog={catalog}
              onMode={setMode}
              onChange={change}
              onRun={run}
              onClear={() => pick(null)}
            />
          ) : tab === "pieces" ? (
            <div className="gh-adder">
              <input
                className="gh-search"
                placeholder="add a piece: search the catalog…"
                aria-label="search the catalog"
                value={search}
                spellCheck={false}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="gh-hits">
                {hits.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className="gh-hit"
                    title={e.id}
                    onClick={() => run(addPiece(t, e.id, 0, 0, defaultScale(e)), "pieces")}
                  >
                    {e.files.thumb ? <img src={libraryUrl(e.files.thumb)} alt="" loading="lazy" /> : <i />}
                    <span className="name">{e.name}</span>
                  </button>
                ))}
                {search.trim() && hits.length === 0 && <p className="gh-lead pad">No piece matches.</p>}
              </div>
            </div>
          ) : (
            <p className="gh-hint-line">
              Click a marker or a piece to select it. G move · R turn · [ ] size · ⌘D copy · Delete · ⌘Z undo.
              Hold alt for fine steps.
            </p>
          )}
        </div>
      </aside>
    </div>
  )
}

/** `layer:index` → a selection, or null. */
function parseSel(raw: string | null): Selection | null {
  const m = /^(pieces|spots|blockers):(\d+)$/.exec(raw ?? "")
  return m ? { layer: m[1] as Layer, i: Number(m[2]) } : null
}

/** A first scale for a new piece: KayKit hex buildings at scale B, everything else near half. */
const defaultScale = (e: CatalogEntry) =>
  e.pack === "kaykit-hexagon" ? 0.5 : e.pack === "kaykit-forest" ? 0.6 : 0.5

function Inspector({
  t,
  sel,
  mode,
  clips,
  props,
  roles,
  catalog,
  onMode,
  onChange,
  onRun,
  onClear,
}: {
  t: TilePrefab
  sel: Selection
  mode: GizmoMode
  clips: string[]
  props: CatalogEntry[]
  roles: string[]
  catalog: Catalog
  onMode: (m: GizmoMode) => void
  onChange: (t: TilePrefab) => void
  onRun: (next: [TilePrefab, number], layer: Layer) => void
  onClear: () => void
}) {
  const gizmo = (
    <Segments
      name="gizmo"
      options={["translate", "rotate"] as const}
      value={mode}
      label={(m) => (m === "translate" ? "move (G)" : "turn (R)")}
      onPick={onMode}
    />
  )
  const actions = (extra?: React.ReactNode) => (
    <div className="gh-chips">
      {extra}
      <button type="button" className="gh-toggle" onClick={() => onRun(duplicate(t, sel), sel.layer)}>
        duplicate
      </button>
      <button
        type="button"
        className="gh-toggle danger"
        onClick={() => {
          onChange(remove(t, sel))
          onClear()
        }}
      >
        remove
      </button>
    </div>
  )
  if (sel.layer === "pieces") {
    const q = t.pieces[sel.i]
    if (!q) return null
    const entry = catalog.get(q.piece)
    const set = (patch: Parameters<typeof patchPiece>[2]) => onChange(patchPiece(t, sel.i, patch))
    return (
      <div className="gh-inspect">
        <div className="gh-sec-head">
          <p className="gh-eyebrow">{short(q.piece)}</p>
          <span className="gh-aside">{q.piece.split("/")[0]}</span>
        </div>
        {gizmo}
        <div className="gh-nums">
          <NumberField label="x" value={q.x} step={0.05} unit="m" onChange={(x) => set({ x })} />
          <NumberField label="z" value={q.z} step={0.05} unit="m" onChange={(z) => set({ z })} />
          <NumberField
            label="y"
            value={q.y ?? 0}
            step={0.05}
            unit="m"
            onChange={(y) => set({ y: y || undefined })}
          />
          <NumberField
            label="turn"
            value={q.rot * DEG}
            step={15}
            unit="°"
            onChange={(d) => set({ rot: d / DEG })}
          />
          <NumberField
            label="scale"
            value={q.scale}
            step={0.01}
            min={0.05}
            max={4}
            onChange={(scale) => set({ scale })}
          />
          <NumberField
            label="odds"
            value={q.odds ?? 1}
            step={0.05}
            min={0.05}
            max={1}
            onChange={(o) => set({ odds: o >= 1 ? undefined : o })}
          />
        </div>
        <label className="gh-check">
          <input
            type="checkbox"
            checked={q.tone ?? false}
            onChange={(e) => set({ tone: e.target.checked || undefined })}
          />
          takes the tile's foliage tone
        </label>
        {actions(
          <>
            <button
              type="button"
              className="gh-toggle"
              title="onto the nearest hex edge, along it, sized to span it"
              onClick={() =>
                onChange(snapToEdge(t, sel.i, 0.96, entry?.category === "fence" ? entry.size[0] : undefined))
              }
            >
              to edge
            </button>
            <button
              type="button"
              className="gh-toggle"
              onClick={() => entry && onRun(blockerFor(t, sel.i, entry.size), "blockers")}
            >
              block it
            </button>
          </>,
        )}
      </div>
    )
  }
  if (sel.layer === "spots") {
    const s = t.spots?.[sel.i]
    if (!s) return null
    const set = (patch: Parameters<typeof patchSpot>[2]) => onChange(patchSpot(t, sel.i, patch))
    return (
      <div className="gh-inspect">
        <div className="gh-sec-head">
          <p className="gh-eyebrow">spot {sel.i + 1}</p>
        </div>
        <Segments
          name="kind"
          options={SPOT_KINDS}
          value={s.kind}
          onPick={(kind) => set({ kind, clip: KIND_CLIP[kind] })}
        />
        {gizmo}
        <div className="gh-nums">
          <NumberField label="x" value={s.x} step={0.05} unit="m" onChange={(x) => set({ x })} />
          <NumberField label="z" value={s.z} step={0.05} unit="m" onChange={(z) => set({ z })} />
          <NumberField
            label="y"
            value={s.y ?? 0}
            step={0.05}
            unit="m"
            onChange={(y) => set({ y: y || undefined })}
          />
          <NumberField
            label="face"
            value={s.facing * DEG}
            step={15}
            unit="°"
            onChange={(d) => set({ facing: d / DEG })}
          />
        </div>
        <Field label="clip">
          <select
            className="gh-select"
            value={s.clip ?? ""}
            onChange={(e) => set({ clip: e.target.value || undefined })}
          >
            <option value="">(kind's default)</option>
            {clips.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="holds">
          <select
            className="gh-select"
            value={s.prop ?? ""}
            onChange={(e) => set({ prop: e.target.value || undefined })}
          >
            <option value="">nothing</option>
            {props.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}
              </option>
            ))}
          </select>
        </Field>
        <Field label="roles">
          <fieldset className="gh-chips" aria-label="roles">
            {roles.map((r) => (
              <button
                key={r}
                type="button"
                className="gh-toggle"
                aria-pressed={s.roles?.includes(r) ?? false}
                onClick={() => {
                  const next = s.roles?.includes(r) ? s.roles.filter((x) => x !== r) : [...(s.roles ?? []), r]
                  set({ roles: next.length ? next : undefined })
                }}
              >
                {r}
              </button>
            ))}
          </fieldset>
        </Field>
        <Field label="hours">
          <div className="gh-hours">
            <label className="gh-check">
              <input
                type="checkbox"
                checked={s.hours !== undefined}
                onChange={(e) => set({ hours: e.target.checked ? [8, 18] : undefined })}
              />
              {s.hours ? "only between" : "any time"}
            </label>
            {spotWindows(s.hours).map(([from, to], w, all) => {
              // one window is stored as [from, to], several as a list of them
              const put = (next: [number, number][]) =>
                set({ hours: next.length === 0 ? undefined : next.length === 1 ? next[0] : next })
              const edit = (win: [number, number]) => put(all.map((x, k) => (k === w ? win : x)))
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: windows have no id; their order is the identity
                <div className="gh-nums" key={w}>
                  <NumberField
                    label="from"
                    value={from}
                    step={0.5}
                    min={0}
                    max={24}
                    onChange={(h) => edit([h, to])}
                  />
                  <NumberField
                    label="to"
                    value={to}
                    step={0.5}
                    min={0}
                    max={24}
                    onChange={(h) => edit([from, h])}
                  />
                  {all.length > 1 && (
                    <button
                      type="button"
                      className="gh-toggle"
                      onClick={() => put(all.filter((_, k) => k !== w))}
                    >
                      drop this window
                    </button>
                  )}
                </div>
              )
            })}
            {s.hours && (
              <button
                type="button"
                className="gh-toggle"
                onClick={() => set({ hours: [...spotWindows(s.hours), [11.5, 14]] })}
              >
                + another window
              </button>
            )}
          </div>
        </Field>
        {actions()}
      </div>
    )
  }
  const b = t.blockers?.[sel.i]
  if (!b) return null
  const set = (patch: Parameters<typeof patchBlocker>[2]) => onChange(patchBlocker(t, sel.i, patch))
  return (
    <div className="gh-inspect">
      <div className="gh-sec-head">
        <p className="gh-eyebrow">blocker {sel.i + 1}</p>
      </div>
      <div className="gh-nums">
        <NumberField label="x" value={b.x} step={0.05} unit="m" onChange={(x) => set({ x })} />
        <NumberField label="z" value={b.z} step={0.05} unit="m" onChange={(z) => set({ z })} />
        <NumberField
          label="r"
          value={b.r}
          step={0.05}
          min={0.1}
          max={3}
          unit="m"
          onChange={(r) => set({ r })}
        />
      </div>
      {actions()}
    </div>
  )
}
