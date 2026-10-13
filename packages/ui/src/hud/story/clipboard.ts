/** The clipboard, with V1's fallback for browsers that refuse the async one (an insecure origin, a WebView). */

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return fallbackCopy(text)
  }
}

/** A PNG onto the clipboard, where the browser allows pictures there (Chromium, Safari; not Firefox yet). */
export async function copyImage(png: Blob | Promise<Blob>): Promise<boolean> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false
  try {
    // A promise in the item keeps Safari's user-gesture window open while the PNG is encoded.
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })])
    return true
  } catch {
    return false
  }
}

/** Can this browser put a picture on the clipboard at all? */
export function canCopyImage(): boolean {
  return (
    typeof ClipboardItem !== "undefined" && typeof navigator !== "undefined" && !!navigator.clipboard?.write
  )
}

function fallbackCopy(text: string): boolean {
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.append(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand("copy")
  } catch {
    ok = false
  }
  area.remove()
  return ok
}
