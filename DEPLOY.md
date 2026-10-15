# Deploying the site

The site (https://guildhall.codestz.dev) is the Vercel project `guildhall` in the `codestzs-projects`
team. It is built on the Mac and uploaded prebuilt: the asset library (`library/`, written by
`bun run import`) is not in git, so Vercel cannot build the site from a push.

- **A push never deploys.** The root `vercel.json` sets `git.deploymentEnabled: false`, so the
  project's GitHub integration builds nothing, on `main` or on any other branch.
- **The site's own config is `apps/studio/vercel.json`**: install, build (`bun run build:showcase`),
  output (`dist`), redirects, rewrites and headers. `vercel build` reads the `vercel.json` of the
  directory it runs in, so every command below runs from `apps/studio`. Its commands override the
  dashboard's Build and Output settings, which still hold V1's.

## Once per machine

```sh
cd apps/studio
vercel link --yes --project guildhall --scope codestzs-projects
```

This writes `apps/studio/.vercel/` (git-ignored). The library must be at the repo root (`library/`).

## Each release

From a clean checkout of the commit to ship, with the library in place:

```sh
cd apps/studio
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
```

`vercel build --prod` runs `bun install --frozen-lockfile` and `bun run build:showcase` here and
writes `apps/studio/.vercel/output`; `vercel deploy --prebuilt --prod` uploads exactly that and
points guildhall.codestz.dev at it. `STUDIO_LIBRARY` (see `apps/studio/vite.config.ts`) picks how
much of the library ships; the default, `style`, is the house style's packs.

To look before going live, leave out every `--prod` (and pull `--environment=preview`):
`vercel deploy --prebuilt` then gives a preview URL and leaves production as it is.
