# Guildhall V2

V2 is a rebuild. The idea is V1's: events in, a living world out. The world, the engine under it and
the site around it are new. V1 is kept on the `v1` tag; its hub and hook, which live mode uses, are in `live/`.

## What's new

**A hex island that grows with the repo.**

- The island is a grid of hexagons, sized by the repo's files (`2 × (40 + 13·√files)` tiles, at most
  2,800). It grows outward in one fixed order, so a bigger island always contains the smaller one, and
  nothing moves as a repo grows.
- Terrain first: levels, hills, springs, rivers that run to the sea, lakes, and a nature lake on
  every island.
- The repo's packages and folders become places: the biggest is the capital beside the Guildhall, and
  the others become towns, villages, a harbour, a mine, a monastery, a camp, farms and hamlets, by size
  and by kind. Roads join them all.
- The Guildhall is the castle, and it grows in four tiers with the repo: a keep, a walled keep, a castle
  with wards and its great hall, a citadel. It is composed for its site: walls follow the outline, the
  gate faces the road, and a river on the edge becomes a moat.
- One collision layer that paths, people, placement and tests all read. A sweep over 720 islands
  went from about 2,000 violations per class to 0.

**Tiles and scenes authored as data.** 82 tile prefabs in `data/tiles/`, with 232 spots where people
sit, work and talk. Scenes span several tiles: a tavern with a beer garden, a training arena where
knights spar in bouts, a harbour quay, a monastery, a farmstead, a market round a fountain, a
lighthouse, a watermill.

**People at work.** Townsfolk keep a day: home at night, out to work, the tavern in the evening.
Every one of them has a trade, with visible work: chips fly at the lumber camp, dust at the mine,
sparks at the forge. Agents are heroes who walk to the package of the file they touch and work there
by craft. The Guildmaster stays in the great hall while it sends the others out. Doors open as people
pass.

**A hall for every chronicled repo.** `/hall/<owner>/<repo>` builds the island from the repo's
chronicle, names its places on plates, and puts its history on a timeline. **Watch it grow** replays
it from the first commit: tiles rise from the sea and buildings grow from the ground. The Legends book
tells the repo by era, and the Repo Chronicle card is a picture to share.

**V1's HUD, ported and tightened.** Hero chips with what each is doing, captions in the narrator's
voice, the act chip, Legends, pleas, the place dossier. The crest is one compact pill, with the repo
as its own small chip beside it. The face bar shows a real miniature portrait of each hero's own 3D
character, with state marks. Click a hero to fly to it and follow it; a director picks the shots
when nobody does. On a phone the HUD is a top row, a face bar, a caption and one bottom sheet, and a
finger drag orbits the hero you follow.

**Events on the island.** CI is the weather: a failing run brings a storm, green brings the sun back
and everyone cheers. Rain and snow have their own looks. Pull requests are ships: one sails in and
docks; merged, it dips its pennant under a gold flare and sails out; closed, it sinks at its berth.
Ships come small, medium or large by their diff, every hull under way leaves a wake, a push is a
cargo ship, and open issues queue on the quay as docket plates with a hooded petitioner each. A
place where a hero works raises a scaffold.

