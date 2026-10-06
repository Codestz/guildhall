# Sound

The guild you can hear (roadmap S1). **Muted by default**: the speaker in the toolbar or
Settings › Sound turns it on, and the first click creates the AudioContext (browsers only allow
audio after a gesture). Prefs (on, volume, notes, ambience) are kept in `hud/prefs.ts`
(`guildhall.sound`). A returning viewer who left it on gets a dot on the speaker, and their first
click starts the sound.

| File | Job |
|---|---|
| `music.ts` | Pure. Key (mood root, minor at night), pentatonic scale, pitch from deed size, timbre per deed kind, a motif per moment kind |
| `limiter.ts` | Pure. Polyphony per bus, cooldown per sound, plea repeats |
| `spatial.ts` | Pan and distance gain from the camera's ground focus (StereoPanner + gain, no HRTF) |
| `ambience.ts` | `ambienceOf` (pure levels) and five looping noise voices built once on unlock |
| `samples.ts` | The sample manifest, the fallback rule, `sampleFor` (which spot sound a moment makes), lazy loading |
| `synth.ts` | The instruments. Oscillators and envelopes per cue, disconnected when the cue ends |
| `engine.ts` | One AudioContext, the mix, the probe. `audio` is the hall's single engine |
| `SoundStage.tsx` | Mounted in the Canvas. Subscribes to live moments and samples the world every 100 ms. It never renders |

## The mix

```
notes (×0.9) ┐
sfx   (×0.7) ┼─► compressor (−20 dB, 3:1) ─► master ─► limiter (−3 dB, 20:1) ─► out
amb.  (×0.55)┘
```

Sliders are squared into gains. SFX follows the Notes slider. Ambience layers sit at 0.1–0.45
inside their bus, so they stay a bed under the notes.

- **Notes.** Every live `deed` plays one note. Bigger diffs (`size`, the lines written) give a lower,
  longer note. A deed with no size gets a high note hashed from its call. Notes are in D / F / A / E
  major pentatonic by mood (Morning Keep / Hearth / Moonstone / Arcane) and turn minor at night.
  Timbre per sigil kind: read harp, edit marimba, search kalimba, test bell, run/work pluck,
  think/consult glass, dispatch horn.
- **Motifs.** `deed-failed` low thud · `fail` minor descending figure · `recover` rising
  figure · `plea` two-note call, repeated every 7 s, softer each time, at most 3 more times, stopped
  when answered · `loot` V→I major cadence · `join` horn swell. `quest`, `plea-answered` and `leave`
  are silent.
- **Restraint.** Notes bus: 6 voices. SFX bus: 3 voices. A deed kind sounds at most every 0.11 s,
  spot sounds every 1.4–12 s (`COOLDOWNS`). Excess cues are dropped, never queued.
- **Never on a rebuild.** Only `live` moments sound. A rebuild clears pleas and voices in flight.
  Muted, or with the tab hidden, the context is suspended.
- **Ambience.** Wind (band-passed noise, wandering centre, gusts) follows the shared
  `wind.strength`. Rain is hiss plus baked droplet grains, and becomes a hush in snow. Sea is
  low-passed noise that swells, heard near open water. Fire crackle is heard near the hearth or forge
  with the camera zoomed in. Crickets play on clear, dry, warm nights. Levels are recomputed at 10 Hz
  and glide.

## Adding or swapping samples

1. Drop an `.ogg` in `packages/hall/public/audio/`.
2. List it under a name in `SAMPLES` (`samples.ts`). Set `gain` and the `rate` jitter range, and
   choose `mode`: `augment` plays with the notes, `replace` plays instead of them once loaded.
   An optional `synth` is what plays while the file is missing.
3. For a new name, add when it plays in `sampleFor`, and its cooldown in `limiter.ts`.

Files are fetched only after the sound is unlocked. A missing or undecodable file falls back
quietly: the dev server answers with HTML, which is skipped. `test/audio.test.ts` checks that every
listed file exists.

**Mapped now** (Kenney RPG Audio + Impact Sounds, CC0, in `public/assets/CREDITS.md`):

| Name | Plays on | Files |
|---|---|---|
| forge | any deed at the keep's forge station | `impactMetal_light_000–002` |
| build | edit/write at the construction yard | `impactPlank_medium_000–001` |
| quarry | deeds at the quarry | `impactMining_000–002` |
| chop | grep/glob/list in the forest | `chop` |
| book | reads at the library, scroll desk or tower | `bookFlip1–3` |
| coins | loot | `handleCoins`, `handleCoins2` |
| door | join (from the gate) | `doorOpen_1` |
| creak | recover (from the graveyard) | `creak1`, `creak3` |
| bell | fail (tolls from the graveyard, at most every 12 s) | `impactBell_heavy_004` |

Good next candidates in the packs: `footstep_wood_*` / `footstep_grass_*` (Impact) for walking,
`metalPot*` (RPG) for the tavern, `impactGlass_light_*` for loot sparkle, `doorClose_*` for `leave`.

## Probe

With `PROBE` (dev, or a `VITE_GUILDHALL_PROBE=1` build), `window.audio.probe` records every cue
decision: `{ t, sound, bus, verdict: play | cooldown | polyphony, notes (MIDI), timbres, sample,
pan, gain, who }`. Headless Chrome only starts audio after a trusted click, so in
`scripts/shot.ts` use a zero-length `drag` on the speaker.
