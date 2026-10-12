import { beforeEach, describe, expect, spyOn, test } from "bun:test"
import { clearLog, configureLog, type LogRecord, log, logRecords, setLogSink } from "../src/log.ts"

// The logger is module state: this first test sees the untouched default sink, every later one a capture.
test("the default sink is the console, by level", () => {
  const info = spyOn(console, "info").mockImplementation(() => {})
  const warn = spyOn(console, "warn").mockImplementation(() => {})
  log("boot").info("hello", { n: 1 })
  log("boot").warn("careful")
  expect(info).toHaveBeenCalledWith("[boot] hello", { n: 1 })
  expect(warn).toHaveBeenCalledWith("[boot] careful")
  info.mockRestore()
  warn.mockRestore()
})

let sunk: LogRecord[] = []

describe("with a capturing sink", () => {
  beforeEach(() => {
    sunk = []
    setLogSink((r) => sunk.push(r))
    configureLog("")
    clearLog()
  })

  describe("levels", () => {
    test("default to info for every channel", () => {
      const l = log("render:stage")
      l.trace("t")
      l.debug("d")
      l.info("i")
      l.error("e")
      expect(logRecords().map((r) => r.msg)).toEqual(["i", "e"])
    })

    test("follow globs, plain names cover children, and * sets the default", () => {
      configureLog("import:*=debug,render=warn,*=error")
      log("import:palette").debug("a")
      log("render:stage").info("dropped")
      log("render:stage").warn("b")
      log("render").warn("c")
      log("ui").warn("dropped")
      log("ui").error("d")
      expect(logRecords().map((r) => r.msg)).toEqual(["a", "b", "c", "d"])
    })

    test("the more specific rule wins whatever the order", () => {
      configureLog("*=error,import:palette=trace,import:*=warn")
      log("import:palette").trace("a")
      log("import:ao").info("dropped")
      log("import:ao").warn("b")
      expect(logRecords().map((r) => r.msg)).toEqual(["a", "b"])
    })

    test("a bad spec warns on the log channel and keeps the previous spec", () => {
      configureLog("render=debug")
      for (const bad of ["render=loud", "render", "a=b=c", "=info"]) configureLog(bad)
      expect(logRecords({ channel: "log" })).toHaveLength(4)
      expect(logRecords({ channel: "log" }).every((r) => r.level === "warn")).toBe(true)
      log("render").debug("still debug")
      expect(logRecords({ channel: "render" }).map((r) => r.msg)).toEqual(["still debug"])
    })

    test("an empty spec restores the default", () => {
      configureLog("*=error")
      configureLog("")
      log("x").info("back")
      expect(logRecords()).toHaveLength(1)
    })
  })

  describe("records", () => {
    test("carry an increasing seq, a time, and data only when given", () => {
      log("a").info("one")
      log("a").info("two", { k: 2 })
      const [one, two] = logRecords()
      expect(two!.seq).toBe(one!.seq + 1)
      expect(two!.t).toBeGreaterThanOrEqual(one!.t)
      expect("data" in one!).toBe(false)
      expect(two!.data).toEqual({ k: 2 })
    })

    test("the ring keeps the last 2000, dropping the oldest", () => {
      for (let i = 0; i < 2005; i++) log("ring").info(String(i))
      const all = logRecords()
      expect(all).toHaveLength(2000)
      expect(all[0]!.msg).toBe("5")
      expect(all.at(-1)!.msg).toBe("2004")
    })

    test("clearLog empties the buffer", () => {
      log("a").info("x")
      clearLog()
      expect(logRecords()).toEqual([])
    })
  })

  describe("child channels", () => {
    test("append ':sub', and nest", () => {
      const palette = log("import").child("palette")
      palette.info("p")
      palette.child("oklab").info("o")
      expect(logRecords().map((r) => r.channel)).toEqual(["import:palette", "import:palette:oklab"])
    })
  })

  describe("sink", () => {
    test("receives each recorded record, and not the dropped ones", () => {
      log("s").debug("dropped")
      log("s").info("kept")
      expect(sunk.map((r) => r.msg)).toEqual(["kept"])
      expect(sunk[0]).toBe(logRecords()[0]!)
    })

    test("null silences output but records are still buffered", () => {
      setLogSink(null)
      log("s").error("quiet")
      expect(sunk).toEqual([])
      expect(logRecords().map((r) => r.msg)).toEqual(["quiet"])
    })
  })

  describe("logRecords filtering", () => {
    beforeEach(() => {
      configureLog("*=trace")
      log("import").debug("1")
      log("render:stage").warn("2")
      log("import:palette").error("3")
      log("importer").info("4")
      log("import:ao").trace("5")
    })

    test("by channel keeps that channel and its children, oldest first", () => {
      expect(logRecords({ channel: "import" }).map((r) => r.msg)).toEqual(["1", "3", "5"])
      expect(logRecords({ channel: "import:*" }).map((r) => r.msg)).toEqual(["3", "5"])
    })

    test("by level keeps that level and above", () => {
      expect(logRecords({ level: "warn" }).map((r) => r.msg)).toEqual(["2", "3"])
    })

    test("both together, the same answer every time, without touching the buffer", () => {
      const first = logRecords({ channel: "import", level: "debug" }).map((r) => r.msg)
      expect(first).toEqual(["1", "3"])
      expect(logRecords({ channel: "import", level: "debug" }).map((r) => r.msg)).toEqual(first)
      expect(logRecords()).toHaveLength(5)
    })
  })
})
