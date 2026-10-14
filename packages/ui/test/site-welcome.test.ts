/** The welcome bar folds to its field and unfolds on focus (user pick 10-13). */
import { describe, expect, test } from "bun:test"
import { welcomeFold } from "../src/site/WelcomeCard.tsx"

describe("the welcome bar", () => {
  test("focusing or clicking the field unfolds Generate and the links", () => {
    expect(welcomeFold(false, "focus", "")).toEqual({ open: true })
    expect(welcomeFold(true, "focus", "react")).toEqual({ open: true })
  })

  test("leaving it with the field empty folds it; a typed repo keeps it open", () => {
    expect(welcomeFold(true, "leave", "")).toEqual({ open: false })
    expect(welcomeFold(true, "leave", "   ")).toEqual({ open: false })
    expect(welcomeFold(true, "leave", "facebook/react")).toEqual({ open: true })
    expect(welcomeFold(false, "leave", "")).toEqual({ open: false })
  })

  test("Esc folds an open empty bar first, and dismisses a folded one", () => {
    expect(welcomeFold(true, "escape", "")).toEqual({ open: false })
    expect(welcomeFold(false, "escape", "")).toEqual({ open: false, dismiss: true })
    expect(welcomeFold(true, "escape", "facebook/react")).toEqual({ open: true, dismiss: true })
  })
})
