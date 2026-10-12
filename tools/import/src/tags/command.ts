/**
 * `bun import tag emit [pack…] [--batch 40]` and `bun import tag apply [out-file…]`: the vision
 * auto-tag step. Between the two, a Claude agent follows tools/import/tags/PROMPT.md for each batch.
 * No API key and no CI: the agent run is a task Claude does, not a call this tool makes.
 */
import { paths } from "../config.ts"
import { applyAnswers } from "./apply.ts"
import { BATCH, batchFile, emitBatches } from "./emit.ts"
import { loadVocab } from "./vocab.ts"

export function parseTagArgs(argv: readonly string[]): {
  action: "emit" | "apply"
  names: string[]
  batch: number
} {
  const [action, ...rest] = argv
  if (action !== "emit" && action !== "apply") throw new Error("tag: expected `tag emit` or `tag apply`")
  const names: string[] = []
  let batch = BATCH
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string
    if (a === "--batch" && action === "emit") {
      batch = Number(rest[++i])
      if (!Number.isInteger(batch) || batch < 1) throw new Error("--batch expects a whole number >= 1")
    } else if (a.startsWith("--")) throw new Error(`unknown option ${a}`)
    else names.push(a)
  }
  return { action, names, batch }
}

/** The `tag` command; `argv` is what follows it. */
export function tagCommand(argv: readonly string[]): number {
  const { action, names, batch } = parseTagArgs(argv)
  const { library } = paths()
  const vocab = loadVocab()
  if (action === "emit") {
    const numbers = emitBatches({ library, names, vocab, batch })
    if (numbers.length === 0) console.log("tag emit: every thumbnail already has an answer")
    for (const n of numbers) console.log(`wrote ${batchFile(library, n)}`)
    return 0
  }
  const summary = applyAnswers({ library, vocab, files: names })
  for (const w of summary.warnings) console.log(`warning: ${w}`)
  console.log(`tag apply: ${summary.answers} answers, ${summary.updated} entries updated`)
  return 0
}
