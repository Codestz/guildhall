import type { BuiltContent } from "@guildhall/ui"

const J = "/site/journey"

/**
 * "How it's built", V2 edition: V1's page (how.html: crowds, WebGL against WebGPU, repos as islands…)
 * rewritten for the hex island, from the decisions file and the journey posts (docs/journey/, which are
 * gitignored, so the posts are summarised here). Numbers are the ones the repo's own tests and notes state.
 */
export const BUILT: BuiltContent = {
  eyebrow: "How it's built",
  title: "A repository, grown into an island",
  lede: "Events in, a living world out: Guildhall turns what happens in a repository (its files, its coding agents, its CI) into a hex island with people on it. It is built to be **looked at**, so every part was tuned from pictures, and every part that must always work is tested across seeds, not examples. This page walks through how, and what went wrong on the way.",
  stats: [
    { n: "2,800", unit: "tiles", label: "the most land an island gets, reached at about 11k files" },
    { n: "1", label: "source of truth for where things stand" },
    { n: "82", unit: "tiles", label: "authored as data, with 232 spots for people" },
  ],
  note: "The island is drawn with three.js in your browser. The Studio, the world and this site share one design system.",
  sections: [
    {
      id: "island",
      title: "The hex island and stable growth",
      blocks: [
        {
          kind: "p",
          text: "The island is a grid of hexagons, built from a seed and the repo's size. Land is `2 × (40 + 13·√files)` tiles, capped at 2,800, so ten times the code gets far less than ten times the land.",
        },
        {
          kind: "p",
          text: "The rule that matters is **stable growth**. The island grows outward from its centre in one fixed, seed-ordered sequence, so an island of N tiles is exactly the first N tiles of any bigger one. A repo that gains files only adds land at the edge; nothing already standing moves. That is also what lets the History view replay a repo's years: each era is the island as it was.",
        },
        {
          kind: "map",
          caption: "What the generator lays down, in order",
          rows: [
            {
              term: "Terrain",
              text: "levels, hills, springs, rivers that run to the sea, lakes, and a nature lake that is always there",
            },
            {
              term: "Places",
              text: "town, harbour, castle, market, farms, a mine, a monastery, a camp and hamlets, each placed by how suitable the ground is",
            },
            { term: "Roads", text: "laid by cost over the hexes, so every tile is within reach of a place" },
            {
              term: "Tiles to prefabs",
              text: "each tile becomes an authored prefab; multi-tile scenes fit where they can turn and mirror",
            },
            {
              term: "The castle",
              text: "the Guildhall grows in four tiers with the repo's files: a keep alone, a walled keep, a castle with wards and its great hall, then a citadel",
            },
          ],
        },
        {
          kind: "image",
          src: `${J}/island-12k.webp`,
          alt: "An island grown from twelve thousand files: districts, roads and a castle on a hex grid.",
          caption: "An island grown from a 12,000-file repo.",
          wide: true,
        },
        {
          kind: "try",
          links: [{ label: "/hall/facebook/react", href: "/hall/facebook/react" }],
          text: "Swap in any public `owner/repo`. The same tree always grows the same island.",
        },
      ],
    },
    {
      id: "buildings",
      title: "Site-aware procedural buildings",
      blocks: [
        {
          kind: "p",
          text: "Anything that will always exist on every map (the castle, the town, the lake) gets the most design, because it shows up in every combination. Those places are not stamped. They pick a **site** first: connected, dry, level, with road access. Then they are composed for it.",
        },
        {
          kind: "list",
          items: [
            "**Walls follow the real outline** of the site, and meet the keep, hall and towers with no gap.",
            "**The gate faces the road**, and the keep sits away from the gate, over a walkable yard.",
            "**A river on the edge becomes a moat**; rivers are routed after the sites are reserved, using only growth-stable data.",
            "**Doors are dynamic**: the castle gate swings open by day and for whoever comes, and closes at night.",
          ],
        },
        {
          kind: "table",
          caption: "Why the sites come first",
          head: ["Sweep over 720 islands", "Before", "After"],
          rows: [["Violations per class (castle in a river, keep over air…)", "about 2,000", "0"]],
          note: "Tests sweep seeds, extreme settings and repo sizes, and assert invariants: nothing on water, nothing overlapping, every door reachable.",
        },
        {
          kind: "image",
          src: `${J}/castle-tiers.webp`,
          alt: "The Guildhall castle at several tiers, beside the scenes it stands in.",
          caption: "The castle grows in tiers; the scenes beside it turn and mirror to fit their sites.",
          wide: true,
        },
      ],
    },
    {
      id: "collision",
      title: "One collision layer",
      blocks: [
        {
          kind: "p",
          text: "The first castle had a river through it and no way in; a keep hung over a lower tile; people walked through each other and sank into stairs. Each system had its own idea of where solid things were. The fix was to give space **one source of truth**: one layer of solid outlines, taken from the real size of each asset as placed, and one walkable-height function.",
        },
        {
          kind: "p",
          text: "Paths, the crowd, activity spots, placement and the tests all read that layer, and a debug view (`?collide=1`) draws it. Roads are sacred: no solid outline lies over a road, street, path, stair or bridge, except door thresholds and gate openings, and the minimum walkable width is about 1.6 m.",
        },
        {
          kind: "table",
          caption: "Measure the bug, then fix it: a 600-second headless crowd run",
          head: ["Measure", "Before", "After"],
          rows: [
            ["Frames with overlapping people", "3.5%", "0"],
            ["Sunk person-frames", "15,415", "0"],
            ["People in walls, per frame", "15.7", "0.06"],
          ],
          note: "Two systems each adding their own “keep right” offset had cancelled out. Duplicated responsibility is a bug class.",
        },
      ],
    },
    {
      id: "life",
      title: "Life at spots",
      blocks: [
        {
          kind: "p",
          text: "Townsfolk live by daily routines: they go to authored **spots** where they sit, work, talk or drink, and the evening finds them in the tavern garden. 232 spots and 462 blockers are authored as data on 82 tile prefabs, so a design opinion (“a canteen with a beer garden”) becomes something the simulation uses.",
        },
        {
          kind: "techs",
          items: [
            {
              title: "Spots, not scripts",
              text: "A person picks a free spot for the hour and walks there along the collision layer; every spot is tested to be reachable.",
            },
            {
              title: "Heroes are agents",
              text: "A coding agent appears as a named hero and walks to the place its work touches: the package of the file it is editing.",
            },
            {
              title: "The Guildmaster stays seated",
              text: "The session that gives the orders sits in the great hall; the heroes it sends out leave and return.",
            },
            {
              title: "Doors know",
              text: "A building shows an open doorway while someone enters or leaves it, so the cost is about zero.",
            },
          ],
        },
        {
          kind: "image",
          src: `${J}/tavern-night.webp`,
          alt: "A tavern at night with its windows lit.",
          caption: "The tavern at night, where the evening's spots are.",
        },
      ],
    },
    {
      id: "studio",
      title: "The Studio",
      blocks: [
        {
          kind: "p",
          text: "Before the world, a workshop. For anything generative, the tools to see, tweak and compare are where quality comes from, so the Studio came first, and it is the same app as this site.",
        },
        {
          kind: "techs",
          items: [
            {
              title: "Pieces and palette",
              text: "1,531 pieces from 18 asset packs, browsable at true scale, with a curated style list.",
            },
            {
              title: "Tile composer",
              text: "Move pieces with a gizmo, author where people sit and work, then try it with characters on every spot.",
            },
            {
              title: "Hex map",
              text: "A 2D map with knobs for coast, hills, rivers, forest and repo size, opening the same island in 3D in one click.",
            },
            {
              title: "Grips",
              text: "How every character holds every prop in every animation, as an editor and a matrix.",
            },
            {
              title: "Review sheets",
              text: "One command shoots every tile alone and builds contact sheets for critique.",
            },
          ],
        },
        {
          kind: "image",
          src: `${J}/studio-home.webp`,
          alt: "The Studio home screen, a gallery of its tools.",
          caption:
            "The Studio's home. Public online: every tool works, nothing is saved. Saving works on localhost.",
          wide: true,
        },
        {
          kind: "try",
          links: [{ label: "/studio", href: "/studio" }],
          text: "Turn a knob, see a castle in a river, fix the generator, prove it with a sweep.",
        },
      ],
    },
    {
      id: "rendering",
      title: "Rendering: worker build, LOD, sky",
      blocks: [
        {
          kind: "p",
          text: "The heavy world is built in a **worker**, with shader compiles started early, behind a loading cover. When the island is ready (terrain, buildings and people) it shows at once, instead of terrain first and buildings popping in.",
        },
        {
          kind: "p",
          text: "V1's flaw was that zooming in and out visibly swapped the world: things popped and the look changed with distance. V2's rule is that **performance work must not change what you see**.",
        },
        {
          kind: "list",
          items: [
            "**LOD is invisible at its switch point**: it swaps only where the difference is under about one pixel, and crossfades (dithered) over a distance band.",
            "**Every threshold has a gap** between its switch-in and switch-out distance, so nothing flickers back and forth.",
            "**Far detail** drops sub-pixel props, and far crop rows merge into one shell per field.",
            "**The quality governor** trades resolution, not detail: it moves the pixel ratio a quarter step at a time (between 1.5 and 2) to hold a 12 ms frame, waits longer after a raise that did not hold, and never overrides a Low, Medium or High picked in Settings.",
          ],
        },
        {
          kind: "p",
          text: "The sky is part of the picture. A warm midday horizon, haze that gives aerial perspective instead of fog on the water, and a thin broken cloud deck the camera looks through when it is far out, with drifting shadows on the island.",
        },
        {
          kind: "image",
          src: `/site/island-hero.webp`,
          alt: "The island from above at midday: roads, rivers, a castle and houses.",
          caption: "The island at midday, as the world draws it.",
          wide: true,
        },
        {
          kind: "p",
          text: "V1 compared WebGL with WebGPU. V2 stays on WebGL: at 30 to 43 draw calls in the bench, the cost is pixels and triangles, not calls, so WebGPU was not worth it yet. Numbers are measured with vsync on and an idle machine, because headless Chrome distorts worker timing.",
        },
      ],
    },
    {
      id: "events",
      title: "The agents and the events pipeline",
      blocks: [
        {
          kind: "p",
          text: "Everything the world shows arrives as an **event**. Coding agents (Claude Code, OpenCode), GitHub and a repo's history are different sources that speak one event model, and the world only ever reads that model.",
        },
        {
          kind: "list",
          items: [
            "**Agents become heroes.** A session is a hero with a banner colour and a family; tool calls are deeds you can watch; a plea waiting on a human puts a mark over the hero.",
            "**CI is weather.** A failing run brings the clouds and a storm; green brings the sun back, and everyone cheers.",
            "**Pull requests are ships.** One sails in and docks at the harbour; merged, it dips its pennant under a gold flare and sails out; closed, it sinks at its berth.",
            "**Ported with a golden.** V1's event model was run on recorded inputs, its outputs saved, and the V2 port is required to match exactly, which made it provably faithful.",
          ],
        },
        {
          kind: "p",
          text: "The HUD stays light: an icon rail whose panels collapse, one large panel at a time, toasts that stack at most two. The world stays the hero, and on a phone the panels become bottom sheets.",
        },
        {
          kind: "try",
          links: [
            { label: "?story=saga", href: "?story=saga" },
            { label: "?story=seas", href: "?story=seas" },
          ],
          text: "Simulated guilds, told from the first quest to the clean sweep.",
        },
      ],
    },
  ],
  journey: {
    title: "Journey",
    intro:
      "The posts written while building it: what happened, and the lesson each one left. Open one to read it here.",
    posts: [
      {
        id: "three-iterations",
        title: "Three iterations to find the real thing",
        summary:
          "V1 shipped. A “serious” V2 looked worse beside it. The fix was not more planning: it was looking.",
        image: { src: `${J}/v1-diorama.webp`, alt: "V1's island at golden hour, its hall lit by a fire." },
        blocks: [
          {
            kind: "p",
            text: "V1 turned a repository's events into a living low-poly island, and people liked the look: warm, chunky, toy-like, with mist round the island. So V2 was planned as a **serious** version: a chunked continent, smooth terrain, milestones, ADRs and a swarm of agents. The engineering was real. Then one morning V2 sat next to V1, and the new world looked worse. Every metric passed. The picture did not.",
          },
          {
            kind: "image",
            src: `${J}/v2-smooth.webp`,
            alt: "The smooth-terrain V2 attempt, dressed with buildings.",
            caption: "The smooth attempt: more engineering, a worse world.",
          },
          {
            kind: "p",
            text: "What fixed it was **jumping in**: screenshots at every step, a one-hour spike on a hex grid that looked right at once, a scale board to pick proportions, preset boards for nature. The restart was fast because the foundations (assets, engine, worker, crowd, Studio) were kept; only the skin was redone.",
          },
          {
            kind: "image",
            src: `${J}/hex-first.webp`,
            alt: "The first hex world, wide.",
            caption: "The first hex world, the afternoon of the restart.",
          },
          {
            kind: "p",
            text: "Tests tell you the thing works; only looking tells you it is the right thing. Spike cheap, look often, keep the bones.",
          },
        ],
      },
      {
        id: "studio-is-the-product",
        title: "The Studio is the product (before the product)",
        summary:
          "The best early decision: build the workshop before the world, so every bug is a one-click repro.",
        image: { src: `${J}/hexmap-2d.webp`, alt: "The 2D hex map with its knobs." },
        blocks: [
          {
            kind: "p",
            text: "Early in V2 the note was: the Studio is the key to getting this polished. Instead of generating the world and hoping, the workshop came first: an asset browser at true scale, a scale board, a tile composer, a 2D map with knobs that opens in 3D, contact sheets of every prefab.",
          },
          {
            kind: "p",
            text: "Procedural worlds fail in combinations. You only find a castle in a river at rain 2.5 and hills 0 if you can turn the knobs yourself in seconds. And every agent task ends with shots it must look at and critique, so review is of contact sheets, not diffs.",
          },
          {
            kind: "p",
            text: "For anything generative, your editor and visualizer are the quality engine. Invest there first.",
          },
        ],
      },
      {
        id: "procedural-generation",
        title: "What always exists on a map needs design",
        summary: "Stable growth, sites before composition, one collision truth, and fuzzing the knobs.",
        image: { src: `${J}/nature-presets.webp`, alt: "Three nature presets, A, B and C, side by side." },
        blocks: [
          {
            kind: "p",
            text: "It looked great on seed 1. Then the knobs were turned: more rain, flatter hills. A castle with a river through it and no gate. A keep over a cliff. People walking through each other.",
          },
          {
            kind: "p",
            text: "The fix was not patching cases but changing the model: big places pick a site first, one collision layer is read by everything, and tests sweep seeds and extreme settings asserting invariants. Nature sizes and density were then chosen from A/B/C boards and frozen as a named default.",
          },
          {
            kind: "list",
            items: [
              "Anything that always exists deserves the most design.",
              "Invariants over examples.",
              "Stability is a feature: design the order so growth never moves what is there.",
              "One source of truth for space.",
            ],
          },
        ],
      },
      {
        id: "senior",
        title: "Is a senior still a senior?",
        summary:
          "Mornings thinking with AI: it removes typing and amplifies judgement, so judgement is the job.",
        blocks: [
          {
            kind: "p",
            text: "AI removes typing and amplifies judgement; without judgement it is a fast loop to nowhere. The decisive turns on this project came from looking at the real screen and naming the root cause, not from writing more code.",
          },
          {
            kind: "p",
            text: "Taste decisions stayed human; engineering decisions were made with a recommendation and a picture. That division is what a senior is for now.",
          },
        ],
      },
      {
        id: "conducting-agents",
        title: "Conducting agents",
        summary:
          "One conductor, many workers in worktrees: briefs are contracts, and reports must say what is still weak.",
        blocks: [
          {
            kind: "p",
            text: "One conductor session talks to the owner, keeps the decisions file, writes briefs, merges and runs the checks. Workers run in git worktrees, one task each. A brief is a contract: what to read, what it owns, the acceptance (tests, the check, screenshots it must look at), and the report shape.",
          },
          {
            kind: "list",
            items: [
              "An agent once killed every dev server by name. Rule: stop processes by port or PID, never by name.",
              "Headless numbers lie: measure with vsync on and say how.",
              "Green tests, wrong picture: every visual task ends with screenshots and a before/after.",
              "Reports must say what missed the target. The backlog gets it.",
            ],
          },
          {
            kind: "p",
            text: "Agents scale execution, not direction. The leverage is in the briefs, in a conductor that verifies, and in a human who reviews pictures and decides taste.",
          },
        ],
      },
    ],
  },
}
