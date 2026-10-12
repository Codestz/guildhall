// Quaternius Ultimate Animated Animals (glTF): alpaca, bull, cow, deer, donkey, fox, horses, husky,
// shiba, stag and wolf, skinned with their own clips. Each animal has its own skeleton and rig.
import type { PackConfig } from "@guildhall/assets"

const ANIMALS = [
  "Alpaca",
  "Bull",
  "Cow",
  "Deer",
  "Donkey",
  "Fox",
  "Horse",
  "Horse_White",
  "Husky",
  "ShibaInu",
  "Stag",
  "Wolf",
]
const rig = (name: string) => `quaternius-animal-${name.toLowerCase().replace(/_/g, "-")}`

export default {
  id: "quaternius-animals",
  source: "quaternius_ultimateanimatedanimals",
  vendor: "quaternius",
  license: "CC0",
  include: ["glTF/*.gltf"],
  colour: { mode: "vertex" },
  // The same off units as the farm animals (a cow 4.6 tall, 8.1 long): x0.36 makes the cow 1.65 m
  // and 2.9 m long, a horse 1.75 m, a deer 1.55 m, a husky 1.15 m and a fox 1 m.
  scale: { factor: 0.36 },
  pivot: "keep",
  rules: [
    { match: "{Fox,Wolf,Deer,Stag}", category: "animal", tags: ["wild"] },
    { match: "{Husky,ShibaInu}", category: "animal", tags: ["dog"] },
    { match: "*", category: "animal", tags: ["farm"] },
  ],
  overrides: { horse: { tags: ["farm", "scale-ref"] } },
  characters: ANIMALS.map((name) => ({ match: name, rig: rig(name) })),
  rigs: ANIMALS.map((name) => ({ id: rig(name), files: [`glTF/${name}.gltf`] })),
} satisfies PackConfig
