/**
 * Saving in the read-only showcase: nothing is written anywhere, so every Save becomes "Download JSON"
 * (the file the dev server would have written, byte for byte) and "Copy JSON".
 */
import { formatData } from "./json.ts"

/** Offers `json` as a download named `file`. */
export function downloadJson(file: string, json: unknown): void {
  const url = URL.createObjectURL(new Blob([formatData(json)], { type: "application/json" }))
  const a = document.createElement("a")
  a.href = url
  a.download = file
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Puts `json` on the clipboard; false when the browser refuses (no permission, not a secure page). */
export async function copyJson(json: unknown): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(formatData(json))
    return true
  } catch {
    return false
  }
}
