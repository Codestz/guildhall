import { MAX_ISLANDS } from "../world/archipelago.ts"
import { type CatalogEntry, CHRONICLES_REPO, loadCatalog } from "../world/chronicle/catalog.ts"
import { growLink } from "./chronicleLinks.ts"
import { canChoose, facts, voyageOf } from "./harbourModel.ts"

/**
 * The Harbour (/harbour, harbour.html): every repo with a deep chronicle, from the chronicles repo's
 * catalog on the CDN, else the hall's own (world/chronicle/catalog.ts). A card opens its island
 * growing (`?repo=…&grow`); "Sail" takes the chosen ones (up to MAX_ISLANDS) out as an archipelago.
 * Plain DOM, no React and no three: the page stays a few kilobytes. Catalog text comes off a CDN, so
 * it is only ever set as text, never parsed as HTML.
 */

const list = document.getElementById("moorings") as HTMLUListElement
const count = document.getElementById("voyage-count") as HTMLParagraphElement
const sail = document.getElementById("sail") as HTMLAnchorElement
const sailLabel = document.getElementById("sail-label") as HTMLSpanElement
const source = document.getElementById("source") as HTMLParagraphElement
const ask = document.getElementById("ask") as HTMLAnchorElement

const chosen = new Set<string>()
let listed: string[] = []

ask.href = `https://github.com/${CHRONICLES_REPO}/issues/new?template=chronicle.yml`

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function card(entry: CatalogEntry): HTMLLIElement {
  const item = el("li", "mooring")
  const [owner, name] = entry.repo.split("/")
  const title = el("h2", "mooring-name")
  title.append(el("span", "mooring-owner", `${owner}/`), name ?? "")
  item.append(title)
  if (entry.description) item.append(el("p", "mooring-about", entry.description))

  const line = el("p", "mooring-facts")
  line.textContent = facts(entry).join(" · ")
  item.append(line)
  if (entry.languages.length > 0) {
    const tongues = el("ul", "mooring-langs")
    tongues.setAttribute("aria-label", "Main languages")
    for (const language of entry.languages) tongues.append(el("li", undefined, language))
    item.append(tongues)
  }

  const actions = el("div", "mooring-acts")
  const open = el("a", "mooring-open", "Open island")
  open.href = growLink(entry.repo)
  open.setAttribute("aria-label", `Open ${entry.repo}'s island, growing from its first commit`)
  const pick = el("label", "mooring-pick")
  const box = el("input")
  box.type = "checkbox"
  box.value = entry.repo
  box.addEventListener("change", () => {
    if (box.checked) chosen.add(entry.repo)
    else chosen.delete(entry.repo)
    refresh()
  })
  pick.append(box, el("span", undefined, "Add to voyage"))
  actions.append(open, pick)
  item.append(actions, el("p", "mooring-built", `Chronicled ${entry.built}`))
  return item
}

/** The voyage bar and the cards' boxes, after a pick. */
function refresh(): void {
  const voyage = voyageOf(listed, chosen)
  sail.href = voyage.href
  sailLabel.textContent = voyage.label
  sail.removeAttribute("aria-disabled")
  const full = !canChoose(chosen)
  for (const box of list.querySelectorAll<HTMLInputElement>("input[type=checkbox]"))
    box.disabled = full && !box.checked
  count.textContent =
    chosen.size > 0
      ? `${chosen.size} of ${MAX_ISLANDS} chosen${full ? ": the archipelago is full" : ""}`
      : `${listed.length} ${listed.length === 1 ? "island" : "islands"} moored. Choose up to ${MAX_ISLANDS} to sail together.`
}

async function main(): Promise<void> {
  const found = await loadCatalog()
  if (!found || found.catalog.repos.length === 0) {
    count.textContent = "The harbour's ledger couldn't be read just now."
    sail.hidden = true
    return
  }
  const { catalog } = found
  listed = catalog.repos.map((entry) => entry.repo)
  list.append(...catalog.repos.map(card))
  source.textContent =
    found.source === "cdn"
      ? `Ledger updated ${catalog.updated}, from the chronicles repo.`
      : "Showing the chronicles the hall ships with: the chronicles repo didn't answer."
  refresh()
}

sail.addEventListener("click", (event) => {
  if (sail.getAttribute("aria-disabled") === "true") event.preventDefault()
})
void main()
