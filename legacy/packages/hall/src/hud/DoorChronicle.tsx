import { useEffect, useState } from "react"
import { badgeMarkdown, deepenLink } from "./chronicleLinks.ts"
import { copyText } from "./clipboard.ts"
import { Icon } from "./icons.tsx"
import { useDeepChronicle } from "./useCatalog.ts"

/**
 * The repo door's chronicle actions (hud/RepoDoor.tsx' footer), for the repo typed or on screen:
 * copy a README badge that links to its island, and, for an island without a deep chronicle (one
 * grown from ~20 live API calls), "Deepen this island": the chronicles repo's request form, prefilled,
 * in a new tab. No sign-in here: the visitor files the request on GitHub themselves.
 */
export function DoorChronicle({ subject }: { subject: string | undefined }) {
  const deep = useDeepChronicle(subject)
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle")

  useEffect(() => {
    if (copied === "idle") return
    const timer = setTimeout(() => setCopied("idle"), 2200)
    return () => clearTimeout(timer)
  }, [copied])

  async function badge() {
    if (subject) setCopied((await copyText(badgeMarkdown(subject))) ? "done" : "failed")
  }

  return (
    <>
      <button type="button" className="door-act" onClick={badge} disabled={!subject}>
        {copied === "done" ? <Icon.check /> : <Icon.copy />}
        <span>
          {copied === "done" ? "Badge copied" : copied === "failed" ? "Couldn't copy" : "README badge"}
        </span>
      </button>
      {subject && deep === false && (
        <a
          className="door-act"
          href={deepenLink(subject)}
          target="_blank"
          rel="noopener noreferrer"
          title="Ask for its whole history to be chronicled (opens a GitHub issue)"
        >
          <Icon.book />
          <span>Deepen this island</span>
        </a>
      )}
      <span className="visually-hidden" aria-live="polite">
        {copied === "done" && subject ? `README badge for ${subject} copied, as Markdown` : ""}
      </span>
    </>
  )
}
