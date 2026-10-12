import { copyJson, downloadJson } from "../showcase.ts"

/**
 * What stands in for a screen's save button in the showcase: download the file the save would have
 * written, or copy it. `onDone` reports what happened, for the screen's status line.
 */
export function ExportButtons({
  file,
  json,
  disabled,
  onDone,
}: {
  /** The file name the download gets (`cottage.json`). */
  file: string
  json: unknown
  disabled?: boolean
  onDone(ok: boolean, text: string): void
}) {
  return (
    <>
      <button
        type="button"
        className="gh-tool gh-save"
        disabled={disabled}
        title="This showcase is read-only: download the file instead"
        onClick={() => {
          downloadJson(file, json)
          onDone(true, `downloaded ${file}`)
        }}
      >
        download JSON
      </button>
      <button
        type="button"
        className="gh-tool"
        disabled={disabled}
        onClick={async () => {
          const ok = await copyJson(json)
          onDone(ok, ok ? `copied ${file} to the clipboard` : "the browser refused the clipboard")
        }}
      >
        copy JSON
      </button>
    </>
  )
}
