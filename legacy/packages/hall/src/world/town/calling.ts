import type { ArchetypeId } from "@guildhall/roster"

/**
 * What a contributor is in the world, from where they commit (ADR 0022): the archetype whose trade
 * matches what their home folder holds. One table, first match wins, read off the folder's own name
 * (a package's, for "packages/react-devtools-core"), so `test-utils` anywhere is a Warden's and
 * `packages/core` an Architect's.
 *
 *   tests, specs, e2e, testing libs        Warden       the verifiers: they prove the work holds
 *   docs, guides, the website, the blog    Archivist    they keep the library
 *   core, compiler, kernel, infra, types   Architect    they shape what everything else stands on
 *   research, RFCs, benchmarks, perf       Scholar      they study before anyone builds
 *   examples, fixtures, demos, playground  Scout        they go out and try it the way users will
 *   scripts, CI (.github), tooling, build  Herald       they cut the releases and carry the news
 *   design, styles, themes, icons, ui      Illuminator  they design and decorate the page
 *   the root's own files (README, config)  Herald       the repo's front door: what it says it is
 *   anything else (src, lib, a package)    Artisan      the builders
 *
 * A folder the table doesn't name whose files are mostly stylesheets is an Illuminator's. Bots are
 * Automatons and anyone with no known home (a quick chronicle has none) a Wanderer: the caller's
 * rules (townsfolk.ts), not this table's.
 */

interface Calling {
  archetype: ArchetypeId
  /** Matches the folder's own name (its last segment), case ignored. */
  name: RegExp
}

const CALLINGS: readonly Calling[] = [
  { archetype: "warden", name: /(^|[-_.])(tests?|specs?|__tests__|e2e|testing|qa|conformance)([-_.]|$)/ },
  {
    archetype: "archivist",
    name: /^(docs?|documentation|guides?|website|site|www|blog|book|handbook|wiki|content)$/,
  },
  { archetype: "architect", name: /(^|[-_.])(core|compiler|kernel|engine|infra|infrastructure|types?)$/ },
  { archetype: "scholar", name: /^(research|rfcs?|proposals?|bench|benchmarks?|perf)$/ },
  { archetype: "scout", name: /^(examples?|fixtures?|demos?|playground|sandbox|samples?|starters?)$/ },
  {
    archetype: "herald",
    name: /^(scripts?|\.?github|\.circleci|\.changeset|\.husky|ci|tools?|tooling|bin|build|release|grunt|gulp)$/,
  },
  { archetype: "illuminator", name: /(^|[-_.])(design|styles?|css|themes?|icons?|ui|assets)$/ },
]

/** Languages that make a folder an Illuminator's: it is mostly stylesheets. */
const STYLESHEETS = /^(css|scss|sass|less|stylus)$/i

/** The archetype a folder's regulars are (`unit`: a chronicle unit's name, "/" for the root's own files). */
export function callingOf(unit: string, language?: string): ArchetypeId {
  if (unit === "/") return "herald"
  const own = (unit.split("/").pop() ?? unit).toLowerCase()
  const named = CALLINGS.find((calling) => calling.name.test(own))?.archetype
  if (named) return named
  return language && STYLESHEETS.test(language) ? "illuminator" : "artisan"
}