**V1's world events, back.** A red CI run raises a skeleton at the graveyard, which keeps vigil until
a fix, when the Guildmaster strikes the grave. Three failed builds in a row bring the dragon over the
peaks. Also a comet, a rainbow, a ghost ship, pirates, a galleon for a release, the lighthouse, and a
festival with fireworks at nightfall. Each is earned by a rule, and the island frames it. The
[World events](https://guildhall.codestz.dev/?story=events) demo earns them all in turn, and the
Saga now ends with the festival.

**Game feel.** Every townsfolk has work with a visible result: logs pile up, fish are caught, carts
roll. Heroes work by craft (read, edit, search, test) and run at a pace their legs keep. Between
people there is life: the tavern's tables drink, toast and sing at night, a few walk home tipsy, walkers
stop to chat or wave, buyers haggle, and lamplighters light the lamps at dusk.

**V1's sounds**, with 18 Kenney CC0 samples. Off until you turn them on.

**Faster.** Gzipped models, a static draw list, shared materials and less garbage a frame: frames
are 25 to 35% shorter, the hero view draws in 8.1 ms at the 95th percentile, and a first visit
downloads 5.2 MB (9.3 before).

**The Studio, public.** The workshop the world is made in: pieces and palette at true scale, the tile
composer, the hex map, NPCs, grips. Online it is read-only: explore freely, nothing is saved.

**Rendering.**

- The world is built in a worker, behind a loading cover, and shows once, whole.
- Shadow cascades are stable, and they re-aim only when the camera leaves an inner area.
- LOD crossfades where the change is under about a pixel.
- The crowd draws from one baked bone texture.
- A governor trades resolution, never detail, to hold the frame budget.
- Performance work must not change what you see.

## What changed

- **One site.** `/` is the island with a demo guild at work. `/demos`, `/harbour`, `/built`,
  `/hall/<owner>/<repo>` and `/studio` are its pages.
- **New links.** V1's `/how` redirects to `/built`, and the old `.html` pages to their new paths. A
  repo's island moves from `/?repo=owner/name` to `/hall/owner/name`.
- **Live mode runs on localhost only.** V2 has no npm package. To watch your own Claude Code
  sessions, run V1's hub and hook from `live/` and open `/hall/<owner>/<repo>?feed=live` on the dev
  server (the README has the steps). The public site plays demo stories and chronicles only.
- **Packages.** V1's `hall`, `herald` and `opencode-guildhall` are replaced by
  `core → assets → world → sim → render`, with `ui` beside them and one app, `apps/studio`. A test
  keeps the layers one-way. V1's `hub`, `claude-code`, `core` and `roster` run live mode from `live/`.
- **Assets.** One house style: chunky KayKit and Kenney pieces, all CC0, mapped onto one palette and
  baked into vertex colours. Characters are scaled so their heads reach a door's top.
- **WebGL only.** At a few dozen draw calls the cost is pixels and triangles, not calls, so WebGPU
  wasn't worth keeping yet.

## What's gone or parked

- **Animals.** Parked until after release, the dog included. The packs we had didn't match the
  low-poly style. Pens and pastures stand empty for now.
- **The archipelago.** V1's several-repos-as-islands view, and the split of a big repo into an
  archipelago, are not in V2. A repo is one island.
- **WebGPU.** V1's experimental renderer is gone; V2 draws on WebGL.
- **The crowd of 300.** The rush story sends twelve heroes; the big crowd waits for the crowd's
  level of detail in the stories.
- **The OpenCode plugin and the nine guild agents** stay V1 (`opencode-guildhall` on npm, code on
  the `v1` tag). The demo stories still include an OpenCode party.
- **"Deepen this island".** The hall has no button to request a chronicle yet; open a request on
  [guildhall-chronicles](https://github.com/Codestz/guildhall-chronicles) instead.

## Known limits

- **First load.** The island takes several seconds to build behind the cover, and a first visit
  downloads about 5.2 MB. The first frame waits on the browser's shader compile queue.
- **Big islands at a distance.** A 12,000-file island at mid and wide views takes 12 to 15 ms a
  frame, GPU-bound, over the 12 ms the governor aims for.
- **Repos without a chronicle** open as a sketch: the generator's own island at a default size,
  marked as such, not that repo's island.
- **Live mode** needs a clone, V1's hub and a hook in your Claude Code settings, and runs on
  localhost only. The hall follows the guild named like the repo; a folder with another name needs
  `&guild=`.
- **One social card** for every page: a static host can't vary it per repo.
- **Phones.** The site works on a phone, with the HUD in one bottom sheet. Quality is held by
  lowering resolution; there is no separate phone tier. It has been tried in an emulator, not yet on
  every device.
- **The deploy** is built on one machine, because the asset library is generated locally and not
  in git: `vercel build --prod` and `vercel deploy --prebuilt --prod` from `apps/studio`
  ([DEPLOY.md](DEPLOY.md)). Git-triggered deployments are off, so a push never builds the site.
