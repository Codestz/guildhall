// Kenney Graveyard Kit 5.0: crypts, gravestones, iron and stone fences, lamp posts, pines and
// graveyard dressing. Its characters are left out (only KayKit bodies are used).
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "kenney-graveyard",
  source: "kenney_graveyard-kit_5.0",
  vendor: "kenney",
  license: "CC0",
  include: ["Models/GLB format/*.glb"],
  exclude: ["**/character-*.glb"],
  colour: { mode: "colormap" },
  // The crypt doors are 0.74 raw tall: x3.4 puts them at 2.5 m, a crypt at 3.4 m to the eave
  // (5.9 m with its roof), a pine 7.8 m and a lamp post 4.3 m.
  scale: { factor: 3.4 },
  scaleBy: [
    // At x3.4 a gravestone is 2-3 m and a fence 2.1 m: the grave furniture and small dressing are
    // sized to the hero instead (a gravestone 1-2 m, a bench seat 0.5 m, a coffin 1.8 m long).
    {
      match:
        "{grave*,cross*,altar-*,bench*,candle*,coffin*,detail-*,pumpkin*,urn-*,lantern-*,shovel*,hay-*,fire-basket,debris*,trunk*,rocks*}",
      factor: 2.2,
    },
    // Fences and the low brick and stone walls at x1.55: a 1-1.4 m railing and a 1.1-1.3 m wall.
    { match: "{fence*,iron-fence*,brick-wall*,stone-wall*}", factor: 1.55 },
  ],
  pivot: "bottom-centre",
  rules: [
    { match: "crypt*-door", category: "door", tags: ["door"] },
    { match: "crypt*-roof", category: "roof", attach: "roof" },
    // A mausoleum is a 3.4 m stone body (crypt-small, crypt-large) under its own roof piece; the
    // other crypts are 1.8-2.5 m tombs.
    { match: "crypt-{small,large}", category: "wall", tags: ["crypt"] },
    { match: "crypt*", category: "prop", tags: ["crypt", "grave"] },
    { match: "{iron-fence,fence}*gate*", category: "fence", attach: "gate", edgeKind: "fence" },
    { match: "{iron-fence,fence}*curve*", category: "fence", attach: "corner", edgeKind: "fence" },
    { match: "{iron-fence,fence}*", category: "fence", attach: "edge-dressing", edgeKind: "fence" },
    { match: "{brick,stone}-wall*", category: "fence", attach: "edge-dressing", edgeKind: "wall" },
    { match: "{pine*}", category: "tree" },
    { match: "{grave,grave-border}", category: "ground", attach: "ground", tags: ["grave"] },
    { match: "{gravestone*,cross*}", category: "prop", tags: ["grave"] },
    { match: "{lightpost*,lantern*,candle*,fire-basket}", category: "prop", tags: ["light"] },
    { match: "{pillar*,column*,border-pillar}", category: "prop", tags: ["pillar"] },
    { match: "{road,debris*}", category: "ground", attach: "ground" },
    { match: "rocks*", category: "rock" },
    { match: "bench*", category: "furniture" },
    { match: "*", category: "prop" },
  ],
  overrides: { "crypt-small": { tags: ["crypt", "scale-ref"] } },
} satisfies PackConfig
