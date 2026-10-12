/**
 * A shell-aware reader for one command line, for the guard (src/guard.ts). It sees what OpenCode's
 * permission matcher can't: OpenCode checks each command's text, and a redirect that tree-sitter
 * hangs on a list, a pipeline or a group (`a && b > f`, `(a) > f`) is in no command's text.
 *
 * It reads bash and zsh (OpenCode runs the user's shell): words with their quoting, control
 * operators, every redirect with its target, here-documents, and the command lines nested in
 * `$( )`, backticks, `<( )`, `>( )` and zsh's `=( )`, wherever they sit (in a word, in double
 * quotes, in `${ }`, in a here-document's body). It does not interpret control flow: `if`, `for`,
 * `{` and `}` are words to it, which is enough to find every redirect and substitution.
 *
 * A word's `value` is its text after quote removal, or `undefined` when the shell would change it:
 * a variable, a substitution, a glob, a brace, a `$'…'` quote, or any character outside a plain
 * set. Callers treat `undefined` as "can't tell", never as safe.
 *
 * What it can't read throws `ShellSyntaxError`: an unclosed quote or substitution, a stray `)`,
 * a `case` inside a substitution (its `)` would close it early).
 */

export class ShellSyntaxError extends Error {}

export interface Word {
  /** As written, quotes and escapes included. */
  raw: string
  /** After quote removal; `undefined` when the shell would expand it. */
  value: string | undefined
}

/** `fd` is the number (or zsh/bash `{var}`) written before the operator, or empty. */
export interface Redirect {
  kind: "redirect"
  fd: string
  op: string
  target: Word
}

export type Token = { kind: "word"; word: Word } | { kind: "operator"; op: string } | Redirect

export interface Line {
  tokens: Token[]
  /** Command lines that run inside this one: substitutions and process substitutions. */
  nested: Line[]
  /** `$( )`, `$(( ))` or backticks, here or in a here-document's body. */
  substitution: boolean
  /** `<( )`, `>( )` or zsh's `=( )`. */
  process: boolean
  /** `<<`, `<<-` or the here-string `<<<`. */
  heredoc: boolean
  comment: boolean
}

