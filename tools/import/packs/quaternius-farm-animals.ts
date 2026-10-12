// Quaternius Farm Animals (FBX): cow, horse, llama, pig, pug, sheep and zebra, skinned and animated
// (walk, run, idle, jump, death). Each animal has its own skeleton, so each gets its own rig.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "quaternius-farm-animals",
  source: "quaternius_farmanimal",
  vendor: "quaternius",
  license: "CC0",
  include: ["FBX/*.fbx"],
  colour: { mode: "vertex" },
  // The FBX units are off: the cow converts 5.1 tall and 9.2 long. x0.3 makes it 1.5 m at the
  // shoulder-hump and 2.8 m long, a horse 2.1 m, a sheep 1.3 m and the pug 0.8 m.
  scale: { factor: 0.3 },
  pivot: "keep",
  rules: [{ match: "*", category: "animal", tags: ["farm"] }],
  overrides: { cow: { tags: ["farm", "scale-ref"] } },
  characters: ["Cow", "Horse", "Llama", "Pig", "Pug", "Sheep", "Zebra"].map((name) => ({
    match: name,
    rig: `quaternius-farm-${name.toLowerCase()}`,
  })),
  rigs: ["Cow", "Horse", "Llama", "Pig", "Pug", "Sheep", "Zebra"].map((name) => ({
    id: `quaternius-farm-${name.toLowerCase()}`,
    files: [`FBX/${name}.fbx`],
  })),
} satisfies PackConfig
