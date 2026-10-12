/**
 * Authored data (`data/`, ADR 005) as the studio reads and writes it, through the `/data/` endpoint in
 * vite.config.ts. Saving works in the dev server only; the endpoint validates every write.
 */
import type { DataOverlay, MountsFile } from "@guildhall/assets"
import { BASE } from "./env.ts"

/** Where vite serves `data/` (vite.config.ts). */
export const DATA = `${BASE}data`

/** A folder of `<id>.json` files under `data/`. */
export type DataKind =
  | "recipes/houses"
  | "recipes/landmarks"
  | "recipes/stalls"
  | "recipes/docks"
  | "recipes/farm"
  | "npcs"
  | "towns"

/** A save either landed, or was refused with the endpoint's reasons (422: the validator's problems). */
export type SaveResult = { ok: true } | { ok: false; status: number; problems: string[] }

type Fetch = (
  url: string,
  init?: { method: string; headers: Record<string, string>; body: string },
) => Promise<Pick<Response, "ok" | "status" | "json">>

const fileUrl = (base: string, kind: DataKind, id: string) => `${base}/${kind}/${encodeURIComponent(id)}.json`

async function getJson(url: string, fetcher: Fetch): Promise<unknown | null> {
  const response = await fetcher(url)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`)
  return response.json()
}

async function put(url: string, json: unknown, fetcher: Fetch): Promise<SaveResult> {
  const response = await fetcher(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(json),
  })
  if (response.ok) return { ok: true }
  const body = (await response.json().catch(() => null)) as { problems?: string[]; error?: string } | null
  return { ok: false, status: response.status, problems: body?.problems ?? [body?.error ?? "save failed"] }
}

/** The ids saved in a data folder, sorted; none when the folder does not exist yet. */
export async function list(kind: DataKind, fetcher: Fetch = fetch, base = DATA): Promise<string[]> {
  return ((await getJson(`${base}/${kind}/`, fetcher)) as string[] | null) ?? []
}

/** One data file, parsed, or null when it does not exist. */
export async function load(
  kind: DataKind,
  id: string,
  fetcher: Fetch = fetch,
  base = DATA,
): Promise<unknown> {
  return getJson(fileUrl(base, kind, id), fetcher)
}

/** Validates and stores `json` as `data/<kind>/<id>.json` (keys sorted, so a reload saves byte-identically). */
export async function save(
  kind: DataKind,
  id: string,
  json: unknown,
  fetcher: Fetch = fetch,
  base = DATA,
): Promise<SaveResult> {
  return put(fileUrl(base, kind, id), json, fetcher)
}

/** What `data/mounts.json` lays over the catalog (feed it to `applyOverlay`); empty when there is none. */
export async function loadOverlay(fetcher: Fetch = fetch, base = DATA): Promise<DataOverlay> {
  const file = (await getJson(`${base}/mounts.json`, fetcher)) as MountsFile | null
  return file ? { mounts: file.mounts } : {}
}

/** Replaces `data/mounts.json` whole: merge into what `loadOverlay` returned, never save a partial set. */
export async function saveMounts(file: MountsFile, fetcher: Fetch = fetch, base = DATA): Promise<SaveResult> {
  return put(`${base}/mounts.json`, file, fetcher)
}
