import { describe, expect, test } from "bun:test"
import { commands, type Line, lines, parse, ShellSyntaxError } from "../src/shell.ts"

/** Every redirect in a line, nested ones included, as `fd op target`. */
function redirects(line: Line): string[] {
  return [...lines(line)].flatMap((inner) =>
    inner.tokens.flatMap((t) => (t.kind === "redirect" ? [`${t.fd}${t.op} ${t.target.raw}`] : [])),
  )
}
const words = (text: string) =>
  commands(parse(text)).map((command) => command.flatMap((t) => (t.kind === "word" ? [t.word.raw] : [])))

describe("shell: redirects", () => {
  test("a redirect after &&, || or | is found, whatever tree-sitter hangs it on", () => {
    expect(redirects(parse("git status && git diff HEAD > src/index.ts"))).toEqual(["> src/index.ts"])
    expect(redirects(parse("a || b >> f"))).toEqual([">> f"])
    expect(redirects(parse("a | b 2>f"))).toEqual(["2> f"])
  })

  test("a redirect on a group or subshell is found", () => {
    expect(redirects(parse("(git show) > f"))).toEqual(["> f"])
    expect(redirects(parse("{ git show; } > f"))).toEqual(["> f"])
  })

  test("every operator form is one redirect, with its descriptor", () => {
    const line = parse("a 2>&1 >&2 &>f &>>g <>h >|i 3<j <&0 >&- {fd}>k")
    expect(redirects(line)).toEqual([
      "2>& 1",
      ">& 2",
      "&> f",
      "&>> g",
      "<> h",
      ">| i",
      "3< j",
      "<& 0",
      ">& -",
      "{fd}> k",
    ])
  })

  test("a redirect inside $( ), backticks, a parameter expansion or <( ) is found", () => {
    expect(redirects(parse("echo $(git diff > a)"))).toEqual(["> a"])
    expect(redirects(parse('echo "`git diff > b`"'))).toEqual(["> b"])
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell syntax under test
    expect(redirects(parse("echo ${X:-$(id > c)}"))).toEqual(["> c"])
    expect(redirects(parse("diff <(git show > d) x"))).toEqual(["> d"])
  })

  test("a newline ends a command; a backslash-newline doesn't", () => {
    expect(words("a\nb > f")).toEqual([["a"], ["b"]])
    expect(redirects(parse("a \\\n> f"))).toEqual(["> f"])
    expect(words("a \\\nb")).toEqual([["a", "b"]])
  })
})

describe("shell: quoting", () => {
  test("'>' and \">\" inside quotes are text, not redirects", () => {
    expect(redirects(parse("echo '>' AGENTS.md"))).toEqual([])
    expect(redirects(parse('echo "> AGENTS.md"'))).toEqual([])
    expect(redirects(parse("echo 'a && b > f'"))).toEqual([])
  })

  test("an escaped > is text", () => {
    expect(redirects(parse("echo \\> AGENTS.md"))).toEqual([])
  })

  test("a quoted word's value is its text; an expanding word has none", () => {
    const [[, quoted, escaped, variable, glob, ansi]] = commands(parse("x 'A'\"B\" C\\D $HOME a* $'\\x41'"))
    const value = (t: unknown) => (t as { word: { value?: string } }).word.value
    expect([value(quoted), value(escaped), value(variable), value(glob), value(ansi)]).toEqual([
      "AB",
      "CD",
      undefined,
      undefined,
      undefined,
    ])
  })

  test("a # inside a word or quotes is not a comment", () => {
    expect(parse("echo a#b '#c'").comment).toBe(false)
    expect(parse("echo x # > f").comment).toBe(true)
    expect(redirects(parse("echo x # > f"))).toEqual([])
  })
})

describe("shell: here-documents", () => {
  test("a here-document's body is data, so a > in it is no redirect", () => {
    const line = parse("cat <<EOF > out\nx > AGENTS.md\nEOF\ngit status")
    expect(redirects(line)).toEqual(["<< EOF", "> out"])
    expect(line.heredoc).toBe(true)
    expect(words("cat <<EOF\nx > AGENTS.md\nEOF\ngit status")).toEqual([["cat"], ["git", "status"]])
  })

  test("an unquoted body's substitutions run, so they are read; a quoted body's are not", () => {
    expect(redirects(parse("cat <<EOF\n$(git diff > a)\nEOF"))).toEqual(["<< EOF", "> a"])
    expect(parse("cat <<'EOF'\n$(git diff > a)\nEOF").substitution).toBe(false)
  })

  test("<<- strips leading tabs from the delimiter line; <<< is a here-string", () => {
    expect(words("cat <<-EOF\n\tx\n\tEOF\nls")).toEqual([["cat"], ["ls"]])
    expect(parse("cat <<< x").heredoc).toBe(true)
  })
})

describe("shell: substitutions and errors", () => {
  test("substitution and process substitution are flagged", () => {
    expect(parse("a $(b)").substitution).toBe(true)
    expect(parse("a `b`").substitution).toBe(true)
    expect(parse("a $((1 + 2))").substitution).toBe(true)
    expect(parse("a <(b)").process).toBe(true)
    expect(parse("a =(b)").process).toBe(true)
    expect(parse("a 'b $(c)'").substitution).toBe(false)
  })

  test("what it can't read throws", () => {
    for (const text of ["a 'b", 'a "b', "a $(b", "a `b", "a ${b", "a )", "a >", "x $(case y in z) w;; esac)"])
      expect(() => parse(text)).toThrow(ShellSyntaxError)
  })
})
