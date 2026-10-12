import { describe, expect, test } from "bun:test"
import { homeOf } from "../src/guild/home.ts"
import { beatAt, CUT_S, cutOf } from "../src/guild/homePace.ts"
import type { GrowthFilm } from "../src/world/chronicle/growthControl.ts"
import type { GrowthCaption } from "../src/world/chronicle/growthStory.ts"

describe("the showcase home's link", () => {
  test("a bare / is the home: straight to the archipelago, no film", () => {
    expect(homeOf("", false, "showcase")).toEqual({ split: true, film: false })
    expect(homeOf("?showcase", false, "showcase")).toEqual({ split: true, film: false })
  })

  test("reduced motion plays no film", () => {
    expect(homeOf("", true, "showcase")).toEqual({ split: true, film: false })
  })

  test("split=0 keeps the one island; gen=1 and utm noise leave it the home", () => {
    expect(homeOf("?split=0", false, "showcase")).toEqual({ split: false, film: false })
    expect(homeOf("?gen=1&utm_source=x", false, "showcase")).toEqual({ split: true, film: false })
  })

  test("a link that asks for something else is not the home", () => {
    for (const search of ["?story=saga", "?repo=Codestz/mcpx", "?act=2", "?grow", "?archipelago", "?demo"])
      expect(homeOf(search, false, "showcase")).toBeNull()
  })

  test("the app (local install, dev) has no home", () => {
    expect(homeOf("", false, "app")).toBeNull()
  })
})

const caption = (t: number, kind: GrowthCaption["kind"], text: string): GrowthCaption => ({
  t,
  kind,
  when: "2013",
  text,
  tagline: "",
})

/** A film as React's: 75 s, a first commit after the prologue, districts, a castle late. */
function film(): GrowthFilm {
  return {
    repo: "facebook/react",
    plan: { duration: 75, start: 15_000, end: 20_000 },
    story: {
      captions: [
        caption(2.5, "first-commit", "First commit"),
        caption(9, "born", "a/ appears"),
        caption(20, "born", "b/ appears"),
        caption(30, "born", "c/ appears"),
      ],
      festivals: [],
      moments: [{ t: 48, text: "The castle is raised" }],
      firsts: [],
      contributors: 0,
    },
    chronicle: {} as GrowthFilm["chronicle"],
    start: 15_000,
    end: 20_000,
  } as unknown as GrowthFilm
}

describe("the home's cut of the film", () => {
  test("tells the first commit, two districts and the castle, and nothing else", () => {
    const { beats } = cutOf(film())
    expect(beats.map((beat) => beat.caption.text)).toEqual([
      "First commit",
      "a/ appears",
      "b/ appears",
      "The castle is raised",
    ])
  })

  test("a beat is slower than the years between", () => {
    const { pace, beats } = cutOf(film())
    const beat = beats[1]
    expect(beat).toBeDefined()
    expect(pace((beat?.from ?? 0) + 1)).toBeLessThan(pace(35))
  })

  test("plays the whole film in about the cut's length", () => {
    const { pace } = cutOf(film())
    let t = 0
    let seconds = 0
    while (t < 75) {
      t += pace(t) * 0.01
      seconds += 0.01
    }
    expect(Math.abs(seconds - CUT_S)).toBeLessThan(4)
  })

  test("a caption is up only inside its beat", () => {
    const cut = cutOf(film())
    expect(beatAt(cut, 2.6)?.caption.text).toBe("First commit")
    expect(beatAt(cut, 60)).toBeUndefined()
  })
})
