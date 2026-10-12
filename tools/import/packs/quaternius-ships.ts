// Quaternius Ships (FBX): a sailing ship, a viking longship, a sailboat, a rowboat and a lifeboat.
// The cruise liner is modern and left out.
import type { PackConfig } from "@guildhall/assets"

export default {
  id: "quaternius-ships",
  source: "quaternius_ships",
  vendor: "quaternius",
  license: "CC0",
  include: ["FBX/*.fbx"],
  exclude: ["FBX/CruiseShip.fbx"],
  colour: { mode: "material" },
  // Each ship is modelled at its own scale, so each gets a factor that sets its length: the
  // sailing ship 20 m (masts 12 m), the longship 16 m, the sailboat and the rowboat 6 m and 4 m,
  // the lifeboat 5 m. Factor 1 is never used.
  scale: { factor: 1 },
  scaleBy: [
    { match: "Sail ship", factor: 3.2 },
    { match: "Viking boat", factor: 3.8 },
    { match: "BoatWSail", factor: 6 },
    { match: "Boat", factor: 6 },
    { match: "Lifeboat", factor: 4.5 },
  ],
  pivot: "bottom-centre",
  rules: [
    // Watercraft are props tagged vehicle: the vehicle band (1.2-3 m) sizes carts, and a ship's
    // masts (9.5-12 m) or a rowboat's gunwale (0.9 m) are right outside it.
    { match: "{Sail ship,Viking boat}", category: "prop", tags: ["ship", "vehicle"] },
    { match: "*", category: "prop", tags: ["boat", "vehicle"] },
  ],
  overrides: { "viking-boat": { tags: ["scale-ref", "ship", "vehicle"] } },
} satisfies PackConfig
