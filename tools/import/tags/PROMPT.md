# Vision tagging brief

You tag one batch of library pieces by looking at their thumbnails. Follow these steps exactly and
write nothing except the one output file.

## Input

`library/tags/batches/<n>.json` (the path you were given):

```json
{ "batch": 3, "vocab": { "groups": { "form": […], … }, "front": ["+z","-z","+x","-x","none"] },
  "items": [ { "id": "pack/slug", "thumb": "/abs/path.webp", "thumbHash": "…", "name": "…",
               "category": "building", "size": [w, h, d] } ] }
```

`size` is in metres (width x, height y, depth z). `name` and `category` come from the source files
and can be wrong: trust the picture.

## Steps

1. Read the batch file.
2. For every item, in order, open `thumb` with the Read tool and look at it. Do not skip an item and
   do not answer from the name alone.
3. Pick its tags, its front and its door (rules below).
4. After the last item, write `library/tags/batches/<n>.out.json` (same folder and number as the
   batch) with the Write tool, in exactly this shape:

```json
{
  "batch": 3,
  "by": "<your model id>",
  "items": [
    { "id": "pack/slug", "tags": ["house", "medieval", "medium", "plaster", "timber"], "front": "+z", "door": true }
  ]
}
```

One object per item, same order as the batch, `tags` sorted alphabetically. No other keys, no
comments, no prose before or after the JSON.

## Tags

- Use only tags that appear in `vocab.groups`, spelled exactly. Never invent one; a tag outside the
  vocabulary is dropped. If nothing fits a group, leave that group out.
- Pick 3 to 8 tags:
  - 1 or 2 `form` tags (what it is) or `nature` tags for plants, rocks and terrain. Required.
  - exactly 1 `size` tag, from the largest of `size`: tiny < 0.5 m, small < 2 m, medium < 10 m,
    large < 20 m, huge >= 20 m.
  - the main `material` tags you can see (at most 2).
  - a `use` tag when the purpose is clear from the picture (a sign, an anvil, crops, a bell).
  - a `state` tag only when it is not `intact` and you can see it (ruins, fire, scaffolding).
  - at most 1 `style` tag, and 1 `accent` tag when a team or trim colour dominates
    (`neutral` when there is none).
  - at most 1 `fits` tag: where a scene builder would place it.
- When unsure about a tag, leave it out. Fewer correct tags beat more guessed ones.

## Front and door

The camera looks down from the front-right at 35 degrees, so two sides are visible:

- the wider side, facing down-left in the picture, is `+z`;
- the narrower side, facing down-right in the picture, is `+x`;
- `-z` and `-x` are the hidden back sides.

`front` is the side a visitor walks up to: the door, the stairs, the open counter, the sign, the
gate opening. Answer `+z` or `+x` when it is on a visible side. Answer `-z` or `-x` only when
something clearly points that way (a porch or path leaving behind the piece). Answer `none` for
pieces with no front (trees, rocks, tiles, round towers, symmetric props) or when you cannot tell.

`door` is `true` only when a door or doorway is visible in the picture, otherwise `false`.
