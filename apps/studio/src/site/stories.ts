import type { Story } from "@guildhall/ui"

const ART = "/site/demos"

/**
 * V1's Demos page ("Every scene, one link away", packages/hall/demos.html on main) as fixture data: the same
 * kickers, descriptions and "what it shows" lines, in the same shelves. The Saga carries its five acts
 * (I Dawn · II The forge · III The storm · IV The mending · V Nightfall, from the saga story's chapters).
 * The pictures are V2's own, each card's link as it opens here (`bun shots demos`). Deviations from V1: no
 * WebGPU card (V2 draws on WebGL only), the archipelago waits for its V2 port, the crowd of 300 is the
 * `rush` story's twelve until the crowd LOD lands, and repo links are the V2 route (`/hall/<owner>/<repo>`).
 */
export const STORIES: readonly Story[] = [
  {
    id: "saga",
    shelf: "Stories",
    title: "The Saga",
    kicker: "Five acts · about 3½ minutes",
    blurb:
      "One pull request from quest to release: the Guildmaster dispatches three heroes, CI turns red, a hero pleads for your word, the fix lands and the island clears.",
    shows: [
      "A plea waits for your word",
      "Red CI rolls in a storm with lightning; green clears it",
      "Heroes walk to the folders they work in",
      "Nightfall ends with a festival and fireworks",
    ],
    art: `${ART}/saga.webp`,
    alt: "The whole island at golden hour, its hall lit by the fire.",
    acts: [
      { n: 1, title: "Dawn" },
      { n: 2, title: "The forge" },
      { n: 3, title: "The storm" },
      { n: 4, title: "The mending" },
      { n: 5, title: "Nightfall" },
    ],
    link: "?story=saga",
    feature: true,
  },
  {
    id: "events",
    shelf: "Stories",
    title: "World events",
    kicker: "Every show · about 4 minutes",
    blurb:
      "One guild earns every world event in turn: red CI raises a skeleton, a red streak wakes the dragon, the 100th deed brings a comet, two falls the ghost ship, a dear session the pirates, and a clean quest a festival with fireworks at night.",
    shows: [
      "Skeletons rise on red CI and the fixer strikes the grave",
      "Dragon, comet, rainbow, ghost ship, pirate raid and galleon, each from its rule",
      "Fireworks over the keep at nightfall",
    ],
    art: `${ART}/events.webp`,
    alt: "The island at nightfall, its lamps and the festival lit.",
    acts: [
      { n: 1, title: "Dawn" },
      { n: 2, title: "Red skies" },
      { n: 3, title: "The hundredth deed" },
      { n: 4, title: "The deep" },
      { n: 5, title: "Nightfall" },
    ],
    link: "?story=events",
  },
  {
    id: "party",
    shelf: "Stories",
    title: "A party",
    kicker: "One conversation",
    blurb:
      "One guildmaster and the adventurers it sends out. Each quest is taken from the board, walked to its station and worked in front of you.",
    shows: ["Every tool call is a deed you can see", "Click anyone to follow them and read their dossier"],
    art: `${ART}/party.webp`,
    alt: "The keep's hall: a guildmaster by the fire, adventurers at their stations.",
    link: "?story=party",
  },
  {
    id: "solo",
    shelf: "Stories",
    title: "Alone",
    kicker: "One agent, one task",
    blurb:
      "A single hero with no party: one task from the board, walked to its place and finished, with the island going about its day around it.",
    shows: ["The smallest story: one hero, one quest", "Follow it and read its dossier as it works"],
    art: `${ART}/solo.webp`,
    alt: "The keep by day: a lone guildmaster at work in its yard.",
    link: "?story=solo",
  },
  {
    id: "factions",
    shelf: "Stories",
    title: "Claude Code and OpenCode",
    kicker: "Two harnesses at once",
    blurb:
      "An OpenCode party and a Claude Code party share one island, each under its own banner, each with its own guildmaster.",
    shows: ["Two sources in one world", "Parties keep their colours and their own stations"],
    art: `${ART}/factions.webp`,
    alt: "Two parties at work in the keep at golden hour.",
    link: "?story=factions",
  },
  {
    id: "seas",
    shelf: "Stories",
    title: "GitHub seas",
    kicker: "A repo's sea",
    blurb:
      "A party with its GitHub sea beside it, from the first push to the release: the repo's life as ships coming and going.",
    shows: [
      "Each pull request sails in and docks; a merge sails off with a flare",
      "Red CI brings a storm over the harbour",
    ],
    art: `${ART}/seas.webp`,
    alt: "Ships at anchor off the island's quay.",
    link: "?story=seas",
  },
  {
    id: "rush",
    shelf: "Stories",
    title: "The rush",
    kicker: "Twelve quests at once",
    blurb:
      "One guildmaster sends twelve adventurers out at once, every one animated; two give up halfway and the graveyard's dead rise, until the sweep is done.",
    shows: [
      "A dozen heroes on the move, every deed on screen",
      "V1's crowd of 300 comes back with the crowd's level of detail",
    ],
    art: `${ART}/crowd.webp`,
    alt: "The island's keep with a party of adventurers spreading out along its roads.",
    link: "?story=rush",
  },
  {
    id: "react",
    shelf: "Repos",
    title: "React grows from its first commit",
    kicker: "A growth timelapse",
    blurb:
      "React's whole history as a timelapse: every folder a district, every release a milestone, every contributor a townsfolk.",
    shows: ["Years of commits in a couple of minutes", "Milestones and captions along the tape"],
    art: `${ART}/react.webp`,
    alt: "A large voxel island crowded with districts: React's repository, grown whole.",
    link: "/hall/facebook/react",
  },
  {
    id: "world",
    shelf: "Repos",
    title: "New world",
    kicker: "The generator",
    blurb:
      "One landmass sized by a repo's files, mountain ranges laid inland, rivers that fall to the sea, forests and hill towns.",
    shows: [
      "Rivers run from the ranges to the coast, under bridges where roads cross",
      "Far land draws simpler, so the island stays light",
    ],
    art: `${ART}/world.webp`,
    alt: "React's repository as one island with mountain ranges, rivers falling to the sea, forests and hill towns.",
    link: "/hall/facebook/react",
  },
  {
    id: "island",
    shelf: "Repos",
    title: "A repo as an island",
    kicker: "Any public repo",
    blurb:
      "A public GitHub repo grown into an island: its folders become districts. The same tree always grows the same island. This one is mcpx.",
    shows: ["Read from the public file tree, never the code", "Grow your own from “Your repo as an island”"],
    art: `${ART}/island.webp`,
    alt: "A small voxel island whose districts are a repository's folders.",
    link: "/hall/Codestz/mcpx",
  },
  {
    id: "night",
    shelf: "The world",
    title: "Night and weather",
    kicker: "Time and sky",
    blurb:
      "The island at ten at night, in a storm: lamps along the paths, rain, lightning over the sea. Change the hour and the weather from the Director's controls.",
    shows: ["A full day and night cycle, and four weathers", "In Auto, failures bring the clouds"],
    art: `${ART}/night.webp`,
    alt: "The island at night in a storm: dark sea, lamps lit along the paths, rain falling.",
    link: "?hour=22&weather=storm",
  },
]