/** Longest first. bash's and zsh's redirect operators, clobbering and both-stream forms included. */
const REDIRECT_OPERATORS = [
  ">>&|",
  ">>&!",
  "&>>",
  "<<<",
  "<<-",
  ">>&",
  ">>|",
  ">>!",
  ">&|",
  ">&!",
  "&>|",
  "&>!",
  "&>",
  "<<",
  "<>",
  "<&",
  ">>",
  ">&",
  ">|",
  ">!",
  ">",
  "<",
]
const REDIRECT = new RegExp(
  `^(\\d+|\\{[A-Za-z_][A-Za-z0-9_]*\\})?(${REDIRECT_OPERATORS.map((op) => op.replace(/[|!&]/g, "\\$&")).join("|")})`,
)
const CONTROL_OPERATORS = [";;&", ";;", ";&", "&&", "||", "|&", "|", ";", "&"]
/** Characters that end an unquoted word. */
const BREAK = new Set([" ", "\t", "\n", ";", "&", "|", "(", ")", "<", ">"])
/** Unquoted characters that stand for themselves in both shells; anything else may expand. */
const PLAIN = /[\p{L}\p{N}_./~@%+,:=-]/u
/** What may follow `$` to make a parameter expansion. */
const PARAMETER = /[A-Za-z0-9_@*#?$!-]/

/** Reads `text` as one command line. */
export function parse(text: string): Line {
  const reader = new Reader(text)
  return reader.line(false)
}

/** The line and every line nested in it, outermost first. */
export function* lines(line: Line): Generator<Line> {
  yield line
  for (const inner of line.nested) yield* lines(inner)
}

/** The simple commands of one line (not its nested lines): the tokens between control operators. */
export function commands(line: Line): Exclude<Token, { kind: "operator" }>[][] {
  const out: Exclude<Token, { kind: "operator" }>[][] = [[]]
  for (const token of line.tokens) {
    if (token.kind === "operator") out.push([])
    else out.at(-1)?.push(token)
  }
  return out.filter((command) => command.length > 0)
}

function emptyLine(): Line {
  return { tokens: [], nested: [], substitution: false, process: false, heredoc: false, comment: false }
}

interface Pending {
  delimiter: string
  strip: boolean
  quoted: boolean
}

class Reader {
  i = 0
  constructor(readonly text: string) {}

  /** Tokens until the end, or until the `)` that closes a substitution when `nested`. */
  line(nested: boolean): Line {
    const line = emptyLine()
    const text = this.text
    let depth = 0
    let pending: Pending[] = []
    for (;;) {
      this.blanks()
      if (this.i >= text.length) {
        if (nested) throw new ShellSyntaxError("unclosed substitution")
        if (depth > 0) throw new ShellSyntaxError("unclosed (")
        return line
      }
      const c = text[this.i] as string
      if (c === "\n") {
        line.tokens.push({ kind: "operator", op: "\n" })
        this.i++
        for (const doc of pending) this.heredoc(doc, line)
        pending = []
        continue
      }
      if (c === "#") {
        line.comment = true
        while (this.i < text.length && text[this.i] !== "\n") this.i++
        continue
      }
      if (c === ")") {
        this.i++
        if (depth > 0) {
          depth--
          line.tokens.push({ kind: "operator", op: ")" })
          continue
        }
        if (!nested) throw new ShellSyntaxError("unexpected )")
        if (pending.length > 0) throw new ShellSyntaxError("here-document inside a substitution on one line")
        return line
      }
      if (this.processStart()) {
        line.tokens.push({ kind: "word", word: this.word(line) as Word })
        continue
      }
      if (c === "(") {
        this.i++
        depth++
        line.tokens.push({ kind: "operator", op: "(" })
        continue
      }
      const redirect = REDIRECT.exec(text.slice(this.i))
      if (redirect) {
        this.i += redirect[0].length
        this.blanks()
        const target = this.word(line)
        if (!target) throw new ShellSyntaxError(`${redirect[0]} has no target`)
        const op = redirect[2] as string
        line.tokens.push({ kind: "redirect", fd: redirect[1] ?? "", op, target })
        if (op === "<<" || op === "<<-" || op === "<<<") line.heredoc = true
        if (op === "<<" || op === "<<-")
          pending.push({
            delimiter: target.value ?? target.raw,
            strip: op === "<<-",
            quoted: target.value !== undefined && target.value !== target.raw,
          })
        continue
      }
      const control = CONTROL_OPERATORS.find((op) => text.startsWith(op, this.i))
      if (control) {
        this.i += control.length
        line.tokens.push({ kind: "operator", op: control })
        continue
      }
      const word = this.word(line) as Word
      if (nested && word.raw === "case") throw new ShellSyntaxError("case inside a substitution")
      line.tokens.push({ kind: "word", word })
    }
  }

  /** Spaces, tabs and line continuations. */
  private blanks(): void {
    const text = this.text
    for (;;) {
      const c = text[this.i]
      if (c === " " || c === "\t") this.i++
      else if (c === "\\" && text[this.i + 1] === "\n") this.i += 2
      else return
    }
  }

  private processStart(): boolean {
    const c = this.text[this.i]
    return (c === "<" || c === ">" || c === "=") && this.text[this.i + 1] === "("
  }

  /** One word from here, or null when none starts here. */
  private word(line: Line): Word | null {
    const text = this.text
    const start = this.i
    let value: string | undefined = ""
    const literal = (s: string) => {
      if (value !== undefined) value += s
    }
    if (this.processStart()) {
      this.i += 2
      line.nested.push(this.line(true))
      line.process = true
      value = undefined
    }
    while (this.i < text.length) {
      const c = text[this.i] as string
      const next = text[this.i + 1]
      if (BREAK.has(c)) break
      if (c === "\\") {
        if (next !== "\n") literal(next ?? "\\")
        this.i += 2
      } else if (c === "'") {
        const close = text.indexOf("'", this.i + 1)
        if (close < 0) throw new ShellSyntaxError("unclosed single quote")
        literal(text.slice(this.i + 1, close))
        this.i = close + 1
      } else if (c === "$" && next === "'") {
        let j = this.i + 2
        while (j < text.length && text[j] !== "'") j += text[j] === "\\" ? 2 : 1
        if (j >= text.length) throw new ShellSyntaxError("unclosed $' quote")
        value = undefined
        this.i = j + 1
      } else if (c === '"') {
        this.i++
        const quoted = this.doubleQuoted(line, true)
        if (quoted === undefined) value = undefined
        else literal(quoted)
      } else if (c === "$" || c === "`") {
        this.expansion(line)
        value = undefined
      } else {
        if (!PLAIN.test(c)) value = undefined
        literal(c)
        this.i++
      }
    }
    if (this.i === start) return null
    return { raw: text.slice(start, this.i), value }
  }

  /**
   * After `$` or at a backtick: a substitution, `${ }` or a parameter, with whatever it nests.
   * A lone `$` is skipped as itself.
   */
  private expansion(line: Line): void {
    const text = this.text
    const next = text[this.i + 1]
    if (text[this.i] === "`") {
      let j = this.i + 1
      while (j < text.length && text[j] !== "`") j += text[j] === "\\" ? 2 : 1
      if (j >= text.length) throw new ShellSyntaxError("unclosed backtick")
      const inner = text.slice(this.i + 1, j).replace(/\\([`\\$])/g, "$1")
      line.nested.push(new Reader(inner).line(false))
      line.substitution = true
      this.i = j + 1
    } else if (next === "(") {
      this.i += 2
      line.nested.push(this.line(true))
      line.substitution = true
    } else if (next === "{") {
      this.i += 2
      this.braces(line)
    } else this.i += next !== undefined && PARAMETER.test(next) ? 2 : 1
  }

  /** After `${`: up to its `}`, reading the substitutions and quotes inside. */
  private braces(line: Line): void {
    const text = this.text
    while (this.i < text.length) {
      const c = text[this.i]
      if (c === "}") {
        this.i++
        return
      }
      if (c === "\\") this.i += 2
      else if (c === "'") {
        const close = text.indexOf("'", this.i + 1)
        if (close < 0) throw new ShellSyntaxError("unclosed single quote")
        this.i = close + 1
      } else if (c === '"') {
        this.i++
        this.doubleQuoted(line, true)
      } else if (c === "$" || c === "`") this.expansion(line)
      else this.i++
    }
    throw new ShellSyntaxError("unclosed ${")
  }

  /**
   * After an opening `"` (to and past the closing one), or a here-document body (to the end).
   * The literal text, or undefined when something in it expands.
   */
  private doubleQuoted(line: Line, closing: boolean): string | undefined {
    const text = this.text
    let value: string | undefined = ""
    while (this.i < text.length) {
      const c = text[this.i] as string
      const next = text[this.i + 1]
      if (closing && c === '"') {
        this.i++
        return value
      }
      if (c === "\\") {
        if (next !== undefined && '$`"\\\n'.includes(next)) {
          if (next !== "\n" && value !== undefined) value += next
          this.i += 2
        } else {
          if (value !== undefined) value += c
          this.i++
        }
      } else if (c === "$" || c === "`") {
        this.expansion(line)
        value = undefined
      } else {
        if (value !== undefined) value += c
        this.i++
      }
    }
    if (closing) throw new ShellSyntaxError("unclosed double quote")
    return value
  }

  /**
   * A here-document's body, from here to its delimiter line (or the end, which the shell accepts
   * with a warning). Unless the delimiter was quoted, the body expands like a double-quoted string,
   * so its substitutions run.
   */
  private heredoc(doc: Pending, line: Line): void {
    const text = this.text
    const start = this.i
    let end = text.length
    while (this.i < text.length) {
      const stop = text.indexOf("\n", this.i)
      const lineEnd = stop < 0 ? text.length : stop
      const body = text.slice(this.i, lineEnd)
      if ((doc.strip ? body.replace(/^\t+/, "") : body) === doc.delimiter) {
        end = this.i
        this.i = stop < 0 ? text.length : stop + 1
        break
      }
      this.i = stop < 0 ? text.length : stop + 1
    }
    if (doc.quoted) return
    const reader = new Reader(text.slice(start, end))
    reader.doubleQuoted(line, false)
  }
}
